// src/controllers/cozinhaController.js — schema siga_mf
'use strict';

const PedidoModel = require('../models/pedidoModel');
const db          = require('../config/db');

module.exports = {

  /**
   * GET /api/cozinha/pedidos
   * Retorna todos os pedidos com itens pendentes ou em produção para o KDS.
   * Usa a view vw_kds_producao do schema siga_mf para dados já agregados.
   */
  async listarPedidosCozinha(req, res) {
    try {
      // Busca pedidos com itens pendentes ou em produção
      const [pedidos] = await db.query(`
        SELECT DISTINCT
          p.id                                              AS pedido_id,
          p.status                                          AS pedido_status,
          p.fluxo,
          p.criado_em,
          m.numero                                          AS mesa_numero,
          u.nome                                            AS garcom,
          TIMESTAMPDIFF(MINUTE, p.criado_em, NOW())         AS minutos_espera
        FROM  pedidos p
        JOIN  mesas   m ON m.id = p.mesa_id
        JOIN  usuarios u ON u.id = p.usuario_id
        WHERE p.status IN ('aberto','em_producao','pronto')
          AND EXISTS (
                SELECT 1 FROM itens_pedido ip
                WHERE ip.pedido_id = p.id
                  AND ip.status IN ('pendente','em_producao')
              )
        ORDER BY p.criado_em ASC
      `);

      if (!pedidos.length) return res.json([]);

      // Para cada pedido, carrega os itens (pendentes + em produção + prontos recentes)
      const resultado = await Promise.all(pedidos.map(async (p) => {
        const [itens] = await db.query(`
          SELECT
            ip.id                AS item_id,
            ip.quantidade,
            ip.observacao,
            ip.status,
            ip.criado_em,
            pr1.nome             AS produto_nome,
            pr2.nome             AS sabor_2_nome
          FROM  itens_pedido ip
          JOIN  produtos pr1 ON pr1.id = ip.produto_id
          LEFT JOIN produtos pr2 ON pr2.id = ip.sabor_2_id
          WHERE ip.pedido_id = ?
            AND ip.status NOT IN ('cancelado','entregue')
          ORDER BY ip.criado_em ASC
        `, [p.pedido_id]);

        return { ...p, itens };
      }));

      res.json(resultado);
    } catch (err) {
      console.error('[CozinhaController] listarPedidosCozinha:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  /**
   * PUT /api/cozinha/itens/:id/pronto
   * Marca o item como pronto e verifica se o pedido inteiro está pronto.
   * Emite evento Socket.IO para o garçom.
   */
  async marcarItemPronto(req, res) {
    const itemId = parseInt(req.params.id);
    try {
      const item = await PedidoModel.atualizarStatusItem(itemId, 'pronto');
      if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });

      // Verifica se todos os itens do pedido estão concluídos
      const [[{ pendentes }]] = await db.query(`
        SELECT COUNT(*) AS pendentes
        FROM  itens_pedido
        WHERE pedido_id = ?
          AND status NOT IN ('pronto','entregue','cancelado')
      `, [item.pedido_id]);

      const todosProntos = parseInt(pendentes) === 0;

      if (todosProntos) {
        await PedidoModel.atualizarStatus(item.pedido_id, 'pronto');
      }

      // Busca número da mesa para incluir no evento
      const pedido = await PedidoModel.buscarPorId(item.pedido_id);

      // Emite evento via Socket.IO → sala 'garcom'
      const io = req.app.get('io');
      if (io) {
        io.to('garcom').emit('item_pronto', {
          item_id     : itemId,
          pedido_id   : item.pedido_id,
          mesa_numero : pedido?.mesa_numero,
          todos_prontos: todosProntos,
          timestamp   : new Date().toISOString(),
        });
      }

      res.json({ item, todos_prontos: todosProntos });
    } catch (err) {
      console.error('[CozinhaController] marcarItemPronto:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  /**
   * PUT /api/cozinha/itens/:id/em-preparo
   * Muda o status do item para 'em_producao'.
   * Emite evento para o garçom acompanhar.
   */
  /**
   * PUT /api/cozinha/itens/:id/status
   * Rota genérica — recebe { status: 'em_producao' | 'pronto' } no body.
   */
  async atualizarStatusItem(req, res) {
    const itemId    = parseInt(req.params.id);
    const { status } = req.body;

    if (status === 'pronto') {
      req.params.id = itemId;
      return module.exports.marcarItemPronto(req, res);
    }
    if (status === 'em_producao') {
      req.params.id = itemId;
      return module.exports.marcarItemEmPreparo(req, res);
    }

    return res.status(400).json({ erro: `Status inválido: ${status}` });
  },

  /**
   * PUT /api/cozinha/pedidos/:id/pronto
   * Marca TODOS os itens do pedido como prontos.
   */
  async marcarPedidoPronto(req, res) {
    const pedidoId = parseInt(req.params.id);
    try {
      // Marca todos os itens pendentes/em_producao como prontos
      await db.query(`
        UPDATE itens_pedido
        SET    status = 'pronto'
        WHERE  pedido_id = ?
          AND  status IN ('pendente','em_producao')
      `, [pedidoId]);

      // Marca o pedido como pronto
      await PedidoModel.atualizarStatus(pedidoId, 'pronto');

      const pedido = await PedidoModel.buscarPorId(pedidoId);

      const io = req.app.get('io');
      if (io) {
        io.to('garcom').emit('item_pronto', {
          pedido_id   : pedidoId,
          mesa_numero : pedido?.mesa_numero,
          todos_prontos: true,
          timestamp   : new Date().toISOString(),
        });
      }

      res.json({ pedido_id: pedidoId, status: 'pronto', todos_prontos: true });
    } catch (err) {
      console.error('[CozinhaController] marcarPedidoPronto:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  async marcarItemEmPreparo(req, res) {
    const itemId = parseInt(req.params.id);
    try {
      const item = await PedidoModel.atualizarStatusItem(itemId, 'em_producao');
      if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });

      const pedido = await PedidoModel.buscarPorId(item.pedido_id);

      const io = req.app.get('io');
      if (io) {
        io.to('garcom').emit('item_em_preparo', {
          item_id     : itemId,
          pedido_id   : item.pedido_id,
          mesa_numero : pedido?.mesa_numero,
          timestamp   : new Date().toISOString(),
        });
      }

      res.json(item);
    } catch (err) {
      console.error('[CozinhaController] marcarItemEmPreparo:', err);
      res.status(500).json({ erro: err.message });
    }
  },
};
