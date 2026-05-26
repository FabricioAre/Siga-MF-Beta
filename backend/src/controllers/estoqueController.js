// src/controllers/estoqueController.js
// ─────────────────────────────────────────────────────────────────────────────
//  Gestão completa de Estoque e Cardápio para o módulo Admin
//  RN04 — Baixa dinâmica por ficha técnica
//  RN05 — PEPS: controle de lotes perecíveis
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const EstoqueModel   = require('../models/estoqueModel');
const ProdutoModel   = require('../models/produtoModel');
const db             = require('../config/db');

// ══════════════════════════════════════════════════════════════════════════════
//  INSUMOS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/estoque/insumos
async function listarInsumos(req, res) {
  try {
    const insumos = await EstoqueModel.listarInsumos();
    res.json(insumos);
  } catch (err) {
    console.error('[EstoqueController] listarInsumos:', err);
    res.status(500).json({ erro: err.message });
  }
}

// GET /api/estoque/insumos/:id
async function buscarInsumo(req, res) {
  try {
    const insumo = await EstoqueModel.buscarInsumoPorId(req.params.id);
    if (!insumo) return res.status(404).json({ erro: 'Insumo não encontrado.' });
    res.json(insumo);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// POST /api/estoque/insumos
async function criarInsumo(req, res) {
  const { unidade_id, nome, estoque_atual, estoque_minimo, custo_unitario, perecivel } = req.body;
  if (!unidade_id || !nome) {
    return res.status(400).json({ erro: 'unidade_id e nome são obrigatórios.' });
  }
  try {
    const insumo = await EstoqueModel.criarInsumo({
      unidade_id, nome,
      estoque_atual   : estoque_atual   ?? 0,
      estoque_minimo  : estoque_minimo  ?? 0,
      custo_unitario  : custo_unitario  ?? 0,
      perecivel       : perecivel       ?? 0,
    });
    res.status(201).json(insumo);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// PUT /api/estoque/insumos/:id
async function atualizarInsumo(req, res) {
  try {
    const insumo = await EstoqueModel.atualizarInsumo(req.params.id, req.body);
    if (!insumo) return res.status(404).json({ erro: 'Insumo não encontrado.' });

    // Propaga atualização via Socket.IO
    req.app.get('io')?.to('admin').emit('estoque_sync', insumo);

    res.json(insumo);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// ── DELETE /api/estoque/insumos/:id ──────────────────────────────────────────
async function removerInsumo(req, res) {
  try {
    const [result] = await db.query(`DELETE FROM insumos WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ erro: 'Insumo não encontrado.' });
    res.json({ mensagem: 'Insumo removido.' });
  } catch (err) {
    // Erro de FK: insumo em uso em ficha técnica
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        erro: 'Insumo está vinculado a uma ficha técnica e não pode ser removido.',
      });
    }
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  LOTES (PEPS — RN05)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/estoque/lotes?insumo_id=N
async function listarLotes(req, res) {
  try {
    const { insumo_id } = req.query;
    let sql = `
      SELECT l.id, l.insumo_id, l.fornecedor, l.quantidade, l.saldo,
             l.custo_unitario, l.data_entrada, l.data_validade,
             l.nota_fiscal, l.criado_em,
             i.nome AS insumo_nome, um.sigla AS unidade,
             DATEDIFF(l.data_validade, CURDATE()) AS dias_validade
      FROM   lotes_insumo l
      JOIN   insumos i ON i.id = l.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      WHERE  l.saldo > 0
    `;
    const params = [];
    if (insumo_id) { sql += ' AND l.insumo_id = ?'; params.push(insumo_id); }
    sql += ' ORDER BY l.insumo_id, l.data_entrada ASC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// POST /api/estoque/lotes — Entrada de novo lote (RN05: alimenta PEPS)
async function registrarLote(req, res) {
  const { insumo_id, fornecedor, quantidade, custo_unitario, data_entrada, data_validade, nota_fiscal } = req.body;
  if (!insumo_id || !quantidade || !data_entrada) {
    return res.status(400).json({ erro: 'insumo_id, quantidade e data_entrada são obrigatórios.' });
  }
  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Insere o lote
      const [result] = await conn.query(`
        INSERT INTO lotes_insumo
          (insumo_id, fornecedor, quantidade, saldo, custo_unitario, data_entrada, data_validade, nota_fiscal)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [insumo_id, fornecedor ?? null, quantidade, quantidade,
          custo_unitario ?? 0, data_entrada, data_validade ?? null, nota_fiscal ?? null]);

      // Atualiza estoque atual do insumo
      const saldoAntes = await _getSaldo(conn, insumo_id);
      await conn.query(
        `UPDATE insumos SET estoque_atual = estoque_atual + ?, custo_unitario = ? WHERE id = ?`,
        [quantidade, custo_unitario ?? 0, insumo_id]
      );
      const saldoDepois = saldoAntes + parseFloat(quantidade);

      // Registra movimentação de entrada
      await conn.query(`
        INSERT INTO movimentacoes_estoque
          (insumo_id, lote_id, usuario_id, tipo, quantidade, saldo_anterior, saldo_posterior)
        VALUES (?, ?, ?, 'entrada', ?, ?, ?)
      `, [insumo_id, result.insertId, req.usuario?.id ?? null, quantidade, saldoAntes, saldoDepois]);

      await conn.commit();

      const [[lote]] = await conn.query(`SELECT * FROM lotes_insumo WHERE id = ?`, [result.insertId]);

      // Recalcula disponibilidade de produtos após entrada de estoque
      await ProdutoModel.recalcularDisponibilidade();

      // Notifica admin
      req.app.get('io')?.to('admin').emit('estoque_sync', { insumo_id, saldo: saldoDepois });

      res.status(201).json(lote);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[EstoqueController] registrarLote:', err);
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MOVIMENTAÇÕES (Histórico de auditoria)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/estoque/movimentacoes?insumo_id=N&tipo=saida&data_ini=...&data_fim=...
async function listarMovimentacoes(req, res) {
  try {
    const { insumo_id, tipo, data_ini, data_fim, limit = 100 } = req.query;
    let sql = `
      SELECT mv.id, mv.tipo, mv.quantidade, mv.saldo_anterior, mv.saldo_posterior,
             mv.justificativa, mv.criado_em,
             i.nome    AS insumo_nome, um.sigla AS unidade,
             u.nome    AS usuario_nome,
             ip.id     AS item_pedido_id
      FROM   movimentacoes_estoque mv
      JOIN   insumos i ON i.id = mv.insumo_id
      JOIN   unidades_medida um ON um.id = i.unidade_id
      LEFT JOIN usuarios u ON u.id = mv.usuario_id
      LEFT JOIN itens_pedido ip ON ip.id = mv.item_pedido_id
      WHERE  1 = 1
    `;
    const params = [];
    if (insumo_id) { sql += ' AND mv.insumo_id = ?';   params.push(insumo_id); }
    if (tipo)      { sql += ' AND mv.tipo = ?';         params.push(tipo); }
    if (data_ini)  { sql += ' AND DATE(mv.criado_em) >= ?'; params.push(data_ini); }
    if (data_fim)  { sql += ' AND DATE(mv.criado_em) <= ?'; params.push(data_fim); }
    sql += ` ORDER BY mv.criado_em DESC LIMIT ${parseInt(limit)}`;

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// POST /api/estoque/ajuste — Ajuste manual (perda, inventário)
async function registrarAjuste(req, res) {
  const { insumo_id, tipo, quantidade, justificativa } = req.body;
  if (!insumo_id || !tipo || !quantidade || !justificativa) {
    return res.status(400).json({
      erro: 'insumo_id, tipo, quantidade e justificativa são obrigatórios.',
    });
  }
  const tiposValidos = ['ajuste','perda','entrada'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ erro: `tipo deve ser: ${tiposValidos.join(', ')}` });
  }

  try {
    const insumo = await EstoqueModel.buscarInsumoPorId(insumo_id);
    if (!insumo) return res.status(404).json({ erro: 'Insumo não encontrado.' });

    const saldoAntes  = parseFloat(insumo.estoque_atual);
    const qtd         = parseFloat(quantidade);
    const saldoDepois = tipo === 'entrada'
      ? saldoAntes + qtd
      : Math.max(0, saldoAntes - qtd);

    await db.query(`UPDATE insumos SET estoque_atual = ? WHERE id = ?`, [saldoDepois, insumo_id]);
    await db.query(`
      INSERT INTO movimentacoes_estoque
        (insumo_id, usuario_id, tipo, quantidade, saldo_anterior, saldo_posterior, justificativa)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [insumo_id, req.usuario?.id ?? null, tipo, qtd, saldoAntes, saldoDepois, justificativa]);

    await ProdutoModel.recalcularDisponibilidade();
    req.app.get('io')?.to('admin').emit('estoque_sync', { insumo_id, saldo: saldoDepois });

    res.json({ insumo_id, saldo_anterior: saldoAntes, saldo_posterior: saldoDepois, tipo, quantidade: qtd });
  } catch (err) {
    console.error('[EstoqueController] registrarAjuste:', err);
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ALERTAS
// ══════════════════════════════════════════════════════════════════════════════

async function alertasEstoque(req, res) {
  try {
    const [minimos, validade] = await Promise.all([
      EstoqueModel.alertasEstoqueMinimo(),
      EstoqueModel.alertasValidade(parseInt(req.query.dias) || 7),
    ]);
    res.json({ abaixo_minimo: minimos, proximos_validade: validade });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  PRODUTOS (Cardápio)
// ══════════════════════════════════════════════════════════════════════════════

async function listarProdutos(req, res) {
  try {
    const { fluxo, disponivel, e_pizza } = req.query;
    const produtos = await ProdutoModel.listarTodos({
      fluxo,
      disponivel : disponivel !== undefined ? parseInt(disponivel) : null,
      e_pizza    : e_pizza    !== undefined ? parseInt(e_pizza)    : null,
    });
    res.json(produtos);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

async function criarProduto(req, res) {
  // 1. Adicionei o obs_rapidas aqui para receber do Front-end
  const { categoria_id, nome, descricao, preco, imagem_url, e_pizza, obs_rapidas } = req.body;
  
  if (!categoria_id || !nome || !preco) {
    return res.status(400).json({ erro: 'categoria_id, nome e preco são obrigatórios.' });
  }
  try {
    // 2. Adicionei o obs_rapidas aqui para enviar pro Model
    const produto = await ProdutoModel.criar({ 
      categoria_id, nome, descricao, preco, imagem_url, e_pizza, obs_rapidas 
    });
    
    req.app.get('io')?.to('garcom').emit('cardapio_atualizado', { produto_id: produto.id, nome, disponivel: 1 });
    res.status(201).json(produto);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

async function atualizarProduto(req, res) {
  try {
    // Se apenas 'disponivel' foi enviado, usa setDisponivel
    const keys = Object.keys(req.body);
    if (keys.length === 1 && keys[0] === 'disponivel') {
      const produto = await ProdutoModel.setDisponivel(req.params.id, req.body.disponivel ? 1 : 0);
      if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
      req.app.get('io')?.to('garcom').emit('cardapio_atualizado', { produto_id: produto.id, nome: produto.nome, disponivel: produto.disponivel });
      return res.json(produto);
    }
    const produto = await ProdutoModel.atualizar(req.params.id, req.body);
    if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
    req.app.get('io')?.to('garcom').emit('cardapio_atualizado', { produto_id: produto.id, nome: produto.nome, disponivel: produto.disponivel });
    res.json(produto);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  FICHAS TÉCNICAS
// ══════════════════════════════════════════════════════════════════════════════

async function buscarFichaTecnica(req, res) {
  try {
    const ficha = await ProdutoModel.buscarFichaTecnica(req.params.id);
    res.json(ficha);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// POST /api/estoque/fichas-tecnicas
async function salvarLinhaFicha(req, res) {
  const { produto_id, insumo_id, quantidade, observacao } = req.body;
  if (!produto_id || !insumo_id || !quantidade) {
    return res.status(400).json({ erro: 'produto_id, insumo_id e quantidade são obrigatórios.' });
  }
  try {
    const linha = await ProdutoModel.salvarLinhaFicha(produto_id, insumo_id, quantidade, observacao);
    res.status(201).json(linha);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// DELETE /api/estoque/fichas-tecnicas/:produto_id/:insumo_id
async function removerLinhaFicha(req, res) {
  try {
    const n = await ProdutoModel.removerLinhaFicha(req.params.produto_id, req.params.insumo_id);
    if (!n) return res.status(404).json({ erro: 'Linha de ficha técnica não encontrada.' });
    res.json({ mensagem: 'Linha removida.' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  CATEGORIAS
// ══════════════════════════════════════════════════════════════════════════════

async function removerProduto(req, res) {
  try {
    const [result] = await db.query('DELETE FROM produtos WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ erro: 'Produto não encontrado.' });
    req.app.get('io')?.to('garcom').emit('cardapio_atualizado', { produto_id: req.params.id, removido: true });
    res.json({ mensagem: 'Produto removido.' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ erro: 'Produto está vinculado a pedidos ou fichas técnicas e não pode ser removido. Desative-o em vez de excluir.' });
    }
    res.status(500).json({ erro: err.message });
  }
}

async function listarCategorias(req, res) {
  try {
    const categorias = await ProdutoModel.listarCategorias(req.query.fluxo);
    res.json(categorias);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

// ── Utilitário interno ─────────────────────────────────────────────────────────
async function _getSaldo(conn, insumo_id) {
  const [[row]] = await conn.query(`SELECT estoque_atual FROM insumos WHERE id = ?`, [insumo_id]);
  return parseFloat(row?.estoque_atual || 0);
}

module.exports = {
  listarInsumos, buscarInsumo, criarInsumo, atualizarInsumo, removerInsumo,
  listarLotes, registrarLote,
  listarMovimentacoes, registrarAjuste,
  alertasEstoque,
  listarProdutos, criarProduto, atualizarProduto, removerProduto,
  buscarFichaTecnica, salvarLinhaFicha, removerLinhaFicha,
  listarCategorias,
};
