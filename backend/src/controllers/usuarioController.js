'use strict';

const UsuarioModel = require('../models/usuarioModel');

async function listarUsuarios(req, res) {
  try {
    const usuarios = await UsuarioModel.listarTodos();
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

async function salvarUsuario(req, res) {
  try {
    const { id } = req.params;
    const dados = req.body;

    // Se só mandou o status "ativo", faz um toggle rápido
    if (Object.keys(dados).length === 1 && dados.ativo !== undefined) {
      const u = await UsuarioModel.toggleAtivo(id, dados.ativo);
      return res.json(u);
    }

    let usuario;
    if (id) {
      usuario = await UsuarioModel.atualizar(id, dados);
    } else {
      usuario = await UsuarioModel.criar(dados);
    }
    
    res.status(id ? 200 : 201).json(usuario);
  } catch (err) {
    // Se tentar cadastrar um login que já existe, o MySQL barra (uq_usuario_login)
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ erro: 'Este login já está em uso por outro usuário.' });
    }
    res.status(500).json({ erro: err.message });
  }
}

module.exports = {
  listarUsuarios,
  salvarUsuario
};