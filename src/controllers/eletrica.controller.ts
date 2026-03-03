import { Request, Response } from 'express';
import { db } from '../config/db';
import { getIO } from '../utils/socket';

export const getTasks = async (req: Request, res: Response) => {
  try {
    const result = await db.query('SELECT * FROM eletrica_tasks ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar tarefas da elétrica:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, description, category, priority, checklist, tags, imageUrl, dueDate } = req.body;
    
    // Insere no banco e usa JSON.stringify para os arrays e grupos do checklist
    const result = await db.query(
      `INSERT INTO eletrica_tasks 
        (title, description, category, priority, checklist, tags, image_url, due_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        title, 
        description, 
        category || 'blue', 
        priority || 'medium', 
        JSON.stringify(checklist || []), 
        JSON.stringify(tags || []), 
        imageUrl, 
        dueDate
      ]
    );

    // Avisa o Frontend para recarregar o quadro instantaneamente
    const io = getIO();
    if (io) {
      io.emit('eletrica_tasks_updated');
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Erro ao criar tarefa da elétrica:', error);
    res.status(500).json({ error: 'Erro ao criar tarefa' });
  }
};

export const updateTask = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, description, category, priority, checklist, tags, completed, imageUrl, dueDate, logAction, logDetails } = req.body;
  const userId = (req as any).user?.id; // ID de quem está a fazer a alteração

  try {
    // 1. Busca a tarefa atual para manter o completed_at correto
    const currentTask = await db.query('SELECT * FROM eletrica_tasks WHERE id = $1', [id]);
    if (currentTask.rows.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
    const task = currentTask.rows[0];

    const updatedCompleted = completed !== undefined ? completed : task.completed;
    const completedAt = updatedCompleted && !task.completed ? new Date() : (updatedCompleted ? task.completed_at : null);

    // 2. Atualiza a tarefa no banco de dados
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
        title, 
        description, 
        category, 
        priority, 
        checklist ? JSON.stringify(checklist) : null, 
        tags ? JSON.stringify(tags) : null, 
        updatedCompleted, 
        completedAt, 
        imageUrl, 
        dueDate, 
        id
      ]
    );

    // 3. SISTEMA DE LOGS DE AUDITORIA 
    // Se o técnico der 'Check' na caixinha, o Frontend envia o logAction!
    if (logAction && userId) {
       try {
          // Tentativa de salvar o log (ignora erro se a tabela tiver outro nome no seu BD)
          await db.query(
             `INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
             [userId, logAction, logDetails ? JSON.stringify(logDetails) : null]
          );
       } catch (logErr) {
          console.warn("Aviso: Falha ao gravar log de auditoria.", logErr);
       }
    }

    const io = getIO();
    if (io) {
      io.emit('eletrica_tasks_updated');
    }

    res.json(result.rows[0]);
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
    if (io) {
      io.emit('eletrica_tasks_updated');
    }

    res.json({ message: 'Tarefa excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir tarefa:', error);
    res.status(500).json({ error: 'Erro ao excluir tarefa' });
  }
};
