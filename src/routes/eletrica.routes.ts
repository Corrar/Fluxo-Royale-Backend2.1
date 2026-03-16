import { Router } from 'express';
import { 
  getTasks, createTask, updateTask, deleteTask, 
  getLists, createList, updateList, deleteList,
  rescueOrphanedTasks,        // <-- Nova função importada
  recoverDeletedListTasks     // <-- Nova função importada
} from '../controllers/eletrica.controller';

// Importamos o nome exato que está no seu auth.ts!
import { authenticate } from '../middlewares/auth';

const router = Router();

// ============================================================================
// ROTAS DE RECUPERAÇÃO / MANUTENÇÃO (Temporárias)
// NOTA: Colocadas ANTES do 'authenticate' para testares fácil pelo navegador.
// Podes apagar estas duas linhas de get() quando recuperares tudo, por segurança.
// ============================================================================
router.get('/rescue', rescueOrphanedTasks);
router.get('/recover-backup', recoverDeletedListTasks);

// ============================================================================
// ROTAS PROTEGIDAS (Abaixo desta linha, todas exigem login)
// ============================================================================
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
