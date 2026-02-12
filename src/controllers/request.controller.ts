import { Request, Response } from 'express';
import { pool } from '../config/db';
import { createLog } from '../utils/logger';
import { getIO } from '../utils/socket';
import { sendPushNotification } from '../utils/push';

// --- LISTAR TODAS AS SOLICITAÇÕES (ALMOXARIFE/ADMIN) ---
export const getRequests = async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        r.*, 
        json_build_object('name', p.name, 'sector', p.sector) as requester,
        (
          SELECT json_agg(
            json_build_object(
              'id', ri.id, 
              'quantity_requested', ri.quantity_requested, 
              'custom_product_name', ri.custom_product_name, 
              'products', CASE 
                WHEN pr.id IS NOT NULL THEN json_build_object('name', pr.name, 'sku', pr.sku, 'unit', pr.unit) 
                ELSE NULL 
              END
            )
          )
          FROM request_items ri 
          LEFT JOIN products pr ON ri.product_id = pr.id 
          WHERE ri.request_id = r.id
        ) as request_items
      FROM requests r 
      LEFT JOIN profiles p ON r.requester_id = p.id 
      ORDER BY r.created_at DESC
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar solicitações' });
  }
};

// --- LISTAR MINHAS SOLICITAÇÕES (COLABORADOR) ---
export const getMyRequests = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const query = `
      SELECT 
        r.*, 
        (
          SELECT json_agg(
            json_build_object(
              'id', ri.id, 
              'quantity_requested', ri.quantity_requested, 
              'custom_product_name', ri.custom_product_name, 
              'products', CASE 
                WHEN pr.id IS NOT NULL THEN json_build_object('name', pr.name, 'sku', pr.sku, 'unit', pr.unit) 
                ELSE NULL 
              END
            )
          )
          FROM request_items ri 
          LEFT JOIN products pr ON ri.product_id = pr.id 
          WHERE ri.request_id = r.id
        ) as request_items
      FROM requests r 
      WHERE r.requester_id = $1 
      ORDER BY r.created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar minhas solicitações' });
  }
};

// --- CRIAR NOVA SOLICITAÇÃO ---
export const createRequest = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { sector, items } = req.body;
  const client = await pool.connect();

  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "O pedido deve conter pelo menos um item." });
    }

    await client.query('BEGIN');

    // 1. Cria o cabeçalho do pedido
    const reqRes = await client.query(
      'INSERT INTO requests (requester_id, sector, status) VALUES ($1, $2, $3) RETURNING id', 
      [userId, sector, 'aberto']
    );
    const requestId = reqRes.rows[0].id;

    // 2. Insere os itens
    for (const item of items) {
      const isCustom = item.product_id === 'custom' || !item.product_id;
      const productId = isCustom ? null : item.product_id;
      const customName = isCustom ? item.custom_name : null;
      const quantity = parseFloat(item.quantity);

      if (isNaN(quantity) || quantity <= 0) throw new Error("Quantidade inválida em um dos itens.");

      await client.query(
        'INSERT INTO request_items (request_id, product_id, custom_product_name, quantity_requested) VALUES ($1, $2, $3, $4)', 
        [requestId, productId, customName, quantity]
      );
    }

    await client.query('COMMIT');

    // 3. Notificações (Pós-Commit para garantir que o dado existe)
    try {
        // Socket (Tempo Real)
        getIO().to('almoxarife').emit('new_request_notification', { 
            message: `📢 Nova solicitação do setor: ${sector}`, 
            action: 'Ver Pedidos' 
        });
        
        // Push (Mobile/Background)
        sendPushNotification('almoxarife', 'Nova Solicitação!', `Setor ${sector} enviou um novo pedido.`);
    } catch (e) {
        console.warn("Erro ao enviar notificação (não crítico):", e);
    }

    res.status(201).json({ success: true, id: requestId });

  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: `Erro ao criar pedido: ${error.message}` }); 
  } finally {
    client.release();
  }
};

// --- EDITAR ITENS (APENAS SE STATUS = ABERTO) ---
export const updateRequestItems = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { items } = req.body;
  const userId = (req as any).user.id;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Trava o pedido para garantir que ninguém aprove enquanto edita
    const reqCheck = await client.query('SELECT status FROM requests WHERE id = $1 FOR UPDATE', [id]);
    
    if (reqCheck.rows.length === 0) throw new Error("Solicitação não encontrada");
    
    if (reqCheck.rows[0].status !== 'aberto') {
        throw new Error("Não é possível editar um pedido aprovado ou entregue. Volte o status para 'Aberto' primeiro.");
    }

    // Substituição total dos itens (Delete All + Insert All)
    await client.query('DELETE FROM request_items WHERE request_id = $1', [id]);
    
    for (const item of items) {
      const isCustom = item.product_id === 'custom' || !item.product_id;
      const productId = isCustom ? null : item.product_id;
      const customName = isCustom ? item.custom_name : null;
      const quantity = parseFloat(item.quantity);

      if (isNaN(quantity) || quantity <= 0) throw new Error("Quantidade inválida.");

      await client.query(
          'INSERT INTO request_items (request_id, product_id, custom_product_name, quantity_requested) VALUES ($1, $2, $3, $4)', 
          [id, productId, customName, quantity]
      );
    }

    await createLog(userId, 'EDIT_REQUEST_ITEMS', { requestId: id, itemsCount: items.length }, req.ip || '127.0.0.1');

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- ALTERAR STATUS (A LÓGICA MAIS CRÍTICA DO SISTEMA) ---
export const updateRequestStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, rejection_reason } = req.body;
  const userId = (req as any).user.id;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Busca e Trava o Pedido
    const currentRes = await client.query('SELECT status FROM requests WHERE id = $1 FOR UPDATE', [id]);
    const currentStatus = currentRes.rows[0]?.status;

    if (!currentStatus) throw new Error("Solicitação não encontrada");
    
    // Se o status for igual, não faz nada
    if (currentStatus === status) {
        await client.query('ROLLBACK');
        return res.json({ success: true });
    }

    // Busca os itens do pedido
    const itemsRes = await client.query('SELECT product_id, quantity_requested FROM request_items WHERE request_id = $1', [id]);
    const items = itemsRes.rows;

    // --- LÓGICA DE MOVIMENTAÇÃO DE ESTOQUE ---

    // CENÁRIO A: APROVAR (Aberto -> Aprovado)
    // Ação: Verifica saldo e Reserva o estoque.
    if (status === 'aprovado' && (currentStatus === 'aberto' || currentStatus === 'rejeitado')) {
      for (const item of items) {
        if (item.product_id) {
          // Trava o produto no estoque para evitar race condition
          const stockCheck = await client.query('SELECT quantity_on_hand FROM stock WHERE product_id = $1 FOR UPDATE', [item.product_id]);
          
          if (stockCheck.rows.length === 0) throw new Error(`Produto ID ${item.product_id} não possui registro de estoque.`);
          
          const onHand = parseFloat(stockCheck.rows[0].quantity_on_hand || 0);
          
          if (onHand < item.quantity_requested) {
             throw new Error(`Estoque insuficiente para o produto ID: ${item.product_id}. Disp: ${onHand}, Req: ${item.quantity_requested}`);
          }

          await client.query(`
            UPDATE stock 
            SET quantity_on_hand = quantity_on_hand - $1,
                quantity_reserved = COALESCE(quantity_reserved, 0) + $1
            WHERE product_id = $2
          `, [item.quantity_requested, item.product_id]);
        }
      }
    }
    
    // CENÁRIO B: DESFAZER APROVAÇÃO (Aprovado -> Aberto/Rejeitado)
    // Ação: Estorna a reserva (devolve para on_hand).
    else if ((status === 'aberto' || status === 'rejeitado') && currentStatus === 'aprovado') {
      for (const item of items) {
        if (item.product_id) {
          await client.query(`
            UPDATE stock 
            SET quantity_on_hand = quantity_on_hand + $1,
                quantity_reserved = GREATEST(0, COALESCE(quantity_reserved, 0) - $1)
            WHERE product_id = $2
          `, [item.quantity_requested, item.product_id]);
        }
      }
    }
    
    // CENÁRIO C: ENTREGAR (Aprovado -> Entregue)
    // Ação: Baixa definitiva do reservado. O produto sai fisicamente.
    else if (status === 'entregue' && currentStatus === 'aprovado') {
      for (const item of items) {
        if (item.product_id) {
          await client.query(`
            UPDATE stock 
            SET quantity_reserved = GREATEST(0, COALESCE(quantity_reserved, 0) - $1)
            WHERE product_id = $2
          `, [item.quantity_requested, item.product_id]);
        }
      }
    }
    
    // CENÁRIO D: CORRIGIR ENTREGA (Entregue -> Aprovado)
    // Ação: Refaz a reserva (Undo da entrega).
    else if (status === 'aprovado' && currentStatus === 'entregue') {
      for (const item of items) {
        if (item.product_id) {
           await client.query(`
             UPDATE stock 
             SET quantity_reserved = COALESCE(quantity_reserved, 0) + $1
             WHERE product_id = $2
           `, [item.quantity_requested, item.product_id]);
        }
      }
    }
    
    // CENÁRIO E: ATALHO DIRETO (Aberto -> Entregue)
    // Ação: Deduz direto do on_hand (Perigoso, mas necessário as vezes).
    else if (status === 'entregue' && currentStatus === 'aberto') {
      for (const item of items) {
        if (item.product_id) {
           const stockCheck = await client.query('SELECT quantity_on_hand FROM stock WHERE product_id = $1 FOR UPDATE', [item.product_id]);
           const onHand = parseFloat(stockCheck.rows[0]?.quantity_on_hand || 0);
           
           if (onHand < item.quantity_requested) throw new Error(`Estoque insuficiente ID: ${item.product_id}`);

           await client.query(`
             UPDATE stock 
             SET quantity_on_hand = quantity_on_hand - $1
             WHERE product_id = $2
           `, [item.quantity_requested, item.product_id]);
        }
      }
    }

    // Atualiza o status final da solicitação
    await client.query(
        'UPDATE requests SET status = $1, rejection_reason = $2 WHERE id = $3', 
        [status, rejection_reason || null, id]
    );
    
    await createLog(userId, 'UPDATE_REQUEST_STATUS', { requestId: id, oldStatus: currentStatus, newStatus: status }, req.ip || '127.0.0.1');

    await client.query('COMMIT');
    res.json({ success: true });

  } catch (error: any) {
    await client.query('ROLLBACK');
    // Se o erro for de estoque insuficiente, retorna 400 (Bad Request), senão 500
    const statusCode = error.message.includes('Estoque insuficiente') ? 400 : 500;
    res.status(statusCode).json({ error: error.message || 'Erro ao atualizar status' });
  } finally {
    client.release();
  }
};

// --- EXCLUIR SOLICITAÇÃO ---
export const deleteRequest = async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const reqRes = await client.query('SELECT status FROM requests WHERE id = $1 FOR UPDATE', [id]);
    
    if (reqRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    const { status } = reqRes.rows[0];

    // Se o pedido estava APROVADO (com estoque reservado), precisamos devolver o estoque antes de deletar
    if (status === 'aprovado') {
       const itemsRes = await client.query('SELECT product_id, quantity_requested FROM request_items WHERE request_id = $1', [id]);
       const items = itemsRes.rows;

       for (const item of items) {
         if (item.product_id) {
           await client.query(`
             UPDATE stock 
             SET quantity_reserved = GREATEST(0, COALESCE(quantity_reserved, 0) - $1),
                 quantity_on_hand = COALESCE(quantity_on_hand, 0) + $1
             WHERE product_id = $2
           `, [item.quantity_requested, item.product_id]);
         }
       }
    }

    await client.query('DELETE FROM request_items WHERE request_id = $1', [id]);
    await client.query('DELETE FROM requests WHERE id = $1', [id]);

    await client.query('COMMIT');
    res.json({ success: true });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error("Erro ao excluir solicitação:", error);
    res.status(500).json({ error: 'Erro ao excluir solicitação' });
  } finally {
    client.release();
  }
};