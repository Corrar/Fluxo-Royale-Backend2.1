import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import * as SepController from '../controllers/separation.controller';

const router = Router();

// Aplica o middleware de autenticação em TODAS as rotas
router.use(authenticate);

// ==========================================
// 🏭 SEPARAÇÕES (Picking / Ordem de Produção)
// ==========================================

// Listar todas as separações (inclui itens e status de devoluções)
router.get('/', SepController.getSeparations);

// Criar uma nova separação (Geralmente via importação de OP ou Manual)
// O status inicial será 'pendente'
router.post('/', SepController.createSeparation);

// Autorizar/Movimentar a Separação
// Body: { action: 'reservar' | 'entregar', items: [...] }
// Esta rota efetivamente altera o saldo de estoque (Reservado ou On Hand)
router.put('/:id/authorize', SepController.authorizeSeparation);

// ==========================================
// ↩️ DEVOLUÇÕES (Logística Reversa)
// ==========================================

// Criar uma solicitação de devolução para uma separação específica
// :id refere-se ao ID da SEPARAÇÃO
router.post('/:id/return', SepController.createReturn);

// Processar uma devolução (Aprovar ou Rejeitar)
// :id refere-se ao ID da DEVOLUÇÃO (tabela separation_returns)
// Se aprovado, o item volta para o estoque disponível
router.put('/returns/:id', SepController.processReturn);

export default router;