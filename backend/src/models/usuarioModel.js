'use strict';

const db = require('../config/db');
const bcrypt = require('bcrypt');

const UsuarioModel = {
  async listarTodos() {
    const [rows] = await db.query(`
      SELECT u.id, u.nome, u.login, u.ativo, u.perfil_id, p.nome as perfil
      FROM usuarios u
      JOIN perfis_acesso p ON p.id = u.perfil_id
      ORDER BY u.nome
    `);
    return rows;
  },

  async buscarPorId(id) {
    const [[row]] = await db.query(`SELECT id, nome, login, ativo, perfil_id FROM usuarios WHERE id = ?`, [id]);
    return row || null;
  },

  async criar({ nome, login, senha, perfil_id, ativo }) {
    // Criptografa a senha antes de salvar no banco
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senha, salt);

    const [result] = await db.query(`
      INSERT INTO usuarios (nome, login, senha_hash, perfil_id, ativo)
      VALUES (?, ?, ?, ?, ?)
    `, [nome, login, senhaHash, perfil_id, ativo ?? 1]);
    
    return this.buscarPorId(result.insertId);
  },

  async atualizar(id, dados) {
    let sql = `UPDATE usuarios SET nome = ?, login = ?, perfil_id = ?, ativo = ?`;
    const params = [dados.nome, dados.login, dados.perfil_id, dados.ativo];

    // Se o Admin preencheu uma senha nova, a gente atualiza. Se não, mantém a velha.
    if (dados.senha) {
      const salt = await bcrypt.genSalt(10);
      const senhaHash = await bcrypt.hash(dados.senha, salt);
      sql += `, senha_hash = ?`;
      params.push(senhaHash);
    }

    sql += ` WHERE id = ?`;
    params.push(id);

    await db.query(sql, params);
    return this.buscarPorId(id);
  },

  async toggleAtivo(id, ativo) {
    await db.query(`UPDATE usuarios SET ativo = ? WHERE id = ?`, [ativo, id]);
    return this.buscarPorId(id);
  }
};

module.exports = UsuarioModel;