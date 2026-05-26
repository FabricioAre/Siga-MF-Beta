// src/routes/authRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/login  → retorna JWT
//  GET  /api/auth/me     → dados do usuário logado
//  POST /api/auth/logout → invalida token (client-side)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const router            = require('express').Router();
const { auth }          = require('../middleware/auth');
const authController    = require('../controllers/authController');
const db                = require('../config/db');

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', authController.login);

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', auth(), async (req, res) => {
  try {
    const [[usuario]] = await db.query(`
      SELECT u.id, u.nome, u.login, u.ativo,
             pa.nome AS perfil
      FROM   usuarios u
      JOIN   perfis_acesso pa ON pa.id = u.perfil_id
      WHERE  u.id = ?
    `, [req.usuario.id]);

    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(usuario);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
// JWT é stateless: o cliente apenas descarta o token.
// Em produção, use uma blocklist (Redis) se precisar de revogação imediata.
router.post('/logout', auth(), (req, res) => {
  console.log(`[Auth] Logout: ${req.usuario?.login}`);
  res.json({ mensagem: 'Logout realizado. Descarte o token no cliente.' });
});

module.exports = router;
