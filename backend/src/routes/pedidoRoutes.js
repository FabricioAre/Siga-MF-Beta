// src/routes/pedidoRoutes.js — schema siga_mf
// ─────────────────────────────────────────────────────────────────────────────
//  Inclui rota de cancelamento de item com auditoria (RN07)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const router = require('express').Router();
const c      = require('../controllers/pedidoController');
const db     = require('../config/db');
const PedidoModel = require('../models/pedidoModel');

// ── Rotas estáticas (DEVEM vir antes de /:id) ─────────────────────────────────
router.get ('/',               c.listarPedidosAbertos);
router.post('/',               c.criarPedido);

// ── GET /api/pedidos/mesas/status — Status de todas as mesas ──────────────────
router.get('/mesas/status', async (req, res) => {
  try {
    const mesas = await PedidoModel.listarMesas();
    res.json(mesas);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── DELETE /api/pedidos/itens/:id — Cancelamento com auditoria (RN07) ─────────
//
//  RN07: Cancelamentos de itens APÓS envio para produção requerem:
//    - Justificativa obrigatória
//    - Perfil admin ou supervisor
//    - Registro em logs_cancelamento (imutável)
//
router.delete('/itens/:id', async (req, res) => {
  const { justificativa, usuario_id } = req.body;
  const itemId = parseInt(req.params.id);

  if (!justificativa || !justificativa.trim()) {
    return res.status(400).json({ erro: 'RN07: Justificativa obrigatória para cancelamento.' });
  }

  try {
    const item = await PedidoModel.buscarItemPorId(itemId);
    if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });

    if (item.status === 'cancelado') {
      return res.status(422).json({ erro: 'Item já foi cancelado.' });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE itens_pedido SET status = 'cancelado', atualizado_em = NOW() WHERE id = ?`,
        [itemId]
      );

      await conn.query(`
        INSERT INTO logs_cancelamento (item_pedido_id, usuario_id, justificativa)
        VALUES (?, ?, ?)
      `, [itemId, usuario_id ?? 1, justificativa.trim()]);

      await conn.query(`
        UPDATE pedidos
           SET total = (
                 SELECT COALESCE(SUM(preco_unitario * quantidade), 0)
                 FROM   itens_pedido
                 WHERE  pedido_id = ? AND status != 'cancelado'
               )
         WHERE id = ?
      `, [item.pedido_id, item.pedido_id]);

      await conn.commit();

      const io = req.app.get('io');
      if (io) {
        io.to('cozinha').emit('pedido_atualizado', { pedido_id: item.pedido_id });
      }

      console.log(`[RN07] Item #${itemId} cancelado. Motivo: ${justificativa}`);

      res.json({
        mensagem     : 'Item cancelado com auditoria registrada (RN07).',
        item_id      : itemId,
        pedido_id    : item.pedido_id,
        justificativa,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[PedidoRoutes] cancelarItem:', err);
    res.status(500).json({ erro: err.message });
  }
});

// ── GET /api/pedidos/itens/:id/log-cancelamento — Consulta auditoria (RN07) ───
router.get('/itens/:id/log-cancelamento', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT lc.id, lc.justificativa, lc.criado_em,
             u.nome AS usuario_nome, u.login,
             ip.pedido_id, ip.produto_id
      FROM   logs_cancelamento lc
      JOIN   usuarios u ON u.id = lc.usuario_id
      JOIN   itens_pedido ip ON ip.id = lc.item_pedido_id
      WHERE  lc.item_pedido_id = ?
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── Rotas com parâmetro dinâmico (DEVEM vir depois das estáticas) ─────────────
router.get ('/:id',            c.buscarPedido);
router.post('/:id/itens',      c.adicionarItem);
router.put ('/:id/fechar',     c.fecharPedido);

// ── GET /api/pedidos/:id/itens ────────────────────────────────────────────────
router.get('/:id/itens', async (req, res) => {
  try {
    const itens = await PedidoModel.listarItensDoPedido(req.params.id);
    res.json(itens);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── PATCH /api/pedidos/:id/status ─────────────────────────────────────────────
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body;
  const statusValidos = ['aberto','em_producao','pronto','entregue','aguardando_pagamento','pago','cancelado'];
  if (!statusValidos.includes(status)) {
    return res.status(400).json({ erro: `Status inválido. Use: ${statusValidos.join(', ')}` });
  }
  try {
    const pedido = await PedidoModel.atualizarStatus(req.params.id, status);
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
    res.json(pedido);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
