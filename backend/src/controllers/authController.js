'use strict';

const db = require('../config/db');
const bcrypt = require('bcrypt');
const { gerarToken } = require('../middleware/auth');

async function login(req, res) {
  try {
    const { login, senha, modulo } = req.body;

    if (!login || !senha) {
      return res.status(400).json({ erro: 'Usuário e senha são obrigatórios.' });
    }

    // 1. Busca o usuário no banco de dados com o perfil
    const [[user]] = await db.query(`
      SELECT u.id, u.nome, u.login, u.senha_hash, u.ativo, u.perfil_id,
             pa.nome AS perfil
      FROM   usuarios u
      JOIN   perfis_acesso pa ON pa.id = u.perfil_id
      WHERE  u.login = ?
    `, [login]);

    if (!user) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }

    // 2. Verifica se o usuário está bloqueado
    if (user.ativo === 0) {
      return res.status(403).json({ erro: 'Usuário bloqueado. Fale com o administrador.' });
    }

    // 3. Compara a senha digitada com o hash bcrypt no banco
    const senhaValida = await bcrypt.compare(senha, user.senha_hash);

    if (!senhaValida) {
      return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    }

    // 4. Gera o token JWT
    const token = gerarToken(user);

    // Sucesso! Retorna token + dados do usuário (sem o hash)
    const { senha_hash, ...dadosPublicos } = user;
    res.json({
      mensagem: 'Login efetuado com sucesso',
      token,
      usuario: dadosPublicos
    });

  } catch (err) {
    console.error('[Auth]', err);
    res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { login };