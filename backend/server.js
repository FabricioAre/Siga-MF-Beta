// =============================================================================
//  SIGA-MF | Maria Fumaça — server.js
//  Entry point principal do servidor Node.js
//  Stack: Express 4 · Socket.IO 4 · MySQL2 · dotenv
// =============================================================================
'use strict';

require('dotenv').config();

const http    = require('http');
const path    = require('path');
const express = require('express');
const cors    = require('cors');
const { Server: SocketIO } = require('socket.io');

// ── Módulos internos ──────────────────────────────────────────────────────────
const db             = require('./src/config/db');
const PedidoModel    = require('./src/models/pedidoModel');
const pedidoRoutes   = require('./src/routes/pedidoRoutes');
const cozinhaRoutes  = require('./src/routes/cozinhaRoutes');
const estoqueRoutes  = require('./src/routes/estoqueRoutes');
const caixaRoutes    = require('./src/routes/caixaRoutes');
const produtoRoutes  = require('./src/routes/produtoRoutes');
const authRoutes     = require('./src/routes/authRoutes');
const usuarioRoutes  = require('./src/routes/usuarioRoutes');

// =============================================================================
//  CONFIGURAÇÃO EXPRESS
// =============================================================================
const app = express();

// ── Middlewares globais ───────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Logger de requisições (leve, sem dependência externa) ─────────────────────
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method.padEnd(6)} ${req.originalUrl}`);
  next();
});

// =============================================================================
//  SERVIDOR HTTP + SOCKET.IO
// =============================================================================
const server = http.createServer(app);

const io = new SocketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  // Aumenta timeout para tablets em redes de restaurante (Wi-Fi instável)
  pingTimeout:  60000,
  pingInterval: 25000,
});

// ── Autenticação Socket.IO via JWT ──────────────────────────────────────────
// Impede que clientes não autenticados se conectem ao WebSocket
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    // Permite conexão sem token por enquanto (compatibilidade com frontends antigos)
    // Em produção, troque para: return next(new Error('Autenticação necessária'));
    console.warn(`[Socket] Conexão sem token: id=${socket.id.substring(0, 8)}`);
    return next();
  }
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'siga_mf_dev_secret_2025';
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.data.usuario = decoded;
    next();
  } catch (err) {
    console.warn(`[Socket] Token inválido: ${err.message}`);
    // Em produção, troque para: next(new Error('Token inválido'));
    next(); // Permite por enquanto para compatibilidade
  }
});

// Disponibiliza o io para todos os controllers via req.app.get('io')
app.set('io', io);

// =============================================================================
//  ARQUIVOS ESTÁTICOS — Frontends
// =============================================================================
const FRONT = path.resolve(__dirname, '..', 'frontend');

const staticOpts = {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  },
};
app.use('/garcom',  express.static(path.join(FRONT, 'garcom'),  staticOpts));
app.use('/cozinha', express.static(path.join(FRONT, 'cozinha'), staticOpts));
app.use('/caixa',   express.static(path.join(FRONT, 'caixa'),   staticOpts));
app.use('/admin',   express.static(path.join(FRONT, 'admin'),   staticOpts));
app.use('/assets',  express.static(path.join(FRONT, 'assets'),  staticOpts));
// Rota raiz → redireciona para o painel do garçom
app.get('/', (_req, res) => res.redirect('/assets/login.html'));

// =============================================================================
//  ROTAS DA API
// =============================================================================
app.use('/api/pedidos',  pedidoRoutes);
app.use('/api/cozinha',  cozinhaRoutes);
app.use('/api/estoque',  estoqueRoutes);
app.use('/api/caixa',    caixaRoutes);
app.use('/api/produtos', produtoRoutes);
app.use('/api/auth',     authRoutes);
app.use('/api/usuarios', usuarioRoutes);
// ── Health-check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS ok');
    res.json({
      status:    'ok',
      banco:     rows[0].ok === 1 ? 'conectado' : 'erro',
      timestamp: new Date().toISOString(),
      versao:    '1.0.0',
    });
  } catch (err) {
    res.status(503).json({ status: 'erro', banco: err.message });
  }
});

// ── Atalho conveniente: lista de mesas ────────────────────────────────────────
app.get('/api/mesas', async (_req, res) => {
  try {
    const [mesas] = await db.query(`
      SELECT m.id, m.numero, m.capacidade, m.status, m.localizacao,
             p.id  AS pedido_id,
             p.fluxo,
             p.status AS pedido_status
      FROM   mesas m
      LEFT JOIN pedidos p
             ON p.mesa_id = m.id
            AND p.status NOT IN ('pago','cancelado')
      ORDER  BY m.numero
    `);
    res.json(mesas);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Criar Novas Mesas em Lote (Área do Admin) ─────────────────────────────────
app.post('/api/mesas/gerar', async (req, res) => {
  try {
    // Recebe quantas mesas o admin quer adicionar
    const { quantidade, capacidade = 4, localizacao = 'Salão Principal' } = req.body;

    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ erro: 'Informe uma quantidade válida.' });
    }

    // 1. Descobre qual é o número da última mesa cadastrada
    const [ultimaMesa] = await db.query('SELECT MAX(numero) as max_numero FROM mesas');
    let proximoNumero = (ultimaMesa[0].max_numero || 0) + 1;

    // 2. Insere as N mesas usando parameterized queries (seguro contra SQL injection)
    const placeholders = [];
    const params = [];
    for (let i = 0; i < quantidade; i++) {
      placeholders.push('(?, ?, ?)');
      params.push(proximoNumero + i, capacidade, localizacao);
    }

    // 3. Executa a inserção no banco de dados
    const sql = `INSERT INTO mesas (numero, capacidade, localizacao) VALUES ${placeholders.join(',')}`;
    await db.query(sql, params);

    res.json({ mensagem: `${quantidade} novas mesas criadas com sucesso!` });
  } catch (err) {
    console.error('[Mesas]', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── Handler 404 ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// ── Handler de erros global ───────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Express] Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// =============================================================================
//  SOCKET.IO — EVENTOS EM TEMPO REAL
//
//  Salas (rooms):
//    - 'garcom'   → todos os dispositivos do salão
//    - 'cozinha'  → monitores KDS
//    - 'caixa'    → terminais de pagamento
//    - 'admin'    → painel administrativo
//
//  Fluxo principal:
//    garcom          → servidor → cozinha   : pedido/item criado
//    cozinha         → servidor → garcom    : item pronto
//    garcom          → servidor → caixa     : pedido entregue / aguardando conta
//    caixa           → servidor → todos     : pedido pago / mesa liberada
//    servidor        → admin               : alertas de estoque
// =============================================================================
io.on('connection', (socket) => {
  const clientId = socket.id.substring(0, 8);
  console.log(`[Socket] + conectado  id=${clientId}`);

  // ── Entrada nas salas por perfil ──────────────────────────────────────────
  // Cliente emite: { sala: 'garcom' | 'cozinha' | 'caixa' | 'admin', nome?: string }
  socket.on('entrar_sala', ({ sala, nome } = {}) => {
    const salasPermitidas = ['garcom', 'cozinha', 'caixa', 'admin'];
    if (!salasPermitidas.includes(sala)) {
      socket.emit('erro', { mensagem: `Sala inválida: ${sala}` });
      return;
    }

    // Remove de todas as salas anteriores antes de entrar na nova
    salasPermitidas.forEach(s => socket.leave(s));
    socket.join(sala);
    socket.data.sala = sala;
    socket.data.nome = nome || 'Anônimo';

    console.log(`[Socket] id=${clientId} entrou em '${sala}' (${socket.data.nome})`);

    socket.emit('sala_confirmada', {
      sala,
      socketId: socket.id,
      mensagem: `Bem-vindo à sala "${sala}", ${socket.data.nome}!`,
    });

    // Notifica os colegas da sala
    socket.to(sala).emit('colega_conectado', {
      socketId: socket.id,
      nome:     socket.data.nome,
      sala,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EVENTOS DO GARÇOM
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Garçom abriu uma mesa / criou pedido
   * Payload: { pedido_id, mesa_numero, fluxo, garcom }
   */
  socket.on('pedido_criado', (dados) => {
    console.log(`[Socket] pedido_criado  mesa=${dados.mesa_numero}  fluxo=${dados.fluxo}`);
    // Avisa cozinha e admin
    io.to('cozinha').to('admin').emit('novo_pedido', dados);
    // Atualiza painel de mesas para todos os garçons
    io.to('garcom').emit('mesa_atualizada', {
      mesa_numero: dados.mesa_numero,
      status: 'ocupada',
      pedido_id: dados.pedido_id,
    });
  });

  /**
   * Garçom adicionou itens ao pedido
   * Payload: { item_id, pedido_id, mesa_numero, fluxo, produtos, garcom }
   *   produtos = [{ nome, sabor2?, quantidade, observacao, preco_unitario }]
   */
  socket.on('itens_enviados', (dados) => {
    console.log(`[Socket] itens_enviados  pedido=${dados.pedido_id}  mesa=${dados.mesa_numero}`);
    // Dispara alerta sonoro/visual no KDS
    io.to('cozinha').emit('novo_item_kds', {
      ...dados,
      timestamp: new Date().toISOString(),
    });
    // Confirma para o garçom
    socket.emit('itens_confirmados', { pedido_id: dados.pedido_id });
  });

  /**
   * Garçom solicitou a conta da mesa
   * Payload: { pedido_id, mesa_numero, garcom }
   */
  socket.on('solicitar_conta', (dados) => {
    console.log(`[Socket] solicitar_conta  mesa=${dados.mesa_numero}`);
    io.to('caixa').emit('conta_solicitada', {
      ...dados,
      timestamp: new Date().toISOString(),
    });
    // Atualiza status da mesa para 'aguardando_conta'
    io.to('garcom').emit('mesa_atualizada', {
      mesa_numero: dados.mesa_numero,
      status: 'aguardando_conta',
      pedido_id: dados.pedido_id,
    });
  });

  /**
   * Garçom marcou item como entregue na mesa
   * Payload: { item_id, pedido_id, mesa_numero }
   */
  socket.on('item_entregue', async ({ item_id, pedido_id, mesa_numero } = {}) => {
    try {
      const item = await PedidoModel.atualizarStatusItem(item_id, 'entregue');
      io.to('garcom').to('cozinha').to('admin').emit('item_entregue_confirmado', {
        item_id,
        pedido_id: item?.pedido_id ?? pedido_id,
        mesa_numero,
      });
    } catch (err) {
      console.error('[Socket] item_entregue:', err.message);
      socket.emit('erro', { mensagem: 'Erro ao confirmar entrega.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EVENTOS DA COZINHA (KDS)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cozinheiro iniciou o preparo de um item
   * Payload: { item_id, pedido_id, mesa_numero, cozinheiro? }
   */
  socket.on('iniciar_preparo', async ({ item_id, pedido_id, mesa_numero } = {}) => {
    try {
      await PedidoModel.atualizarStatusItem(item_id, 'em_producao');
      // Avisa o garçom que a cozinha está trabalhando no pedido
      io.to('garcom').emit('item_em_preparo', {
        item_id,
        pedido_id,
        mesa_numero,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Socket] iniciar_preparo:', err.message);
      socket.emit('erro', { mensagem: 'Erro ao iniciar preparo.' });
    }
  });

  /**
   * Cozinheiro marcou item como pronto
   * Payload: { item_id, pedido_id, mesa_numero }
   */
  socket.on('item_pronto_kds', async ({ item_id, pedido_id, mesa_numero } = {}) => {
    try {
      await PedidoModel.atualizarStatusItem(item_id, 'pronto');

      // Verifica se TODOS os itens do pedido estão prontos/entregues
      const [rows] = await db.query(
        `SELECT COUNT(*) AS pendentes
         FROM itens_pedido
         WHERE pedido_id = ? AND status NOT IN ('pronto','entregue','cancelado')`,
        [pedido_id]
      );
      const todosProntos = parseInt(rows[0].pendentes) === 0;

      if (todosProntos) {
        await PedidoModel.atualizarStatus(pedido_id, 'pronto');
      }

      // Notifica garçom para levar à mesa
      io.to('garcom').emit('item_pronto', {
        item_id,
        pedido_id,
        mesa_numero,
        todos_prontos: todosProntos,
        timestamp: new Date().toISOString(),
      });

      // Remove do KDS (feedback visual)
      socket.emit('item_removido_kds', { item_id });
    } catch (err) {
      console.error('[Socket] item_pronto_kds:', err.message);
      socket.emit('erro', { mensagem: 'Erro ao marcar item como pronto.' });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EVENTOS DO CAIXA
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Caixa registrou o pagamento e fechou o pedido
   * Payload: { pedido_id, mesa_numero, total, metodo, troco, alertas_estoque? }
   */
  socket.on('pedido_pago', (dados) => {
    console.log(`[Socket] pedido_pago  pedido=${dados.pedido_id}  mesa=${dados.mesa_numero}`);

    // Libera a mesa para todos (garçom + admin)
    io.to('garcom').emit('mesa_liberada', {
      mesa_numero: dados.mesa_numero,
      status: 'livre',
    });

    // Atualiza painel administrativo
    io.to('admin').emit('venda_registrada', {
      pedido_id:   dados.pedido_id,
      mesa_numero: dados.mesa_numero,
      total:       dados.total,
      metodo:      dados.metodo,
      timestamp:   new Date().toISOString(),
    });

    // Alertas de estoque após o fechamento
    if (dados.alertas_estoque?.length) {
      io.to('admin').to('caixa').emit('alertas_estoque', dados.alertas_estoque);
      console.warn(`[Socket] ${dados.alertas_estoque.length} alerta(s) de estoque emitido(s).`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EVENTOS ADMINISTRATIVOS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Admin atualizou produto (ex: esgotado ou disponível novamente)
   * Payload: { produto_id, disponivel, nome }
   */
  socket.on('produto_atualizado', (dados) => {
    // Propaga para garçons atualizarem o cardápio em tempo real
    io.to('garcom').emit('cardapio_atualizado', dados);
  });

  /**
   * Admin atualizou o estoque manualmente
   * Payload: { insumo_id, nome, estoque_atual, estoque_minimo }
   */
  socket.on('estoque_atualizado', (dados) => {
    io.to('admin').emit('estoque_sync', dados);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITÁRIOS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Heartbeat — KDS envia ping periódico para confirmar conexão ativa
   * Payload: { ts: Date.now() }
   */
  socket.on('ping_kds', ({ ts } = {}) => {
    socket.emit('pong_kds', { ts, serverTs: Date.now() });
  });

  // ── Desconexão ────────────────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(
      `[Socket] - desconectado id=${clientId}  sala=${socket.data.sala || '-'}  motivo=${reason}`
    );
    // Notifica colegas da mesma sala
    if (socket.data.sala) {
      socket.to(socket.data.sala).emit('colega_desconectado', {
        socketId: socket.id,
        nome: socket.data.nome,
      });
    }
  });

  // ── Erros de socket ───────────────────────────────────────────────────────
  socket.on('error', (err) => {
    console.error(`[Socket] Erro  id=${clientId}:`, err.message);
  });
});

// =============================================================================
//  INICIALIZAÇÃO DO SERVIDOR
// =============================================================================
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function iniciar() {
  try {
    // Verifica conexão com o MySQL antes de abrir o servidor
    const [teste] = await db.query('SELECT DATABASE() AS banco');
    console.log(`[DB]  Conectado ao banco: ${teste[0].banco}`);

    // Auto-migration: garante que a coluna obs_rapidas existe na tabela produtos
    try {
      await db.query(`ALTER TABLE produtos ADD COLUMN obs_rapidas TEXT NULL AFTER imagem_url`);
      console.log('[DB]  Coluna obs_rapidas adicionada à tabela produtos.');
    } catch (e) {
      if (e.code !== 'ER_DUP_FIELDNAME') throw e; // já existe, tudo bem
    }
    // Se existir a coluna com nome antigo, renomeia
    try {
      await db.query(`ALTER TABLE produtos CHANGE observacoes_rapidas obs_rapidas TEXT NULL`);
      console.log('[DB]  Coluna observacoes_rapidas renomeada para obs_rapidas.');
    } catch (e) {
      if (e.code !== 'ER_BAD_FIELD_ERROR') throw e; // não existe com nome antigo, tudo bem
    }

    server.listen(PORT, HOST, () => {
      const linha = '═'.repeat(52);
      console.log(`\n${linha}`);
      console.log(`  SIGA-MF | Maria Fumaca — Servidor iniciado`);
      console.log(`${linha}`);
      console.log(`  URL     : http://localhost:${PORT}`);
      console.log(`  Garcom  : http://localhost:${PORT}/garcom`);
      console.log(`  Cozinha : http://localhost:${PORT}/cozinha`);
      console.log(`  Caixa   : http://localhost:${PORT}/caixa`);
      console.log(`  Admin   : http://localhost:${PORT}/admin`);
      console.log(`  API     : http://localhost:${PORT}/api/health`);
      console.log(`${linha}\n`);
    });
  } catch (err) {
    console.error('[FATAL] Falha ao conectar com o banco de dados:', err.message);
    console.error('Verifique as variáveis DB_HOST, DB_USER, DB_PASSWORD, DB_NAME no .env');
    process.exit(1);
  }
}

// =============================================================================
//  GRACEFUL SHUTDOWN
//  Encerra o servidor de forma limpa ao receber SIGTERM / SIGINT (Ctrl+C)
// =============================================================================
function desligar(sinal) {
  console.log(`\n[Server] ${sinal} recebido — encerrando...`);

  // Para de aceitar novas conexões
  server.close(async () => {
    try {
      // Fecha o pool do MySQL
      await db.end();
      console.log('[DB]  Pool fechado com sucesso.');
    } catch (_) { /* ignora */ }

    // Desconecta todos os sockets
    io.close(() => {
      console.log('[Socket] Todos os clientes desconectados.');
      console.log('[Server] Encerrado. Até logo!');
      process.exit(0);
    });
  });

  // Força saída após 10s se algo travar
  setTimeout(() => {
    console.error('[Server] Timeout de shutdown — forçando saída.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => desligar('SIGTERM'));
process.on('SIGINT',  () => desligar('SIGINT'));

// Captura exceções não tratadas para evitar crash silencioso
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

// =============================================================================
//  START
// =============================================================================
iniciar();

module.exports = { app, server, io };
