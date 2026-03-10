// ficheiro: src/controllers/travel.controller.ts

import { Request, Response } from 'express';
import { pool } from '../config/db';

// ==========================================
// 🚀 1. LISTAR TODAS AS VIAGENS (Com campos JSON)
// ==========================================
export const getTravels = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        COALESCE(t.checklist_groups, '[]'::jsonb) as checklists,
        COALESCE(t.tags, '[]'::jsonb) as tags,
        COALESCE(t.attachments, '[]'::jsonb) as attachments,
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
// 🚀 2. CRIAR NOVA VIAGEM
// ==========================================
export const createTravel = async (req: Request, res: Response) => {
  const { title, description } = req.body;
  const created_by = (req as any).user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO travels (title, description, created_by) 
       VALUES ($1, $2, $3) RETURNING *`,
      [title, description, created_by]
    );
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
        (SELECT json_agg(tt) FROM travel_technicians tt WHERE tt.travel_id = t.id) as technicians,
        (SELECT json_agg(tl) FROM travel_time_logs tl WHERE tl.travel_id = t.id) as time_logs,
        (SELECT json_agg(tm) FROM travel_messages tm WHERE tm.travel_id = t.id) as messages
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
// ✨ 4. AUTO-SAVE (Mágica da Edição e Checklists - COM CAST JSONB)
// ==========================================
export const updateTravelDetails = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description, priority, due_date, cover_url, tags, checklist_groups, attachments } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE travels 
       SET 
         title = COALESCE($1, title), 
         description = $2, 
         priority = COALESCE($3, priority), 
         due_date = $4, 
         cover_url = $5,
         tags = COALESCE($6::jsonb, tags), 
         checklist_groups = COALESCE($7::jsonb, checklist_groups), 
         attachments = COALESCE($8::jsonb, attachments), 
         updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        title, 
        description, 
        priority, 
        due_date || null, 
        cover_url || null, 
        tags ? JSON.stringify(tags) : null, 
        checklist_groups ? JSON.stringify(checklist_groups) : null, 
        attachments ? JSON.stringify(attachments) : null, 
        id
      ]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Erro no AutoSave:', error);
    res.status(500).json({ error: 'Erro ao guardar os detalhes.' });
  }
};

// ==========================================
// 👨‍🔧 5. ATRIBUIR TÉCNICO À VIAGEM
// ==========================================
export const assignTechnician = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.body; 

  try {
    const result = await pool.query(
      `INSERT INTO travel_technicians (travel_id, user_id) VALUES ($1, $2) RETURNING *`,
      [id, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atribuir técnico.' });
  }
};

// ==========================================
// ⏱️ 6. BATER PONTO: ENTRADA (Check-in)
// ==========================================
export const clockIn = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = (req as any).user?.id; 

  try {
    const result = await pool.query(
      `INSERT INTO travel_time_logs (travel_id, user_id, check_in) 
       VALUES ($1, $2, NOW()) RETURNING *`,
      [id, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar ponto de entrada.' });
  }
};

// ==========================================
// ⏱️ 7. BATER PONTO: SAÍDA (Check-out)
// ==========================================
export const clockOut = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = (req as any).user?.id; 

  try {
    const result = await pool.query(
      `UPDATE travel_time_logs 
       SET check_out = NOW() 
       WHERE travel_id = $1 AND user_id = $2 AND check_out IS NULL 
       RETURNING *`,
      [id, user_id]
    );
    
    if (result.rowCount === 0) {
        return res.status(400).json({ error: 'Nenhum ponto de entrada em aberto encontrado.' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar ponto de saída.' });
  }
};

// ==========================================
// 💬 8. ENVIAR MENSAGEM / IMAGEM (Chat)
// ==========================================
export const sendMessage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { message, image_url } = req.body;
  const user_id = (req as any).user?.id; 

  try {
    const result = await pool.query(
      `INSERT INTO travel_messages (travel_id, user_id, message, image_url) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, user_id, message, image_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao enviar mensagem.' });
  }
};

// ==========================================
// 🔄 9. ATUALIZAR STATUS (Drag and Drop Kanban)
// ==========================================
export const updateTravelStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE travels SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar o status.' });
  }
};
