import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { corsOptions } from '../config/cors';

let io: SocketIOServer;

export const initSocket = (httpServer: HttpServer) => {
  io = new SocketIOServer(httpServer, {
    cors: corsOptions,
    // Configurações de performance/timeout recomendadas para produção
    pingTimeout: 60000,
    connectTimeout: 45000
  });

  io.on('connection', (socket: Socket) => {
    console.log(`⚡ Cliente Socket conectado: ${socket.id}`);
    
    // Entrar em "salas" baseadas no cargo (ex: 'almoxarife', 'admin')
    socket.on('join_room', (role: string) => {
      if (role) {
        socket.join(role);
        // console.log(`Socket ${socket.id} entrou na sala: ${role}`);
      }
    });

    socket.on('disconnect', (reason) => {
       // Debug opcional: console.log(`Cliente desconectou: ${reason}`);
    });
  });

  // Monitoramento de erros no nível do Engine (importante para debug)
  io.engine.on("connection_error", (err) => {
    console.error("Erro de conexão Socket.io:", err.req?.url, err.code, err.message);
  });

  return io;
};

// Getter seguro para usar o IO em Controllers/Services
export const getIO = () => {
  if (!io) {
    console.warn("⚠️ Aviso: getIO() chamado antes da inicialização do Socket. Usando Mock seguro.");
    
    // Retorna um objeto "Mock" que imita a estrutura básica do Socket.io
    // Isso impede que o servidor crashe se um controller tentar emitir algo cedo demais.
    return {
      to: (room: string) => ({
        emit: (event: string, data?: any) => {
          // console.log(`[Mock IO] Emitindo '${event}' para '${room}' (Socket não pronto)`);
        }
      }),
      emit: (event: string, data?: any) => {
         // console.log(`[Mock IO] Emitindo '${event}' globalmente (Socket não pronto)`);
      }
    } as unknown as SocketIOServer;
  }
  return io;
};