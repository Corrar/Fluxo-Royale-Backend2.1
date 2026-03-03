import { Router } from 'express';
import { getTasks, createTask, updateTask, deleteTask, getLists, createList, updateList, deleteList } from '../controllers/eletrica.controller';

// CORREÇÃO: Vamos importar 'verifyToken' que é o nome padrão comum em sistemas NodeJS para verificar a sessão do utilizador
import { verifyToken } from '../middlewares/auth';

const router = Router();

// Usa o verifyToken para proteger a rota
router.use(verifyToken);

// Listas / Colunas
router.get('/lists', getLists);
router.post('/lists', createList);
router.put('/lists/:id', updateList);
router.delete('/lists/:id', deleteList);

// Cartões
router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
