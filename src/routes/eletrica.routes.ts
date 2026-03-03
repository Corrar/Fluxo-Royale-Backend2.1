import { Router } from 'express';
import { 
  getTasks, createTask, updateTask, deleteTask, 
  getLists, createList, updateList, deleteList 
} from '../controllers/eletrica.controller';

// CORREÇÃO: Importamos o nome exato que está no seu auth.ts!
import { authenticate } from '../middlewares/auth';

const router = Router();

// Usa o 'authenticate' para proteger estas rotas
router.use(authenticate);

// --- Rotas das Listas / Colunas ---
router.get('/lists', getLists);
router.post('/lists', createList);
router.put('/lists/:id', updateList);
router.delete('/lists/:id', deleteList);

// --- Rotas dos Cartões ---
router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
