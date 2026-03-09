// ficheiro: src/controllers/travel.controller.ts

import { Request, Response } from 'express';
import pool from '../config/db'; // O teu ficheiro de conexão com a base de dados

// ==========================================
// 🚀 1. LISTAR TODAS AS VIAGENS
// ==========================================
export const getTravels = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
        (SELECT json_agg(tt) FROM travel_technicians tt WHERE tt.travel_id = t.id) as technicians,
        (SELECT json_agg(tc) FROM travel_checklists tc WHERE tc.travel_id = t.id) as checklists,
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
  const created_by = req.user?.id; // Assumindo que o middleware de auth coloca o user aqui

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
// 🚀 3. BUSCAR VIAGEM POR ID (Detalhada)
// ==========================================
export const getTravelById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT t.*, 
        (SELECT json_agg(tt) FROM travel_technicians tt WHERE tt.travel_id = t.id) as technicians,
        (SELECT json_agg(tc) FROM travel_checklists tc WHERE tc.travel_id = t.id) as checklists,
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
// 👨‍🔧 4. ATRIBUIR TÉCNICO À VIAGEM
// ==========================================
export const assignTechnician = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { user_id } = req.body; // ID do técnico a ser atribuído

  try {
    const result = await pool.query(
      `INSERT INTO travel_technicians (travel_id, user_id) VALUES ($1, $2) RETURNING *`,
      [id, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atribuir técnico. Ele já pode estar nesta viagem.' });
  }
};

// ==========================================
// ⏱️ 5. BATER PONTO: ENTRADA (Check-in)
// ==========================================
export const clockIn = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = req.user?.id; // Técnico logado

  try {
    // Registra a hora atual como check_in
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
// ⏱️ 6. BATER PONTO: SAÍDA (Check-out)
// ==========================================
export const clockOut = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user_id = req.user?.id;

  try {
    // Atualiza o último registro de entrada deste usuário nesta viagem que ainda não tem saída
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
// 📋 7. ADICIONAR CHECKLIST EXTRA (Líder)
// ==========================================
export const addChecklist = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { description } = req.body;
  const created_by = req.user?.id;

  try {
    const result = await pool.query(
      `INSERT INTO travel_checklists (travel_id, description, created_by) 
       VALUES ($1, $2, $3) RETURNING *`,
      [id, description, created_by]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao adicionar tarefa extra.' });
  }
};

// ==========================================
// ✅ 8. CONCLUIR CHECKLIST EXTRA (Técnico)
// ==========================================
export const completeChecklist = async (req: Request, res: Response) => {
  const { id, checklistId } = req.params;
  const { is_completed } = req.body; // true ou false

  try {
    const result = await pool.query(
      `UPDATE travel_checklists 
       SET is_completed = $1, completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END 
       WHERE id = $2 AND travel_id = $3 RETURNING *`,
      [is_completed, checklistId, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tarefa.' });
  }
};

// ==========================================
// 💬 9. ENVIAR MENSAGEM / IMAGEM (Chat)
// ==========================================
export const sendMessage = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { message, image_url } = req.body;
  const user_id = req.user?.id;

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
