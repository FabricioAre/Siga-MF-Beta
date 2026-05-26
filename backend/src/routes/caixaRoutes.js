// src/routes/caixaRoutes.js — PDV
'use strict';

const router = require('express').Router();
const c      = require('../controllers/caixaController');
const { auth } = require('../middleware/auth'); // Trazendo o segurança!


// Liberamos todas as rotas do PDV para quem é Caixa E para o Administrador

router.get ('/mesas-abertas',       auth('admin', 'caixa'), c.mesasAbertas);
router.get ('/pedidos/:id/conta',   auth('admin', 'caixa'), c.verConta);
router.post('/pagamento',           auth('admin', 'caixa'), c.registrarPagamento);
router.get ('/historico',           auth('admin', 'caixa'), c.historicoPagamentos);

module.exports = router;