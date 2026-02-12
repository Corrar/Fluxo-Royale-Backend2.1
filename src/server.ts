import { createServer } from 'http';
import dotenv from 'dotenv';
import { app } from './app'; // Importa a aplicação Express configurada
import { initSocket } from './utils/socket'; // Inicializador do Socket.io
import { initPush } from './utils/push'; // Inicializador do Web Push

// 1. Carrega variáveis de ambiente
dotenv.config();

const PORT = process.env.PORT || 3000;

// 2. Cria o servidor HTTP nativo
// Precisamos disso (em vez de app.listen) para acoplar o Socket.io corretamente
const httpServer = createServer(app);

// 3. Inicializa os Serviços Auxiliares
// O Socket.io precisa da instância do httpServer para interceptar conexões
initSocket(httpServer);

// Configura as chaves VAPID para notificações push
initPush();

// 4. Inicia o Servidor
httpServer.listen(PORT, () => {
  console.log('=================================================');
  console.log(`🚀 SERVIDOR RODANDO!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`⚡ Socket.io: Ativo e pronto.`);
  console.log(`🔔 Web Push: Configurado.`);
  console.log(`📅 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('=================================================');
});

// (Opcional) Tratamento para encerramento gracioso
// Útil para quando o Render/Vercel reinicia o servidor
process.on('SIGTERM', () => {
  console.log('🛑 Recebido SIGTERM. Encerrando servidor graciosamente...');
  httpServer.close(() => {
    console.log('✅ Servidor encerrado.');
    process.exit(0);
  });
});