/* ═══════════════════════════════════════════════════════════
   SIGA-MF | Caixa / PDV — Lógica de Pagamentos
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── Estado global ──────────────────────────────────────────
const state = {
  mesaSelecionada: null,
  pedidoId: null,
  totalConta: 0,
  totalRevelado: false
};

// ── Relógio ────────────────────────────────────────────────
function atualizarRelogio() {
  document.getElementById('relogio').textContent =
    new Date().toLocaleTimeString('pt-BR');
}
setInterval(atualizarRelogio, 1000);
atualizarRelogio();

// ── Utilitários ────────────────────────────────────────────
function fmtBRL(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ICONS = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };

function toast(msg, tipo = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span class="material-symbols-outlined">${ICONS[tipo] || 'info'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ── Socket.IO ──────────────────────────────────────────────
let socket;

function conectarSocket() {
  try {
    const socketOpts = {
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      auth: { token: window.sigaAuth?.getToken() || '' }
    };
    socket = io(window.location.origin, socketOpts);

    socket.on('connect', () => {
      const badge = document.getElementById('badge-conexao');
      badge.textContent = 'Online';
      badge.className = 'badge-conexao online';
      const nomeUsuario = window.sigaAuth?.getUsuarioNome() || 'Caixa';
      socket.emit('entrar_sala', { sala: 'caixa', nome: nomeUsuario });
    });

    socket.on('disconnect', () => {
      const badge = document.getElementById('badge-conexao');
      badge.textContent = 'Offline';
      badge.className = 'badge-conexao offline';
    });

    socket.on('conta_solicitada', (data) => {
      const num = data.mesa || data.numero_mesa || data.mesa_numero || '?';
      exibirBanner(`Mesa ${num} solicitou a conta!`);
      toast(`Mesa ${num} pedindo a conta`, 'warning');
      carregarMesas();
    });

    socket.on('novo_pedido', () => carregarMesas());
    socket.on('pedido_atualizado', () => carregarMesas());

  } catch (e) {
    console.error('Socket.IO não disponível:', e);
  }
}

// ── Banner ─────────────────────────────────────────────────
function exibirBanner(texto) {
  const b = document.getElementById('banner-conta');
  document.getElementById('banner-texto').textContent = texto;
  b.classList.add('show');
}

function fecharBanner() {
  document.getElementById('banner-conta').classList.remove('show');
}

// ── Mesas ──────────────────────────────────────────────────
async function carregarMesas() {
  try {
    const res = await window.sigaAuth.apiFetch('/api/caixa/mesas-abertas');
    if (!res.ok) throw new Error(res.statusText);
    const mesas = await res.json();
    renderizarMesas(Array.isArray(mesas) ? mesas : []);
  } catch (e) {
    toast('Erro ao carregar mesas', 'error');
    console.error(e);
  }
}

function renderizarMesas(mesas) {
  const grid = document.getElementById('mesas-grid');
  if (!mesas.length) {
    grid.innerHTML = '<div class="mesa-vazia">Nenhuma mesa aberta no momento.</div>';
    return;
  }
  grid.innerHTML = mesas.map(m => {
    const pedidoId  = m.pedido_id;
    const numero    = m.mesa_numero;
    const garcom    = m.garcom || m.nome_garcom || 'N/D';
    const total     = m.total || 0;
    const contaReq  = m.conta_solicitada;
    const extraClass = state.pedidoId === pedidoId ? ' selecionada' : contaReq ? ' conta-solicitada' : '';
    const statusLabel = contaReq
      ? '<span class="mesa-status conta-req">Conta pedida</span>'
      : '<span class="mesa-status aberta">Aberta</span>';

    return `
      <div class="mesa-card${extraClass}" onclick="selecionarMesa(${pedidoId}, ${numero})">
        <div class="mesa-numero">Mesa ${numero}</div>
        ${statusLabel}
        <div class="mesa-garcom">
          <span class="material-symbols-outlined" style="font-size:15px;">person</span>
          ${garcom}
        </div>
        <div class="mesa-info">
          <span class="mesa-total">${fmtBRL(total)}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Conta da Mesa ──────────────────────────────────────────
async function selecionarMesa(pedidoId, numero) {
  state.pedidoId = pedidoId;
  state.mesaSelecionada = numero;
  state.totalRevelado = false;

  document.getElementById('conta-mesa-badge').textContent = `Mesa ${numero}`;
  document.getElementById('total-valor').classList.remove('revelado');
  document.getElementById('btn-revelar').style.display = 'flex';
  document.getElementById('btn-pagar').disabled = true;
  document.getElementById('resultado-box').classList.remove('show');

  // Highlight visual
  document.querySelectorAll('.mesa-card').forEach(el => el.classList.remove('selecionada'));
  event.currentTarget && event.currentTarget.classList.add('selecionada');

  await carregarConta(pedidoId);
}

async function carregarConta(pedidoId) {
  try {
    const res = await window.sigaAuth.apiFetch(`/api/caixa/pedidos/${pedidoId}/conta`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();

    state.totalConta = data.resumo?.total_valor ?? data.total ?? 0;
    document.getElementById('total-valor').textContent = fmtBRL(state.totalConta);
    document.getElementById('btn-pagar').disabled = false;

    const itens = data.itens || [];
    const lista = document.getElementById('itens-lista');
    if (!itens.length) {
      lista.innerHTML = '<li class="sem-mesa">Nenhum item lançado nesta mesa.</li>';
      return;
    }
    lista.innerHTML = itens.map(i => `
      <li class="item-conta">
        <span class="item-qtd">${i.quantidade}x</span>
        <span style="flex:1">${i.produto_nome}</span>
        <span class="item-preco">${fmtBRL(i.preco_unitario * i.quantidade)}</span>
      </li>`).join('');
  } catch (e) {
    toast('Erro ao carregar conta', 'error');
    console.error(e);
  }
}

// ── Revelação e Cálculo ────────────────────────────────────
function revelarTotal() {
  state.totalRevelado = true;
  document.getElementById('total-valor').classList.add('revelado');
  document.getElementById('btn-revelar').style.display = 'none';
  calcularResultado();
}

function calcularResultado() {
  const rec = parseFloat(document.getElementById('valor-recebido').value) || 0;
  const box = document.getElementById('resultado-box');

  if (rec > 0) {
    box.classList.add('show');
    document.getElementById('res-recebido').textContent = fmtBRL(rec);
    const troco = rec - state.totalConta;
    document.getElementById('res-troco').textContent = fmtBRL(troco > 0 ? troco : 0);
  } else {
    box.classList.remove('show');
  }
}

// ── Pagamento ──────────────────────────────────────────────
async function efetuarPagamento() {
  if (!state.pedidoId) { toast('Selecione uma mesa', 'warning'); return; }

  const btn = document.getElementById('btn-pagar');
  const span = document.getElementById('btn-pagar-texto');
  btn.disabled = true;
  span.textContent = 'Processando...';

  try {
    const res = await window.sigaAuth.apiFetch('/api/caixa/pagamento', {
      method: 'POST',
      body: JSON.stringify({
        pedido_id: state.pedidoId,
        metodo: document.getElementById('metodo-pagamento').value,
        valor_recebido: parseFloat(document.getElementById('valor-recebido').value) || state.totalConta,
        numero_pessoas: parseInt(document.getElementById('numero-pessoas').value) || 1
      })
    });

    const data = await res.json();
    if (res.ok) {
      toast('Pagamento realizado com sucesso!', 'success');
      setTimeout(() => location.reload(), 1500);
    } else {
      throw new Error(data.erro || data.message || 'Erro desconhecido');
    }
  } catch (e) {
    toast(`Erro no pagamento: ${e.message}`, 'error');
    btn.disabled = false;
    span.textContent = 'Efetuar Pagamento';
  }
}

// ── Histórico ──────────────────────────────────────────────
async function carregarHistorico() {
  const container = document.getElementById('historico-container');
  container.innerHTML = '<div class="mesa-vazia">Carregando...</div>';
  try {
    const res = await window.sigaAuth.apiFetch('/api/caixa/historico');
    if (!res.ok) throw new Error(res.statusText);
    
    const data = await res.json();
    // Essa é a linha mágica igual a que você fez no Admin!
    const lista = Array.isArray(data) ? data : (data.pagamentos || data.vendas || []);
    
    renderizarHistorico(lista);
  } catch (e) {
    container.innerHTML = '<div class="mesa-vazia">Erro ao carregar histórico.</div>';
  }
}

const COR_METODO = {
  dinheiro: { bg: '#d4edda', color: '#155724' },
  cartao_credito: { bg: '#cce5ff', color: '#004085' },
  cartao_debito:  { bg: '#d1ecf1', color: '#0c5460' },
  pix:     { bg: '#fff3cd', color: '#856404' },
  voucher: { bg: '#e2d9f3', color: '#6f42c1' }
};

function renderizarHistorico(lista) {
  const container = document.getElementById('historico-container');
  if (!lista.length) {
    container.innerHTML = '<div class="mesa-vazia">Nenhum pagamento registrado hoje.</div>';
    return;
  }
  const rows = lista.map(p => {
    const metodo = p.metodo_pagamento || p.metodo || 'N/D';
    const valor = p.total_valor || p.valor_total || p.total || 0;
    const hora = p.fechado_em || p.criado_em || p.created_at;
    const garcom = p.garcom || p.nome_garcom || p.caixa_nome || 'N/D';
    const mesa = p.mesa_numero || p.numero_mesa || p.mesa || '?';
    const cor = COR_METODO[metodo] || { bg: '#eee', color: '#333' };
    return `
      <tr>
        <td>Mesa ${mesa}</td>
        <td>${fmtBRL(valor)}</td>
        <td>
          <span class="tag-metodo" style="background:${cor.bg}; color:${cor.color}">
            ${metodo}
          </span>
        </td>
        <td>${garcom}</td>
        <td>${hora ? new Date(hora).toLocaleTimeString('pt-BR') : '—'}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="historico-table">
      <thead><tr>
        <th>Mesa</th><th>Total</th><th>Método</th><th>Garçom</th><th>Hora</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Init ───────────────────────────────────────────────────
if (!window.sigaAuth.isLoggedIn()) {
  window.sigaAuth.logout();
}
conectarSocket();
carregarMesas();
carregarHistorico();
