import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import * as DashController from '../controllers/dashboard.controller';

const router = Router();

// ==========================================
// 🔓 ROTAS PÚBLICAS (Configuração Inicial)
// ==========================================

// Retorna a chave pública VAPID para o front-end iniciar o setup do Push
router.get('/notifications/push-key', DashController.getPushKey);

// ==========================================
// 🔒 ROTAS PROTEGIDAS (Requerem Token)
// ==========================================

// Aplica o middleware de autenticação em todas as rotas abaixo
router.use(authenticate);

// --- Notificações ---
// Salva a "assinatura" do navegador do usuário no banco
router.post('/notifications/subscribe', DashController.subscribePush);

// --- Dados da Página Inicial (NOVA ROTA) ---
// Retorna Patrimônio, Ativos, Críticos, Obsoletos, Destaques e Atividades
router.get('/home', DashController.getHomeDashboard);

// --- KPIs e Estatísticas (Cards do Topo) ---
// Retorna contagens de produtos, alertas de estoque, pedidos abertos, etc.
router.get('/stats', DashController.getStats);

// --- Relatórios ---
// Dados para gráficos (Top produtos, Histórico mensal, Pizza de status)
router.get('/reports/managerial', DashController.getManagerialReport);

// Relatório Detalhado (Tabulação de Entradas vs Saídas com filtro de data)
router.get('/reports/general', DashController.getGeneralReport);

// Retorna o intervalo de datas (min/max) disponível no banco para preencher filtros
router.get('/reports/available-dates', DashController.getAvailableDates);

// --- Auditoria e Segurança ---
// Lista logs de ações do sistema.
// Nota: O Controller faz uma verificação adicional se o usuário tem role='admin'.
router.get('/admin/logs', DashController.getLogs);

// ==========================================
// --- GESTÃO DE DESTAQUES (BANNERS) ---
// ==========================================

// Lista todos os destaques criados
router.get('/highlights', DashController.getHighlights);

// Cria um novo destaque (Apenas Admin - Validado no Controller)
router.post('/highlights', DashController.createHighlight);

// Deleta um destaque específico (Apenas Admin - Validado no Controller)
router.delete('/highlights/:id', DashController.deleteHighlight);

export default router;
