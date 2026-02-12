import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import * as TaskController from '../controllers/task.controller';

const router = Router();

// Aplica o middleware de autenticação em TODAS as rotas
router.use(authenticate);

// ==========================================
// 📝 GESTÃO DE TAREFAS
// ==========================================

// Listar todas as tarefas (Ordenadas por pendência e data)
router.get('/', TaskController.getTasks);

// Criar nova tarefa
router.post('/', TaskController.createTask);

// Atualizar tarefa existente (Status, Conteúdo, Prioridade)
router.put('/:id', TaskController.updateTask);

// Excluir tarefa
router.delete('/:id', TaskController.deleteTask);

export default router;