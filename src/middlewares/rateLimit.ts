import rateLimit from 'express-rate-limit';

/**
 * Limite Global: Aplica-se a todas as rotas da API.
 * Protege contra sobrecarga geral do servidor (DDoS simples).
 * Configuração: Máximo de 300 requisições a cada 15 minutos por IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300, // Limite de 300 requisições por IP
  standardHeaders: true, // Retorna info de limite nos headers `RateLimit-*`
  legacyHeaders: false, // Desabilita headers `X-RateLimit-*`
  message: {
    error: 'Muitas requisições deste IP, por favor tente novamente em 15 minutos.'
  }
});

/**
 * Limite de Autenticação: Aplica-se apenas às rotas de Login/Registro.
 * Protege contra ataques de força bruta (tentativas de adivinhar senha).
 * Configuração: Máximo de 20 tentativas erradas a cada 5 minutos.
 */
export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 20, // Limite estrito de 20 tentativas
  message: {
    error: 'Muitas tentativas de login. Sua conta está temporariamente bloqueada por 5 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});