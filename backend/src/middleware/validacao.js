// src/middleware/validacao.js
// ─────────────────────────────────────────────────────────────────────────────
//  Validadores de request reutilizáveis (sem dependência externa)
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

/**
 * Valida campos obrigatórios no body.
 * @param {...string} campos
 */
function requeridos(...campos) {
  return (req, res, next) => {
    const faltando = campos.filter(c => req.body[c] === undefined || req.body[c] === '');
    if (faltando.length) {
      return res.status(400).json({
        erro: `Campo(s) obrigatório(s): ${faltando.join(', ')}.`,
      });
    }
    next();
  };
}

/**
 * Valida que :id na rota é um inteiro positivo.
 */
function idValido(req, res, next) {
  const id = parseInt(req.params.id);
  if (!id || id < 1) {
    return res.status(400).json({ erro: 'ID inválido.' });
  }
  req.params.id = id; // normaliza como número
  next();
}

/**
 * Valida que o corpo não está vazio.
 */
function bodyNaoVazio(req, res, next) {
  if (!req.body || !Object.keys(req.body).length) {
    return res.status(400).json({ erro: 'Body da requisição não pode ser vazio.' });
  }
  next();
}

module.exports = { requeridos, idValido, bodyNaoVazio };
