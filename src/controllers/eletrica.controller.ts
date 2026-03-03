import { Request, Response } from 'express';
import { db } from '../config/db';
import { getIO } from '../utils/socket';

export const getTasks = async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM eletrica_tasks ORDER BY created_at DESC');
    
    // Mapeamos do formato do Banco (snake_case) para o Frontend (camelCase)
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
      completed: row.completed,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json(mappedRows);
  } catch (error) {
    console.error('Erro ao buscar tarefas da elétrica:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, description, category, priority, checklist, tags, imageUrl, dueDate } = req.body;
    
    const result = await db.query(
      `INSERT INTO eletrica_tasks 
        (title, description, category, priority, checklist, tags, image_url, due_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        title, 
        description || '', 
        category || 'blue', 
        priority || 'medium', 
        checklist ? JSON.stringify(checklist) : '[]', 
        tags ? JSON.stringify(tags) : '[]', 
        imageUrl || null, 
        dueDate || null
      ]
    );

    const io = getIO();
    if (io) io.emit('eletrica_tasks_updated');

    // Devolve formatado para o Frontend processar instantaneamente
    const row = result.rows[0];
    res.status(201).json({
      ...row, imageUrl: row.image_url, dueDate: row.due_date, createdAt: row.created_at
    });
  } catch (error) {
    console.error('Erro ao criar tarefa da elétrica:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa' });
  }
};

export const updateTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description, category, priority, checklist, tags, completed, imageUrl, dueDate, logAction, logDetails } = req.body;
  const userId = (req as any).user?.id;

  try {
    const currentTask = await db.query('SELECT * FROM eletrica_tasks WHERE id = $1', [id]);
    if (currentTask.rows.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
    const task = currentTask.rows[0];

    const updatedCompleted = completed !== undefined ? completed : task.completed;
    const completedAt = updatedCompleted && !task.completed ? new Date() : (updatedCompleted ? task.completed_at : null);

    const result = await db.query(
      `UPDATE eletrica_tasks 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           priority = COALESCE($4, priority),
           checklist = COALESCE($5, checklist),
           tags = COALESCE($6, tags),
           completed = $7,
           completed_at = $8,
           image_url = COALESCE($9, image_url),
           due_date = COALESCE($10, due_date),
           updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [
        title, description, category, priority, 
        checklist ? JSON.stringify(checklist) : null, 
        tags ? JSON.stringify(tags) : null, 
        updatedCompleted, completedAt, imageUrl, dueDate, id
      ]
    );

    // Sistema de Logs (Não trava o save se falhar)
    if (logAction && userId) {
       try {
          await db.query(
             `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
             [userId, logAction, logDetails ? JSON.stringify(logDetails) : null]
          );
       } catch (logErr) {
          console.warn("Falha ao gravar log de auditoria.", logErr);
       }
    }

    const io = getIO();
    if (io) io.emit('eletrica_tasks_updated');

    const row = result.rows[0];
    res.json({
      ...row, imageUrl: row.image_url, dueDate: row.due_date, createdAt: row.created_at
    });
  } catch (error) {
    console.error('Erro ao atualizar tarefa da elétrica:', error);
    res.status(500).json({ error: 'Erro ao atualizar tarefa' });
  }
};

export const deleteTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM eletrica_tasks WHERE id = $1', [id]);
    
    const io = getIO();
    if (io) io.emit('eletrica_tasks_updated');

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir tarefa:', error);
    res.status(500).json({ error: 'Erro ao excluir tarefa' });
  }
};
