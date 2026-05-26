-- =============================================================================
--  SIGA-MF | Módulo de Segurança e Acesso
--  Tabelas: perfis_acesso e usuarios
--
--  NOTA: Os nomes dos perfis (admin, garcom, cozinheiro, caixa) DEVEM
--  corresponder ao que o middleware auth.js verifica no JWT.
-- =============================================================================

USE siga_mf;

-- Desabilita checagem de chaves estrangeiras temporariamente para recriar as tabelas se necessário
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS perfis_acesso;

-- =============================================================================
-- 1. PERFIS_ACESSO (RBAC — Role-Based Access Control)
-- =============================================================================
CREATE TABLE perfis_acesso (
    id        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome      VARCHAR(50)      NOT NULL COMMENT 'admin | garcom | cozinheiro | caixa',
    descricao VARCHAR(255)         NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_perfil_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Papéis de acesso que definem o que cada usuário pode ver no sistema';

-- =============================================================================
-- 2. USUARIOS
-- =============================================================================
CREATE TABLE usuarios (
    id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    perfil_id     TINYINT UNSIGNED NOT NULL,
    nome          VARCHAR(100)     NOT NULL,
    login         VARCHAR(50)      NOT NULL,
    senha_hash    VARCHAR(255)     NOT NULL COMMENT 'Hash gerado pelo bcrypt no Node.js',
    ativo         TINYINT(1)       NOT NULL DEFAULT 1 COMMENT '1=Ativo, 0=Bloqueado (Soft Delete)',
    criado_em     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_usuario_login (login),
    CONSTRAINT fk_usuario_perfil
        FOREIGN KEY (perfil_id) REFERENCES perfis_acesso (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_usuario_ativo (ativo),
    INDEX idx_usuario_login_senha (login, senha_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Usuários do Siga-MF com autenticação segura';

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- SEED: Dados Iniciais Obrigatórios
-- =============================================================================

-- 1. Inserindo os Perfis Padrões do Siga-MF
-- IMPORTANTE: Os nomes DEVEM ser 'admin', 'garcom', 'cozinheiro', 'caixa'
-- pois é isso que o middleware auth.js verifica no token JWT.
INSERT INTO perfis_acesso (id, nome, descricao) VALUES
  (1, 'admin',      'Acesso total ao painel de gestão, estoque e relatórios'),
  (2, 'garcom',     'Acesso ao módulo de salão para lançar pedidos nas mesas'),
  (3, 'cozinheiro', 'Acesso ao monitor KDS para gerenciar a fila de produção'),
  (4, 'caixa',      'Acesso ao PDV para recebimento e fechamento de contas');

-- 2. Inserindo o Usuário Admin Master
-- A senha_hash abaixo corresponde à senha: admin@2025
-- (Gerada com bcrypt, custo 10)
INSERT INTO usuarios (perfil_id, nome, login, senha_hash, ativo) VALUES
  (1, 'Administrador Master', 'admin', '$2b$10$69dku9zZQf7dlwQtGRcgueGxXmhfcaNU9dj9iV4jRrDwbvcduoDC.', 1);

-- 3. Inserindo usuários de teste para os outros módulos
-- ATENÇÃO: As senhas abaixo são placeholders e NÃO funcionam com bcrypt.compare().
-- Execute o script arrumar_senhas.js para gerar hashes válidos:
--   node arrumar_senhas.js
-- (Senha de todos: 1234)
INSERT INTO usuarios (perfil_id, nome, login, senha_hash, ativo) VALUES
  (2, 'João Garçom',      'joao',   '$2b$10$PLACEHOLDER_HASH_INVALIDO', 1),
  (3, 'Maria Cozinheira', 'maria',  '$2b$10$PLACEHOLDER_HASH_INVALIDO', 1),
  (4, 'Ana Caixa',        'ana',    '$2b$10$PLACEHOLDER_HASH_INVALIDO', 1);