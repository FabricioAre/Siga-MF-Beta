// src/models/produtoModel.js
// ─────────────────────────────────────────────────────────────────────────────
//  Model completo de Produtos e Fichas Técnicas — schema siga_mf
//  Substitui o pratoModel.js (schema antigo)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const db = require('../config/db');

const ProdutoModel = {

  // ── Listagem ────────────────────────────────────────────────────────────────
  async listarTodos({ fluxo, disponivel = null, e_pizza = null } = {}) {
    let sql = `
      SELECT p.id, p.nome, p.descricao, p.preco,
             p.e_pizza, p.disponivel, p.imagem_url, p.obs_rapidas,
             c.id   AS categoria_id,
             c.nome AS categoria,
             c.fluxo
      FROM   produtos p
      JOIN   categorias_produto c ON c.id = p.categoria_id
      WHERE  1 = 1
    `;
    const params = [];

    if (disponivel !== null) { sql += ' AND p.disponivel = ?'; params.push(disponivel); }
    if (e_pizza    !== null) { sql += ' AND p.e_pizza = ?';    params.push(e_pizza);    }
    if (fluxo) {
      sql += ` AND (c.fluxo = ? OR c.fluxo = 'ambos')`;
      params.push(fluxo);
    }

    sql += ' ORDER BY c.fluxo, c.nome, p.nome';
    const [rows] = await db.query(sql, params);
    return rows;
  },

  async listarPizzas() {
    const [rows] = await db.query(`
      SELECT p.id, p.nome, p.preco, p.disponivel, c.fluxo
      FROM   produtos p
      JOIN   categorias_produto c ON c.id = p.categoria_id
      WHERE  p.e_pizza = 1 AND p.disponivel = 1
      ORDER  BY p.preco DESC, p.nome
    `);
    return rows;
  },

  // ── Busca individual ────────────────────────────────────────────────────────
  async buscarPorId(id) {
    const [[row]] = await db.query(`
      SELECT p.*, c.nome AS categoria, c.fluxo
      FROM   produtos p
      JOIN   categorias_produto c ON c.id = p.categoria_id
      WHERE  p.id = ?
    `, [id]);
    return row ?? null;
  },

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async criar({ categoria_id, nome, descricao, preco, imagem_url, e_pizza = 0, obs_rapidas = null }) {
    const [result] = await db.query(`
      INSERT INTO produtos (categoria_id, nome, descricao, preco, imagem_url, e_pizza, obs_rapidas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [categoria_id, nome, descricao ?? null, preco, imagem_url ?? null, e_pizza, obs_rapidas]);
    
    return this.buscarPorId(result.insertId);
  },

  async atualizar(id, { categoria_id, nome, descricao, preco, imagem_url, e_pizza, disponivel }) {
    await db.query(`
      UPDATE produtos
         SET categoria_id = ?, nome = ?, descricao = ?, preco = ?,
             imagem_url = ?, e_pizza = ?, disponivel = ?
       WHERE id = ?
    `, [categoria_id, nome, descricao ?? null, preco, imagem_url ?? null, e_pizza, disponivel, id]);
    return this.buscarPorId(id);
  },

  async setDisponivel(id, disponivel) {
    await db.query(`UPDATE produtos SET disponivel = ? WHERE id = ?`, [disponivel, id]);
    return this.buscarPorId(id);
  },


  async remover(id) {
    // Isso tenta deletar o produto. 
    // Se o produto estiver em algum pedido, o banco de dados (MySQL) vai jogar um erro 
    // do tipo 'ER_ROW_IS_REFERENCED_2', que o seu Controller já sabe tratar!
    const [result] = await db.query(`DELETE FROM produtos WHERE id = ?`, [id]);
    return result.affectedRows;
  },

  // ── Ficha Técnica ───────────────────────────────────────────────────────────

  /**
   * Busca a receita completa de um produto.
   * @param {number} produtoId
   */
  async buscarFichaTecnica(produtoId) {
    const [rows] = await db.query(`
      SELECT ft.id, ft.insumo_id, ft.quantidade, ft.observacao,
             i.nome  AS insumo_nome,
             um.sigla AS unidade,
             i.estoque_atual,
             i.estoque_minimo,
             i.custo_unitario,
             (ft.quantidade * i.custo_unitario) AS custo_linha
      FROM   fichas_tecnicas ft
      JOIN   insumos         i  ON i.id  = ft.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  ft.produto_id = ?
      ORDER  BY i.nome
    `, [produtoId]);

    // Calcula custo total da ficha
    const custoTotal = rows.reduce((s, r) => s + parseFloat(r.custo_linha || 0), 0);
    return { linhas: rows, custo_total: parseFloat(custoTotal.toFixed(4)) };
  },

  /**
   * Salva (insere ou atualiza) uma linha na ficha técnica.
   * Usa ON DUPLICATE KEY UPDATE para idempotência.
   * @param {number} produto_id
   * @param {number} insumo_id
   * @param {number} quantidade
   * @param {string} [observacao]
   */
  async salvarLinhaFicha(produto_id, insumo_id, quantidade, observacao = null) {
    await db.query(`
      INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade, observacao)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        quantidade = VALUES(quantidade),
        observacao = VALUES(observacao)
    `, [produto_id, insumo_id, quantidade, observacao]);

    const [[row]] = await db.query(`
      SELECT ft.*, i.nome AS insumo_nome, um.sigla AS unidade
      FROM   fichas_tecnicas ft
      JOIN   insumos i ON i.id = ft.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  ft.produto_id = ? AND ft.insumo_id = ?
    `, [produto_id, insumo_id]);
    return row;
  },

  async removerLinhaFicha(produto_id, insumo_id) {
    const [result] = await db.query(`
      DELETE FROM fichas_tecnicas WHERE produto_id = ? AND insumo_id = ?
    `, [produto_id, insumo_id]);
    return result.affectedRows;
  },

  /**
   * Recalcula disponibilidade de todos os produtos baseado no estoque atual.
   * Chamado pelo estoqueService após cada baixa (RN05).
   */
  async recalcularDisponibilidade() {
    // Bloqueia produtos cujo estoque de qualquer insumo ficou abaixo do necessário
    await db.query(`
      UPDATE produtos p
         SET p.disponivel = 0
       WHERE p.e_pizza = 0
         AND EXISTS (
               SELECT 1
               FROM   fichas_tecnicas ft
               JOIN   insumos i ON i.id = ft.insumo_id
               WHERE  ft.produto_id = p.id
                 AND  i.estoque_atual < ft.quantidade
             )
    `);

    // Reabilita produtos com estoque suficiente
    await db.query(`
      UPDATE produtos p
         SET p.disponivel = 1
       WHERE NOT EXISTS (
               SELECT 1
               FROM   fichas_tecnicas ft
               JOIN   insumos i ON i.id = ft.insumo_id
               WHERE  ft.produto_id = p.id
                 AND  i.estoque_atual < ft.quantidade
             )
         AND p.disponivel = 0
    `);
  },

  // ── Categorias ───────────────────────────────────────────────────────────────
  async listarCategorias(fluxo = null) {
    let sql = `SELECT id, nome, fluxo FROM categorias_produto`;
    const params = [];
    if (fluxo) {
      sql += ` WHERE fluxo = ? OR fluxo = 'ambos'`;
      params.push(fluxo);
    }
    sql += ` ORDER BY fluxo, nome`;
    const [rows] = await db.query(sql, params);
    return rows;
  },
};

module.exports = ProdutoModel;
