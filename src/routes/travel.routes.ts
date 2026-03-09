// ficheiro: src/routes/travel.routes.ts

import { Router } from 'express';
import { auth } from '../middlewares/auth';
import {
  getTravels,
  createTravel,
  getTravelById,
  assignTechnician,
  clockIn,
  clockOut,
  addChecklist,
  completeChecklist,
  sendMessage
} from '../controllers/travel.controller';

const router = Router();

// 🔒 Middleware de Autenticação
// Garante que apenas utilizadores com login (token válido) possam aceder a estas rotas
router.use(auth);

// ==========================================
// 🚀 ROTAS PRINCIPAIS DAS VIAGENS
// ==========================================

// GET /api/travels -> Lista todas as viagens
router.get('/', getTravels);

// POST /api/travels -> Cria uma nova viagem
router.post('/', createTravel);

// GET /api/travels/:id -> Busca todos os detalhes de uma viagem específica
router.get('/:id', getTravelById);

// ==========================================
// 👨‍🔧 ROTAS DE ATRIBUIÇÃO E CHECKLIST (Líderes)
// ==========================================

// POST /api/travels/:id/technicians -> Adiciona um técnico à viagem
router.post('/:id/technicians', assignTechnician);

// POST /api/travels/:id/checklists -> Adiciona uma tarefa extra (checklist)
router.post('/:id/checklists', addChecklist);

// ==========================================
// ⏱️ ROTAS DO TÉCNICO (Bate-Ponto e Ações)
// ==========================================

// POST /api/travels/:id/checkin -> Bater o ponto (Entrada)
router.post('/:id/checkin', clockIn);

// POST /api/travels/:id/checkout -> Bater o ponto (Saída)
router.post('/:id/checkout', clockOut);

// PUT /api/travels/:id/checklists/:checklistId -> Marcar tarefa extra como feita
router.put('/:id/checklists/:checklistId', completeChecklist);

// ==========================================
// 💬 ROTAS DO CHAT E OBSERVAÇÕES
// ==========================================

// POST /api/travels/:id/messages -> Enviar mensagem/imagem no chat da viagem
router.post('/:id/messages', sendMessage);

export default router;
