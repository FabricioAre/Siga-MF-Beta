// src/routes/estoqueRoutes.js — schema siga_mf
'use strict';

const router = require('express').Router();
const c      = require('../controllers/estoqueController');

// ── Insumos ──────────────────────────────────────────────────────────────────
router.get   ('/insumos',     c.listarInsumos);
router.get   ('/insumos/:id', c.buscarInsumo);
router.post  ('/insumos',     c.criarInsumo);
router.put   ('/insumos/:id', c.atualizarInsumo);
router.delete('/insumos/:id', c.removerInsumo);

// ── Lotes PEPS (RN05) ─────────────────────────────────────────────────────
router.get ('/lotes',  c.listarLotes);
router.post('/lotes',  c.registrarLote);

// ── Movimentações / Auditoria ─────────────────────────────────────────────
router.get ('/movimentacoes', c.listarMovimentacoes);
router.post('/ajuste',        c.registrarAjuste);

// ── Alertas ───────────────────────────────────────────────────────────────
router.get('/alertas', c.alertasEstoque);

// ── Produtos / Cardápio (admin) ───────────────────────────────────────────
router.get ('/produtos',     c.listarProdutos);
router.post ('/produtos',    c.criarProduto);
router.put  ('/produtos/:id',c.atualizarProduto);
router.delete('/produtos/:id', c.removerProduto);

// ── Categorias ────────────────────────────────────────────────────────────
router.get('/categorias', c.listarCategorias);

// ── Fichas Técnicas (RN04) ────────────────────────────────────────────────
router.get   ('/fichas-tecnicas/:id',                  c.buscarFichaTecnica);
router.post  ('/fichas-tecnicas',                      c.salvarLinhaFicha);
router.delete('/fichas-tecnicas/:produto_id/:insumo_id', c.removerLinhaFicha);

module.exports = router;
