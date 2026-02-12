import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import * as ReqController from '../controllers/request.controller';

const router = Router();

// Aplica o middleware de autenticação em TODAS as rotas deste arquivo
router.use(authenticate);

// ==========================================
// 📖 LEITURA (GET)
// ==========================================

// Listar TODAS as solicitações (Visão do Almoxarife/Admin)
router.get('/', ReqController.getRequests);

// Listar APENAS as solicitações do usuário logado (Visão do Colaborador)
router.get('/my-requests', ReqController.getMyRequests);

// ==========================================
// ✍️ ESCRITA (POST/PUT/DELETE)
// ==========================================

// Criar nova solicitação
router.post('/', ReqController.createRequest);

// Editar itens da solicitação
// Nota: Só permitido se o status for 'aberto' (validado no controller)
router.put('/:id', ReqController.updateRequestItems);

// Alterar Status (Aprovar, Rejeitar, Entregar)
// Esta é a rota que movimenta o estoque físico e reservado
router.put('/:id/status', ReqController.updateRequestStatus);

// Cancelar/Excluir solicitação
router.delete('/:id', ReqController.deleteRequest);

export default router;