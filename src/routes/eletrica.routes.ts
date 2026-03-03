import { Router } from 'express';
import { getTasks, createTask, updateTask, deleteTask } from '../controllers/eletrica.controller';
import { authMiddleware } from '../middlewares/auth';

const router = Router();

// Protege TODAS as rotas da elétrica com o middleware de autenticação
router.use(authMiddleware);

// Mapeamento dos Endpoints (CRUD)
router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
