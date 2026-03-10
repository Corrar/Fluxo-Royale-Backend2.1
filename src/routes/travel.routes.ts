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
  updateTravelDetails // ✨ A NOSSA NOVA FUNÇÃO DE AUTOSAVE
} from '../controllers/travel.controller';

const router = Router();

// 🔒 Middleware de Autenticação
// Garante que apenas utilizadores com login (token válido) possam aceder a estas rotas
router.use(authenticate); 

// ==========================================
// 🚀 ROTAS PRINCIPAIS DAS VIAGENS
// ==========================================

// GET /api/travels -> Lista todas as viagens
router.get('/', getTravels);

// POST /api/travels -> Cria uma nova viagem
router.post('/', createTravel);

// GET /api/travels/:id -> Busca todos os detalhes de uma viagem específica
router.get('/:id', getTravelById);

// PUT /api/travels/:id/status -> Atualiza a coluna (Arrastar cartão / Drag and Drop)
router.put('/:id/status', updateTravelStatus);

// ✨ NOVA ROTA: AutoSave (Atualiza título, descrição, checklists, etiquetas de uma vez)
router.put('/:id/details', updateTravelDetails);

// ==========================================
// 👨‍🔧 ROTAS DE ATRIBUIÇÃO (Líderes)
// ==========================================

// POST /api/travels/:id/technicians -> Adiciona um técnico à viagem
router.post('/:id/technicians', assignTechnician);

// ==========================================
// ⏱️ ROTAS DO TÉCNICO (Bate-Ponto)
// ==========================================

// POST /api/travels/:id/checkin -> Bater o ponto (Entrada)
router.post('/:id/checkin', clockIn);

// POST /api/travels/:id/checkout -> Bater o ponto (Saída)
router.post('/:id/checkout', clockOut);

// ==========================================
// 💬 ROTAS DO CHAT E OBSERVAÇÕES
// ==========================================

// POST /api/travels/:id/messages -> Enviar mensagem/imagem no chat da viagem
router.post('/:id/messages', sendMessage);

export default router;
