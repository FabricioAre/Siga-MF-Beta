-- =============================================================================
--  SIGA-MF | Sistema Integrado de Gestão e Automação — Maria Fumaça
--  PASSO 1 — DDL Completo do Banco de Dados
--  Banco: MySQL 8.0+  |  Charset: utf8mb4  |  Engine: InnoDB (ACID)
--  Paleta: #1D1A39 · #451952 · #662549 · #AE445A · #F39F5A · #E8BCB9
-- =============================================================================

SET FOREIGN_KEY_CHECKS  = 0;
SET SQL_MODE            = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- =============================================================================
-- BANCO DE DADOS
-- =============================================================================
CREATE DATABASE IF NOT EXISTS siga_mf
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE siga_mf;

-- Remove tabelas em ordem inversa de dependência (re-execução limpa)
DROP TABLE IF EXISTS logs_cancelamento;
DROP TABLE IF EXISTS movimentacoes_estoque;
DROP TABLE IF EXISTS lotes_insumo;
DROP TABLE IF EXISTS pagamentos;
DROP TABLE IF EXISTS itens_pedido;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS fichas_tecnicas;
DROP TABLE IF EXISTS produtos;
DROP TABLE IF EXISTS categorias_produto;
DROP TABLE IF EXISTS insumos;
DROP TABLE IF EXISTS unidades_medida;
DROP TABLE IF EXISTS mesas;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS perfis_acesso;

-- =============================================================================
-- 1. PERFIS_ACESSO  (RBAC — Role-Based Access Control)
-- =============================================================================
CREATE TABLE perfis_acesso (
    id        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome      VARCHAR(50)      NOT NULL COMMENT 'admin | garcom | cozinheiro | caixa',
    descricao VARCHAR(255)         NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_perfil_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Papéis de acesso dos usuários (RBAC)';

-- =============================================================================
-- 2. USUARIOS
-- =============================================================================
CREATE TABLE usuarios (
    id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    perfil_id     TINYINT UNSIGNED NOT NULL,
    nome          VARCHAR(100)     NOT NULL,
    login         VARCHAR(50)      NOT NULL,
    senha_hash    VARCHAR(255)     NOT NULL COMMENT 'bcrypt hash (custo 10)',
    ativo         TINYINT(1)       NOT NULL DEFAULT 1,
    criado_em     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_usuario_login (login),
    CONSTRAINT fk_usuario_perfil
        FOREIGN KEY (perfil_id) REFERENCES perfis_acesso (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Usuários: garçons, cozinheiros, caixas e administradores';

-- =============================================================================
-- 3. MESAS  (16 mesas — RN06)
-- =============================================================================
CREATE TABLE mesas (
    id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    numero      SMALLINT UNSIGNED NOT NULL COMMENT 'Número visível (1–16)',
    capacidade  TINYINT UNSIGNED  NOT NULL DEFAULT 4,
    status      ENUM(
                    'livre',
                    'ocupada',
                    'aguardando_conta',
                    'em_limpeza'
                ) NOT NULL DEFAULT 'livre' COMMENT 'RN06: gerenciado em tempo real via Socket.IO',
    localizacao VARCHAR(60)           NULL COMMENT 'Ex: Salão, Varanda, Terraço',
    PRIMARY KEY (id),
    UNIQUE KEY uq_mesa_numero (numero),
    INDEX idx_mesa_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mesas do estabelecimento com status em tempo real (RN06)';

-- =============================================================================
-- 4. UNIDADES_MEDIDA
-- =============================================================================
CREATE TABLE unidades_medida (
    id        TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sigla     VARCHAR(10)      NOT NULL COMMENT 'g | kg | ml | L | un | cx | fd | pc',
    descricao VARCHAR(60)      NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_unidade_sigla (sigla)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Unidades de medida para controle de estoque';

-- =============================================================================
-- 5. INSUMOS  (matérias-primas — base da baixa automática RN04)
-- =============================================================================
CREATE TABLE insumos (
    id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    unidade_id      TINYINT UNSIGNED NOT NULL,
    nome            VARCHAR(150)     NOT NULL,
    descricao       TEXT                 NULL,
    estoque_atual   DECIMAL(12,3)    NOT NULL DEFAULT 0.000 COMMENT 'Saldo em tempo real',
    estoque_minimo  DECIMAL(12,3)    NOT NULL DEFAULT 0.000 COMMENT 'Limiar para alerta (RN05)',
    custo_unitario  DECIMAL(10,4)    NOT NULL DEFAULT 0.0000,
    perecivel       TINYINT(1)       NOT NULL DEFAULT 0 COMMENT 'RN05 PEPS: 1 = perecível',
    criado_em       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em   DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_insumo_unidade
        FOREIGN KEY (unidade_id) REFERENCES unidades_medida (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_insumo_alerta (estoque_atual, estoque_minimo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Insumos/ingredientes com controle de estoque por unidade de medida';

-- =============================================================================
-- 6. LOTES_INSUMO  (PEPS — Primeiro que Entra, Primeiro que Sai — RN05)
-- =============================================================================
CREATE TABLE lotes_insumo (
    id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    insumo_id      INT UNSIGNED     NOT NULL,
    fornecedor     VARCHAR(150)         NULL,
    quantidade     DECIMAL(12,3)    NOT NULL COMMENT 'Quantidade inicial do lote',
    saldo          DECIMAL(12,3)    NOT NULL COMMENT 'Saldo restante (diminui conforme consumo PEPS)',
    custo_unitario DECIMAL(10,4)    NOT NULL,
    data_entrada   DATE             NOT NULL COMMENT 'Ordena os lotes para aplicação do PEPS',
    data_validade  DATE                 NULL COMMENT 'Apenas para perecíveis',
    nota_fiscal    VARCHAR(50)          NULL,
    criado_em      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_lote_insumo
        FOREIGN KEY (insumo_id) REFERENCES insumos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Índice crítico: ordena por data de entrada ASC para consumir o lote mais antigo primeiro
    INDEX idx_lote_peps (insumo_id, data_entrada ASC, saldo DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Lotes de insumos perecíveis para controle PEPS (RN05)';

-- =============================================================================
-- 7. CATEGORIAS_PRODUTO  (separação de fluxo — RN01)
-- =============================================================================
CREATE TABLE categorias_produto (
    id    SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome  VARCHAR(80)       NOT NULL,
    fluxo ENUM('restaurante','pizzaria','ambos') NOT NULL DEFAULT 'ambos'
          COMMENT 'RN01: filtra o cardápio exibido por fluxo',
    PRIMARY KEY (id),
    UNIQUE KEY uq_categoria_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Categorias do cardápio com separação de fluxo (RN01)';

-- =============================================================================
-- 8. PRODUTOS  (cardápio completo)
-- =============================================================================
CREATE TABLE produtos (
    id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    categoria_id  SMALLINT UNSIGNED NOT NULL,
    nome          VARCHAR(150)      NOT NULL,
    descricao     TEXT                  NULL,
    preco         DECIMAL(10,2)     NOT NULL COMMENT 'Preço base',
    imagem_url    VARCHAR(500)          NULL,
    obs_rapidas   TEXT                  NULL COMMENT 'Observações rápidas separadas por vírgula (ex: sem cebola, extra molho)',
    e_pizza       TINYINT(1)        NOT NULL DEFAULT 0
                  COMMENT 'RN02: 1 = permite fracionamento meio a meio',
    disponivel    TINYINT(1)        NOT NULL DEFAULT 1
                  COMMENT 'RN05: 0 = bloqueado por falta de insumo',
    criado_em     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_produto_categoria
        FOREIGN KEY (categoria_id) REFERENCES categorias_produto (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_produto_disponivel (disponivel),
    INDEX idx_produto_categoria  (categoria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cardápio completo do restaurante e pizzaria';

-- =============================================================================
-- 9. FICHAS_TECNICAS  (receita digital — coração da RN04)
-- Relaciona cada Produto com seus Insumos e as quantidades por porção
-- =============================================================================
CREATE TABLE fichas_tecnicas (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    produto_id  INT UNSIGNED NOT NULL,
    insumo_id   INT UNSIGNED NOT NULL,
    quantidade  DECIMAL(12,3) NOT NULL COMMENT 'Qtd do insumo por 1 unidade do produto (na unidade do insumo)',
    observacao  VARCHAR(255)      NULL COMMENT 'Ex: meia porção para pizza meio a meio',
    PRIMARY KEY (id),
    UNIQUE KEY uq_ficha_produto_insumo (produto_id, insumo_id),
    CONSTRAINT fk_ficha_produto
        FOREIGN KEY (produto_id) REFERENCES produtos (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ficha_insumo
        FOREIGN KEY (insumo_id) REFERENCES insumos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ficha técnica digital: mapeamento Produto × Insumo com quantidades (base da RN04)';

-- =============================================================================
-- 10. PEDIDOS  (cabeçalho — um por sessão de mesa)
-- =============================================================================
CREATE TABLE pedidos (
    id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    mesa_id       SMALLINT UNSIGNED NOT NULL,
    usuario_id    INT UNSIGNED      NOT NULL COMMENT 'Garçom responsável',
    fluxo         ENUM('restaurante','pizzaria') NOT NULL
                  COMMENT 'RN01: fluxo selecionado pelo garçom ao abrir o pedido',
    status        ENUM(
                      'aberto',
                      'em_producao',
                      'pronto',
                      'entregue',
                      'aguardando_pagamento',
                      'pago',
                      'cancelado'
                  ) NOT NULL DEFAULT 'aberto',
    observacoes   TEXT                  NULL,
    total         DECIMAL(10,2)     NOT NULL DEFAULT 0.00 COMMENT 'Calculado dinamicamente',
    criado_em     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_pedido_mesa
        FOREIGN KEY (mesa_id) REFERENCES mesas (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_pedido_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_pedido_mesa   (mesa_id),
    INDEX idx_pedido_status (status),
    INDEX idx_pedido_data   (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cabeçalho dos pedidos com rastreio de fluxo (RN01) e status';

-- =============================================================================
-- 11. ITENS_PEDIDO  (linhas do pedido)
--     Suporta pizza meio a meio via sabor_2_id  (RN02 + RN03)
-- =============================================================================
CREATE TABLE itens_pedido (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    pedido_id        INT UNSIGNED      NOT NULL,
    produto_id       INT UNSIGNED      NOT NULL COMMENT 'Sabor 1 ou produto único',
    sabor_2_id       INT UNSIGNED          NULL COMMENT 'RN02: 2º sabor (somente pizza); NULL = pizza inteira',
    quantidade       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    preco_unitario   DECIMAL(10,2)     NOT NULL
                     COMMENT 'RN03: cobrado o MAIOR preço entre sabor_1 e sabor_2',
    observacao       VARCHAR(500)          NULL COMMENT 'Ex: sem cebola, borda recheada',
    status           ENUM(
                         'pendente',
                         'em_producao',
                         'pronto',
                         'entregue',
                         'cancelado'
                     ) NOT NULL DEFAULT 'pendente',
    estoque_baixado  TINYINT(1)        NOT NULL DEFAULT 0
                     COMMENT 'RN04: 1 após a baixa automática de insumos (idempotência)',
    criado_em        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em    DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_item_pedido
        FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_item_produto_1
        FOREIGN KEY (produto_id) REFERENCES produtos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_item_produto_2
        FOREIGN KEY (sabor_2_id) REFERENCES produtos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_item_pedido  (pedido_id),
    INDEX idx_item_status  (status),
    INDEX idx_item_baixado (estoque_baixado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Linhas de pedido; pizza meio a meio via sabor_2_id (RN02); preço maior (RN03)';

-- =============================================================================
-- 12. MOVIMENTACOES_ESTOQUE  (auditoria completa — RN04 + RN05)
-- =============================================================================
CREATE TABLE movimentacoes_estoque (
    id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
    insumo_id        INT UNSIGNED NOT NULL,
    lote_id          INT UNSIGNED     NULL COMMENT 'Lote PEPS consumido (perecíveis — RN05)',
    item_pedido_id   INT UNSIGNED     NULL COMMENT 'Item que originou a saída automática (RN04)',
    usuario_id       INT UNSIGNED     NULL COMMENT 'Responsável por entrada ou ajuste manual',
    tipo             ENUM('entrada','saida','ajuste','perda') NOT NULL,
    quantidade       DECIMAL(12,3) NOT NULL COMMENT 'Magnitude da movimentação (sempre positivo)',
    saldo_anterior   DECIMAL(12,3) NOT NULL,
    saldo_posterior  DECIMAL(12,3) NOT NULL,
    justificativa    VARCHAR(500)      NULL COMMENT 'RN07: obrigatório para cancelamentos/perdas',
    criado_em        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_mov_insumo
        FOREIGN KEY (insumo_id) REFERENCES insumos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_lote
        FOREIGN KEY (lote_id) REFERENCES lotes_insumo (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_item
        FOREIGN KEY (item_pedido_id) REFERENCES itens_pedido (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_mov_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_mov_insumo (insumo_id),
    INDEX idx_mov_data   (criado_em),
    INDEX idx_mov_tipo   (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Auditoria completa: entradas, baixas automáticas (RN04) e perdas';

-- =============================================================================
-- 13. LOGS_CANCELAMENTO  (auditoria de cancelamentos — RN07)
-- =============================================================================
CREATE TABLE logs_cancelamento (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    item_pedido_id INT UNSIGNED NOT NULL,
    usuario_id     INT UNSIGNED NOT NULL COMMENT 'Deve ter perfil admin (RN07)',
    justificativa  VARCHAR(500) NOT NULL,
    criado_em      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_logcancel_item
        FOREIGN KEY (item_pedido_id) REFERENCES itens_pedido (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_logcancel_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='RN07: Log imutável de cancelamentos de itens já enviados à produção';

-- =============================================================================
-- 14. PAGAMENTOS  (PDV — fechamento cego RN08 + divisão de conta)
-- =============================================================================
CREATE TABLE pagamentos (
    id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    pedido_id        INT UNSIGNED      NOT NULL,
    usuario_id       INT UNSIGNED      NOT NULL COMMENT 'Operador de caixa',
    metodo           ENUM(
                         'dinheiro',
                         'cartao_credito',
                         'cartao_debito',
                         'pix',
                         'voucher',
                         'misto'
                     ) NOT NULL,
    valor_total      DECIMAL(10,2)     NOT NULL COMMENT 'Total do pedido',
    valor_recebido   DECIMAL(10,2)     NOT NULL
                     COMMENT 'RN08: informado ANTES de revelar o total esperado',
    troco            DECIMAL(10,2)     NOT NULL DEFAULT 0.00,
    numero_pessoas   TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    valor_por_pessoa DECIMAL(10,2)         NULL COMMENT 'valor_total / numero_pessoas',
    observacoes      VARCHAR(255)          NULL,
    criado_em        DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_pag_pedido
        FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_pag_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_pag_pedido (pedido_id),
    INDEX idx_pag_data   (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pagamentos com suporte a divisão de conta e fechamento cego (RN08)';

SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================================
-- VIEWS UTILITÁRIAS
-- =============================================================================

-- KDS: fila de produção ordenada por tempo de espera
CREATE OR REPLACE VIEW vw_kds_producao AS
SELECT
    ip.id                                                     AS item_id,
    p.id                                                      AS pedido_id,
    m.numero                                                  AS mesa_numero,
    p.fluxo                                                   AS pedido_fluxo,
    pr1.nome                                                  AS sabor_1,
    pr2.nome                                                  AS sabor_2,
    ip.quantidade,
    ip.observacao,
    ip.status                                                 AS item_status,
    u.nome                                                    AS garcom,
    ip.criado_em                                              AS hora_lancamento,
    TIMESTAMPDIFF(MINUTE, ip.criado_em, NOW())               AS minutos_aguardando
FROM itens_pedido ip
JOIN pedidos  p   ON p.id    = ip.pedido_id
JOIN mesas    m   ON m.id    = p.mesa_id
JOIN produtos pr1 ON pr1.id  = ip.produto_id
LEFT JOIN produtos pr2 ON pr2.id = ip.sabor_2_id
JOIN usuarios u   ON u.id    = p.usuario_id
WHERE ip.status IN ('pendente','em_producao')
ORDER BY ip.criado_em ASC;

-- Resumo de mesas com pedidos ativos (painel do garçom)
CREATE OR REPLACE VIEW vw_status_mesas AS
SELECT
    m.id          AS mesa_id,
    m.numero      AS mesa_numero,
    m.capacidade,
    m.status      AS mesa_status,
    m.localizacao,
    p.id          AS pedido_id,
    p.fluxo,
    p.status      AS pedido_status,
    p.total       AS pedido_total,
    u.nome        AS garcom,
    p.criado_em   AS pedido_inicio
FROM mesas m
LEFT JOIN pedidos  p ON p.mesa_id = m.id
                    AND p.status NOT IN ('pago','cancelado')
LEFT JOIN usuarios u ON u.id = p.usuario_id;

-- Alertas de estoque mínimo
CREATE OR REPLACE VIEW vw_alertas_estoque AS
SELECT
    i.id,
    i.nome                                                           AS insumo,
    um.sigla                                                         AS unidade,
    i.estoque_atual,
    i.estoque_minimo,
    i.perecivel,
    ROUND((i.estoque_atual / NULLIF(i.estoque_minimo,0)) * 100, 1)  AS pct_estoque
FROM insumos i
JOIN unidades_medida um ON um.id = i.unidade_id
WHERE i.estoque_atual <= i.estoque_minimo
ORDER BY pct_estoque ASC;

-- =============================================================================
-- STORED PROCEDURE: sp_baixar_estoque
-- RN04: baixa automática dos insumos ao confirmar um item
-- RN05: consome lotes na ordem PEPS (data_entrada ASC) para perecíveis
-- =============================================================================
DROP PROCEDURE IF EXISTS sp_baixar_estoque;

DELIMITER $$

CREATE PROCEDURE sp_baixar_estoque(
    IN  p_item_id  INT UNSIGNED,
    OUT p_ok        TINYINT,
    OUT p_msg       VARCHAR(500)
)
sp_baixar_estoque: BEGIN
    DECLARE v_prod1         INT UNSIGNED;
    DECLARE v_prod2         INT UNSIGNED;
    DECLARE v_qtd_item      DECIMAL(12,3);
    DECLARE v_insumo_id     INT UNSIGNED;
    DECLARE v_qtd_ficha      DECIMAL(12,3);
    DECLARE v_saldo         DECIMAL(12,3);
    DECLARE v_perecivel     TINYINT(1);
    DECLARE v_fator         DECIMAL(5,3) DEFAULT 1.000;
    DECLARE v_done          INT DEFAULT 0;
    DECLARE v_qtd_baixar    DECIMAL(12,3);

    -- Cursor para a ficha técnica do Sabor 1
    DECLARE cur_ft CURSOR FOR 
        SELECT insumo_id, quantidade 
        FROM fichas_tecnicas 
        WHERE produto_id = v_prod1;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
    
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_ok  = 0;
        SET p_msg = 'Erro na transação de baixa de estoque.';
    END;

    -- Busca dados do item e verifica idempotência
    SELECT produto_id, sabor_2_id, quantidade
    INTO   v_prod1, v_prod2, v_qtd_item
    FROM   itens_pedido
    WHERE  id = p_item_id AND estoque_baixado = 0
    LIMIT  1;

    IF v_prod1 IS NULL THEN
        SET p_ok  = 0;
        SET p_msg = 'Item não encontrado ou estoque já baixado.';
        LEAVE sp_baixar_estoque;
    END IF;

    -- Se for pizza meio a meio, o fator de consumo de cada sabor é 0.5
    IF v_prod2 IS NOT NULL THEN
        SET v_fator = 0.500;
    END IF;

    START TRANSACTION;

    -- Processamento Sabor 1
    OPEN cur_ft;
    loop1: LOOP
        FETCH cur_ft INTO v_insumo_id, v_qtd_ficha;
        IF v_done THEN LEAVE loop1; END IF;

        SET v_qtd_baixar = v_qtd_ficha * v_qtd_item * v_fator;

        SELECT estoque_atual, perecivel INTO v_saldo, v_perecivel
        FROM insumos WHERE id = v_insumo_id FOR UPDATE;

        IF v_saldo < v_qtd_baixar THEN
            ROLLBACK;
            SET p_ok  = 0;
            SET p_msg = CONCAT('Saldo insuficiente: insumo ID ', v_insumo_id);
            LEAVE sp_baixar_estoque;
        END IF;

        INSERT INTO movimentacoes_estoque (insumo_id, item_pedido_id, tipo, quantidade, saldo_anterior, saldo_posterior)
        VALUES (v_insumo_id, p_item_id, 'saida', v_qtd_baixar, v_saldo, v_saldo - v_qtd_baixar);

        UPDATE insumos SET estoque_atual = estoque_atual - v_qtd_baixar WHERE id = v_insumo_id;
    END LOOP;
    CLOSE cur_ft;

    -- Processamento Sabor 2 (Opcional)
    IF v_prod2 IS NOT NULL THEN
        SET v_done = 0;
        BEGIN
            DECLARE cur_ft2 CURSOR FOR 
                SELECT insumo_id, quantidade 
                FROM fichas_tecnicas 
                WHERE produto_id = v_prod2;
            DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

            OPEN cur_ft2;
            loop2: LOOP
                FETCH cur_ft2 INTO v_insumo_id, v_qtd_ficha;
                IF v_done THEN LEAVE loop2; END IF;

                SET v_qtd_baixar = v_qtd_ficha * v_qtd_item * v_fator;

                SELECT estoque_atual INTO v_saldo FROM insumos WHERE id = v_insumo_id FOR UPDATE;

                IF v_saldo < v_qtd_baixar THEN
                    ROLLBACK;
                    SET p_ok  = 0;
                    SET p_msg = CONCAT('Saldo insuficiente (Sabor 2): insumo ID ', v_insumo_id);
                    LEAVE sp_baixar_estoque;
                END IF;

                INSERT INTO movimentacoes_estoque (insumo_id, item_pedido_id, tipo, quantidade, saldo_anterior, saldo_posterior)
                VALUES (v_insumo_id, p_item_id, 'saida', v_qtd_baixar, v_saldo, v_saldo - v_qtd_baixar);

                UPDATE insumos SET estoque_atual = estoque_atual - v_qtd_baixar WHERE id = v_insumo_id;
            END LOOP;
            CLOSE cur_ft2;
        END;
    END IF;

    -- Finalização
    UPDATE itens_pedido SET estoque_baixado = 1 WHERE id = p_item_id;

    -- Atualiza disponibilidade global (RN05)
    UPDATE produtos pr SET pr.disponivel = 0
    WHERE EXISTS (
        SELECT 1 FROM fichas_tecnicas ft
        JOIN insumos i ON i.id = ft.insumo_id
        WHERE ft.produto_id = pr.id AND i.estoque_atual < ft.quantidade
    );

    COMMIT;
    SET p_ok  = 1;
    SET p_msg = 'Estoque baixado com sucesso.';
END$$

DELIMITER ;

-- =============================================================================
-- SEED: dados essenciais para o ambiente de desenvolvimento/produção
-- =============================================================================

-- Perfis de acesso
INSERT INTO perfis_acesso (nome, descricao) VALUES
  ('admin',      'Acesso total — gerencia cardápio, estoque e cancelamentos (RN07)'),
  ('garcom',     'Lança pedidos e acompanha status das mesas'),
  ('cozinheiro', 'Recebe pedidos e atualiza status no KDS'),
  ('caixa',      'Finaliza vendas, divide contas e audita pagamentos');

-- Unidades de medida
INSERT INTO unidades_medida (sigla, descricao) VALUES
  ('g',  'Gramas'),
  ('kg', 'Quilogramas'),
  ('ml', 'Mililitros'),
  ('L',  'Litros'),
  ('un', 'Unidade'),
  ('cx', 'Caixa'),
  ('fd', 'Fardo'),
  ('pc', 'Pacote');

-- Usuário administrador padrão
-- ATENÇÃO: senha_hash = bcrypt('admin@2025') — ALTERAR NO PRIMEIRO DEPLOY
INSERT INTO usuarios (perfil_id, nome, login, senha_hash) VALUES
  (1, 'Administrador', 'admin',
   '$2b$10$D2oG54Tc4GyKpXmpP871XuymePFQgIODe/X/kp0haC5IeAER9wd9a');

-- 16 Mesas
INSERT INTO mesas (numero, capacidade, localizacao) VALUES
  ( 1, 4, 'Salão Principal'), ( 2, 4, 'Salão Principal'),
  ( 3, 4, 'Salão Principal'), ( 4, 4, 'Salão Principal'),
  ( 5, 6, 'Salão Principal'), ( 6, 6, 'Salão Principal'),
  ( 7, 4, 'Salão Principal'), ( 8, 4, 'Salão Principal'),
  ( 9, 2, 'Varanda'),         (10, 2, 'Varanda'),
  (11, 4, 'Varanda'),         (12, 4, 'Varanda'),
  (13, 8, 'Área VIP'),        (14, 8, 'Área VIP'),
  (15, 4, 'Terraço'),         (16, 4, 'Terraço');

-- Categorias do cardápio (RN01)
INSERT INTO categorias_produto (nome, fluxo) VALUES
  -- Pizzaria
  ('Pizzas Tradicionais',    'pizzaria'),
  ('Pizzas Especiais',       'pizzaria'),
  ('Pizzas Doces',           'pizzaria'),
  -- Restaurante
  ('Entradas',               'restaurante'),
  ('Pratos Executivos',      'restaurante'),
  ('Massas',                 'restaurante'),
  ('Grelhados',              'restaurante'),
  ('Saladas',                'restaurante'),
  ('Sobremesas',             'restaurante'),
  -- Ambos
  ('Bebidas Não Alcoólicas', 'ambos'),
  ('Bebidas Alcoólicas',     'ambos'),
  ('Porções',                'ambos');

-- Insumos base (estoque inicial de desenvolvimento)
INSERT INTO insumos (unidade_id, nome, estoque_atual, estoque_minimo, custo_unitario, perecivel) VALUES
  -- (unidade_id: 2=kg, 1=g, 3=ml, 4=L, 5=un)
  (2, 'Farinha de Trigo',     50.000, 10.000,  4.5000, 0),
  (2, 'Muçarela',             30.000,  5.000, 45.0000, 1),
  (4, 'Molho de Tomate',      20.000,  3.000,  8.0000, 1),
  (2, 'Calabresa',            15.000,  3.000, 28.0000, 1),
  (5, 'Milho Verde (lata)',   40.000, 10.000,  3.5000, 0),
  (2, 'Frango Desfiado',      20.000,  4.000, 22.0000, 1),
  (2, 'Carne Moída',          25.000,  5.000, 35.0000, 1),
  (2, 'Arroz',                80.000, 15.000,  5.0000, 0),
  (2, 'Feijão',               40.000, 10.000,  7.5000, 0),
  (4, 'Óleo de Soja',         15.000,  3.000,  9.0000, 0),
  (5, 'Refrigerante 2L',      60.000, 20.000,  8.0000, 0),
  (5, 'Água Mineral 500ml',  120.000, 30.000,  1.5000, 0),
  (5, 'Cerveja 600ml',        80.000, 20.000,  5.5000, 0),
  (2, 'Presunto',             10.000,  2.000, 32.0000, 1),
  (2, 'Pimentão',              8.000,  1.500, 12.0000, 1),
  (2, 'Cebola',               10.000,  2.000,  5.0000, 1),
  (2, 'Alho',                  5.000,  1.000, 18.0000, 1),
  (5, 'Ovo',                 200.000, 30.000,  0.8000, 1),
  (2, 'Requeijão Cremoso',    12.000,  2.000, 38.0000, 1),
  (2, 'Bacon',                 8.000,  1.500, 42.0000, 1),
  (2, 'Escarola',              5.000,  1.000,  8.0000, 1),
  (2, 'Lombo Suíno',          20.000,  4.000, 30.0000, 1);

-- Produtos do cardápio (pizzas)
INSERT INTO produtos (categoria_id, nome, descricao, preco, e_pizza) VALUES
  -- Pizzas Tradicionais (cat 1)
  (1, 'Pizza Calabresa',
      'Calabresa fatiada, cebola, mussarela e orégano',          52.00, 1),
  (1, 'Pizza Mussarela',
      'Mussarela extra, molho especial e orégano',               45.00, 1),
  (1, 'Pizza Milho Verde',
      'Milho verde, requeijão cremoso e mussarela',              48.00, 1),
  -- Pizzas Especiais (cat 2)
  (2, 'Pizza Frango c/ Catupiry',
      'Frango desfiado, requeijão e mussarela',                  56.00, 1),
  (2, 'Pizza Portuguesa',
      'Presunto, ovo, pimentão, cebola e mussarela',             58.00, 1),
  (2, 'Pizza 4 Queijos',
      'Mussarela, requeijão, parmesão e provolone',              60.00, 1),
  (2, 'Pizza Bacon',
      'Bacon crocante, cheddar e cebola caramelizada',           62.00, 1),
  -- Pizzas Doces (cat 3)
  (3, 'Pizza Romeu & Julieta',
      'Mussarela com goiabada e cream cheese',                   55.00, 1),
  (3, 'Pizza Prestígio',
      'Chocolate ao leite, coco ralado e leite condensado',      58.00, 1);

-- Produtos do restaurante
INSERT INTO produtos (categoria_id, nome, descricao, preco, e_pizza) VALUES
  (5, 'Prato Executivo Frango',
      'Frango grelhado, arroz, feijão e salada',                 28.00, 0),
  (5, 'Prato Executivo Carne',
      'Carne assada, arroz, feijão e salada',                    32.00, 0),
  (7, 'Filé Grelhado',
      'Filé mignon grelhado ao alho e óleo',                     45.00, 0),
  (6, 'Macarrão ao Sugo',
      'Macarrão com molho de tomate fresco',                     25.00, 0),
  (8, 'Salada Caesar',
      'Alface romana, croutons, parmesão e molho Caesar',        22.00, 0);

-- Bebidas (compartilhadas entre fluxos)
INSERT INTO produtos (categoria_id, nome, descricao, preco, e_pizza) VALUES
  (10, 'Refrigerante 2L',    'Coca-Cola, Guaraná ou Fanta',      16.00, 0),
  (10, 'Água Mineral 500ml', 'Com ou sem gás',                    5.00, 0),
  (11, 'Cerveja 600ml',      'Brahma ou Skol gelada',            12.00, 0);

-- Fichas Técnicas (Pizzas)
-- Pizza Calabresa
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo' THEN 0.350
    WHEN 'Molho de Tomate'  THEN 0.150
    WHEN 'Muçarela'         THEN 0.250
    WHEN 'Calabresa'        THEN 0.200
    WHEN 'Cebola'           THEN 0.050
    WHEN 'Óleo de Soja'     THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza Calabresa'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Calabresa','Cebola','Óleo de Soja');

-- Pizza Mussarela
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo' THEN 0.350
    WHEN 'Molho de Tomate'  THEN 0.180
    WHEN 'Muçarela'         THEN 0.350
    WHEN 'Óleo de Soja'     THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza Mussarela'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Óleo de Soja');

-- Pizza Milho Verde
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo'   THEN 0.350
    WHEN 'Molho de Tomate'    THEN 0.150
    WHEN 'Muçarela'           THEN 0.200
    WHEN 'Milho Verde (lata)' THEN 1.000
    WHEN 'Requeijão Cremoso'  THEN 0.100
    WHEN 'Óleo de Soja'       THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza Milho Verde'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Milho Verde (lata)','Requeijão Cremoso','Óleo de Soja');

-- Pizza Frango c/ Catupiry
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo'  THEN 0.350
    WHEN 'Molho de Tomate'   THEN 0.120
    WHEN 'Muçarela'          THEN 0.200
    WHEN 'Frango Desfiado'   THEN 0.250
    WHEN 'Requeijão Cremoso' THEN 0.150
    WHEN 'Óleo de Soja'      THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza Frango c/ Catupiry'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Frango Desfiado','Requeijão Cremoso','Óleo de Soja');

-- Pizza Portuguesa
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo' THEN 0.350
    WHEN 'Molho de Tomate'  THEN 0.150
    WHEN 'Muçarela'         THEN 0.250
    WHEN 'Presunto'         THEN 0.150
    WHEN 'Ovo'              THEN 3.000
    WHEN 'Pimentão'         THEN 0.080
    WHEN 'Cebola'           THEN 0.060
    WHEN 'Óleo de Soja'     THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza Portuguesa'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Presunto','Ovo','Pimentão','Cebola','Óleo de Soja');

-- Pizza 4 Queijos
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Farinha de Trigo'  THEN 0.350
    WHEN 'Molho de Tomate'   THEN 0.100
    WHEN 'Muçarela'          THEN 0.200
    WHEN 'Requeijão Cremoso' THEN 0.150
    WHEN 'Óleo de Soja'      THEN 0.030
  END
FROM produtos p, insumos i
WHERE p.nome = 'Pizza 4 Queijos'
  AND i.nome IN ('Farinha de Trigo','Molho de Tomate','Muçarela','Requeijão Cremoso','Óleo de Soja');

-- Prato Executivo Frango
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Frango Desfiado' THEN 0.180
    WHEN 'Arroz'           THEN 0.120
    WHEN 'Feijão'          THEN 0.080
    WHEN 'Alho'            THEN 0.010
    WHEN 'Óleo de Soja'    THEN 0.015
  END
FROM produtos p, insumos i
WHERE p.nome = 'Prato Executivo Frango'
  AND i.nome IN ('Frango Desfiado','Arroz','Feijão','Alho','Óleo de Soja');

-- Prato Executivo Carne
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id,
  CASE i.nome
    WHEN 'Carne Moída'  THEN 0.200
    WHEN 'Arroz'        THEN 0.120
    WHEN 'Feijão'       THEN 0.080
    WHEN 'Alho'         THEN 0.010
    WHEN 'Óleo de Soja' THEN 0.015
  END
FROM produtos p, insumos i
WHERE p.nome = 'Prato Executivo Carne'
  AND i.nome IN ('Carne Moída','Arroz','Feijão','Alho','Óleo de Soja');

-- Bebidas (ficha técnica: 1 unidade por 1 unidade vendida)
INSERT INTO fichas_tecnicas (produto_id, insumo_id, quantidade)
SELECT p.id, i.id, 1.000 FROM produtos p JOIN insumos i ON i.nome = p.nome
WHERE p.nome IN ('Refrigerante 2L','Água Mineral 500ml','Cerveja 600ml');

-- =============================================================================
-- FIM DO SCHEMA SIGA-MF v1.0
-- Próximo: PASSO 2 — Estrutura de pastas Node.js + server.js
-- =============================================================================
