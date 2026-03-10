// ficheiro: src/routes/travel.routes.ts

import { Router } from 'express';
import { authenticate } from '../middlewares/auth'; 
import {
  getTravels,
  createTravel,
  getTravelById,
  assignTechnician,
  removeTechnician,    // ✨ ADICIONADO: Importação da nova função
  clockIn,
  clockOut,
  sendMessage,
  updateTravelStatus,
  updateTravelDetails,
  deleteTravel,        
  toggleChecklistItem  
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

// Excluir viagem
router.delete('/:id', deleteTravel);

// Rota base PUT em vez de /details para combinar com o Frontend Autosave
router.put('/:id', updateTravelDetails);

// Atualiza a coluna (Arrastar cartão / Drag and Drop)
router.put('/:id/status', updateTravelStatus);

// Toggle rápido para o utilizador/viajante marcar a tarefa como feita
router.put('/:id/checklist/:groupId/item/:itemId/toggle', toggleChecklistItem);

// ==========================================
// 👨‍🔧 ROTAS DE ATRIBUIÇÃO E PONTO
// ==========================================

router.post('/:id/technicians', assignTechnician);

// ✨ ADICIONADO: Rota para remover um técnico da viagem
router.delete('/:id/technicians/:userId', removeTechnician);

router.post('/:id/checkin', clockIn);
router.post('/:id/checkout', clockOut);
router.post('/:id/messages', sendMessage);

export default router;
