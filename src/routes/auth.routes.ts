import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { authLimiter } from '../middlewares/rateLimit';
import * as AuthController from '../controllers/auth.controller';

const router = Router();

// ==========================================
// 🔓 ROTAS PÚBLICAS (Sem Token)
// ==========================================

// Login com proteção contra Força Bruta (Rate Limit estrito)
router.post('/login', authLimiter, AuthController.login);

// Registro de novos usuários
router.post('/register', AuthController.register);

// ==========================================
// 🔒 ROTAS PROTEGIDAS (Requerem Token)
// ==========================================

// Aplica o middleware de autenticação em todas as rotas abaixo
router.use(authenticate);

// --- Gestão de Usuários ---
router.get('/users', AuthController.getUsers); // Listar usuários
router.put('/users/:id/role', AuthController.updateUserRole); // Alterar cargo
router.delete('/users/:id', AuthController.deleteUser); // Remover usuário

// --- Monitoramento ---
// Heartbeat: Usado pelo front-end para dizer "estou online" e contar tempo de uso
router.put('/users/:id/heartbeat', AuthController.heartbeat);

// --- Área Administrativa (Admin) ---
// Reset de senha forçado pelo admin
router.post('/admin/reset-password', AuthController.resetPassword);

// RBAC (Role-Based Access Control) - Gestão de Permissões dinâmicas
router.get('/admin/permissions', AuthController.getPermissions);
router.post('/admin/permissions', AuthController.updatePermissions);

export default router;