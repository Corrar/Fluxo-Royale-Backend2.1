import { Request, Response } from 'express';
import { pool } from '../config/db';
import { vapidKeys } from '../utils/push'; // Importa as chaves centralizadas

// --- RELATÓRIO GERENCIAL (GRÁFICOS) ---
export const getManagerialReport = async (req: Request, res: Response) => {
  try {
    // 1. Top 5 Produtos (Saídas)
    const topProductsQuery = `
      SELECT p.name, SUM(si.quantity) as total 
      FROM separation_items si 
      JOIN products p ON si.product_id = p.id 
      JOIN separations s ON si.separation_id = s.id 
      WHERE s.status = 'concluida' 
      GROUP BY p.name 
      ORDER BY total DESC 
      LIMIT 5
    `;

    // 2. Histórico de Movimentação (Últimos 5 meses)
    const historyQuery = `
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months', 
          date_trunc('month', CURRENT_DATE), 
          '1 month'::interval
        ) as month
      ) 
      SELECT 
        TO_CHAR(m.month, 'Mon') as name, 
        COALESCE(SUM(xi.quantity), 0) as entradas, 
        (
          SELECT COALESCE(SUM(si.quantity), 0) 
          FROM separation_items si 
          JOIN separations s ON si.separation_id = s.id 
          WHERE date_trunc('month', s.created_at) = m.month AND s.status = 'concluida'
        ) as saidas 
      FROM months m 
      LEFT JOIN xml_logs xl ON date_trunc('month', xl.created_at) = m.month 
      LEFT JOIN xml_items xi ON xi.xml_log_id = xl.id 
      GROUP BY m.month 
      ORDER BY m.month ASC
    `;

    // 3. Status de Compras (Pizza)
    const statusPieQuery = `
      SELECT 
        COALESCE(purchase_status, 'pendente') as name, 
        COUNT(*) as value 
      FROM products 
      WHERE active = true 
      GROUP BY purchase_status
    `;

    // Executa as 3 queries em paralelo para performance
    const [top, hist, pie] = await Promise.all([
      pool.query(topProductsQuery),
      pool.query(historyQuery),
      pool.query(statusPieQuery)
    ]);

    res.json({ 
      topProducts: top.rows, 
      history: hist.rows, 
      purchaseStatus: pie.rows 
    });

  } catch (error: any) {
    console.error("Erro Report Gerencial:", error);
    res.status(500).json({ error: 'Erro ao gerar dados gerenciais' });
  }
};

// --- ESTATÍSTICAS GERAIS (CARDS DO TOPO) ---
export const getStats = async (req: Request, res: Response) => {
  try {
    // Queries otimizadas
    const queries = [
      pool.query('SELECT COUNT(*) FROM products WHERE active = true'),
      pool.query(`
        SELECT COUNT(*) 
        FROM products p 
        LEFT JOIN stock s ON p.id = s.product_id 
        WHERE p.min_stock IS NOT NULL 
          AND (COALESCE(s.quantity_on_hand, 0) - COALESCE(s.quantity_reserved, 0)) < p.min_stock 
          AND p.active = true
      `),
      pool.query('SELECT COUNT(*) FROM requests'),
      pool.query("SELECT COUNT(*) FROM requests WHERE status = 'aberto'"),
      pool.query("SELECT COUNT(*) FROM separations WHERE type = 'op'"), // type='op' ou 'default' conforme sua regra
      // Cálculo de valor total direto no SQL (Mais rápido que loop JS)
      pool.query(`
        SELECT SUM(COALESCE(s.quantity_on_hand, 0) * COALESCE(p.unit_price, 0)) as total_value
        FROM stock s 
        JOIN products p ON s.product_id = p.id 
        WHERE p.active = true
      `)
    ];

    const [productsRes, lowStockRes, requestsRes, openRequestsRes, separationsRes, valueRes] = await Promise.all(queries);

    res.json({
      totalProducts: parseInt(productsRes.rows[0].count),
      lowStock: parseInt(lowStockRes.rows[0].count),
      totalRequests: parseInt(requestsRes.rows[0].count),
      openRequests: parseInt(openRequestsRes.rows[0].count),
      totalSeparations: parseInt(separationsRes.rows[0].count),
      totalValue: parseFloat(valueRes.rows[0].total_value || '0'),
    });

  } catch (error: any) {
    console.error("Erro Stats:", error);
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
};

// --- RELATÓRIO GERAL (TABELA UNIFICADA) ---
export const getGeneralReport = async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'Datas de início e fim são obrigatórias.' });
  }

  const start = `${startDate} 00:00:00`;
  const end = `${endDate} 23:59:59`;

  try {
    // 1. Entradas (Logs XML/Manual)
    const queryEntradas = `
      SELECT 
        xi.created_at as data, 
        'Entrada' as tipo, 
        xl.file_name as origem, 
        p.name as produto, 
        p.sku, 
        p.unit as unidade, 
        xi.quantity as quantidade 
      FROM xml_items xi 
      JOIN products p ON xi.product_id = p.id 
      JOIN xml_logs xl ON xi.xml_log_id = xl.id 
      WHERE xi.created_at >= $1 AND xi.created_at <= $2 
      ORDER BY xi.created_at DESC
    `;

    // 2. Saídas (Separações/OPs)
    const querySeparacoes = `
      SELECT 
        s.created_at as data, 
        CASE WHEN s.type='manual' THEN 'Saída - Manual' ELSE 'Saída - Separação' END as tipo, 
        s.destination as destino_setor, 
        p.name as produto, 
        p.sku, 
        p.unit as unidade, 
        si.quantity as quantidade 
      FROM separation_items si 
      JOIN separations s ON si.separation_id = s.id 
      JOIN products p ON si.product_id = p.id 
      WHERE s.created_at >= $1 AND s.created_at <= $2 
        AND s.status = 'concluida' 
      ORDER BY s.created_at DESC
    `;

    // 3. Saídas (Solicitações/Requests)
    const querySolicitacoes = `
      SELECT 
        r.created_at as data, 
        'Saída - Solicitação' as tipo, 
        COALESCE(pf.sector, r.sector) as destino_setor, 
        pf.name as solicitante, 
        COALESCE(p.name, ri.custom_product_name) as produto, 
        p.sku, 
        p.unit as unidade, 
        ri.quantity_requested as quantidade, 
        r.status 
      FROM request_items ri 
      JOIN requests r ON ri.request_id = r.id 
      LEFT JOIN products p ON ri.product_id = p.id 
      LEFT JOIN profiles pf ON r.requester_id = pf.id 
      WHERE r.created_at >= $1 AND r.created_at <= $2 
        AND r.status IN ('aprovado', 'entregue') 
      ORDER BY r.created_at DESC
    `;

    const [entradasRes, separacoesRes, solicitacoesRes] = await Promise.all([
      pool.query(queryEntradas, [start, end]),
      pool.query(querySeparacoes, [start, end]),
      pool.query(querySolicitacoes, [start, end])
    ]);

    res.json({ 
      entradas: entradasRes.rows, 
      saidas_separacoes: separacoesRes.rows, 
      saidas_solicitacoes: solicitacoesRes.rows 
    });

  } catch (error: any) {
    console.error("Erro Report Geral:", error);
    res.status(500).json({ error: 'Erro ao gerar relatório detalhado' });
  }
};

// --- DATAS DISPONÍVEIS (PARA FILTRO) ---
export const getAvailableDates = async (req: Request, res: Response) => {
  try {
    // Busca a menor e a maior data em todas as tabelas relevantes
    const result = await pool.query(`
      SELECT MIN(data) as min_date, MAX(data) as max_date 
      FROM (
        SELECT created_at as data FROM xml_items 
        UNION ALL 
        SELECT created_at as data FROM separations WHERE status = 'concluida' 
        UNION ALL 
        SELECT created_at as data FROM requests WHERE status IN ('aprovado', 'entregue')
      ) as all_dates
    `);
    res.json(result.rows[0]);
  } catch (error: any) { 
    res.status(500).json({ error: 'Erro ao buscar intervalo de datas' }); 
  }
};

// --- LOGS DE AUDITORIA (ADMIN ONLY) ---
export const getLogs = async (req: Request, res: Response) => {
  const requesterId = (req as any).user.id;

  try {
    // Verificação de Admin
    const adminCheck = await pool.query("SELECT role FROM profiles WHERE id = $1", [requesterId]);
    if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const { action, user, startDate, endDate } = req.query;
    
    // Construção Dinâmica da Query
    let query = `
      SELECT 
        a.id, a.action, a.details, a.created_at, a.ip_address, 
        COALESCE(p.name, u.email, 'Usuário Removido') as user_name, 
        COALESCE(p.role::text, 'removido') as user_role 
      FROM audit_logs a 
      LEFT JOIN users u ON a.user_id = u.id 
      LEFT JOIN profiles p ON u.id = p.id 
      WHERE 1=1
    `;
    
    const params: any[] = [];
    let idx = 1;

    if (action && action !== 'ALL') { 
      query += ` AND a.action = $${idx++}`; 
      params.push(action); 
    }
    
    if (user) { 
      query += ` AND (p.name ILIKE $${idx} OR u.email ILIKE $${idx++})`; 
      params.push(`%${user}%`); 
    }
    
    if (startDate) { 
      query += ` AND a.created_at >= $${idx++}`; 
      params.push(`${startDate} 00:00:00`); 
    }
    
    if (endDate) { 
      query += ` AND a.created_at <= $${idx++}`; 
      params.push(`${endDate} 23:59:59`); 
    }
    
    query += ` ORDER BY a.created_at DESC LIMIT 100`;

    const { rows } = await pool.query(query, params);
    res.json(rows);

  } catch (error: any) {
    console.error("Erro Logs:", error);
    res.status(500).json({ error: "Erro ao buscar logs do sistema" });
  }
};

// --- CONFIGURAÇÃO DE NOTIFICAÇÕES (PUSH) ---
export const getPushKey = (req: Request, res: Response) => {
    // Retorna a chave pública para o Front-end se registrar
    res.json({ publicKey: vapidKeys.publicKey });
};

export const subscribePush = async (req: Request, res: Response) => {
    const { profileId, subscription } = req.body;
    
    if (!profileId || !subscription) {
      return res.status(400).json({ error: "Dados incompletos para inscrição." });
    }

    try {
      await pool.query(`
        INSERT INTO user_push_subscriptions (profile_id, subscription_data) 
        VALUES ($1, $2) 
        ON CONFLICT (profile_id, subscription_data) DO NOTHING
      `, [profileId, JSON.stringify(subscription)]);
      
      res.json({ success: true });
    } catch (error) {
      console.error("Erro Push Subscribe:", error);
      res.status(500).json({ error: 'Erro ao salvar subscrição push' });
    }
};

// ==========================================
// --- NOVA ROTA: DADOS DA PÁGINA INICIAL ---
// ==========================================
export const getHomeDashboard = async (req: Request, res: Response) => {
  try {
    const queries = [
      // 0: Patrimônio (Soma do valor de todos os itens em estoque)
      pool.query(`
        SELECT SUM(COALESCE(s.quantity_on_hand, 0) * COALESCE(p.unit_price, 0)) as total_value
        FROM stock s JOIN products p ON s.product_id = p.id WHERE p.active = true
      `),
      // 1: Ativos (Quantidade total de itens físicos guardados)
      pool.query(`
        SELECT SUM(COALESCE(quantity_on_hand, 0)) as total_items
        FROM stock s JOIN products p ON s.product_id = p.id WHERE p.active = true
      `),
      // 2: Críticos (Estoque atual menor que o mínimo)
      pool.query(`
        SELECT COUNT(*) FROM products p 
        LEFT JOIN stock s ON p.id = s.product_id 
        WHERE p.min_stock IS NOT NULL 
          AND (COALESCE(s.quantity_on_hand, 0) - COALESCE(s.quantity_reserved, 0)) < p.min_stock 
          AND p.active = true
      `),
      // 3: Obsoletos (Produtos com estoque > 0, mas sem NENHUMA saída nos últimos 90 dias)
      pool.query(`
        SELECT COUNT(DISTINCT s.product_id)
        FROM stock s
        WHERE s.quantity_on_hand > 0 
        AND NOT EXISTS (
          SELECT 1 FROM separation_items si 
          JOIN separations sep ON si.separation_id = sep.id 
          WHERE si.product_id = s.product_id 
          AND sep.created_at >= NOW() - INTERVAL '90 days'
        )
      `),
      // 4: Destaques (Buscando da tabela nova configurável pelo Admin)
      pool.query(`SELECT id, title, description as desc, bg, icon, border FROM highlights WHERE is_active = true ORDER BY created_at DESC LIMIT 5`),
      // 5: Atividades Recentes (Os últimos 3 logs do sistema)
      pool.query(`
        SELECT a.action, a.created_at, COALESCE(p.name, u.email, 'Sistema') as user_name
        FROM audit_logs a 
        LEFT JOIN users u ON a.user_id = u.id 
        LEFT JOIN profiles p ON u.id = p.id 
        ORDER BY a.created_at DESC LIMIT 3
      `)
    ];

    const [valueRes, itemsRes, critRes, obsRes, highlightsRes, activitiesRes] = await Promise.all(queries);

    // Mapeamos a atividade para o formato amigável para a Home
    const formattedActivities = activitiesRes.rows.map(a => {
      // Formata a data para ex: "10:30"
      const timeStr = new Date(a.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return {
        user: a.user_name.split(' ')[0], // Apenas o primeiro nome
        action: a.action.replace(/_/g, ' '), // Remove os underscores (ex: CREATE_PRODUCT vira CREATE PRODUCT)
        time: timeStr
      };
    });

    res.json({
      stats: {
        patrimonio: parseFloat(valueRes.rows[0]?.total_value || '0'),
        ativos: parseInt(itemsRes.rows[0]?.total_items || '0'),
        criticos: parseInt(critRes.rows[0]?.count || '0'),
        obsoletos: parseInt(obsRes.rows[0]?.count || '0'),
      },
      highlights: highlightsRes.rows,
      activities: formattedActivities
    });

  } catch (error: any) {
    console.error("Erro Home Dashboard:", error);
    res.status(500).json({ error: 'Erro ao carregar dados da página inicial' });
  }
};

// ==========================================
// --- GESTÃO DE DESTAQUES (BANNERS) ---
// ==========================================

export const getHighlights = async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description as desc, icon, bg, border, is_active FROM highlights ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error: any) {
    console.error("Erro ao buscar destaques:", error);
    res.status(500).json({ error: 'Erro ao buscar destaques' });
  }
};

export const createHighlight = async (req: Request, res: Response) => {
  const { title, desc, icon, bg, border } = req.body;
  const userId = (req as any).user.id;

  try {
    // Segurança: Apenas admins podem criar
    const adminCheck = await pool.query("SELECT role FROM profiles WHERE id = $1", [userId]);
    if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO highlights (title, description, icon, bg, border, is_active) 
       VALUES ($1, $2, $3, $4, $5, true) 
       RETURNING id, title, description as desc, icon, bg, border`,
      [title, desc, icon, bg, border]
    );
    
    res.status(201).json(rows[0]);
  } catch (error: any) {
    console.error("Erro ao criar destaque:", error);
    res.status(500).json({ error: 'Erro ao criar destaque' });
  }
};

export const deleteHighlight = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = (req as any).user.id;

  try {
    // Segurança: Apenas admins podem deletar
    const adminCheck = await pool.query("SELECT role FROM profiles WHERE id = $1", [userId]);
    if (adminCheck.rows.length === 0 || adminCheck.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'Acesso negado.' });
    }

    await pool.query('DELETE FROM highlights WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Erro ao excluir destaque:", error);
    res.status(500).json({ error: 'Erro ao excluir destaque' });
  }
};
