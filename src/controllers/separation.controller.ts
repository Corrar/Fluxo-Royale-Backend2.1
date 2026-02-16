import { Request, Response } from 'express';
import { pool } from '../config/db';
import { createLog } from '../utils/logger';
import { getIO } from '../utils/socket';

// --- LISTAR SEPARAÇÕES (COM ITENS E DEVOLUÇÕES) ---
export const getSeparations = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        s.*,
        (
          SELECT json_agg(
            json_build_object(
              'id', si.id,
              'product_id', si.product_id, 
              'quantity', si.quantity,
              'qty_requested', si.qty_requested,
              'products', json_build_object(
                 'name', p.name, 
                 'sku', p.sku, 
                 'unit', p.unit,
                 'unit_price', COALESCE(p.unit_price, 0),
                 'stock', json_build_object(
                    'quantity_on_hand', COALESCE(st.quantity_on_hand, 0),
                    'quantity_reserved', COALESCE(st.quantity_reserved, 0)
                 )
              )
            )
          )
          FROM separation_items si
          JOIN products p ON si.product_id = p.id
          LEFT JOIN stock st ON p.id = st.product_id
          WHERE si.separation_id = s.id
        ) as items,
        (
           SELECT json_agg(
             json_build_object(
               'id', sr.id,
               'product_id', sr.product_id,
               'quantity', sr.quantity,
               'status', sr.status,
               'product_name', p.name
             )
           )
           FROM separation_returns sr
           JOIN products p ON sr.product_id = p.id
           WHERE sr.separation_id = s.id
        ) as returns
      FROM separations s
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar separações' });
  }
};

// --- CRIAR NOVA SEPARAÇÃO (ORDEM DE PRODUÇÃO/OP) ---
export const createSeparation = async (req: Request, res: Response) => {
  const { destination, client_name, production_order, items } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Cria o cabeçalho
    const sepRes = await client.query(
      `INSERT INTO separations (destination, client_name, production_order, status, type) 
       VALUES ($1, $2, $3, 'pendente', 'op') 
       RETURNING id`,
      [destination, client_name, production_order]
    );
    const separationId = sepRes.rows[0].id;

    // Insere os itens com quantidade zerada (será preenchida na separação real)
    for (const item of items) {
       await client.query(
         `INSERT INTO separation_items (separation_id, product_id, qty_requested, quantity) 
          VALUES ($1, $2, $3, 0)`,
         [separationId, item.product_id, item.quantity] 
       );
    }
    
    await client.query('COMMIT');
    
    // Notifica Almoxarife e Admin
    getIO().to('almoxarife').emit('separations_update');
    getIO().to('admin').emit('separations_update');

    res.status(201).json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- PROCESSAR SEPARAÇÃO (RESERVAR OU ENTREGAR) ---
export const authorizeSeparation = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { items, action } = req.body; // action: 'reservar' | 'entregar'
  const userId = (req as any).user.id;
  
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verifica se a separação existe e trava para edição
    const sepCheck = await client.query('SELECT status FROM separations WHERE id = $1 FOR UPDATE', [id]);
    if (sepCheck.rows.length === 0) throw new Error("Separação não encontrada");

    for (const item of items) {
      // Busca o estado anterior do item na separação
      const oldItemRes = await client.query('SELECT quantity, product_id FROM separation_items WHERE id = $1', [item.id]);
      
      if (oldItemRes.rows.length > 0) {
          const oldQty = parseFloat(oldItemRes.rows[0].quantity || 0);
          const newQty = parseFloat(item.quantity); // Quantidade que está sendo processada agora
          const productId = oldItemRes.rows[0].product_id;
          
          const diff = newQty - oldQty;

          // Atualiza a quantidade confirmada na tabela de separação
          await client.query('UPDATE separation_items SET quantity = $1 WHERE id = $2', [newQty, item.id]);

          if (productId) {
            
            // --- AÇÃO: RESERVAR (Aloca do Disponível -> Reservado) ---
            if (action === 'reservar') {
              if (diff !== 0) {
                 // Se estamos aumentando a reserva, verifica se tem estoque disponível
                 if (diff > 0) {
                    const stockCheck = await client.query('SELECT quantity_on_hand FROM stock WHERE product_id = $1 FOR UPDATE', [productId]);
                    const currentHand = parseFloat(stockCheck.rows[0]?.quantity_on_hand || 0);
                    
                    if (currentHand < diff) {
                       throw new Error(`Estoque insuficiente no produto ID ${productId}. Necessário: ${diff}, Disponível: ${currentHand}`);
                    }
                 }
                 
                 // Ajusta o estoque: Tira do Disponível, põe no Reservado
                 await client.query(`
                    UPDATE stock 
                    SET quantity_on_hand = quantity_on_hand - $1, 
                        quantity_reserved = COALESCE(quantity_reserved, 0) + $1 
                    WHERE product_id = $2
                 `, [diff, productId]);
              }
            } 
            
            // --- AÇÃO: ENTREGAR (Baixa Definitiva do Reservado) ---
            else if (action === 'entregar') {
              // Lógica:
              // 1. O item estava reservado (oldQty). Removemos essa reserva.
              // 2. Se newQty < oldQty (entregou menos do que separou), a diferença (sobra) volta para o Disponível.
              // 3. O newQty "some" do sistema (foi entregue fisicamente).
              
              const sobra = oldQty - newQty; // Se positivo, volta pro estoque. Se negativo (impossível na logica normal), seria erro.

              await client.query(`
                UPDATE stock 
                SET quantity_reserved = GREATEST(0, quantity_reserved - $1), 
                    quantity_on_hand = quantity_on_hand + $2
                WHERE product_id = $3
              `, [oldQty, sobra, productId]);
            }
          }
      }
    }

    // Atualiza status da Separação
    if (action === 'entregar') {
      await client.query("UPDATE separations SET status = 'entregue', sent_at = NOW() WHERE id = $1", [id]);
    } else if (action === 'reservar') {
       await client.query("UPDATE separations SET status = 'em_separacao' WHERE id = $1", [id]);
    }

    await createLog(userId, 'UPDATE_SEPARATION', { separationId: id, action }, req.ip || '127.0.0.1');
    
    await client.query('COMMIT');
    
    getIO().emit('separations_update'); // Atualiza paineis

    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    // Se for erro de estoque, 400. Senão, 500.
    const status = error.message.includes('Estoque insuficiente') ? 400 : 500;
    res.status(status).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- CRIAR SOLICITAÇÃO DE DEVOLUÇÃO ---
export const createReturn = async (req: Request, res: Response) => {
  const { id } = req.params; // ID da Separação
  const { items } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    
    for (const item of items) {
      if (item.quantity > 0) {
        await client.query(
          `INSERT INTO separation_returns (separation_id, product_id, quantity, status) 
           VALUES ($1, $2, $3, 'pendente')`,
          [id, item.product_id, item.quantity]
        );
      }
    }
    
    await client.query('COMMIT');
    getIO().to('almoxarife').emit('separations_update');
    
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- PROCESSAR DEVOLUÇÃO (APROVAR/REJEITAR) ---
export const processReturn = async (req: Request, res: Response) => {
  const { id } = req.params; // ID da Devolução (separation_returns)
  const { status } = req.body; // 'aprovado' ou 'rejeitado'
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    
    // 1. Verifica e trava a devolução
    const checkRes = await client.query(
        "SELECT status, product_id, quantity FROM separation_returns WHERE id = $1 FOR UPDATE", 
        [id]
    );
    
    if (checkRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: "Devolução não encontrada" });
    }

    const current = checkRes.rows[0];
    
    // Garante que não processe duas vezes
    if (current.status !== 'pendente') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Esta devolução já foi ${current.status}.` });
    }

    // 2. Atualiza o status
    await client.query("UPDATE separation_returns SET status = $1 WHERE id = $2", [status, id]);

    // 3. Se APROVADO, o item volta fisicamente para o estoque (Available/On Hand)
    if (status === 'aprovado') {
        await client.query(
          "UPDATE stock SET quantity_on_hand = quantity_on_hand + $1 WHERE product_id = $2",
          [current.quantity, current.product_id]
        );
    }

    await client.query('COMMIT');
    
    getIO().emit('separations_update');
    
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error("Erro ao processar devolução:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};
