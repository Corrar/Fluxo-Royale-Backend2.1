import webpush from 'web-push';
import { pool } from '../config/db';
import dotenv from 'dotenv';

dotenv.config();

// Configuração das Chaves VAPID
// É crucial que estas chaves estejam no .env em produção
export const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BFx...SUBSTITUA_POR_CHAVE_REAL_SE_NAO_USAR_ENV...',
  privateKey: process.env.VAPID_PRIVATE_KEY || '...SUBSTITUA_POR_CHAVE_REAL...'
};

const CONTACT_EMAIL = process.env.VAPID_EMAIL || 'mailto:suporte@fluxoroyale.local';

/**
 * Inicializa a configuração do Web Push ao arrancar o servidor.
 */
export const initPush = () => {
    try {
        // Verifica se as chaves são placeholders ou estão vazias
        if (!vapidKeys.privateKey || vapidKeys.privateKey.startsWith('...')) {
            console.warn('⚠️ Push Notifications: Chaves VAPID não configuradas corretamente no .env. O serviço não funcionará.');
            return;
        }

        webpush.setVapidDetails(
          CONTACT_EMAIL,
          vapidKeys.publicKey,
          vapidKeys.privateKey
        );
        console.log('✅ Web Push configurado com sucesso');
    } catch (err) {
        console.warn('⚠️ Erro ao configurar Web Push:', err);
    }
};

/**
 * Envia notificação push para todos os usuários de um determinado cargo (role).
 * Remove automaticamente subscrições inválidas (410 Gone / 404 Not Found).
 */
export const sendPushNotification = async (roleTarget: string, title: string, body: string, url: string = '/requests') => {
  try {
    // 1. Busca subscrições ativas para o cargo alvo
    const { rows: subs } = await pool.query(`
      SELECT s.subscription_data, s.id 
      FROM user_push_subscriptions s
      JOIN profiles p ON s.profile_id = p.id
      WHERE p.role = $1
    `, [roleTarget]);

    if (subs.length === 0) return;

    // 2. Monta o payload
    const payload = JSON.stringify({ 
        title, 
        body, 
        icon: '/pwa-192x192.png', // Caminho padrão do ícone PWA
        data: { url } // URL para onde o clique deve levar
    });

    // 3. Envio paralelo (Promise.all)
    const notifications = subs.map(row => {
      let subData;
      
      // Garante que o subscription_data seja um objeto, caso o banco retorne string
      try {
          subData = typeof row.subscription_data === 'string' 
            ? JSON.parse(row.subscription_data) 
            : row.subscription_data;
      } catch (e) {
          console.error(`Erro ao fazer parse da subscrição ID ${row.id}`);
          return Promise.resolve();
      }

      return webpush.sendNotification(subData, payload)
        .catch(async (err) => {
          // Se o endpoint retornou 410 (Gone) ou 404, a subscrição não existe mais no navegador
          if (err.statusCode === 410 || err.statusCode === 404) {
            // console.log(`🗑️ Limpando subscrição inativa (ID: ${row.id})`);
            await pool.query('DELETE FROM user_push_subscriptions WHERE id = $1', [row.id]);
          } else {
            console.error(`Erro no envio de push (ID: ${row.id}):`, err.statusCode);
          }
        });
    });

    await Promise.all(notifications);
    
  } catch (error) {
    console.error("Erro geral no processamento do Push:", error);
  }
};