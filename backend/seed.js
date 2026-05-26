require('dotenv').config();
const db = require('./src/config/db');

async function seed() {
  console.log('Iniciando seed...');

  await db.query(`INSERT IGNORE INTO perfis_acesso (nome, descricao) VALUES
    ('admin','Acesso total'),
    ('garcom','Lanca pedidos'),
    ('cozinheiro','KDS'),
    ('caixa','PDV')`);
  console.log('Perfis OK');

  await db.query(`INSERT IGNORE INTO unidades_medida (sigla, descricao) VALUES
    ('g','Gramas'),('kg','Quilogramas'),('ml','Mililitros'),
    ('L','Litros'),('un','Unidade'),('cx','Caixa'),('fd','Fardo'),('pc','Pacote')`);
  console.log('Unidades OK');

  // Senha: admin@2025
  await db.query(`INSERT IGNORE INTO usuarios (perfil_id, nome, login, senha_hash) VALUES
    (1,'Administrador','admin','$2b$10$D2oG54Tc4GyKpXmpP871XuymePFQgIODe/X/kp0haC5IeAER9wd9a')`);
  console.log('Usuario admin OK');

  const locais = {1:'Salao Principal',2:'Salao Principal',3:'Salao Principal',4:'Salao Principal',
    5:'Salao Principal',6:'Salao Principal',7:'Salao Principal',8:'Salao Principal',
    9:'Varanda',10:'Varanda',11:'Varanda',12:'Varanda',
    13:'Area VIP',14:'Area VIP',15:'Terraco',16:'Terraco'};
  for (let i = 1; i <= 16; i++) {
    await db.query('INSERT IGNORE INTO mesas (numero, capacidade, localizacao) VALUES (?,4,?)', [i, locais[i]]);
  }
  console.log('16 Mesas OK');

  await db.query(`INSERT IGNORE INTO categorias_produto (nome, fluxo) VALUES
    ('Pizzas Tradicionais','pizzaria'),('Pizzas Especiais','pizzaria'),('Pizzas Doces','pizzaria'),
    ('Entradas','restaurante'),('Pratos Executivos','restaurante'),('Massas','restaurante'),
    ('Grelhados','restaurante'),('Saladas','restaurante'),('Sobremesas','restaurante'),
    ('Bebidas Nao Alcoolicas','ambos'),('Bebidas Alcoolicas','ambos'),('Porcoes','ambos')`);
  console.log('Categorias OK');

  await db.query(`INSERT IGNORE INTO insumos (unidade_id, nome, estoque_atual, estoque_minimo, custo_unitario, perecivel) VALUES
    (2,'Farinha de Trigo',50,10,4.50,0),
    (2,'Mussarela',30,5,45.00,1),
    (4,'Molho de Tomate',20,3,8.00,1),
    (2,'Calabresa',15,3,28.00,1),
    (5,'Milho Verde',40,10,3.50,0),
    (2,'Frango Desfiado',20,4,22.00,1),
    (2,'Carne Moida',25,5,35.00,1),
    (2,'Arroz',80,15,5.00,0),
    (2,'Feijao',40,10,7.50,0),
    (4,'Oleo de Soja',15,3,9.00,0),
    (5,'Refrigerante 2L',60,20,8.00,0),
    (5,'Agua Mineral 500ml',120,30,1.50,0),
    (5,'Cerveja 600ml',80,20,5.50,0),
    (2,'Presunto',10,2,32.00,1),
    (2,'Pimentao',8,1.5,12.00,1),
    (2,'Cebola',10,2,5.00,1),
    (2,'Alho',5,1,18.00,1),
    (5,'Ovo',200,30,0.80,1),
    (2,'Requeijao Cremoso',12,2,38.00,1),
    (2,'Bacon',8,1.5,42.00,1)`);
  console.log('Insumos OK');

  await db.query(`INSERT IGNORE INTO produtos (categoria_id, nome, descricao, preco, e_pizza) VALUES
    (1,'Pizza Calabresa','Calabresa, cebola, mussarela e oregano',52.00,1),
    (1,'Pizza Mussarela','Mussarela extra e molho especial',45.00,1),
    (1,'Pizza Milho Verde','Milho verde, requeijao e mussarela',48.00,1),
    (2,'Pizza Frango c/ Catupiry','Frango desfiado e requeijao',56.00,1),
    (2,'Pizza Portuguesa','Presunto, ovo, pimentao, cebola e mussarela',58.00,1),
    (2,'Pizza 4 Queijos','Mussarela, requeijao, parmesao e provolone',60.00,1),
    (2,'Pizza Bacon','Bacon crocante, cheddar e cebola caramelizada',62.00,1),
    (3,'Pizza Romeu e Julieta','Mussarela com goiabada e cream cheese',55.00,1),
    (3,'Pizza Prestigio','Chocolate, coco ralado e leite condensado',58.00,1),
    (5,'Prato Executivo Frango','Frango grelhado, arroz, feijao e salada',28.00,0),
    (5,'Prato Executivo Carne','Carne assada, arroz, feijao e salada',32.00,0),
    (7,'File Grelhado','File mignon ao alho e oleo',45.00,0),
    (6,'Macarrao ao Sugo','Molho de tomate fresco',25.00,0),
    (8,'Salada Caesar','Alface romana, croutons, parmesao',22.00,0),
    (10,'Refrigerante 2L','Coca-Cola, Guarana ou Fanta',16.00,0),
    (10,'Agua Mineral 500ml','Com ou sem gas',5.00,0),
    (11,'Cerveja 600ml','Brahma ou Skol gelada',12.00,0)`);
  console.log('Produtos OK');

  const [[counts]] = await db.query(`SELECT
    (SELECT COUNT(*) FROM mesas) AS mesas,
    (SELECT COUNT(*) FROM produtos) AS produtos,
    (SELECT COUNT(*) FROM usuarios) AS usuarios,
    (SELECT COUNT(*) FROM insumos) AS insumos,
    (SELECT COUNT(*) FROM categorias_produto) AS categorias`);
  console.log('\n=== SEED CONCLUIDO ===');
  console.log('Mesas: ' + counts.mesas + ' | Produtos: ' + counts.produtos + ' | Usuarios: ' + counts.usuarios + ' | Insumos: ' + counts.insumos + ' | Categorias: ' + counts.categorias);

  db.end();
}

seed().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
