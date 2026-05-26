require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./src/config/db');

async function arrumar() {
  try {
    console.log('Gerando chaves de segurança reais...');
    
    // Gera as senhas corretas (consistentes com schema_usuarios.sql)
    const hashAdmin = await bcrypt.hash('admin@2025', 10);
    const hashGeral = await bcrypt.hash('1234', 10);

    // Salva no banco de dados
    await db.query(`UPDATE usuarios SET senha_hash = ? WHERE login = 'admin'`, [hashAdmin]);
    await db.query(`UPDATE usuarios SET senha_hash = ? WHERE login IN ('joao', 'maria', 'ana')`, [hashGeral]);

    console.log('Senhas atualizadas com sucesso!');
    console.log('  admin   -> admin@2025');
    console.log('  joao/maria/ana -> 1234');
    process.exit(0);
  } catch (erro) {
    console.error('Erro:', erro);
    process.exit(1);
  }
}

arrumar();