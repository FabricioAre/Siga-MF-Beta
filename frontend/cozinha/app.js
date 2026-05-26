'use strict';
// ══════════════════════════════════════════════════════════════
//  SIGA-MF | KDS Cozinha — app.js
//  Schema: siga_mf | Status: pendente → em_producao → pronto
// ══════════════════════════════════════════════════════════════

const API = window.location.origin;
const $   = id => document.getElementById(id);

// ── Estado ─────────────────────────────────────────────────────
let pedidosMap      = new Map();
let filtroAtual     = 'all';
let soundOn         = true;
let confirmCallback = null;

// ── Relógio ────────────────────────────────────────────────────
function tickClock() {
  $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
}
tickClock();
setInterval(tickClock, 1000);

// ── Som (Web Audio API) ────────────────────────────────────────
$('btnSom').addEventListener('click', () => {
  soundOn = !soundOn;
  $('btnSom').innerHTML = soundOn ? '<span class="material-symbols-outlined">notifications</span>' : '<span class="material-symbols-outlined">notifications_off</span>';
  $('btnSom').classList.toggle('muted', !soundOn);
});

function beep(tipo) {
  if (!soundOn) return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    switch (tipo) {
      case 'novo':
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + .12);
        osc.frequency.setValueAtTime(1320, ctx.currentTime + .36);
        gain.gain.setValueAtTime(.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .55);
        osc.start(); osc.stop(ctx.currentTime + .55);
        break;
      case 'pronto':
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + .1);
        gain.gain.setValueAtTime(.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .35);
        osc.start(); osc.stop(ctx.currentTime + .35);
        break;
      case 'urgente':
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.setValueAtTime(220, ctx.currentTime + .1);
        gain.gain.setValueAtTime(.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .22);
        osc.start(); osc.stop(ctx.currentTime + .22);
        break;
      default:
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .28);
        osc.start(); osc.stop(ctx.currentTime + .28);
    }
  } catch { /* autoplay bloqueado */ }
}

// ── Toast ──────────────────────────────────────────────────────
function toast(msg, tipo = '', icon = 'info') {
  const box = $('toastsEl');
  const el  = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.innerHTML = `<span class="material-symbols-outlined">${icon}</span> <span>${msg}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4000);
}

// ── Stats ──────────────────────────────────────────────────────
function atualizarStats() {
  let pendente = 0, emPreparo = 0;
  pedidosMap.forEach(({ dados }) => {
    dados.itens?.forEach(i => {
      if (i.status === 'pendente')     pendente++;
      if (i.status === 'em_producao') emPreparo++;
    });
  });
  $('statPendente').textContent  = `${pendente} pendente(s)`;
  $('statEmPreparo').textContent = `${emPreparo} em preparo`;
}

// ── Banner alerta ──────────────────────────────────────────────
function mostrarBanner(texto) {
  $('bannerTexto').textContent = texto;
  $('bannerAlerta').classList.add('show');
  setTimeout(() => $('bannerAlerta').classList.remove('show'), 8000);
}
$('bannerClose').addEventListener('click', () => $('bannerAlerta').classList.remove('show'));

// ── Temporizador por card ──────────────────────────────────────
setInterval(() => {
  pedidosMap.forEach(({ startMs }, pedidoId) => {
    const el = document.querySelector(`[data-pedido="${pedidoId}"] .card-timer`);
    if (!el) return;
    
    let seg = Math.floor((Date.now() - startMs) / 1000);
    
    // Se a hora do banco vier bagunçada (negativa), 
    // forçamos o início da contagem a partir do momento em que a tela abriu.
    if (seg < 0) {
        pedidosMap.get(pedidoId).startMs = Date.now();
        seg = 0;
    }

    const mm  = String(Math.floor(seg / 60)).padStart(2, '0');
    const ss  = String(seg % 60).padStart(2, '0');
    el.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px;">timer</span> ${mm}:${ss}`;

    const card = document.querySelector(`[data-pedido="${pedidoId}"]`);
    if (!card) return;
    if (seg >= 1200) { // 20min — urgente
      el.classList.add('urgente'); el.classList.remove('alerta');
      card.classList.add('kds-card--urgente'); card.classList.remove('kds-card--alerta');
      if (seg % 60 < 2) { beep('urgente'); mostrarBanner(`Mesa ${card.querySelector('.mesa-titulo em')?.textContent} — Pedido URGENTE!`); }
    } else if (seg >= 600) { // 10min — alerta
      el.classList.add('alerta'); el.classList.remove('urgente');
      card.classList.add('kds-card--alerta'); card.classList.remove('kds-card--urgente');
    }

    // Barra de progresso (0→20min)
    const bar = document.querySelector(`[data-pedido="${pedidoId}"] .progress-bar`);
    if (bar) {
      const pct = Math.min((seg / 1200) * 100, 100);
      const cor  = seg >= 1200 ? 'var(--vermelho)' : seg >= 600 ? 'var(--amarelo)' : 'var(--verde)';
      bar.style.width     = `${pct}%`;
      bar.style.background = cor;
    }
  });
}, 1000);

// ════════════════════════════════════════════════════════════
//  CARREGAR PEDIDOS
// ════════════════════════════════════════════════════════════
async function carregarPedidos() {
  const btn = $('btnRefresh');
  btn.classList.add('spin');
  try {
    const res  = await window.sigaAuth.apiFetch(`${API}/api/cozinha/pedidos`);
    const data = await res.json();
    const lista = Array.isArray(data) ? data : (data.pedidos || []);

    pedidosMap.clear();
    lista.forEach(p => {
      const pId = p.pedido_id || p.id;
      
      // Tratamento para fuso horário do MySQL (força UTC para evitar timer negativo)
      let criadoMs = Date.now();
      if (p.criado_em) {
          let dataString = p.criado_em;
          if (typeof dataString === 'string') {
              // Troca espaço por 'T' e adiciona 'Z' para o JS entender que é UTC
              if (!dataString.includes('T')) dataString = dataString.replace(' ', 'T');
              if (!dataString.endsWith('Z')) dataString += 'Z';
          }
          criadoMs = new Date(dataString).getTime();
      }
      
      pedidosMap.set(pId, { dados: p, startMs: criadoMs });
    });
    renderizarKDS(lista);
    atualizarStats();
  } catch (e) {
    toast('Erro ao carregar pedidos', 'vermelho', 'error');
    console.error(e);
  } finally {
    btn.classList.remove('spin');
  }
}

// ════════════════════════════════════════════════════════════
//  RENDERIZAR KDS
// ════════════════════════════════════════════════════════════
function renderizarKDS(lista) {
  const grid = $('kdsGrid');

  // Filtragem
  let filtrada = lista;
  if (filtroAtual === 'pendente')     filtrada = lista.filter(p => p.itens?.some(i => i.status === 'pendente'));
  if (filtroAtual === 'em_producao') filtrada = lista.filter(p => p.itens?.some(i => i.status === 'em_producao'));
  if (filtroAtual === 'pizzaria')    filtrada = lista.filter(p => p.fluxo === 'pizzaria');
  if (filtroAtual === 'restaurante') filtrada = lista.filter(p => p.fluxo === 'restaurante');

  if (!filtrada.length) {
    grid.innerHTML = `
      <div class="empty-kds">
        <span class="material-symbols-outlined empty-kds__icon">check_circle</span>
        <h2>Cozinha em dia!</h2>
        <p>Nenhum pedido ${filtroAtual === 'all' ? 'pendente' : 'nesta categoria'}.</p>
      </div>`;
    return;
  }

  // Remove a mensagem de "Cozinha em dia" se ela estiver na tela
  const emptyMsg = grid.querySelector('.empty-kds');
  if (emptyMsg) {
    emptyMsg.remove();
  }

  // Preserva cards existentes e só adiciona novos
  const existentes = new Set([...grid.querySelectorAll('[data-pedido]')].map(el => el.dataset.pedido));

  filtrada.forEach(p => {
    const pId = p.pedido_id || p.id;
    if (existentes.has(String(pId))) {
      atualizarCardExistente(p);
    } else {
      grid.appendChild(criarCard(p));
    }
  });

  // Remove cards de pedidos que saíram do filtro
  grid.querySelectorAll('[data-pedido]').forEach(el => {
    if (!filtrada.find(p => String(p.pedido_id || p.id) === el.dataset.pedido)) {
      el.classList.add('kds-card--saindo');
      setTimeout(() => el.remove(), 500);
    }
  });
}

function criarCard(pedido) {
  const card = document.createElement('div');
  card.className = 'kds-card kds-card--normal';
  const pId = pedido.pedido_id || pedido.id;
  card.dataset.pedido = pId;
  card.innerHTML = buildCardHTML(pedido, pId);
  bindCardEvents(card, pedido, pId);
  return card;
}

function atualizarCardExistente(pedido) {
  const pId = pedido.pedido_id || pedido.id;
  const card = document.querySelector(`[data-pedido="${pId}"]`);
  if (!card) return;
  const body = card.querySelector('.kds-card__body');
  if (body) body.innerHTML = buildItensHTML(pedido.itens || [], pId);
  bindCardEvents(card, pedido, pId);
}

function buildCardHTML(pedido, pId) {
  const fluxo = pedido.fluxo || 'restaurante';
  const iconFluxo = fluxo === 'pizzaria' ? 'local_pizza' : 'restaurant';
  const nomeFluxo = fluxo === 'pizzaria' ? 'Pizzaria' : 'Restaurante';
  const criadoMs = pedido.criado_em ? new Date(pedido.criado_em).getTime() : Date.now();

  return `
    <div class="kds-card__header">
      <div class="fluxo-stripe fluxo-stripe--${fluxo}"></div>
      <div class="kds-card__header-body">
        <div class="kds-card__mesa">
          <div class="mesa-titulo">Mesa <em>${pedido.mesa_numero || pedido.mesa}</em></div>
          <div class="mesa-sub">#${pId} · ${new Date(criadoMs).toLocaleTimeString('pt-BR')}</div>
        </div>
        <div class="kds-card__meta">
          <div class="card-timer" data-start="${criadoMs}"><span class="material-symbols-outlined" style="font-size:16px;">timer</span> 00:00</div>
          <div class="progress-wrap"><div class="progress-bar" style="width:0%;background:var(--verde)"></div></div>
          <span class="garcom-badge" style="display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:14px;">person</span> ${pedido.garcom || 'Garçom'}</span>
          <span class="fluxo-badge fluxo-badge--${fluxo}" style="display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:14px;">${iconFluxo}</span> ${nomeFluxo}</span>
        </div>
      </div>
    </div>
    <div class="kds-card__body">${buildItensHTML(pedido.itens || [], pId)}</div>
    <div class="kds-card__footer">
      <span class="item-count">${(pedido.itens || []).length} item(s)</span>
      <button class="btn-tudo-pronto" data-pedido="${pId}" style="display:flex;align-items:center;justify-content:center;gap:6px;">
        <span class="material-symbols-outlined" style="font-size:18px;">done_all</span> Tudo Pronto
      </button>
    </div>`;
}

function buildItensHTML(itens, pId) {
  return itens.map(item => {
    const isPronto    = item.status === 'pronto' || item.status === 'entregue';
    const isProducao  = item.status === 'em_producao';
    const extraClass  = isPronto ? 'kds-item--done' : isProducao ? 'kds-item--em_producao' : '';
    const dotClass    = `status-dot--${item.status || 'pendente'}`;

    // Proteção para pegar o ID correto do item
    const iId = item.item_id || item.id;
    const currentPId = item.pedido_id || pId;

    return `
      <div class="kds-item ${extraClass}" data-item="${iId}">
        <div class="kds-item__row">
          <div class="kds-item__qty">${item.quantidade}</div>
          <div class="kds-item__nome">${item.produto_nome || item.nome}</div>
          <span class="status-dot ${dotClass}"></span>
        </div>
        ${item.sabor_2_nome ? `<div class="kds-item__meio">½+½ ${item.produto_nome} | ${item.sabor_2_nome}</div>` : ''}
        ${item.observacao ? `<div class="kds-item__obs"><span class="material-symbols-outlined" style="font-size:14px;">chat</span> ${item.observacao}</div>` : ''}
        <div class="kds-item__actions">
          ${!isProducao && !isPronto ? `<button class="btn-iniciar" data-item="${iId}" data-pedido="${currentPId}" style="display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:16px;">local_fire_department</span> Iniciar</button>` : ''}
          ${isPronto
            ? `<div class="pronto-label"><span class="material-symbols-outlined" style="font-size:16px;">check_circle</span> Pronto</div>`
            : `<button class="btn-pronto" data-item="${iId}" data-pedido="${currentPId}" ${!isProducao ? 'disabled' : ''} style="display:flex;align-items:center;gap:4px;"><span class="material-symbols-outlined" style="font-size:16px;">check_circle</span> Pronto</button>`}
        </div>
      </div>`;
  }).join('');
}

function bindCardEvents(card, pedido, pId) {
  card.querySelectorAll('.btn-iniciar').forEach(btn => {
    btn.addEventListener('click', () => atualizarItemStatus(btn.dataset.item, btn.dataset.pedido, 'em_producao'));
  });
  card.querySelectorAll('.btn-pronto').forEach(btn => {
    btn.addEventListener('click', () => atualizarItemStatus(btn.dataset.item, btn.dataset.pedido, 'pronto'));
  });
  const btnTudo = card.querySelector('.btn-tudo-pronto');
  if (btnTudo) {
    btnTudo.addEventListener('click', () => {
      confirmCallback = () => marcarTudoPronto(pId, pedido.mesa_numero || pedido.mesa);
      $('confirmMsg').textContent = `Todos os itens da Mesa ${pedido.mesa_numero || pedido.mesa} serão marcados como prontos e o garçom será notificado.`;
      $('confirmOverlay').classList.add('open');
    });
  }
}

// ── Atualizar status de item ────────────────────────────────────
async function atualizarItemStatus(itemId, pedidoId, novoStatus) {
  try {
    const response = await window.sigaAuth.apiFetch(`${API}/api/cozinha/itens/${itemId}/status`, {
      method : 'PUT',
      body   : JSON.stringify({ status: novoStatus }),
    });
    
    if (!response.ok) {
        throw new Error('Falha na API');
    }

    beep(novoStatus === 'pronto' ? 'pronto' : 'preparo');
    await carregarPedidos();
  } catch (e) {
    toast('Erro ao atualizar status', 'vermelho', 'error');
  }
}

// ── Marcar tudo pronto ─────────────────────────────────────────
async function marcarTudoPronto(pedidoId, mesaNum) {
  try {
    await window.sigaAuth.apiFetch(`${API}/api/cozinha/pedidos/${pedidoId}/pronto`, {
      method : 'PUT',
    });

    if (socket?.connected) {
      socket.emit('item_pronto', { pedido_id: pedidoId, mesa_numero: mesaNum, todos_prontos: true });
    }

    beep('pronto');
    toast(`Mesa ${mesaNum} — Tudo pronto!`, 'verde', 'check_circle');

    const card = document.querySelector(`[data-pedido="${pedidoId}"]`);
    if (card) {
      card.classList.add('kds-card--saindo');
      setTimeout(() => { card.remove(); pedidosMap.delete(pedidoId); atualizarStats(); }, 500);
    }
  } catch (e) {
    toast('Erro ao marcar como pronto', 'vermelho', 'error');
  }
}

// ── Modal confirmação ──────────────────────────────────────────
$('btnConfirmOk').addEventListener('click', () => {
  $('confirmOverlay').classList.remove('open');
  if (confirmCallback) { confirmCallback(); confirmCallback = null; }
});
$('btnConfirmCancel').addEventListener('click', () => {
  $('confirmOverlay').classList.remove('open');
  confirmCallback = null;
});
$('confirmOverlay').addEventListener('click', e => {
  if (e.target === $('confirmOverlay')) {
    $('confirmOverlay').classList.remove('open');
    confirmCallback = null;
  }
});

// ── Filtros ────────────────────────────────────────────────────
document.querySelector('.toolbar').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filtroAtual = btn.dataset.filter || 'all';
  const todos = [...pedidosMap.values()].map(v => v.dados);
  renderizarKDS(todos);
});

$('btnRefresh').addEventListener('click', carregarPedidos);

// ════════════════════════════════════════════════════════════
//  SOCKET.IO
// ════════════════════════════════════════════════════════════
let socket;
try {
  const socketOpts = {
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    auth: { token: window.sigaAuth?.getToken() || '' }
  };
  socket = io(API, socketOpts);

  socket.on('connect', () => {
    $('connDot').classList.add('on');
    $('connLabel').textContent = 'Online';
    const nomeUsuario = window.sigaAuth?.getUsuarioNome() || 'Cozinheiro';
    socket.emit('entrar_sala', { sala: 'cozinha', nome: nomeUsuario });
  });

  socket.on('disconnect', () => {
    $('connDot').classList.remove('on');
    $('connLabel').textContent = 'Offline';
  });

  // Novo pedido chega na cozinha
  socket.on('novo_pedido', (data) => {
    beep('novo');
    toast(`Novo pedido — Mesa ${data.mesa_numero || data.mesa}`, 'laranja', 'notifications_active');
    carregarPedidos();
  });

  // Itens enviados pelo garçom
  socket.on('itens_enviados', (data) => {
    beep('novo');
    toast(`Mesa ${data.mesa_numero} — ${data.produtos?.length || ''} item(s)`, 'laranja', 'add_shopping_cart');
    carregarPedidos();
  });

  // Pedido atualizado externamente
  socket.on('pedido_atualizado', () => carregarPedidos());

  // Alerta de estoque
  socket.on('alerta_estoque', ({ nome, estoque_atual, unidade }) => {
    mostrarBanner(`Estoque crítico: ${nome} — ${estoque_atual}${unidade}`);
    toast(`Estoque baixo: ${nome}`, 'vermelho', 'warning');
  });

  // Pong heartbeat
  socket.on('pong_kds', () => {});

} catch (e) {
  console.warn('[Socket] Não disponível:', e.message);
}

// ── Polling de fallback ────────────────────────────────────────
setInterval(carregarPedidos, 30000);

// ── Init ───────────────────────────────────────────────────────
if (!window.sigaAuth.isLoggedIn()) {
  window.sigaAuth.logout();
}
carregarPedidos();