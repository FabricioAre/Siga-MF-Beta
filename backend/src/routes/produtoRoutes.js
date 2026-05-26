// src/routes/produtoRoutes.js
// GET /api/produtos  → lista o cardápio com filtro de fluxo (RN01)
// GET /api/produtos/:id/ficha-tecnica → insumos do produto
'use strict';

const router = require('express').Router();
const db     = require('../config/db');

// GET /api/produtos?fluxo=pizzaria|restaurante|ambos
router.get('/', async (req, res) => {
  try {
    const { fluxo, e_pizza, disponivel = 1 } = req.query;

    let sql = `
      SELECT p.id, p.nome, p.descricao, p.preco, p.e_pizza, p.disponivel,
             p.imagem_url, p.obs_rapidas, c.nome AS categoria, c.fluxo
      FROM   produtos p
      JOIN   categorias_produto c ON c.id = p.categoria_id
      WHERE  p.disponivel = ?
    `;
    const params = [parseInt(disponivel, 10)];

    if (fluxo) {
      sql += ` AND (c.fluxo = ? OR c.fluxo = 'ambos')`;
      params.push(fluxo);
    }
    if (e_pizza !== undefined) {
      sql += ` AND p.e_pizza = ?`;
      params.push(parseInt(e_pizza, 10));
    }

    sql += ` ORDER BY c.fluxo, c.nome, p.nome`;

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/produtos/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*, c.nome AS categoria, c.fluxo
      FROM   produtos p
      JOIN   categorias_produto c ON c.id = p.categoria_id
      WHERE  p.id = ?
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Produto não encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/produtos/:id/ficha-tecnica
router.get('/:id/ficha-tecnica', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT ft.insumo_id, ft.quantidade,
             i.nome AS insumo_nome, um.sigla AS unidade, ft.observacao
      FROM   fichas_tecnicas ft
      JOIN   insumos i ON i.id = ft.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  ft.produto_id = ?
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PUT /api/produtos/:id (ou /api/estoque/produtos/:id dependendo do seu index.js)
// Atualiza o status de disponibilidade do produto
router.put('/:id', async (req, res) => {
  try {
    const { disponivel } = req.body;
    const { id } = req.params;

    // Validação básica
    if (disponivel === undefined) {
      return res.status(400).json({ erro: 'O campo disponivel é obrigatório.' });
    }

    // No MySQL, booleanos costumam ser salvos como 1 (true) ou 0 (false)
    const valorDisponivel = disponivel ? 1 : 0;

    const [result] = await db.query(
      'UPDATE produtos SET disponivel = ? WHERE id = ?',
      [valorDisponivel, id]
    );

    // Verifica se algum produto foi realmente alterado
    if (result.affectedRows === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado.' });
    }

    res.json({ success: true, message: 'Disponibilidade do produto atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    res.status(500).json({ erro: err.message });
  }
});
module.exports = router;
