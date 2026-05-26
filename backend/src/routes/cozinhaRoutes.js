// routes/cozinhaRoutes.js
const router = require('express').Router();
const c      = require('../controllers/cozinhaController');

router.get('/pedidos',              c.listarPedidosCozinha);
router.put('/itens/:id/pronto',     c.marcarItemPronto);
router.put('/itens/:id/em-preparo', c.marcarItemEmPreparo);
router.put('/itens/:id/status',     c.atualizarStatusItem);
router.put('/pedidos/:id/pronto',   c.marcarPedidoPronto);

module.exports = router;
