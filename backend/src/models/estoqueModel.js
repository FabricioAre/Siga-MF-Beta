// src/models/estoqueModel.js — schema siga_mf
'use strict';

const db = require('../config/db');

const EstoqueModel = {

  async listarInsumos() {
    const [rows] = await db.query(`
      SELECT i.id, i.nome, um.sigla AS unidade,
             i.estoque_atual, i.estoque_minimo, i.custo_unitario,
             i.perecivel, i.atualizado_em,
             (i.estoque_atual <= i.estoque_minimo) AS alerta_minimo
      FROM   insumos i
      JOIN   unidades_medida um ON um.id = i.unidade_id
      ORDER  BY i.nome
    `);
    return rows;
  },

  async buscarInsumoPorId(id) {
    const [rows] = await db.query(`
      SELECT i.*, um.sigla AS unidade
      FROM   insumos i
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  i.id = ?
    `, [id]);
    return rows[0] ?? null;
  },

  async criarInsumo({ unidade_id, nome, estoque_atual = 0, estoque_minimo = 0, custo_unitario = 0, perecivel = 0 }) {
    const [result] = await db.query(`
      INSERT INTO insumos (unidade_id, nome, estoque_atual, estoque_minimo, custo_unitario, perecivel)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [unidade_id, nome, estoque_atual, estoque_minimo, custo_unitario, perecivel]);
    return this.buscarInsumoPorId(result.insertId);
  },

  async atualizarInsumo(id, { nome, estoque_atual, estoque_minimo, custo_unitario, perecivel }) {
    await db.query(`
      UPDATE insumos
         SET nome = ?, estoque_atual = ?, estoque_minimo = ?,
             custo_unitario = ?, perecivel = ?
       WHERE id = ?
    `, [nome, estoque_atual, estoque_minimo, custo_unitario, perecivel, id]);
    return this.buscarInsumoPorId(id);
  },

  // GREATEST evita saldo negativo acidental (o Stored Procedure garante atomicidade)
  async deduzirEstoque(insumo_id, quantidade) {
    const [[antes]] = await db.query(
      `SELECT estoque_atual FROM insumos WHERE id = ?`, [insumo_id]
    );
    await db.query(
      `UPDATE insumos
          SET estoque_atual = GREATEST(estoque_atual - ?, 0)
        WHERE id = ?`,
      [quantidade, insumo_id]
    );
    const [[depois]] = await db.query(
      `SELECT id, nome, estoque_atual, estoque_minimo FROM insumos WHERE id = ?`,
      [insumo_id]
    );
    return { ...depois, deduzido: quantidade, saldo_anterior: antes?.estoque_atual };
  },

  // Ficha técnica pelo produto_id (schema novo)
  async buscarFichaTecnicaProduto(produto_id) {
    const [rows] = await db.query(`
      SELECT ft.insumo_id, ft.quantidade,
             i.nome AS insumo_nome,
             um.sigla AS unidade
      FROM   fichas_tecnicas ft
      JOIN   insumos i ON i.id = ft.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  ft.produto_id = ?
    `, [produto_id]);
    return rows;
  },

  async alertasEstoqueMinimo() {
    const [rows] = await db.query(`
      SELECT i.id, i.nome, um.sigla AS unidade,
             i.estoque_atual, i.estoque_minimo,
             ROUND((i.estoque_atual / NULLIF(i.estoque_minimo,0)) * 100, 1) AS pct
      FROM   insumos i
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  i.estoque_atual <= i.estoque_minimo
      ORDER  BY pct ASC
    `);
    return rows;
  },

  async alertasValidade(dias = 7) {
    const [rows] = await db.query(`
      SELECT l.id AS lote_id, i.nome, um.sigla AS unidade,
             l.saldo, l.data_validade,
             DATEDIFF(l.data_validade, CURDATE()) AS dias_restantes
      FROM   lotes_insumo l
      JOIN   insumos i ON i.id = l.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  l.data_validade IS NOT NULL
        AND  l.data_validade <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND  l.saldo > 0
      ORDER  BY l.data_validade ASC
    `, [dias]);
    return rows;
  },
};

module.exports = EstoqueModel;
