// ficheiro: src/routes/travel.routes.ts

import { Router } from 'express';
import { authenticate } from '../middlewares/auth'; 
import {
  getTravels,
  createTravel,
  getTravelById,
  assignTechnician,
  clockIn,
  clockOut,
  sendMessage,
  updateTravelStatus,
  updateTravelDetails,
  deleteTravel,        // ✨ NOVA
  toggleChecklistItem  // ✨ NOVA
} from '../controllers/travel.controller';

const router = Router();

// 🔒 Middleware de Autenticação
router.use(authenticate); 

// ==========================================
// 🚀 ROTAS PRINCIPAIS DAS VIAGENS
// ==========================================

router.get('/', getTravels);
router.post('/', createTravel);
router.get('/:id', getTravelById);

// ✨ NOVA: Excluir viagem
router.delete('/:id', deleteTravel);

// ✨ ATUALIZADO: Rota base PUT em vez de /details para combinar com o Frontend Autosave
router.put('/:id', updateTravelDetails);

// Atualiza a coluna (Arrastar cartão / Drag and Drop)
router.put('/:id/status', updateTravelStatus);

// ✨ NOVA: Toggle rápido para o utilizador/viajante marcar a tarefa como feita
router.put('/:id/checklist/:groupId/item/:itemId/toggle', toggleChecklistItem);

// ==========================================
// 👨‍🔧 ROTAS DE ATRIBUIÇÃO E PONTO
// ==========================================

router.post('/:id/technicians', assignTechnician);
router.post('/:id/checkin', clockIn);
router.post('/:id/checkout', clockOut);
router.post('/:id/messages', sendMessage);

export default router;
