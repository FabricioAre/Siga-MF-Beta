// src/controllers/pedidoController.js — schema siga_mf
'use strict';

const PedidoModel    = require('../models/pedidoModel');

module.exports = {

  // GET /api/pedidos — lista pedidos não finalizados
  async listarPedidosAbertos(req, res) {
    try {
      const pedidos = await PedidoModel.listarAbertos();
      res.json(pedidos);
    } catch (err) {
      console.error('[PedidoController] listarPedidosAbertos:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // GET /api/pedidos/:id
  async buscarPedido(req, res) {
    try {
      const pedido = await PedidoModel.buscarPorId(req.params.id);
      if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

      const itens = await PedidoModel.listarItensDoPedido(pedido.id);
      res.json({ ...pedido, itens });
    } catch (err) {
      console.error('[PedidoController] buscarPedido:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // POST /api/pedidos — cria novo pedido
  // Body: { mesa_id, usuario_id, fluxo, observacoes? }
  async criarPedido(req, res) {
    try {
      const { mesa_id, usuario_id = 1, fluxo, observacoes } = req.body;

      if (!mesa_id)  return res.status(400).json({ erro: 'mesa_id é obrigatório.' });
      if (!fluxo)    return res.status(400).json({ erro: 'fluxo é obrigatório (restaurante|pizzaria).' });
      if (!['restaurante','pizzaria'].includes(fluxo)) {
        return res.status(400).json({ erro: 'fluxo deve ser "restaurante" ou "pizzaria".' });
      }

      const pedido = await PedidoModel.criar({ mesa_id, usuario_id, fluxo, observacoes });

      // Notifica sala de garçons via Socket.IO
      const io = req.app.get('io');
      if (io) {
        const mesa = await PedidoModel.buscarMesaPorId(mesa_id);
        io.to('garcom').to('admin').emit('pedido_criado', {
          pedido_id  : pedido.id,
          mesa_numero: mesa?.numero,
          fluxo,
          garcom     : req.usuario?.nome || 'Garçom',
        });
        io.to('garcom').emit('mesa_atualizada', {
          mesa_id,
          mesa_numero: mesa?.numero,
          status: 'ocupada',
          pedido_id: pedido.id,
        });
      }

      res.status(201).json(pedido);
    } catch (err) {
      console.error('[PedidoController] criarPedido:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // POST /api/pedidos/:id/itens — adiciona item ao pedido
  // Body: { produto_id, sabor_2_id?, quantidade, preco_unitario, observacao? }
  async adicionarItem(req, res) {
    try {
      const { produto_id, sabor_2_id, quantidade = 1, preco_unitario, observacao } = req.body;
      const pedido_id = parseInt(req.params.id);

      if (!produto_id)     return res.status(400).json({ erro: 'produto_id é obrigatório.' });
      if (!preco_unitario) return res.status(400).json({ erro: 'preco_unitario é obrigatório.' });

      // Valida pedido existente
      const pedido = await PedidoModel.buscarPorId(pedido_id);
      if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });
      if (['pago','cancelado'].includes(pedido.status)) {
        return res.status(422).json({ erro: 'Pedido já finalizado.' });
      }

      const item = await PedidoModel.adicionarItem({
        pedido_id,
        produto_id,
        sabor_2_id : sabor_2_id || null,
        quantidade,
        preco_unitario,
        observacao,
      });

      // Dispara evento Socket.IO para o KDS
      const io = req.app.get('io');
      if (io) {
        const mesa = await PedidoModel.buscarMesaPorId(pedido.mesa_id);
        io.to('cozinha').emit('novo_item_kds', {
          item_id    : item.id,
          pedido_id,
          mesa_numero: mesa?.numero,
          fluxo      : pedido.fluxo,
          produto    : item.produto_nome,
          sabor2     : item.sabor2_nome || null,
          quantidade : item.quantidade,
          observacao : item.observacao,
          timestamp  : new Date().toISOString(),
        });
      }

      res.status(201).json(item);
    } catch (err) {
      console.error('[PedidoController] adicionarItem:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // PUT /api/pedidos/:id/fechar — fecha pedido (sem baixa de estoque)
  // NOTA: A baixa de estoque (RN04) é feita pelo caixaController.registrarPagamento
  //       para evitar dupla baixa quando o pedido passa por fecharPedido + pagamento.
  async fecharPedido(req, res) {
    try {
      const pedido_id = parseInt(req.params.id);

      const pedido = await PedidoModel.buscarPorId(pedido_id);
      if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

      const pedidoFechado = await PedidoModel.fechar(pedido_id);

      // Notifica via Socket.IO
      const io = req.app.get('io');
      if (io) {
        const mesa = await PedidoModel.buscarMesaPorId(pedido.mesa_id);
        io.to('garcom').emit('mesa_liberada', {
          mesa_numero: mesa?.numero,
          status: 'livre',
        });
        io.to('admin').emit('venda_registrada', {
          pedido_id,
          mesa_numero: mesa?.numero,
          total: pedidoFechado?.total,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({ pedido: pedidoFechado });
    } catch (err) {
      console.error('[PedidoController] fecharPedido:', err);
      res.status(500).json({ erro: err.message });
    }
  },
};
