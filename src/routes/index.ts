import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import requestRoutes from './request.routes';
import separationRoutes from './separation.routes';
import dashboardRoutes from './dashboard.routes';
import taskRoutes from './task.routes';

const router = Router();

// --- Health Check ---
// Útil para saber se a API caiu ou está de pé (ex: Ping do Render/Vercel)
router.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Fluxo Royale API', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

// ====================================================
// MAPEAMENTO DE ROTAS
// ====================================================

// 1. Autenticação e Usuários
// Captura: /auth/login, /auth/register
router.use('/auth', authRoutes);
// Captura: /users, /admin/reset-password (Compatibilidade legado)
router.use('/', authRoutes);

// 2. Produtos e Estoque
// Captura: /products, /products/low-stock
router.use('/products', productRoutes);
// Captura: /manual-entry, /manual-withdrawal, /stock-list (Compatibilidade legado)
router.use('/', productRoutes); 

// 3. Solicitações (Pedidos)
// Captura: /requests, /requests/:id
router.use('/requests', requestRoutes);

// 4. Separações e OPs
// Captura: /separations, /separations/returns
router.use('/separations', separationRoutes);

// 5. Dashboard, Relatórios e Logs
// Captura: /dashboard/stats
router.use('/dashboard', dashboardRoutes);
// Captura: /reports/..., /admin/logs, /notifications/... (Compatibilidade legado)
router.use('/', dashboardRoutes);

// 6. Tarefas (Kanban)
// Captura: /tasks
router.use('/tasks', taskRoutes);

// 7. Rota 404 (Fallback)
// Se nenhuma rota acima bater, cai aqui.
router.use('*', (req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.originalUrl}` });
});

export default router;