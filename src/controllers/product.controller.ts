import { Request, Response } from 'express';
import { pool } from '../config/db';
import { createLog } from '../utils/logger';
import { getIO } from '../utils/socket';

// Helper para tratar erros do Postgres
const handleDbError = (res: Response, error: any, context: string) => {
  console.error(`❌ Erro em ${context}:`, error);

  // Erro de Unicidade (ex: SKU já existe)
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Dados duplicados: SKU ou Nome já existem no sistema.' });
  }
  
  // Erro de Sintaxe de UUID ou Tipo de Dado
  if (error.code === '22P02') {
    return res.status(400).json({ error: 'Formato de dados inválido (ex: ID incorreto).' });
  }

  // Erro de Check Constraint (ex: quantidade negativa no banco)
  if (error.code === '23514') {
    return res.status(400).json({ error: 'Operação violou regra de integridade (ex: valor negativo não permitido).' });
  }

  return res.status(500).json({ error: error.message || 'Erro interno do servidor.' });
};

// --- LISTAR PRODUTOS ---
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.id, p.sku, p.name, p.description, p.unit, p.tags, 
        p.unit_price, p.sales_price, p.min_stock, p.active, 
        p.purchase_status, p.purchase_note, p.delivery_forecast,
        json_build_object(
          'quantity_on_hand', COALESCE(s.quantity_on_hand, 0),
          'quantity_reserved', COALESCE(s.quantity_reserved, 0),
          'quantity_open', (
             SELECT COALESCE(SUM(ri.quantity_requested), 0)
             FROM request_items ri
             JOIN requests r ON ri.request_id = r.id
             WHERE ri.product_id = p.id AND r.status = 'aberto'
          )
        ) as stock
      FROM products p
      LEFT JOIN stock s ON p.id = s.product_id
      WHERE p.active = true
      ORDER BY p.name ASC
    `);
    res.json(rows);
  } catch (error: any) {
    handleDbError(res, error, 'getProducts');
  }
};

// --- RELATÓRIO DE ESTOQUE BAIXO ---
export const getLowStock = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.id, p.sku, p.name, p.unit, p.min_stock, 
        p.purchase_status, p.purchase_note, p.delivery_forecast,
        COALESCE(s.quantity_on_hand, 0) as quantity, 
        COALESCE(s.quantity_reserved, 0) as quantity_reserved,
        s.critical_since, 
        (COALESCE(s.quantity_on_hand, 0) - COALESCE(s.quantity_reserved, 0)) as disponivel,
        (
          SELECT COALESCE(SUM(ri.quantity_requested), 0)
          FROM request_items ri
          JOIN requests r ON ri.request_id = r.id
          WHERE ri.product_id = p.id AND r.status IN ('aberto', 'aprovado')
        ) as demanda_reprimida
      FROM products p
      LEFT JOIN stock s ON p.id = s.product_id
      WHERE p.min_stock IS NOT NULL 
        AND p.active = true
        AND (COALESCE(s.quantity_on_hand, 0) - COALESCE(s.quantity_reserved, 0)) < CAST(NULLIF(CAST(p.min_stock AS TEXT), '') AS NUMERIC)
      ORDER BY (COALESCE(s.quantity_on_hand, 0) - COALESCE(s.quantity_reserved, 0)) ASC
    `);
    res.json(rows);
  } catch (error: any) {
    handleDbError(res, error, 'getLowStock');
  }
};

// --- CRIAR PRODUTO ---
export const createProduct = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { sku, name, description, unit, min_stock, quantity, unit_price, sales_price, tags } = req.body;
  
  // Validação Básica
  if (!sku || !name || !unit) {
    return res.status(400).json({ error: 'SKU, Nome e Unidade são obrigatórios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Insere o produto
    const productRes = await client.query(
      `INSERT INTO products (sku, name, description, unit, min_stock, unit_price, sales_price, tags) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        sku.trim().toUpperCase(), // Sanitização
        name.trim(), 
        description || '', 
        unit, 
        min_stock || 0, 
        unit_price || 0, 
        sales_price || 0, 
        JSON.stringify(tags || [])
      ]
    );
    const newProduct = productRes.rows[0];

    // 2. Insere o estoque inicial (se houver)
    const initialQty = quantity ? parseFloat(quantity) : 0;
    
    if (isNaN(initialQty) || initialQty < 0) {
        throw new Error("Quantidade inicial inválida.");
    }

    await client.query(
      `INSERT INTO stock (product_id, quantity_on_hand, quantity_reserved) 
       VALUES ($1, $2, 0)
       ON CONFLICT (product_id) 
       DO UPDATE SET quantity_on_hand = COALESCE(stock.quantity_on_hand, 0) + EXCLUDED.quantity_on_hand`,
      [newProduct.id, initialQty]
    );

    // 3. Log de Entrada Inicial
    if (initialQty > 0) {
      const logRes = await client.query(
        "INSERT INTO xml_logs (file_name, success, total_items) VALUES ($1, $2, $3) RETURNING id", 
        ['Estoque Inicial - Cadastro', true, 1]
      );
      await client.query(
        "INSERT INTO xml_items (xml_log_id, product_id, quantity) VALUES ($1, $2, $3)", 
        [logRes.rows[0].id, newProduct.id, initialQty]
      );
    }
    
    await client.query('COMMIT');
    await createLog(userId, 'CREATE_PRODUCT', { sku, name, initialQty }, req.ip || '127.0.0.1');

    res.status(201).json(newProduct);

  } catch (error: any) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'createProduct');
  } finally {
    client.release();
  }
};

// --- ATUALIZAR PRODUTO ---
export const updateProduct = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  const { sku, name, description, unit, min_stock, quantity, unit_price, sales_price, tags } = req.body;
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Atualiza Dados Cadastrais
    const { rows } = await client.query(
      `UPDATE products SET 
          sku = COALESCE($1, sku), 
          name = COALESCE($2, name), 
          description = COALESCE($3, description), 
          unit = COALESCE($4, unit), 
          min_stock = COALESCE($5, min_stock),
          unit_price = COALESCE($6, unit_price),
          sales_price = COALESCE($7, sales_price),
          tags = COALESCE($8, tags)
       WHERE id = $9 RETURNING *`,
      [
        sku ? sku.trim().toUpperCase() : null, 
        name ? name.trim() : null, 
        description, 
        unit, 
        min_stock, 
        unit_price, 
        sales_price, 
        tags ? JSON.stringify(tags) : null, 
        id
      ]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    
    // Se foi passado quantidade explicita (Ajuste direto no cadastro)
    if (quantity !== undefined && quantity !== "") {
      const newQty = parseFloat(quantity);
      if (isNaN(newQty) || newQty < 0) throw new Error("Quantidade inválida.");
      
      await client.query('UPDATE stock SET quantity_on_hand = $1 WHERE product_id = $2', [newQty, id]);
    }
    
    await client.query('COMMIT');
    await createLog(userId, 'UPDATE_PRODUCT', { id, name, changes: req.body }, req.ip || '127.0.0.1');

    res.json(rows[0]);
  } catch (error: any) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'updateProduct');
  } finally {
    client.release();
  }
};

// --- ATUALIZAR INFO DE COMPRAS ---
export const updatePurchaseInfo = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { purchase_status, purchase_note, delivery_forecast } = req.body;
  try {
    await pool.query(
      'UPDATE products SET purchase_status = $1, purchase_note = $2, delivery_forecast = $3 WHERE id = $4',
      [purchase_status, purchase_note, delivery_forecast || null, id]
    );
    res.json({ success: true });
  } catch (error: any) {
    handleDbError(res, error, 'updatePurchaseInfo');
  }
};

// --- ARQUIVAR/DELETAR PRODUTO ---
export const deleteProduct = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params;
  try {
    const result = await pool.query('UPDATE products SET active = false WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    await createLog(userId, 'DELETE_PRODUCT', { id, message: 'Produto arquivado' }, req.ip || '127.0.0.1');
    res.json({ message: 'Produto arquivado com sucesso' });
  } catch (error: any) {
    handleDbError(res, error, 'deleteProduct');
  }
};

// --- LISTAGEM DE ESTOQUE ---
export const getStock = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, 
        json_build_object('id', p.id, 'name', p.name, 'sku', p.sku, 'unit', p.unit, 'min_stock', p.min_stock, 'unit_price', p.unit_price, 'sales_price', p.sales_price) as products 
      FROM stock s 
      JOIN products p ON s.product_id = p.id 
      WHERE p.active = true
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar estoque' });
  }
};

// --- AJUSTE MANUAL DE ESTOQUE (CORREÇÃO DIRETA) ---
export const updateStock = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const { id } = req.params; // ID do STOCK
  const { quantity_on_hand } = req.body;
  
  const newQty = parseFloat(quantity_on_hand);
  if (isNaN(newQty) || newQty < 0) {
      return res.status(400).json({ error: "Quantidade inválida." });
  }

  try {
    const oldStock = await pool.query('SELECT quantity_on_hand, product_id FROM stock WHERE id = $1', [id]);
    
    if (oldStock.rows.length === 0) {
        return res.status(404).json({ error: "Registro de estoque não encontrado." });
    }

    await pool.query('UPDATE stock SET quantity_on_hand = $1 WHERE id = $2', [newQty, id]);
    
    await createLog(userId, 'UPDATE_STOCK', { 
         stock_id: id, 
         product_id: oldStock.rows[0].product_id,
         old_qty: oldStock.rows[0].quantity_on_hand,
         new_qty: newQty 
    }, req.ip || '127.0.0.1');

    res.json({ success: true });
  } catch (error: any) {
    handleDbError(res, error, 'updateStock');
  }
};

// --- ENTRADA MANUAL DE MERCADORIA ---
export const manualEntry = async (req: Request, res: Response) => {
  const { items } = req.body; 
  const client = await pool.connect();
  
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Sem itens para dar entrada." });
    }

    await client.query('BEGIN');
    
    const logRes = await client.query(
        "INSERT INTO xml_logs (file_name, success, total_items) VALUES ($1, $2, $3) RETURNING id", 
        [`Entrada Manual - ${new Date().toLocaleDateString('pt-BR')}`, true, items.length]
    );
    const logId = logRes.rows[0].id;
    
    for (const item of items) {
      const qty = parseFloat(item.quantity);
      if (!item.product_id || isNaN(qty) || qty <= 0) {
          throw new Error(`Item inválido ou quantidade zerada (ID: ${item.product_id}).`);
      }
      
      // Verifica se produto existe
      const prodCheck = await client.query("SELECT id FROM products WHERE id = $1", [item.product_id]);
      if (prodCheck.rows.length === 0) throw new Error(`Produto ID ${item.product_id} não encontrado.`);

      await client.query(
          "INSERT INTO xml_items (xml_log_id, product_id, quantity) VALUES ($1, $2, $3)", 
          [logId, item.product_id, qty]
      );
      
      await client.query(
          "UPDATE stock SET quantity_on_hand = COALESCE(quantity_on_hand, 0) + $1 WHERE product_id = $2", 
          [qty, item.product_id]
      );
    }

    await client.query('COMMIT');
    
    getIO().to('compras').emit('new_request_notification', { 
        message: '📦 Nova entrada de mercadoria registrada!', 
        action: 'Ver Estoque' 
    });

    res.status(201).json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    // Se o erro foi gerado manualmente pelo throw, retorna 400. Senão, 500.
    const status = error.message.includes('Item inválido') || error.message.includes('não encontrado') ? 400 : 500;
    res.status(status).json({ error: error.message || "Erro na entrada manual" });
  } finally {
    client.release();
  }
};

// --- SAÍDA MANUAL BLINDADA (WITHDRAWAL) ---
export const manualWithdrawal = async (req: Request, res: Response) => {
  const { sector, items } = req.body;
  const userId = (req as any).user.id;
  const client = await pool.connect();
  
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Sem itens para retirar." });
    }

    await client.query('BEGIN');
    
    const sepRes = await client.query(
        'INSERT INTO separations (destination, status, type) VALUES ($1, $2, $3) RETURNING id', 
        [sector, 'concluida', 'manual']
    );
    const separationId = sepRes.rows[0].id;
    
    for (const item of items) {
      const qtdToWithdraw = parseFloat(item.quantity);

      if (!item.product_id || isNaN(qtdToWithdraw) || qtdToWithdraw <= 0) {
          throw new Error("Item inválido: ID faltando ou quantidade negativa.");
      }

      // --- BLINDAGEM DE ESTOQUE (LOCK) ---
      // 'FOR UPDATE' trava a linha do produto. Ninguém mais consegue editar o estoque
      // deste produto até esta transação terminar (COMMIT ou ROLLBACK).
      const stockRes = await client.query(
          'SELECT quantity_on_hand FROM stock WHERE product_id = $1 FOR UPDATE', 
          [item.product_id]
      );
      
      if (stockRes.rows.length === 0) throw new Error(`Estoque não inicializado para produto ID: ${item.product_id}`);

      const currentStock = parseFloat(stockRes.rows[0].quantity_on_hand);

      if (currentStock < qtdToWithdraw) {
          throw new Error(`Estoque insuficiente para o produto ID: ${item.product_id}. Disponível: ${currentStock}, Solicitado: ${qtdToWithdraw}`);
      }

      await client.query(
          'INSERT INTO separation_items (separation_id, product_id, quantity) VALUES ($1, $2, $3)', 
          [separationId, item.product_id, qtdToWithdraw]
      );
      
      await client.query(
          'UPDATE stock SET quantity_on_hand = quantity_on_hand - $1 WHERE product_id = $2', 
          [qtdToWithdraw, item.product_id]
      );
    }
    
    await createLog(userId, 'MANUAL_WITHDRAWAL', { separationId, count: items.length }, req.ip || '127.0.0.1');
    
    await client.query('COMMIT');
    res.status(201).json({ success: true });

  } catch (error: any) {
    await client.query('ROLLBACK');
    // Retorna 400 se for erro de validação/estoque
    const status = error.message.includes('Estoque insuficiente') || error.message.includes('Item inválido') ? 400 : 500;
    res.status(status).json({ error: error.message || "Erro na saída manual" });
  } finally {
    client.release();
  }
};

// --- CÁLCULO DE ESTOQUE MÍNIMO ---
export const calculateMinStock = async (req: Request, res: Response) => {
  const { days } = req.body;
  const period = Number(days);
  
  if (!period || period < 7 || period > 365 || isNaN(period)) {
    return res.status(400).json({ error: 'Período inválido (entre 7 e 365 dias)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period);

    const { rows: consumptionData } = await client.query(`
      SELECT 
        si.product_id, p.sku, p.name, COALESCE(p.min_stock, 0) as old_min, SUM(si.quantity) as total_consumed 
      FROM separation_items si 
      JOIN separations s ON si.separation_id = s.id 
      JOIN products p ON si.product_id = p.id 
      WHERE 
        s.status = 'concluida' 
        AND s.created_at >= $1
        AND p.active = true
        AND p.name NOT ILIKE '%teste%'  
      GROUP BY si.product_id, p.sku, p.name, p.min_stock
    `, [cutoffDate]);

    let updatedProducts: any[] = []; 

    for (const item of consumptionData) {
      const total = parseFloat(item.total_consumed);
      const avgDaily = total / period;
      
      // Cálculo: Média diária * 15 dias de segurança
      const newMinStock = Math.ceil(avgDaily * 15);

      if (newMinStock > 0 && newMinStock !== parseFloat(item.old_min)) {
        await client.query('UPDATE products SET min_stock = $1 WHERE id = $2', [newMinStock, item.product_id]);
        
        updatedProducts.push({
          id: item.product_id,
          sku: item.sku,
          name: item.name,
          oldMin: parseFloat(item.old_min),
          newMin: newMinStock,
          avgConsumption: parseFloat(avgDaily.toFixed(2))
        });
      }
    }

    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: `Cálculo concluído. ${updatedProducts.length} produtos alterados.`,
      updatedProducts: updatedProducts 
    });
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    handleDbError(res, error, 'calculateMinStock');
  } finally { 
    client.release(); 
  }
};