'use strict';

const router = require('express').Router();
const c = require('../controllers/usuarioController');
const { auth } = require('../middleware/auth'); // Trazendo o nosso "Segurança"

// Bloqueando as rotas: Apenas quem tem o token com o perfil 'admin' pode passar!
router.get('/', auth('admin'), c.listarUsuarios);
router.post('/', auth('admin'), c.salvarUsuario);
router.put('/:id', auth('admin'), c.salvarUsuario);

module.exports = router;