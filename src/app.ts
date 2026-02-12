import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsOptions } from './config/cors';
import { globalLimiter } from './middlewares/rateLimit';
import routes from './routes'; // Importa o index.ts da pasta routes
import { getIO } from './utils/socket';

const app = express();

// ==========================================
// 1. CONFIGURAÇÕES GLOBAIS
// ==========================================

// Necessário para obter o IP real do usuário quando hospedado em Vercel/Render/Heroku
// Sem isso, o Rate Limit pode bloquear o IP do Load Balancer em vez do usuário real.
app.set('trust proxy', 1);

// ==========================================
// 2. MIDDLEWARES DE SEGURANÇA E PARSING
// ==========================================

// Adiciona headers de segurança HTTP (X-Content-Type-Options, X-Frame-Options, etc.)
app.use(helmet());

// Configura quem pode acessar a API (CORS)
app.use(cors(corsOptions));

// Permite que a API entenda JSON no corpo das requisições (body-parser embutido)
app.use(express.json());

// Aplica limite de requisições globalmente (Proteção básica contra DDoS)
app.use(globalLimiter);

// ==========================================
// 3. MIDDLEWARES UTILITÁRIOS
// ==========================================

// Injeta a instância do Socket.io no objeto de requisição (req.io)
// Isso permite usar 'req.io.emit' em middlewares legados, se necessário.
// Nota: Os controllers novos importam 'getIO' diretamente, mas mantemos isso por compatibilidade.
app.use((req: any, res, next) => {
    try {
        req.io = getIO();
    } catch (e) {
        // Se o socket ainda não iniciou (raro), não quebra a requisição
    }
    next();
});

// ==========================================
// 4. ROTAS
// ==========================================

// Carrega todas as rotas definidas em src/routes/index.ts
app.use(routes);

export { app };