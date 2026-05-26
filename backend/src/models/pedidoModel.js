// src/models/pedidoModel.js — schema siga_mf
'use strict';

const db = require('../config/db');

const PedidoModel = {

  // ── Mesas ─────────────────────────────────────────────────────────────────
  async listarMesas() {
    const [rows] = await db.query(`
      SELECT m.id, m.numero, m.capacidade, m.status, m.localizacao,
             p.id    AS pedido_id,
             p.fluxo AS pedido_fluxo,
             p.total AS pedido_total
      FROM   mesas m
      LEFT JOIN pedidos p
             ON p.mesa_id = m.id
            AND p.status NOT IN ('pago','cancelado')
      ORDER  BY m.numero
    `);
    return rows;
  },

  async buscarMesaPorId(id) {
    const [rows] = await db.query(`SELECT * FROM mesas WHERE id = ?`, [id]);
    return rows[0] ?? null;
  },

  async atualizarStatusMesa(id, status) {
    await db.query(`UPDATE mesas SET status = ? WHERE id = ?`, [status, id]);
  },

  // ── Pedidos ───────────────────────────────────────────────────────────────
  async criar({ mesa_id, usuario_id, fluxo, observacoes = '' }) {
    const [result] = await db.query(
      `INSERT INTO pedidos (mesa_id, usuario_id, fluxo, observacoes)
       VALUES (?, ?, ?, ?)`,
      [mesa_id, usuario_id, fluxo, observacoes]
    );
    await db.query(`UPDATE mesas SET status = 'ocupada' WHERE id = ?`, [mesa_id]);
    const [rows] = await db.query(`SELECT * FROM pedidos WHERE id = ?`, [result.insertId]);
    return rows[0];
  },

  async buscarPorId(id) {
    const [rows] = await db.query(`
      SELECT p.*, m.numero AS mesa_numero, u.nome AS garcom_nome
      FROM   pedidos p
      JOIN   mesas   m ON m.id = p.mesa_id
      JOIN   usuarios u ON u.id = p.usuario_id
      WHERE  p.id = ?
    `, [id]);
    return rows[0] ?? null;
  },

  async listarAbertos() {
    const [rows] = await db.query(`
      SELECT p.id, p.status, p.fluxo, p.total, p.criado_em,
             m.numero AS mesa_numero,
             u.nome   AS garcom_nome
      FROM   pedidos p
      JOIN   mesas   m ON m.id = p.mesa_id
      JOIN   usuarios u ON u.id = p.usuario_id
      WHERE  p.status NOT IN ('pago','cancelado')
      ORDER  BY p.criado_em
    `);
    return rows;
  },

  async atualizarStatus(id, status) {
    await db.query(`UPDATE pedidos SET status = ? WHERE id = ?`, [status, id]);
    const [rows] = await db.query(`SELECT * FROM pedidos WHERE id = ?`, [id]);
    return rows[0] ?? null;
  },

  async fechar(id) {
    await db.query(
      `UPDATE pedidos SET status = 'pago', atualizado_em = NOW() WHERE id = ?`, [id]
    );
    const [rows] = await db.query(`SELECT * FROM pedidos WHERE id = ?`, [id]);
    const pedido = rows[0];
    if (pedido) {
      await db.query(
        `UPDATE mesas SET status = 'livre' WHERE id = ?`, [pedido.mesa_id]
      );
    }
    return pedido ?? null;
  },

  // ── Itens do Pedido ───────────────────────────────────────────────────────
  /**
   * @param {object} dados
   * @param {number} dados.pedido_id
   * @param {number} dados.produto_id         — sabor 1
   * @param {number|null} dados.sabor_2_id    — sabor 2 (pizza meio a meio, RN02)
   * @param {number} dados.quantidade
   * @param {number} dados.preco_unitario     — maior preço (RN03)
   * @param {string} dados.observacao
   */
  async adicionarItem({ pedido_id, produto_id, sabor_2_id = null, quantidade = 1, preco_unitario, observacao = null }) {
    const [result] = await db.query(
      `INSERT INTO itens_pedido
         (pedido_id, produto_id, sabor_2_id, quantidade, preco_unitario, observacao)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [pedido_id, produto_id, sabor_2_id, quantidade, preco_unitario, observacao]
    );

    // Atualiza total do pedido
    await db.query(`
      UPDATE pedidos
         SET total = (
               SELECT COALESCE(SUM(preco_unitario * quantidade), 0)
               FROM   itens_pedido
               WHERE  pedido_id = ? AND status != 'cancelado'
             ),
             status = IF(status = 'aberto', 'em_producao', status)
       WHERE id = ?
    `, [pedido_id, pedido_id]);

    const [rows] = await db.query(
      `SELECT ip.*,
              pr1.nome AS produto_nome,
              pr2.nome AS sabor2_nome
       FROM   itens_pedido ip
       JOIN   produtos pr1 ON pr1.id = ip.produto_id
       LEFT JOIN produtos pr2 ON pr2.id = ip.sabor_2_id
       WHERE  ip.id = ?`,
      [result.insertId]
    );
    return rows[0];
  },

  async listarItensDoPedido(pedido_id) {
    const [rows] = await db.query(`
      SELECT ip.*,
             pr1.nome  AS produto_nome,
             pr1.preco AS produto_preco,
             pr2.nome  AS sabor2_nome
      FROM   itens_pedido ip
      JOIN   produtos pr1 ON pr1.id = ip.produto_id
      LEFT JOIN produtos pr2 ON pr2.id = ip.sabor_2_id
      WHERE  ip.pedido_id = ?
      ORDER  BY ip.criado_em
    `, [pedido_id]);
    return rows;
  },

  async atualizarStatusItem(item_id, status) {
    await db.query(
      `UPDATE itens_pedido SET status = ? WHERE id = ?`, [status, item_id]
    );
    const [rows] = await db.query(`
      SELECT ip.*, pr.nome AS produto_nome
      FROM   itens_pedido ip
      JOIN   produtos pr ON pr.id = ip.produto_id
      WHERE  ip.id = ?
    `, [item_id]);
    return rows[0] ?? null;
  },

  async buscarItemPorId(item_id) {
    const [rows] = await db.query(`
      SELECT ip.*, pr1.nome AS produto_nome, pr2.nome AS sabor2_nome
      FROM   itens_pedido ip
      JOIN   produtos pr1 ON pr1.id = ip.produto_id
      LEFT JOIN produtos pr2 ON pr2.id = ip.sabor_2_id
      WHERE  ip.id = ?
    `, [item_id]);
    return rows[0] ?? null;
  },

  async listarItensPorPedidoParaEstoque(pedido_id) {
    const [rows] = await db.query(
      `SELECT produto_id, sabor_2_id, quantidade, estoque_baixado
       FROM   itens_pedido
       WHERE  pedido_id = ? AND status != 'cancelado'`,
      [pedido_id]
    );
    return rows;
  },

  // ── Caixa ─────────────────────────────────────────────────────────────────
  async calcularTotalPedido(pedido_id) {
    const [rows] = await db.query(`
      SELECT p.id, p.status, p.fluxo, m.numero AS mesa_numero, p.criado_em,
             COALESCE(SUM(ip.preco_unitario * ip.quantidade), 0) AS total
      FROM   pedidos p
      JOIN   mesas   m  ON m.id = p.mesa_id
      LEFT JOIN itens_pedido ip ON ip.pedido_id = p.id AND ip.status != 'cancelado'
      WHERE  p.id = ?
      GROUP  BY p.id, p.status, p.fluxo, m.numero, p.criado_em
    `, [pedido_id]);
    return rows[0] ?? null;
  },

  async registrarPagamento({ pedido_id, usuario_id, metodo, valor_total, valor_recebido, troco, numero_pessoas }) {
    const valor_por_pessoa = numero_pessoas > 1
      ? (valor_total / numero_pessoas).toFixed(2)
      : null;

    const [result] = await db.query(`
      INSERT INTO pagamentos
        (pedido_id, usuario_id, metodo, valor_total, valor_recebido, troco, numero_pessoas, valor_por_pessoa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [pedido_id, usuario_id, metodo, valor_total, valor_recebido, troco, numero_pessoas || 1, valor_por_pessoa]);

    const [rows] = await db.query(`SELECT * FROM pagamentos WHERE id = ?`, [result.insertId]);
    return rows[0];
  },
};

module.exports = PedidoModel;
