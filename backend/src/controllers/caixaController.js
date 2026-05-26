// src/controllers/caixaController.js
// ─────────────────────────────────────────────────────────────────────────────
//  Módulo PDV — Fechamento de Conta, Divisão e Pagamento
//
//  RN04 — Baixa de estoque ao confirmar pagamento
//  RN08 — Fechamento Cego: caixa informa o valor recebido ANTES de ver o total
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const PedidoModel    = require('../models/pedidoModel');
const EstoqueService = require('../services/estoqueService');
const db             = require('../config/db');

module.exports = {

  // ── GET /api/caixa/mesas-abertas ──────────────────────────────────────────
  // Lista todas as mesas com pedidos ainda não pagos (painel do PDV)
  async mesasAbertas(req, res) {
    try {
      const [rows] = await db.query(`
        SELECT m.id       AS mesa_id,
               m.numero   AS mesa_numero,
               m.status   AS mesa_status,
               m.localizacao,
               p.id       AS pedido_id,
               p.status   AS pedido_status,
               p.fluxo,
               p.criado_em,
               p.total,
               u.nome     AS garcom,
               TIMESTAMPDIFF(MINUTE, p.criado_em, NOW()) AS minutos_aberto,
               COUNT(ip.id)                              AS total_itens
        FROM   mesas m
        JOIN   pedidos p       ON p.mesa_id = m.id
                              AND p.status NOT IN ('pago','cancelado')
        JOIN   usuarios u      ON u.id = p.usuario_id
        LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id
                                AND ip.status != 'cancelado'
        GROUP  BY m.id, m.numero, m.status, m.localizacao,
                  p.id, p.status, p.fluxo, p.criado_em, p.total, u.nome
        ORDER  BY p.criado_em ASC
      `);
      res.json(rows);
    } catch (err) {
      console.error('[CaixaController] mesasAbertas:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // ── GET /api/caixa/pedidos/:id/conta ─────────────────────────────────────
  // Retorna o detalhamento completo da conta para o PDV
  async verConta(req, res) {
    try {
      const pedidoId = parseInt(req.params.id);
      const pedido   = await PedidoModel.buscarPorId(pedidoId);
      if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado.' });

      const itens = await PedidoModel.listarItensDoPedido(pedidoId);

      // Recalcula o total a partir dos itens (fonte da verdade)
      const total = itens
        .filter(i => i.status !== 'cancelado')
        .reduce((s, i) => s + parseFloat(i.preco_unitario) * i.quantidade, 0);

      // Atualiza o total no banco (garante consistência)
      await db.query(`UPDATE pedidos SET total = ? WHERE id = ?`, [total, pedidoId]);

      res.json({
        pedido : { ...pedido, total },
        itens,
        resumo : {
          total_itens  : itens.filter(i => i.status !== 'cancelado').length,
          total_valor  : parseFloat(total.toFixed(2)),
        },
      });
    } catch (err) {
      console.error('[CaixaController] verConta:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // ── POST /api/caixa/pagamento ─────────────────────────────────────────────
  //
  //  RN08 — Fechamento Cego:
  //    O caixa informa o valor recebido antes do sistema revelar o total.
  //    O sistema então calcula o troco e confirma o pagamento.
  //
  //  Body: {
  //    pedido_id      : number  (obrigatório)
  //    metodo         : string  (dinheiro|cartao_credito|cartao_debito|pix|voucher|misto)
  //    valor_recebido : number  (RN08 — informado às cegas)
  //    numero_pessoas : number  (divisão de conta, default 1)
  //    observacoes    : string  (opcional)
  //  }
  async registrarPagamento(req, res) {
    const { pedido_id, metodo, valor_recebido, numero_pessoas = 1, observacoes } = req.body;

    // ── Validação de entrada ─────────────────────────────────────────────────
    if (!pedido_id)       return res.status(400).json({ erro: 'pedido_id é obrigatório.' });
    if (!metodo)          return res.status(400).json({ erro: 'metodo é obrigatório.' });
    if (valor_recebido === undefined)
                          return res.status(400).json({ erro: 'valor_recebido é obrigatório (RN08).' });

    const metodosValidos = ['dinheiro','cartao_credito','cartao_debito','pix','voucher','misto'];
    if (!metodosValidos.includes(metodo)) {
      return res.status(400).json({ erro: `Método inválido. Use: ${metodosValidos.join(', ')}.` });
    }

    try {
      // ── Verifica estado do pedido ──────────────────────────────────────────
      const pedido = await PedidoModel.buscarPorId(pedido_id);
      if (!pedido)               return res.status(404).json({ erro: 'Pedido não encontrado.' });
      if (pedido.status === 'pago')
                                 return res.status(422).json({ erro: 'Pedido já foi pago.' });
      if (pedido.status === 'cancelado')
                                 return res.status(422).json({ erro: 'Pedido foi cancelado.' });

      // ── Calcula o total real dos itens ────────────────────────────────────
      const itens = await PedidoModel.listarItensDoPedido(pedido_id);
      const total  = itens
        .filter(i => i.status !== 'cancelado')
        .reduce((s, i) => s + parseFloat(i.preco_unitario) * i.quantidade, 0);

      const valorTotal    = parseFloat(total.toFixed(2));
      const valorRec      = parseFloat(parseFloat(valor_recebido).toFixed(2));

      if (valorRec < valorTotal && metodo === 'dinheiro') {
        return res.status(422).json({
          erro          : 'Valor recebido é insuficiente.',
          total_devido  : valorTotal,
          valor_recebido: valorRec,
          diferenca     : parseFloat((valorTotal - valorRec).toFixed(2)),
        });
      }

      const troco          = Math.max(0, parseFloat((valorRec - valorTotal).toFixed(2)));
      const pessoasInt     = parseInt(numero_pessoas) || 1;
      const valorPorPessoa = parseFloat((valorTotal / pessoasInt).toFixed(2));

      // ── RN04 — Baixa automática de estoque ────────────────────────────────
      const usuario_id = req.usuario?.id ?? 1;
      const { baixas, alertas } = await EstoqueService.darBaixaEstoque(pedido_id);

      // ── Registra pagamento ─────────────────────────────────────────────────
      const pagamento = await PedidoModel.registrarPagamento({
        pedido_id,
        usuario_id,
        metodo,
        valor_total      : valorTotal,
        valor_recebido   : valorRec,
        troco,
        numero_pessoas   : pessoasInt,
      });

      // ── Fecha o pedido e libera a mesa ────────────────────────────────────
      await PedidoModel.fechar(pedido_id);

      // ── Notificações Socket.IO ─────────────────────────────────────────────
      const io = req.app.get('io');
      if (io) {
        const mesa = await PedidoModel.buscarMesaPorId(pedido.mesa_id);

        // Libera mesa para garçons em tempo real
        io.to('garcom').emit('mesa_liberada', {
          mesa_numero: mesa?.numero,
          status     : 'livre',
        });

        // Notifica admin sobre a venda
        io.to('admin').emit('venda_registrada', {
          pedido_id,
          mesa_numero  : mesa?.numero,
          total        : valorTotal,
          metodo,
          timestamp    : new Date().toISOString(),
        });

        // Alertas de estoque mínimo pós-baixa (RN05)
        if (alertas.length) {
          io.to('admin').to('caixa').emit('alertas_estoque', alertas);
          console.warn(`[Caixa] ${alertas.length} alerta(s) de estoque emitido(s).`);
        }
      }

      res.status(201).json({
        pagamento,
        baixas_estoque   : baixas,
        alertas_estoque  : alertas,
        resumo           : {
          total_devido     : valorTotal,
          valor_recebido   : valorRec,
          troco,
          numero_pessoas   : pessoasInt,
          valor_por_pessoa : valorPorPessoa,
          metodo,
        },
      });

    } catch (err) {
      console.error('[CaixaController] registrarPagamento:', err);
      res.status(500).json({ erro: err.message });
    }
  },

  // ── GET /api/caixa/historico ────────────────────────────────────────────
  // Histórico de pagamentos do dia (para conferência de caixa)
  async historicoPagamentos(req, res) {
    try {
      const { data } = req.query; // YYYY-MM-DD, default = hoje
      const dataRef = data || new Date().toISOString().split('T')[0];

      const [rows] = await db.query(`
        SELECT pg.id, pg.metodo, pg.valor_total, pg.valor_recebido,
               pg.troco, pg.numero_pessoas, pg.valor_por_pessoa,
               pg.criado_em,
               p.id    AS pedido_id,
               m.numero AS mesa_numero,
               u.nome   AS caixa_nome
        FROM   pagamentos pg
        JOIN   pedidos  p  ON p.id  = pg.pedido_id
        JOIN   mesas    m  ON m.id  = p.mesa_id
        JOIN   usuarios u  ON u.id  = pg.usuario_id
        WHERE  DATE(pg.criado_em) = ?
        ORDER  BY pg.criado_em DESC
      `, [dataRef]);

      const totalDia = rows.reduce((s, r) => s + parseFloat(r.valor_total), 0);
      const porMetodo = rows.reduce((acc, r) => {
        acc[r.metodo] = (acc[r.metodo] || 0) + parseFloat(r.valor_total);
        return acc;
      }, {});

      res.json({
        data         : dataRef,
        pagamentos   : rows,
        total_dia    : parseFloat(totalDia.toFixed(2)),
        por_metodo   : porMetodo,
        total_vendas : rows.length,
      });
    } catch (err) {
      console.error('[CaixaController] historicoPagamentos:', err);
      res.status(500).json({ erro: err.message });
    }
  },
};
