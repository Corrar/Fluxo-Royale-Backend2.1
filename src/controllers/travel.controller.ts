// ficheiro: src/controllers/travel.controller.ts

import { Request, Response } from 'express';
import { pool } from '../config/db';
import { getIO } from '../utils/socket'; // Opcional, para atualizar o ecrã em tempo real

// ==========================================
// 🚀 1. LISTAR TODAS AS VIAGENS
// ==========================================
export const getTravels = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        COALESCE(t.checklist_groups, '[]'::jsonb) as checklists,
        COALESCE(t.tags, '[]'::jsonb) as tags,
        COALESCE(t.attachments, '[]'::jsonb) as attachments,
        COALESCE(t.comments, '[]'::jsonb) as comments,
        (SELECT json_agg(tt) FROM travel_technicians tt WHERE tt.travel_id = t.id) as technicians,
        (SELECT json_agg(tl) FROM travel_time_logs tl WHERE tl.travel_id = t.id) as time_logs,
        (SELECT json_agg(tm) FROM travel_messages tm WHERE tm.travel_id = t.id) as messages
      FROM travels t
      ORDER BY t.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar viagens:', error);
    res.status(500).json({ error: 'Erro interno ao buscar as viagens.' });
  }
};

// ==========================================
// 🚀 2. CRIAR NOVA VIAGEM (Alinhado com o Frontend)
// ==========================================
export const createTravel = async (req: Request, res: Response) => {
  // Agora recebemos tudo o que o painel envia
  const { title, description, priority, checklists, tags, imageUrl, dueDate, listId } = req.body;
  const created_by = (req as any).user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO travels 
        (title, description, priority, checklist_groups, tags, cover_url, due_date, status, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        title, 
        description || '', 
        priority || 'medium', 
        checklists ? JSON.stringify(checklists) : '[]', 
        tags ? JSON.stringify(tags) : '[]', 
        imageUrl || null, 
        dueDate || null, 
        listId || 'list-todo', // A coluna que ele pertence
        created_by
      ]
    );

    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar viagem:', error);
    res.status(500).json({ error: 'Erro ao criar a viagem.' });
  }
};

// ==========================================
// 🚀 3. BUSCAR VIAGEM POR ID
// ==========================================
export const getTravelById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT t.*, 
        COALESCE(t.checklist_groups, '[]'::jsonb) as checklists,
        COALESCE(t.tags, '[]'::jsonb) as tags,
        COALESCE(t.attachments, '[]'::jsonb) as attachments,
        COALESCE(t.comments, '[]'::jsonb) as comments
      FROM travels t
      WHERE t.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Viagem não encontrada.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar viagem.' });
  }
};

// ==========================================
// ✨ 4. AUTO-SAVE & EDITAÇÃO GENÉRICA
// ==========================================
export const updateTravelDetails = async (req: Request, res: Response) => {
  const { id } = req.params;
  // Extraímos os nomes dos campos exatos que o frontend envia
  const { title, description, priority, dueDate, imageUrl, tags, checklists, attachments, comments } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE travels 
       SET 
         title = COALESCE($1, title), 
         description = COALESCE($2, description), 
         priority = COALESCE($3, priority), 
         due_date = COALESCE($4, due_date), 
         cover_url = COALESCE($5, cover_url),
         tags = COALESCE($6::jsonb, tags), 
         checklist_groups = COALESCE($7::jsonb, checklist_groups), 
         attachments = COALESCE($8::jsonb, attachments), 
         comments = COALESCE($9::jsonb, comments),
         updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [
        title, 
        description, 
        priority, 
        dueDate, 
        imageUrl, 
        tags ? JSON.stringify(tags) : null, 
        checklists ? JSON.stringify(checklists) : null, 
        attachments ? JSON.stringify(attachments) : null, 
        comments ? JSON.stringify(comments) : null, 
        id
      ]
    );

    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro no AutoSave:', error);
    res.status(500).json({ error: 'Erro ao guardar os detalhes.' });
  }
};

// ==========================================
// 🗑️ 5. APAGAR VIAGEM
// ==========================================
export const deleteTravel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Apaga as tabelas dependentes primeiro para evitar erro de Foreign Key
    await pool.query('DELETE FROM travel_messages WHERE travel_id = $1', [id]);
    await pool.query('DELETE FROM travel_technicians WHERE travel_id = $1', [id]);
    await pool.query('DELETE FROM travel_time_logs WHERE travel_id = $1', [id]);
    
    // Apaga a viagem
    await pool.query('DELETE FROM travels WHERE id = $1', [id]);
    
    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao excluir viagem:', error);
    res.status(500).json({ error: 'Erro ao excluir a viagem.' });
  }
};

// ==========================================
// ✅ 6. TOGGLE DE TAREFAS
// ==========================================
export const toggleChecklistItem = async (req: Request, res: Response) => {
  const { id, groupId, itemId } = req.params;
  try {
    const result = await pool.query('SELECT checklist_groups FROM travels WHERE id = $1', [id]);
    if(result.rows.length === 0) return res.status(404).json({error: "Viagem não encontrada"});
    
    let checklists = result.rows[0].checklist_groups || [];
    if (typeof checklists === 'string') checklists = JSON.parse(checklists);

    const updatedChecklists = checklists.map((c: any) => {
        if(c.id === groupId) {
          return {
              ...c,
              items: c.items.map((i: any) => i.id === itemId ? { ...i, completed: !i.completed } : i)
          }
        }
        return c;
    });

    await pool.query('UPDATE travels SET checklist_groups = $1 WHERE id = $2', [JSON.stringify(updatedChecklists), id]);
    
    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.json({ success: true });
  } catch (error) {
    console.error('Erro no toggle:', error);
    res.status(500).json({ error: 'Erro ao atualizar a tarefa.' });
  }
};

// ==========================================
// 🔄 7. ATUALIZAR STATUS (Drag and Drop)
// ==========================================
export const updateTravelStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE travels SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );

    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao mover o cartão.' });
  }
};

// ==========================================
// 👨‍🔧 8. ATRIBUIR TÉCNICO E BATER PONTO
// ==========================================
export const assignTechnician = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.body; 
  try {
    const result = await pool.query(`INSERT INTO travel_technicians (travel_id, user_id) VALUES ($1, $2) RETURNING *`, [id, user_id]);
    
    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Erro ao atribuir.' }); }
};

// ✨ NOVA FUNÇÃO AQUI: Remover o técnico da viagem
export const removeTechnician = async (req: Request, res: Response) => {
  const { id, userId } = req.params;
  try {
    await pool.query(`DELETE FROM travel_technicians WHERE travel_id = $1 AND user_id = $2`, [id, userId]);
    
    const io = getIO();
    if (io) io.emit('travel_board_updated');

    res.json({ success: true });
  } catch (error) { 
    console.error('Erro ao remover técnico:', error);
    res.status(500).json({ error: 'Erro ao remover técnico.' }); 
  }
};

export const clockIn = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = (req as any).user?.id; 
  try {
    const result = await pool.query(`INSERT INTO travel_time_logs (travel_id, user_id, check_in) VALUES ($1, $2, NOW()) RETURNING *`, [id, user_id]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Erro ao dar entrada.' }); }
};

export const clockOut = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = (req as any).user?.id; 
  try {
    const result = await pool.query(`UPDATE travel_time_logs SET check_out = NOW() WHERE travel_id = $1 AND user_id = $2 AND check_out IS NULL RETURNING *`, [id, user_id]);
    if (result.rowCount === 0) return res.status(400).json({ error: 'Ponto não aberto.' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Erro ao dar saída.' }); }
};

export const sendMessage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { message, image_url } = req.body;
  const user_id = (req as any).user?.id; 
  try {
    const result = await pool.query(`INSERT INTO travel_messages (travel_id, user_id, message, image_url) VALUES ($1, $2, $3, $4) RETURNING *`, [id, user_id, message, image_url]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: 'Erro ao enviar.' }); }
};
