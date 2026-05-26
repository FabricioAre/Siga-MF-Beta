// src/middleware/auth.js
// ─────────────────────────────────────────────────────────────────────────────
//  Autenticação JWT + controle de perfis (RBAC)
//  Uso: router.get('/rota', auth(), handler)          // qualquer perfil autenticado
//       router.post('/rota', auth('admin'), handler)  // somente admin
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'siga-mf-secret-dev-troque-em-producao';

/**
 * Gera um JWT assinado para o usuário.
 * @param {{ id, login, nome, perfil }} usuario
 * @returns {string} token
 */
function gerarToken(usuario) {
  return jwt.sign(
    {
      id    : usuario.id,
      login : usuario.login,
      nome  : usuario.nome,
      perfil: usuario.perfil,
    },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

/**
 * Middleware de autenticação e autorização por perfil.
 * @param {...string} perfisPermitidos  — se omitido, qualquer perfil autenticado é aceito
 * @returns {import('express').RequestHandler}
 */
function auth(...perfisPermitidos) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token de autenticação não fornecido.' });
    }

    const token = authHeader.slice(7);

    try {
      const decoded  = jwt.verify(token, SECRET);
      req.usuario    = decoded; // disponível em todos os controllers

      if (perfisPermitidos.length && !perfisPermitidos.includes(decoded.perfil)) {
        return res.status(403).json({
          erro: `Acesso negado. Perfil requerido: ${perfisPermitidos.join(' ou ')}.`,
        });
      }

      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ erro: 'Token expirado. Faça login novamente.' });
      }
      return res.status(401).json({ erro: 'Token inválido.' });
    }
  };
}

module.exports = { auth, gerarToken };
