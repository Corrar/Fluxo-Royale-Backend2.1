import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { getProducts, createProduct } from '../controllers/product.controller';

const router = Router();

router.use(authenticate); // Aplica auth em todas as rotas abaixo

router.get('/', getProducts);
router.post('/', createProduct);
// router.put('/:id', updateProduct);
// router.delete('/:id', deleteProduct);

export default router;