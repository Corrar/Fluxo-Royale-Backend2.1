import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Verifica se a chave secreta existe, senão avisa (segurança)
const envSecret = process.env.JWT_SECRET;
if (!envSecret) {
  console.warn("⚠️ AVISO DE SEGURANÇA: JWT_SECRET não definido no .env. Usando chave padrão insegura.");
}

const JWT_SECRET = envSecret || 'sua-chave-secreta-padrao';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  // 1. Verifica se o header existe
  if (!authHeader) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  // 2. Valida o formato "Bearer <token>"
  const parts = authHeader.split(' ');
  
  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Erro no token. Formato esperado: Bearer <token>' });
  }

  const [scheme, token] = parts;

  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: 'Token malformatado.' });
  }

  try {
    // 3. Verifica a validade do token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 4. Anexa o payload do usuário ao request para uso nos controllers
    // (req as any) é usado para contornar a tipagem estrita do Express sem precisar de arquivos .d.ts complexos agora
    (req as any).user = decoded;

    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
};