import { pool } from '../config/db';
import { getIO } from './socket';

/**
 * Cria um registro de auditoria no banco e notifica administradores em tempo real.
 * * @param userId - ID do usuário que realizou a ação (pode ser null se for sistema/anonimo)
 * @param action - Nome da ação (ex: 'LOGIN', 'DELETE_PRODUCT')
 * @param details - Objeto JSON com os detalhes do que foi alterado
 * @param ip - Endereço IP da requisição
 */
export const createLog = async (userId: string | null, action: string, details: Record<string, any>, ip: string) => {
  try {
    // 1. Insere o log básico e recupera o ID gerado
    const insertResult = await pool.query(
      `INSERT INTO audit_logs (user_id, action, details, ip_address) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, action, JSON.stringify(details), ip]
    );

    const newLogId = insertResult.rows[0].id;

    // 2. Busca o log completo com JOIN para pegar o Nome e Cargo do usuário.
    // Isso é feito imediatamente para que o Dashboard do Admin mostre o nome real, não o ID.
    const fullLogQuery = `
      SELECT 
        a.id, 
        a.action, 
        a.details, 
        a.created_at, 
        a.ip_address,
        COALESCE(p.name, u.email, 'Usuário Removido') as user_name, 
        COALESCE(p.role::text, 'removido') as user_role
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN profiles p ON u.id = p.id
      WHERE a.id = $1
    `;
    
    const fullLogResult = await pool.query(fullLogQuery, [newLogId]);
    const logData = fullLogResult.rows[0];
    
    // 3. Emite para o painel de Admin em Tempo Real
    // O getIO() já possui proteção interna (Mock) caso o socket não tenha iniciado ainda.
    getIO().to('admin').emit('new_audit_log', logData);

  } catch (err) {
    // Log de erro no console, mas não derruba a aplicação se o log falhar
    console.error("❌ Falha ao criar log de auditoria:", err);
  }
};