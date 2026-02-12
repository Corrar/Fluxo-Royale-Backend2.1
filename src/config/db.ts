import { Pool } from 'pg';
import dotenv from 'dotenv';

// Carrega as variáveis do arquivo .env
dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("❌ ERRO FATAL: A variável DATABASE_URL não está definida no arquivo .env");
  process.exit(1); // Encerra o servidor se não tiver banco configurado
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Configuração automática de SSL para produção (necessário para Render/Vercel/Neon/Supabase)
  ssl: process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true' 
    ? { rejectUnauthorized: false } 
    : undefined
});

// Teste de conexão ao iniciar (para debug)
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Falha ao conectar no PostgreSQL:', err.message);
  } else {
    console.log('✅ Banco de Dados conectado com sucesso!');
    release(); // Libera o cliente de volta para o pool
  }
});

// Listener global para erros inesperados na conexão
pool.on('error', (err, client) => {
  console.error('❌ Erro inesperado no client do PostgreSQL', err);
  // Não encerra o processo, permitindo tentativa de reconexão
});