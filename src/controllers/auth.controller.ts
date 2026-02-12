import { Request, Response } from 'express';
import { pool } from '../config/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createLog } from '../utils/logger';
import { getIO } from '../utils/socket';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'sua-chave-secreta';

// --- LOGIN ---
export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    // 1. Busca o usuário pelo email
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Usuário não encontrado' });
    }

    // 2. Verifica a senha criptografada
    const validPassword = await bcrypt.compare(password, user.encrypted_password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Senha incorreta' });
    }

    // 3. Gera o Token JWT (expira em 1 dia)
    const token = jwt.sign(
      { id: user.id, email: user.email }, 
      JWT_SECRET, 
      { expiresIn: '1d' }
    );
    
    // 4. Busca ou Cria o Perfil do Usuário
    let { rows: profiles } = await pool.query('SELECT * FROM profiles WHERE id = $1', [user.id]);
    
    if (profiles.length === 0) {
      // Se não tiver perfil (primeiro login após cadastro manual no banco), cria um padrão
      const defaultName = user.email.split('@')[0];
      const insertRes = await pool.query(
        `INSERT INTO profiles (id, name, role, sector) 
         VALUES ($1, $2, 'setor', 'Geral') RETURNING *`,
        [user.id, defaultName]
      );
      profiles = insertRes.rows;
    }

    const userProfile = profiles[0];

    // 5. Busca Permissões do Cargo (Role)
    const permRes = await pool.query('SELECT page_key FROM role_permissions WHERE role = $1', [userProfile.role]);
    const userPermissions = permRes.rows.map((r: any) => r.page_key);
    
    // 6. Log de Auditoria
    await createLog(user.id, 'LOGIN', { message: 'Login realizado com sucesso' }, req.ip || '127.0.0.1');

    // 7. Retorna tudo que o Front precisa
    res.json({ 
      token, 
      user: { id: user.id, email: user.email }, 
      profile: userProfile, 
      permissions: userPermissions 
    });

  } catch (error: any) {
    console.error("Erro no Login:", error);
    res.status(500).json({ error: "Erro interno no servidor ao realizar login." });
  }
};

// --- REGISTRO DE NOVO USUÁRIO ---
export const register = async (req: Request, res: Response) => {
  const { email, password, name, role, sector } = req.body;
  
  const client = await pool.connect(); // Usa transaction para garantir integridade

  try {
    await client.query('BEGIN');

    // 1. Verifica se email já existe
    const userCheck = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Este e-mail já está em uso.' });
    }

    // 2. Criptografa a senha
    const salt = await bcrypt.genSalt(10);
    const encryptedPassword = await bcrypt.hash(password, salt);
    
    // 3. Insere na tabela USERS
    const userRes = await client.query(
      'INSERT INTO users (email, encrypted_password) VALUES ($1, $2) RETURNING id',
      [email, encryptedPassword]
    );
    const newUserId = userRes.rows[0].id;

    // 4. Insere na tabela PROFILES
    await client.query(
      `INSERT INTO profiles (id, name, role, sector) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, sector = EXCLUDED.sector`,
      [newUserId, name, role, sector]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: "Usuário registrado com sucesso!" });

  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error("Erro no Registro:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// --- LISTAR USUÁRIOS (ADMIN) ---
export const getUsers = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        u.id, 
        u.email, 
        COALESCE(p.name, u.email) as name, 
        COALESCE(p.role, 'setor') as role, 
        COALESCE(p.sector, '-') as sector, 
        u.created_at, 
        u.total_minutes, 
        u.last_active
      FROM users u 
      LEFT JOIN profiles p ON u.id = p.id 
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao buscar lista de usuários' });
  }
};

// --- ATUALIZAR CARGO DO USUÁRIO ---
export const updateUserRole = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { role } = req.body;

  try {
    await pool.query('UPDATE profiles SET role = $1 WHERE id = $2', [role, id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao atualizar função do usuário' });
  }
};

// --- EXCLUIR USUÁRIO ---
export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // A deleção em cascade do banco deve cuidar dos perfis e logs, se configurada.
    // Senão, o ideal seria deletar de profiles primeiro.
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
};

// --- HEARTBEAT (Contador de Tempo Online) ---
export const heartbeat = async (req: Request, res: Response) => {
  const { id } = req.params;
  try { 
    await pool.query(`
      UPDATE users 
      SET total_minutes = COALESCE(total_minutes, 0) + 1, last_active = NOW() 
      WHERE id = $1
    `, [id]);
    res.json({ success: true }); 
  } catch (error) { 
    // Falha silenciosa para não travar o front
    res.json({ success: false }); 
  }
};

// --- RESETAR SENHA (ADMIN) ---
export const resetPassword = async (req: Request, res: Response) => {
  const { userId, newPassword } = req.body;
  const requesterId = (req as any).user.id;

  // 1. Verifica se quem pediu é ADMIN
  const adminCheck = await pool.query("SELECT role FROM profiles WHERE id = $1", [requesterId]);
  if (adminCheck.rows[0]?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const encryptedPassword = await bcrypt.hash(newPassword, salt);
    
    await pool.query('UPDATE users SET encrypted_password = $1 WHERE id = $2', [encryptedPassword, userId]);
    
    await createLog(requesterId, 'RESET_PASSWORD', { target_user_id: userId }, req.ip || '127.0.0.1');

    res.json({ success: true, message: 'Senha redefinida com sucesso.' });
  } catch (error: any) { 
    res.status(500).json({ error: 'Erro ao resetar senha' }); 
  }
};

// --- LISTAR PERMISSÕES (RBAC) ---
export const getPermissions = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query('SELECT role, page_key FROM role_permissions');
    
    // Transforma o array plano do banco em um objeto { role: [permissoes] }
    const permissionsMap: Record<string, string[]> = {};
    rows.forEach((row: any) => {
      if (!permissionsMap[row.role]) {
        permissionsMap[row.role] = [];
      }
      permissionsMap[row.role].push(row.page_key);
    });
    
    res.json(permissionsMap);
  } catch (error: any) { 
    res.status(500).json({ error: 'Erro ao buscar permissões' }); 
  }
};

// --- ATUALIZAR PERMISSÕES (RBAC) ---
export const updatePermissions = async (req: Request, res: Response) => {
  const { role, permissions } = req.body;
  const requesterId = (req as any).user.id;

  // 1. Verifica se quem pediu é ADMIN
  const adminCheck = await pool.query("SELECT role FROM profiles WHERE id = $1", [requesterId]);
  if (adminCheck.rows[0]?.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Remove todas as permissões antigas desse cargo
    await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);
    
    // Insere as novas
    for (const page of permissions) {
      await client.query('INSERT INTO role_permissions (role, page_key) VALUES ($1, $2)', [role, page]);
    }
    
    await client.query('COMMIT');
    
    // Log e Notificação em Tempo Real para atualizar a UI de quem estiver logado
    await createLog(requesterId, 'UPDATE_PERMISSIONS', { role_target: role, count: permissions.length }, req.ip || '127.0.0.1');
    getIO().to(role).emit('permissions_updated', permissions);
    
    res.json({ success: true });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erro ao salvar permissões' });
  } finally {
    client.release();
  }
};