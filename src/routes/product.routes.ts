import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import * as ProductController from '../controllers/product.controller';

const router = Router();

// Aplica o middleware de autenticação em TODAS as rotas deste arquivo
router.use(authenticate);

// ==========================================
// 📊 RELATÓRIOS E LISTAGENS ESPECIAIS
// (Devem vir antes das rotas dinâmicas /:id)
// ==========================================

// Relatório de Estoque Baixo
router.get('/low-stock', ProductController.getLowStock);

// Visualização Específica de Estoque (Tabela Stock)
// URL final será: /products/stock-list (ou conforme definido no index.ts)
router.get('/stock-list', ProductController.getStock);

// ==========================================
// 📦 MOVIMENTAÇÕES DE ESTOQUE
// ==========================================

// Entrada Manual (XML/Nota Fiscal Manual)
router.post('/manual-entry', ProductController.manualEntry);

// Saída Manual (Baixa direta/Uso interno)
router.post('/manual-withdrawal', ProductController.manualWithdrawal);

// Cálculo Inteligente de Estoque Mínimo
router.post('/calculate-min', ProductController.calculateMinStock);

// Ajuste Direto de Quantidade (Correção de Inventário)
// Note: O :id aqui refere-se ao ID da tabela STOCK, não do Produto
router.put('/stock/:id', ProductController.updateStock);

// ==========================================
// 🛠️ CRUD DE PRODUTOS (Padrão REST)
// ==========================================

// Listar todos os produtos
router.get('/', ProductController.getProducts);

// Criar novo produto
router.post('/', ProductController.createProduct);

// Atualizar produto existente (Dados cadastrais)
router.put('/:id', ProductController.updateProduct);

// Atualizar apenas informações de compra (Status, Previsão)
router.put('/:id/purchase-info', ProductController.updatePurchaseInfo);

// Arquivar/Excluir produto
router.delete('/:id', ProductController.deleteProduct);

export default router;