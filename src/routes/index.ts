import { Router } from 'express';
import authRoutes from './auth.routes';
import productRoutes from './product.routes';
import requestRoutes from './request.routes';
import separationRoutes from './separation.routes';
import dashboardRoutes from './dashboard.routes';
import taskRoutes from './task.routes';
import eletricaRoutes from './eletrica.routes'; 
import travelRoutes from './travel.routes'; // ✨ NOVA: Importação das rotas de viagens

const router = Router();

router.get('/health', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Fluxo Royale API', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

// MAPEAMENTO DE ROTAS
router.use('/auth', authRoutes);
router.use('/', authRoutes);
router.use('/products', productRoutes);
router.use('/', productRoutes); 
router.use('/requests', requestRoutes);
router.use('/separations', separationRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/', dashboardRoutes);
router.use('/tasks', taskRoutes);

// Rota do Kanban da Elétrica
router.use('/eletrica-tasks', eletricaRoutes);

// ✨ NOVA: Rota das Viagens Externas
router.use('/travels', travelRoutes);

router.use((req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.originalUrl}` });
});

export default router;
