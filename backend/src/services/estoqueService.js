// src/services/estoqueService.js
// ─────────────────────────────────────────────────────────────────────────────
//  RN04 — Baixa automática de estoque ao fechar um pedido
//  RN02 — Pizza meio a meio: cada sabor consome 50% da ficha técnica
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const PedidoModel  = require('../models/pedidoModel');
const EstoqueModel = require('../models/estoqueModel');

/**
 * darBaixaEstoque(pedidoId)
 *
 * Algoritmo:
 *  1. Busca todos os itens do pedido (não cancelados e não já baixados)
 *  2. Para cada item:
 *     a. Carrega a ficha técnica do produto (sabor 1)
 *     b. Se pizza meio a meio (sabor_2_id), carrega a ficha do segundo sabor
 *        com fator 0.5 para cada um (RN02)
 *     c. Acumula consumo por insumo (evita múltiplos UPDATEs no mesmo insumo)
 *  3. Deduz o consumo agregado do banco
 *  4. Verifica alertas de estoque mínimo
 *  5. Retorna { baixas[], alertas[] }
 *
 * @param {number} pedidoId
 * @returns {Promise<{ baixas: object[], alertas: object[] }>}
 */
async function darBaixaEstoque(pedidoId) {
  const itens = await PedidoModel.listarItensPorPedidoParaEstoque(pedidoId);

  // Filtra apenas itens que ainda não tiveram o estoque baixado (idempotência)
  const itensPendentes = itens.filter(i => !i.estoque_baixado);

  if (!itensPendentes.length) {
    return { baixas: [], alertas: [] };
  }

  // Mapa de consumo agregado:  insumo_id → { nome, unidade, total }
  const consumoAgregado = new Map();

  for (const item of itensPendentes) {
    const { produto_id, sabor_2_id, quantidade: qtdPedida } = item;
    const eMeioAMeio = Boolean(sabor_2_id);
    const fator      = eMeioAMeio ? 0.5 : 1.0;   // RN02

    // ── Ficha técnica sabor 1 ──────────────────────────────────────────────
    const ficha1 = await EstoqueModel.buscarFichaTecnicaProduto(produto_id);
    acumularConsumo(consumoAgregado, ficha1, qtdPedida * fator);

    // ── Ficha técnica sabor 2 (pizza meio a meio) ─────────────────────────
    if (eMeioAMeio) {
      const ficha2 = await EstoqueModel.buscarFichaTecnicaProduto(sabor_2_id);
      acumularConsumo(consumoAgregado, ficha2, qtdPedida * fator);
    }
  }

  // ── Aplica deduções ────────────────────────────────────────────────────────
  const baixas  = [];
  const alertas = [];

  for (const [, consumo] of consumoAgregado) {
    const { insumo_id, insumo_nome, unidade, total } = consumo;
    const resultado = await EstoqueModel.deduzirEstoque(insumo_id, total);

    if (!resultado) continue;

    const baixaInfo = {
      insumo_id,
      nome:             insumo_nome,
      unidade,
      deduzido:         total,
      estoque_restante: parseFloat(resultado.estoque_atual),
    };
    baixas.push(baixaInfo);

    if (parseFloat(resultado.estoque_atual) <= parseFloat(resultado.estoque_minimo)) {
      alertas.push({
        ...baixaInfo,
        estoque_minimo: parseFloat(resultado.estoque_minimo),
        mensagem:       `ALERTA: "${insumo_nome}" abaixo do estoque mínimo!`,
      });
    }
  }

  // Marca itens como baixados (flag idempotência)
  const db = require('../config/db');
  const idsItem = itensPendentes.map(i => i.id).filter(Boolean);
  if (idsItem.length) {
    await db.query(
      `UPDATE itens_pedido SET estoque_baixado = 1 WHERE pedido_id = ? AND status != 'cancelado'`,
      [pedidoId]
    );
  }

  console.log(`[EstoqueService] Pedido #${pedidoId} — ${baixas.length} insumo(s) deduzidos.`);
  if (alertas.length) {
    alertas.forEach(a => console.warn('[EstoqueService]', a.mensagem));
  }

  return { baixas, alertas };
}

// ── Função auxiliar ────────────────────────────────────────────────────────────
function acumularConsumo(mapa, ficha, qtd) {
  for (const linha of ficha) {
    const { insumo_id, quantidade, insumo_nome, unidade } = linha;
    const consumo = parseFloat(quantidade) * qtd;

    if (mapa.has(insumo_id)) {
      mapa.get(insumo_id).total += consumo;
    } else {
      mapa.set(insumo_id, { insumo_id, insumo_nome, unidade, total: consumo });
    }
  }
}

module.exports = { darBaixaEstoque };
