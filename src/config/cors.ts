import { CorsOptions } from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Lista base de origens permitidas (Hardcoded)
const allowedOrigins = [
  'http://localhost:5173',  // Vite Frontend
  'http://localhost:3000',  // Backend ou Frontend alternativo
  'https://fluxo-royale.vercel.app',
  'https://fluxoroyale21.vercel.app'
];

// Adiciona origens extras definidas no .env (separadas por vírgula)
// Ex no .env: ADDITIONAL_ORIGINS=https://minha-nova-url.com,https://teste.com
if (process.env.ADDITIONAL_ORIGINS) {
  const envOrigins = process.env.ADDITIONAL_ORIGINS.split(',');
  allowedOrigins.push(...envOrigins.map(origin => origin.trim()));
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // 1. Permite requisições sem 'origin' (ex: Postman, Insomnia, Apps Mobile Nativos, ou chamadas server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // 2. Verifica se a origem está na lista explícita
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // 3. Regras para Desenvolvimento Local e Rede Wi-Fi (Mobile testing)
    // Permite qualquer porta em localhost ou IPs da rede local (192.168.x.x)
    if (origin.startsWith('http://localhost') || origin.startsWith('http://192.168.')) {
        return callback(null, true);
    }

    // 4. Bloqueia qualquer outra origem
    console.error(`⛔ Bloqueio CORS: Tentativa de acesso negada da origem: ${origin}`);
    return callback(new Error(`Bloqueio CORS: A origem ${origin} não é permitida.`), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true, // Permite envio de Cookies/Sessão se necessário
  optionsSuccessStatus: 200 // Para compatibilidade com navegadores/clientes legados que não tratam bem o 204
};