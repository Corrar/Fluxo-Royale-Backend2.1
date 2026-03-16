import { Request, Response } from 'express';
import { pool } from '../config/db'; 
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
    const userId = (req as any).user?.id;

    const result = await pool.query(
      `INSERT INTO eletrica_lists (id, title, position) VALUES ($1, $2, $3) RETURNING *`,
      [id, title, position]
    );

    // REGISTO DE AUDITORIA
    if (userId) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
        [userId, 'CREATE_LIST_ELETRICA', JSON.stringify({ list_name: title })]
      );
    }

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
    const userId = (req as any).user?.id;

    await pool.query(`UPDATE eletrica_lists SET title = $1 WHERE id = $2`, [title, id]);
    
    // REGISTO DE AUDITORIA
    if (userId) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
        [userId, 'UPDATE_LIST_ELETRICA', JSON.stringify({ new_name: title, list_id: id })]
      );
    }

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
    const userId = (req as any).user?.id;

    // Proteção contra acesso indevido (Apenas Admins/Gerentes)
    const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    const userRole = userResult.rows[0]?.role;
    if (userRole !== 'admin' && userRole !== 'gerente') {
      return res.status(403).json({ error: 'Apenas administradores podem excluir listas inteiras.' });
    }

    // 1. Busca o nome da lista ANTES de a apagar
    const listRes = await pool.query('SELECT title FROM eletrica_lists WHERE id = $1', [id]);
    const listTitle = listRes.rows[0]?.title || id;

    // 2. BACKUP: Busca todas as tarefas que estão lá dentro antes de destruir tudo
    const tasksRes = await pool.query('SELECT * FROM eletrica_tasks WHERE list_id = $1', [id]);
    const tarefasApagadas = tasksRes.rows; 

    // 3. Apaga tarefas e a lista
    await pool.query(`DELETE FROM eletrica_tasks WHERE list_id = $1`, [id]); 
    await pool.query(`DELETE FROM eletrica_lists WHERE id = $1`, [id]); 

    // 4. REGISTO DE AUDITORIA DESTRUTIVA COM BACKUP MASSIVO
    if (userId) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
        [
          userId, 
          'DELETE_LIST_ELETRICA', 
          JSON.stringify({ 
            mensagem: `Lista "${listTitle}" e ${tarefasApagadas.length} tarefas apagadas.`,
            backup_tarefas: tarefasApagadas // Array de todas as tarefas para recuperação futura
          })
        ]
      );
    }

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
      id: row.id, title: row.title, description: row.description, category: row.category,
      priority: row.priority, checklist: row.checklist, tags: row.tags, imageUrl: row.image_url,
      dueDate: row.due_date, listId: row.list_id, comments: row.comments, attachments: row.attachments,  
      completed: row.completed, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at
    }));
    res.json(mappedRows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar tarefas' });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, description, category, priority, checklist, tags, imageUrl, dueDate, listId } = req.body;
    const userId = (req as any).user?.id;

    const result = await pool.query(
      `INSERT INTO eletrica_tasks 
        (title, description, category, priority, checklist, tags, image_url, due_date, list_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        title, description || '', category || 'blue', priority || 'medium', 
        checklist ? JSON.stringify(checklist) : '[]', tags ? JSON.stringify(tags) : '[]', 
        imageUrl || null, dueDate || null, listId || 'list-todo'
      ]
    );

    // REGISTO DE AUDITORIA
    if (userId) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
        [userId, 'CREATE_TASK_ELETRICA', JSON.stringify({ task_title: title })]
      );
    }

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');

    const row = result.rows[0];
    res.status(201).json({ ...row, imageUrl: row.image_url, dueDate: row.due_date, listId: row.list_id });
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
       SET title = COALESCE($1, title), description = COALESCE($2, description),
           priority = COALESCE($3, priority), checklist = COALESCE($4, checklist),
           tags = COALESCE($5, tags), completed = $6, completed_at = $7,
           image_url = COALESCE($8, image_url), due_date = COALESCE($9, due_date),
           list_id = COALESCE($10, list_id), comments = COALESCE($11, comments),
           attachments = COALESCE($12, attachments), updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [
        title, description, priority, checklist ? JSON.stringify(checklist) : null, tags ? JSON.stringify(tags) : null, 
        updatedCompleted, completedAt, imageUrl, dueDate, listId, comments ? JSON.stringify(comments) : null,
        attachments ? JSON.stringify(attachments) : null, id
      ]
    );

    // REGISTO DE AUDITORIA: Usa a ação do Frontend, se não houver, regista uma edição genérica.
    if (userId) {
       const actionToLog = logAction || 'UPDATE_TASK_ELETRICA';
       const detailsToLog = logDetails || { task_title: title || task.title };
       try {
          await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
             [userId, actionToLog, JSON.stringify(detailsToLog)]
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
    const userId = (req as any).user?.id;
    
    // 1. Busca a TAREFA INTEIRA antes de apagar (Backup Snapshot)
    const taskRes = await pool.query('SELECT * FROM eletrica_tasks WHERE id = $1', [req.params.id]);
    
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tarefa não encontrada' });
    }
    
    const taskData = taskRes.rows[0];

    // 2. Apaga a tarefa da base de dados
    await pool.query('DELETE FROM eletrica_tasks WHERE id = $1', [req.params.id]);
    
    // 3. REGISTO DE AUDITORIA COM BACKUP EMBUTIDO
    if (userId) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)`,
        [
          userId, 
          'DELETE_TASK_ELETRICA', 
          JSON.stringify({ 
            mensagem: `Tarefa "${taskData.title}" foi apagada.`,
            dados_recuperacao: taskData // Guarda o JSON exato e completo da base de dados!
          })
        ]
      );
    }

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao excluir' });
  }
};

// ============================================================================
// FUNÇÕES DE RECUPERAÇÃO E MANUTENÇÃO (Adicionadas)
// ============================================================================

// 1. Resgata tarefas órfãs (que estão no banco mas não aparecem na tela)
export const rescueOrphanedTasks = async (req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      UPDATE eletrica_tasks 
      SET list_id = 'list-todo' 
      WHERE list_id NOT IN (SELECT id FROM eletrica_lists) 
         OR list_id IS NULL
      RETURNING *;
    `);

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');

    res.json({ 
      success: true, 
      message: `${result.rowCount} tarefas órfãs foram resgatadas com sucesso para a coluna "A Fazer"!`,
      tarefas_recuperadas: result.rows
    });
  } catch (error) {
    console.error('Erro ao resgatar tarefas:', error);
    res.status(500).json({ error: 'Erro ao tentar resgatar as tarefas perdidas.' });
  }
};

// 2. Recupera tarefas apagadas através dos Logs de Auditoria
export const recoverDeletedListTasks = async (req: Request, res: Response) => {
  try {
    const logRes = await pool.query(
      `SELECT details FROM audit_logs WHERE action = 'DELETE_LIST_ELETRICA' ORDER BY created_at DESC LIMIT 1`
    );

    if (logRes.rows.length === 0) {
      return res.status(404).json({ error: 'Nenhum backup de lista apagada foi encontrado.' });
    }

    let details = logRes.rows[0].details;
    if (typeof details === 'string') details = JSON.parse(details);
    const tarefasApagadas = details.backup_tarefas;

    if (!tarefasApagadas || tarefasApagadas.length === 0) {
      return res.status(404).json({ error: 'O último backup não continha tarefas.' });
    }

    let restauradasCount = 0;

    for (const task of tarefasApagadas) {
      await pool.query(
        `INSERT INTO eletrica_tasks 
         (title, description, category, priority, checklist, tags, image_url, due_date, list_id, comments, attachments, completed, completed_at, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (id) DO NOTHING`,
        [
          task.title, task.description, task.category, task.priority, 
          task.checklist ? JSON.stringify(task.checklist) : '[]', 
          task.tags ? JSON.stringify(task.tags) : '[]', 
          task.image_url, task.due_date, 'list-todo', 
          task.comments ? JSON.stringify(task.comments) : '[]', 
          task.attachments ? JSON.stringify(task.attachments) : '[]', 
          task.completed, task.completed_at, task.created_at
        ]
      );
      restauradasCount++;
    }

    const io = getIO();
    if (io) io.emit('eletrica_board_updated');

    res.json({ 
      success: true, 
      message: `${restauradasCount} tarefas foram recuperadas com sucesso para a coluna "A Fazer"!` 
    });

  } catch (error) {
    console.error('Erro na recuperação:', error);
    res.status(500).json({ error: 'Ocorreu um erro ao tentar recuperar as tarefas.' });
  }
};
