import { Request, Response } from 'express';
import { pool } from '../config/db'; // <-- CORREÇÃO AQUI (pool em vez de db)
import { getIO } from '../utils/socket';

// --- ROTAS DAS LISTAS (COLUNAS) ---
export const getLists = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM eletrica_lists ORDER BY position ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar listas' });
  }
};

export const createList = async (req: Request, res: Response) => {
  try {
    const { id, title, position } = req.body;
    const result = await pool.query(
      `INSERT INTO eletrica_lists (id, title, position) VALUES ($1, $2, $3) RETURNING *`,
      [id, title, position]
    );
    const io = getIO();
    if (io) io.emit('eletrica_board_updated');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar lista' });
  }
};

export const updateList = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    await pool.query(`UPDATE eletrica_lists SET title = $1 WHERE id = $2`, [title, id]);
    const io = getIO();
    if (io) io.emit('eletrica_board_updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar lista' });
  }
};

export const deleteList = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM eletrica_tasks WHERE list_id = $1`, [id]); 
    await pool.query(`DELETE FROM eletrica_lists WHERE id = $1`, [id]); 
    const io = getIO();
    if (io) io.emit('eletrica_board_updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir lista' });
  }
};

// --- ROTAS DOS CARTÕES ---
export const getTasks = async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM eletrica_tasks ORDER BY created_at DESC');
    
    const mappedRows = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      priority: row.priority,
      checklist: row.checklist,
      tags: row.tags,
      imageUrl: row.image_url,
      dueDate: row.due_date,
      listId: row.list_id,           
      comments: row.comments,        
      attachments: row.attachments,  
      completed: row.completed,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json(mappedRows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, description, category, priority, checklist, tags, imageUrl, dueDate, listId } = req.body;
    
    const result = await pool.query(
      `INSERT INTO eletrica_tasks 
        (title, description, category, priority, checklist, tags, image_url, due_date, list_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        title, description || '', category || 'blue', priority || 'medium', 
        checklist ? JSON.stringify(checklist) : '[]', 
        tags ? JSON.stringify(tags) : '[]', 
        imageUrl || null, dueDate || null, listId || 'list-todo'
      ]
    );

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');

    const row = result.rows[0];
    res.status(201).json({
      ...row, imageUrl: row.image_url, dueDate: row.due_date, listId: row.list_id
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar tarefa' });
  }
};

export const updateTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description, priority, checklist, tags, completed, imageUrl, dueDate, listId, comments, attachments, logAction, logDetails } = req.body;
  const userId = (req as any).user?.id;

  try {
    const currentTask = await pool.query('SELECT * FROM eletrica_tasks WHERE id = $1', [id]);
    if (currentTask.rows.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const task = currentTask.rows[0];

    const updatedCompleted = completed !== undefined ? completed : task.completed;
    const completedAt = updatedCompleted && !task.completed ? new Date() : (updatedCompleted ? task.completed_at : null);

    const result = await pool.query(
      `UPDATE eletrica_tasks 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           priority = COALESCE($3, priority),
           checklist = COALESCE($4, checklist),
           tags = COALESCE($5, tags),
           completed = $6,
           completed_at = $7,
           image_url = COALESCE($8, image_url),
           due_date = COALESCE($9, due_date),
           list_id = COALESCE($10, list_id),
           comments = COALESCE($11, comments),
           attachments = COALESCE($12, attachments),
           updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [
        title, description, priority, 
        checklist ? JSON.stringify(checklist) : null, 
        tags ? JSON.stringify(tags) : null, 
        updatedCompleted, completedAt, imageUrl, dueDate, listId,
        comments ? JSON.stringify(comments) : null,
        attachments ? JSON.stringify(attachments) : null,
        id
      ]
    );

    if (logAction && userId) {
       try {
          await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
             [userId, logAction, logDetails ? JSON.stringify(logDetails) : null]
          );
       } catch (logErr) {}
    }

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar' });
  }
};

export const deleteTask = async (req: Request, res: Response) => {
  try {
    await pool.query('DELETE FROM eletrica_tasks WHERE id = $1', [req.params.id]);
    const io = getIO();
    if (io) io.emit('eletrica_board_updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir' });
  }
};
