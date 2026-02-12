import { Request, Response } from 'express';
import { pool } from '../config/db';
import { createLog } from '../utils/logger';

// --- LISTAR TODAS AS TAREFAS ---
export const getTasks = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        t.*,
        COALESCE(p.name, u.email) as creator_name
      FROM tasks t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN profiles p ON u.id = p.id
      ORDER BY 
        t.completed ASC,       -- Pendentes primeiro
        t.priority DESC,       -- Alta prioridade primeiro
        t.created_at DESC      -- Mais recentes
    `);
    
    res.json(rows);
  } catch (error: any) {
    console.error("Erro ao buscar tarefas:", error);
    res.status(500).json({ error: 'Erro interno ao carregar tarefas.' });
  }
};

// --- CRIAR NOVA TAREFA ---
export const createTask = async (req: Request, res: Response) => {
  const { title, description, category, priority, checklist } = req.body;
  const userId = (req as any).user.id;

  if (!title) {
    return res.status(400).json({ error: "O título da tarefa é obrigatório." });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO tasks (title, description, category, priority, checklist, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        title.trim(), 
        description || '', 
        category || 'geral', 
        priority || 'baixa', 
        JSON.stringify(checklist || []), 
        userId
      ]
    );

    const newTask = rows[0];

    // Log de auditoria
    await createLog(userId, 'CREATE_TASK', { 
        taskId: newTask.id, 
        title: newTask.title 
    }, req.ip || '127.0.0.1');

    await client.query('COMMIT');
    
    res.status(201).json(newTask);

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error("Erro ao criar tarefa:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- ATUALIZAR TAREFA ---
export const updateTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description, category, priority, checklist, completed } = req.body;
  const userId = (req as any).user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verifica se a tarefa existe antes de atualizar
    const checkRes = await client.query('SELECT id FROM tasks WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Tarefa não encontrada' });
    }

    // Lógica SQL Aprimorada:
    // Se completed = true, define completed_at = NOW()
    // Se completed = false, define completed_at = NULL (reseta)
    const { rows } = await client.query(
      `UPDATE tasks SET 
          title = COALESCE($1, title), 
          description = COALESCE($2, description), 
          category = COALESCE($3, category), 
          priority = COALESCE($4, priority), 
          checklist = COALESCE($5, checklist), 
          completed = COALESCE($6, completed),
          completed_at = CASE 
              WHEN $6 = true THEN NOW() 
              WHEN $6 = false THEN NULL 
              ELSE completed_at 
          END,
          updated_at = NOW()
       WHERE id = $7 
       RETURNING *`,
      [
        title, 
        description, 
        category, 
        priority, 
        checklist ? JSON.stringify(checklist) : null, 
        completed, 
        id
      ]
    );

    await createLog(userId, 'UPDATE_TASK', { 
        taskId: id, 
        changes: { title, completed, priority } 
    }, req.ip || '127.0.0.1');

    await client.query('COMMIT');
    res.json(rows[0]);

  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erro ao atualizar tarefa' });
  } finally {
    client.release();
  }
};

// --- EXCLUIR TAREFA ---
export const deleteTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req as any).user.id;

  try {
    // Retorna os dados da tarefa antes de excluir para o log
    const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING title', [id]);
    
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Tarefa não encontrada.' });
    }

    await createLog(userId, 'DELETE_TASK', { 
        taskId: id, 
        taskTitle: rows[0].title 
    }, req.ip || '127.0.0.1');

    res.json({ success: true, message: "Tarefa removida com sucesso." });

  } catch (error: any) {
    console.error("Erro ao excluir tarefa:", error);
    res.status(500).json({ error: 'Erro ao excluir tarefa' });
  }
};