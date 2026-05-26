'use strict';
// ══════════════════════════════════════════════════════════
//  SIGA-MF | Garçom — app.js
//  Implementa: RN01 · RN02 · RN03 · Socket.IO
// ══════════════════════════════════════════════════════════

const API = window.location.origin;

// ── Estado global ──────────────────────────────────────────
const State = {
  mesa         : null,
  fluxo        : null,
  pedido       : null,
  carrinho     : [],
  produtoAtual : null,
  quantidade   : 1,
  obsAtivas    : new Set(),
  todosProd    : [],
  pizzasCache  : [],
};

// ── Helpers DOM ────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

const views = { mesa: $('viewMesa'), cardapio: $('viewCardapio') };

function showView(name) {
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[name].classList.add('active');
}

function setStep(n) {
  [1,2,3,4].forEach(i => {
    const el = $(`step${i}`);
    el.classList.toggle('active', i === n);
    el.classList.toggle('done',   i < n);
  });
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, tipo = '') {
  const box = $('toastsBox');
  const el  = document.createElement('div');
  el.className = `toast toast--${tipo}`;
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3500);
}

// ── Formatação ─────────────────────────────────────────────
function fmt(v) {
  return 'R$ ' + parseFloat(v || 0).toFixed(2).replace('.', ',');
}

const MI = (icon, size = 18) => `<span class="material-symbols-outlined" style="font-size:${size}px;">${icon}</span>`;

const CAT_ICON = {
  'Pizzas Tradicionais'    : 'local_pizza',
  'Pizzas Especiais'       : 'local_pizza',
  'Pizzas Doces'           : 'cake',
  'Entradas'               : 'set_meal',
  'Pratos Executivos'      : 'restaurant',
  'Massas'                 : 'ramen_dining',
  'Grelhados'              : 'outdoor_grill',
  'Saladas'                : 'eco',
  'Sobremesas'             : 'icecream',
  'Bebidas Nao Alcoolicas' : 'local_cafe',
  'Bebidas Alcoolicas'     : 'sports_bar',
  'Porcoes'                : 'tapas',
};

// Observações rápidas por tipo de produto
const OBS_POR_TIPO = {
  pizza: ['Sem cebola', 'Extra queijo', 'Borda recheada', 'Sem azeitona', 'Bem assada', 'Molho extra'],
  carne: ['Bem passado', 'Mal passado', 'Ao ponto', 'Sem cebola', 'Sem alho', 'Molho à parte', 'Extra queijo'],
  massa: ['Sem cebola', 'Sem alho', 'Molho à parte', 'Extra queijo', 'Al dente', 'Sem pimenta'],
  salada: ['Sem cebola', 'Molho à parte', 'Sem croutons', 'Sem queijo', 'Extra limão'],
  bebida: ['Com gelo', 'Sem gelo', 'Com limão', 'Bem gelado', 'No copo', 'Com canudo'],
  sobremesa: ['Sem cobertura', 'Extra calda', 'Com chantilly', 'Sem açúcar'],
  padrao: ['Sem cebola', 'Sem alho', 'Sem pimenta', 'Extra queijo', 'Molho à parte'],
};

function getObsParaCategoria(categoria) {
  if (!categoria) return OBS_POR_TIPO.padrao;
  const cat = categoria.toLowerCase();
  if (cat.includes('pizza'))    return OBS_POR_TIPO.pizza;
  if (cat.includes('grelhado') || cat.includes('executivo')) return OBS_POR_TIPO.carne;
  if (cat.includes('massa'))    return OBS_POR_TIPO.massa;
  if (cat.includes('salada'))   return OBS_POR_TIPO.salada;
  if (cat.includes('bebida'))   return OBS_POR_TIPO.bebida;
  if (cat.includes('sobremesa') || cat.includes('doce')) return OBS_POR_TIPO.sobremesa;
  if (cat.includes('porco') || cat.includes('entrada')) return OBS_POR_TIPO.padrao;
  return OBS_POR_TIPO.padrao;
}
const getIcon = cat => CAT_ICON[cat] || 'restaurant';
const getIconHTML = cat => MI(getIcon(cat), 22);

// ════════════════════════════════════════════════════════
//  VIEW 1 — MESAS
// ════════════════════════════════════════════════════════
let mesasCache = [];

async function carregarMesas() {
  const grid = $('mesasGrid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    const res  = await window.sigaAuth.apiFetch(`${API}/api/mesas`);
    if (!res.ok) throw new Error('Erro na API');
    mesasCache = await res.json();
    renderMesas(mesasCache);
  } catch (err) {
    console.error('Erro ao carregar mesas:', err);
    grid.innerHTML = `<div class="empty"><p>Erro de conexão. Verifique o console (F12).</p></div>`;
  }
}

function renderMesas(lista) {
  const q = $('searchMesa').value.trim().toLowerCase();
  const filtrada = q
    ? lista.filter(m => String(m.numero).includes(q) || (m.localizacao||'').toLowerCase().includes(q))
    : lista;

  const grid = $('mesasGrid');
  grid.innerHTML = '';

  if (!filtrada.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty__icon">${MI('search_off', 36)}</div><p>Mesa não encontrada.</p></div>`;
    return;
  }

  filtrada.forEach(m => {
    const statusIcon  = { livre: MI('circle', 14), ocupada: MI('circle', 14), aguardando_conta: MI('circle', 14), em_limpeza: MI('circle', 14) }[m.status] || MI('circle', 14);
    const statusLabel = { livre:'Livre', ocupada:'Ocupada', aguardando_conta:'Aguardando', em_limpeza:'Limpeza' }[m.status] || m.status;
    const card = document.createElement('div');
    card.className = `mesa-card mesa-card--${m.status}`;
    card.innerHTML = `
      <span class="mesa-icon">${statusIcon}</span>
      <span class="mesa-num">${m.numero}</span>
      <span class="mesa-cap">${MI('person', 14)} ${m.capacidade}</span>
      <span class="mesa-pill pill-${m.status}">${statusLabel}</span>
      ${m.pedido_total ? `<span class="mesa-valor">${fmt(m.pedido_total)}</span>` : ''}
    `;
    if (m.status === 'em_limpeza') {
      card.style.pointerEvents = 'none';
    } else {
      card.addEventListener('click', () => abrirModalFluxo(m));
    }
    grid.appendChild(card);
  });
}

$('searchMesa').addEventListener('input', e => {
  $('clearMesa').classList.toggle('show', !!e.target.value);
  renderMesas(mesasCache);
});
$('clearMesa').addEventListener('click', () => {
  $('searchMesa').value = '';
  $('clearMesa').classList.remove('show');
  renderMesas(mesasCache);
});

// ════════════════════════════════════════════════════════
//  MODAL DE FLUXO — RN01
// ════════════════════════════════════════════════════════
function abrirModalFluxo(mesa) {
  State.mesa   = mesa;
  State.pedido = mesa.pedido_id ? { id: mesa.pedido_id } : null;
  State.carrinho = [];
  atualizarFAB();

  $('modalMesaNum').textContent = `Mesa ${mesa.numero}`;
  $('modalMesaCap').innerHTML = `${MI('person', 16)} ${mesa.capacidade}`;
  $('modalMesaLoc').textContent = mesa.localizacao || '—';
  $('modalFluxo').classList.add('open');
}

function fecharModalFluxo() { $('modalFluxo').classList.remove('open'); }

async function selecionarFluxo(fluxo) {
  State.fluxo = fluxo;
  fecharModalFluxo();

  $('headerBadge').textContent   = `Mesa ${State.mesa.numero}`;
  $('headerBadge').classList.add('show');
  $('mesaLabel').textContent     = State.mesa.numero;
  $('drawerMesaNum').textContent = State.mesa.numero;
  $('fluxoBadgeNome').innerHTML = fluxo === 'restaurante' ? `${MI('restaurant', 16)} Restaurante` : `${MI('local_pizza', 16)} Pizzaria`;

  setStep(3);
  showView('cardapio');
  await carregarCardapio();
}

$('btnFluxoRestaurante').addEventListener('click', () => selecionarFluxo('restaurante'));
$('btnFluxoPizzaria').addEventListener('click',    () => selecionarFluxo('pizzaria'));
[$('btnFluxoRestaurante'), $('btnFluxoPizzaria')].forEach(el => {
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.click(); });
});
$('modalFluxo').addEventListener('click', e => { if (e.target === $('modalFluxo')) fecharModalFluxo(); });

// ════════════════════════════════════════════════════════
//  VIEW 2 — CARDÁPIO
// ════════════════════════════════════════════════════════
async function carregarCardapio(catFiltro = '') {
  $('cardapioGrid').innerHTML = '<div class="spinner"></div>';
  try {
    const url = new URL(`${API}/api/produtos`);
    if (State.fluxo) url.searchParams.set('fluxo', State.fluxo);
    if (catFiltro)   url.searchParams.set('categoria', catFiltro);

    const res       = await window.sigaAuth.apiFetch(url);
    State.todosProd = await res.json();
    State.pizzasCache = State.todosProd.filter(p => p.e_pizza);

    montarCategorias(State.todosProd);
    renderCardapio(State.todosProd);
  } catch {
    $('cardapioGrid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty__icon">${MI('wifi_off', 36)}</div><p>Erro ao carregar cardápio.</p></div>`;
    toast('Erro ao carregar cardápio', 'vermelho');
  }
}

function montarCategorias(prods) {
  const cats = [...new Set(prods.map(p => p.categoria))];
  const bar  = $('catsBar');
  bar.innerHTML = `<button class="cat-btn active" data-cat="">Todos</button>`;
  cats.forEach(c => {
    const btn = document.createElement('button');
    btn.className  = 'cat-btn';
    btn.dataset.cat = c;
    btn.innerHTML = `${MI(getIcon(c), 16)} ${c}`;
    bar.appendChild(btn);
  });
}

function renderCardapio(prods) {
  const q = $('searchProd').value.trim().toLowerCase();
  const lista = q
    ? prods.filter(p => p.nome.toLowerCase().includes(q) || (p.descricao||'').toLowerCase().includes(q))
    : prods;

  const grid = $('cardapioGrid');
  grid.innerHTML = '';

  if (!lista.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty__icon">${MI('restaurant', 36)}</div><p>Nenhum produto encontrado.</p></div>`;
    return;
  }

  lista.forEach(p => {
    const card = document.createElement('div');
    card.className = `produto-card${!p.disponivel ? ' produto-card--indisponivel' : ''}`;
    const icon = getIconHTML(p.categoria);
    card.innerHTML = `
      <div class="produto-thumb">${icon}</div>
      <div class="produto-body">
        <div class="produto-nome">${p.nome}</div>
        ${p.descricao ? `<div class="produto-desc">${p.descricao}</div>` : ''}
        <div class="produto-preco">${fmt(p.preco)}</div>
      </div>
      ${p.e_pizza ? `<span class="produto-badge">½+½</span>` : ''}
      ${!p.disponivel ? `<span class="produto-badge produto-badge--indisponivel">Indisponível</span>` : ''}
    `;
    if (p.disponivel) card.addEventListener('click', () => abrirPanel(p));
    grid.appendChild(card);
  });
}

$('searchProd').addEventListener('input', e => {
  $('clearProd').classList.toggle('show', !!e.target.value);
  renderCardapio(State.todosProd);
});
$('clearProd').addEventListener('click', () => {
  $('searchProd').value = '';
  $('clearProd').classList.remove('show');
  renderCardapio(State.todosProd);
});

$('catsBar').addEventListener('click', e => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  $$('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const cat   = btn.dataset.cat;
  const lista = cat ? State.todosProd.filter(p => p.categoria === cat) : State.todosProd;
  renderCardapio(lista);
});

$('btnVoltarMesa').addEventListener('click', () => {
  showView('mesa');
  setStep(1);
  $('headerBadge').classList.remove('show');
  carregarMesas();
});

// ════════════════════════════════════════════════════════
//  PANEL — DETALHES DO ITEM (RN02 / RN03)
// ════════════════════════════════════════════════════════
function abrirPanel(prod) {
  State.produtoAtual = prod;
  State.quantidade   = 1;
  State.obsAtivas.clear();

  $('panelBanner').innerHTML  = getIconHTML(prod.categoria);
  $('panelNome').textContent    = prod.nome;
  $('panelDesc').textContent    = prod.descricao || '';
  $('panelPreco').textContent   = fmt(prod.preco);
  $('panelRN03Hint').style.display = 'none';
  $('qtyVal').textContent       = 1;
  $('obsItem').value            = '';

  // Gera chips de observação contextuais por categoria (ou customizadas do produto)
  let obsLista;
  console.log('[DEBUG] Produto:', prod.nome, 'obs_rapidas:', prod.obs_rapidas);
  if (prod.obs_rapidas && prod.obs_rapidas.trim()) {
    obsLista = prod.obs_rapidas.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    obsLista = getObsParaCategoria(prod.categoria);
  }
  $('obsChips').innerHTML = obsLista.map(obs =>
    `<span class="obs-chip" data-obs="${obs}">${obs}</span>`
  ).join('');

  if (prod.e_pizza) {
    $('secaoPizza').classList.remove('hidden');
    $('tipoPizzaInteira').checked = true;
    $('secaoMeioMeio').classList.add('hidden');
    $('rn03Box').classList.remove('show');

    const options = State.pizzasCache
      .map(p => `<option value="${p.id}" data-preco="${p.preco}">${p.nome} — ${fmt(p.preco)}</option>`)
      .join('');
    $('sabor1').innerHTML = options;
    $('sabor2').innerHTML = options;

    Array.from($('sabor1').options).forEach((opt, i) => {
      if (opt.value == prod.id) $('sabor1').selectedIndex = i;
    });
    const outroIdx = State.pizzasCache.findIndex(p => p.id !== prod.id);
    if (outroIdx >= 0) $('sabor2').selectedIndex = outroIdx;
    calcularPrecoMeioMeio();
  } else {
    $('secaoPizza').classList.add('hidden');
  }

  $('panelOverlay').classList.add('open');
  setStep(4);
}

function fecharPanel() {
  $('panelOverlay').classList.remove('open');
  setStep(State.mesa ? 3 : 1);
}
$('panelOverlay').addEventListener('click', e => { if (e.target === $('panelOverlay')) fecharPanel(); });

$$('input[name="pizzaTipo"]').forEach(r => {
  r.addEventListener('change', () => {
    const isMeio = r.value === 'meio';
    $('secaoMeioMeio').classList.toggle('hidden', !isMeio);
    $('rn03Box').classList.toggle('show', isMeio);
    $('panelRN03Hint').style.display = isMeio ? 'block' : 'none';
    if (isMeio) calcularPrecoMeioMeio();
    else $('panelPreco').textContent = fmt(State.produtoAtual?.preco);
  });
});

['sabor1','sabor2'].forEach(id => $(id).addEventListener('change', calcularPrecoMeioMeio));

/** RN03 — cobra o MAIOR preço entre os dois sabores */
function calcularPrecoMeioMeio() {
  const opt1   = $('sabor1').selectedOptions[0];
  const opt2   = $('sabor2').selectedOptions[0];
  const preco1 = parseFloat(opt1?.dataset.preco || 0);
  const preco2 = parseFloat(opt2?.dataset.preco || 0);
  const maior  = Math.max(preco1, preco2);
  $('rn03Preco').textContent  = fmt(maior);
  $('panelPreco').textContent = fmt(maior);
}

$('btnMenos').addEventListener('click', () => {
  if (State.quantidade > 1) { State.quantidade--; $('qtyVal').textContent = State.quantidade; }
});
$('btnMais').addEventListener('click', () => {
  State.quantidade++;
  $('qtyVal').textContent = State.quantidade;
});

$('obsChips').addEventListener('click', e => {
  const chip = e.target.closest('.obs-chip');
  if (!chip) return;
  const obs = chip.dataset.obs;
  chip.classList.toggle('active');
  if (State.obsAtivas.has(obs)) State.obsAtivas.delete(obs);
  else State.obsAtivas.add(obs);
});

$('btnAdicionar').addEventListener('click', () => {
  const prod = State.produtoAtual;
  if (!prod) return;

  let sabor2 = null, precoUnit = parseFloat(prod.preco), obsNome = prod.nome;

  if (prod.e_pizza && $('tipoPizzaMeio').checked) {
    const opt1 = $('sabor1').selectedOptions[0];
    const opt2 = $('sabor2').selectedOptions[0];
    if (opt1?.value === opt2?.value) { toast('Selecione dois sabores diferentes para ½+½', 'laranja'); return; }
    const preco1 = parseFloat(opt1?.dataset.preco || 0);
    const preco2 = parseFloat(opt2?.dataset.preco || 0);
    precoUnit = Math.max(preco1, preco2); // RN03
    sabor2 = { id: parseInt(opt2.value), nome: opt2.text.split(' —')[0].trim(), preco: preco2 };
    obsNome = `½ ${opt1.text.split(' —')[0].trim()} | ½ ${sabor2.nome}`;
  }

  const obsChipsStr = [...State.obsAtivas].join(', ');
  const obsManual   = $('obsItem').value.trim();
  const obs         = [obsChipsStr, obsManual].filter(Boolean).join('; ');

  State.carrinho.push({ produto: prod, sabor2, quantidade: State.quantidade, preco_unitario: precoUnit, obs, nomeExibicao: obsNome });
  fecharPanel();
  atualizarFAB();
  toast(`${obsNome} adicionado!`, 'verde');
});

// ════════════════════════════════════════════════════════
//  FAB + DRAWER CARRINHO
// ════════════════════════════════════════════════════════
function atualizarFAB() {
  if (!State.carrinho.length) { $('cartFab').classList.remove('show'); return; }
  $('cartFab').classList.add('show');
  const total = calcTotal();
  const count = State.carrinho.reduce((s, i) => s + i.quantidade, 0);
  $('cartCount').textContent   = count;
  $('cartTotal').textContent   = fmt(total);
  $('drawerTotal').textContent = fmt(total);
}

function calcTotal() {
  return State.carrinho.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
}

$('btnAbrirDrawer').addEventListener('click', () => { renderDrawer(); $('drawerOverlay').classList.add('open'); });
function fecharDrawer() { $('drawerOverlay').classList.remove('open'); }
$('btnFecharDrawer').addEventListener('click', fecharDrawer);
$('drawerOverlay').addEventListener('click', e => { if (e.target === $('drawerOverlay')) fecharDrawer(); });

function renderDrawer() {
  const body = $('drawerBody');
  body.innerHTML = '';
  if (!State.carrinho.length) {
    body.innerHTML = `<div class="empty"><div class="empty__icon">${MI('shopping_cart', 36)}</div><p>Carrinho vazio.</p></div>`;
    return;
  }
  State.carrinho.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'drawer__item';
    div.innerHTML = `
      <span class="drawer__emoji">${getIconHTML(item.produto.categoria)}</span>
      <div class="drawer__info">
        <div class="drawer__nome">${item.quantidade}× ${item.nomeExibicao}</div>
        ${item.obs ? `<div class="drawer__obs">${MI('chat', 14)} ${item.obs}</div>` : ''}
      </div>
      <span class="drawer__sub">${fmt(item.preco_unitario * item.quantidade)}</span>
      <button class="drawer__del" data-idx="${idx}" title="Remover">${MI('delete', 18)}</button>
    `;
    body.appendChild(div);
  });
  body.querySelectorAll('.drawer__del').forEach(btn => {
    btn.addEventListener('click', () => {
      State.carrinho.splice(parseInt(btn.dataset.idx), 1);
      atualizarFAB();
      renderDrawer();
      if (!State.carrinho.length) fecharDrawer();
    });
  });
}

// ════════════════════════════════════════════════════════
//  ENVIAR PEDIDO
// ════════════════════════════════════════════════════════
$('btnEnviarCozinha').addEventListener('click', async () => {
  if (!State.mesa || !State.carrinho.length) return;
  const btn  = $('btnEnviarCozinha');
  btn.disabled = true;
  btn.innerHTML = `${MI('hourglass_empty', 18)} Enviando…`;

  try {
    if (!State.pedido) {
      const res = await window.sigaAuth.apiFetch(`${API}/api/pedidos`, {
        method : 'POST',
        body   : JSON.stringify({ mesa_id: State.mesa.id, usuario_id: parseInt(window.sigaAuth?.getUsuarioId()) || 1, fluxo: State.fluxo }),
      });
      if (!res.ok) throw new Error(await res.text());
      State.pedido = await res.json();
    }

    for (const item of State.carrinho) {
      const res = await window.sigaAuth.apiFetch(`${API}/api/pedidos/${State.pedido.id}/itens`, {
        method : 'POST',
        body   : JSON.stringify({
          produto_id     : item.produto.id,
          sabor_2_id     : item.sabor2?.id ?? null,
          quantidade     : item.quantidade,
          preco_unitario : item.preco_unitario,
          observacao     : item.obs || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    }

    if (socket?.connected) {
      socket.emit('itens_enviados', {
        pedido_id   : State.pedido.id,
        mesa_numero : State.mesa.numero,
        fluxo       : State.fluxo,
        garcom      : window.sigaAuth?.getUsuarioNome() || 'Garçom',
        produtos    : State.carrinho.map(i => ({
          nome          : i.nomeExibicao,
          quantidade    : i.quantidade,
          observacao    : i.obs,
          preco_unitario: i.preco_unitario,
        })),
      });
    }

    State.carrinho = [];
    atualizarFAB();
    fecharDrawer();
    $('notifDot').classList.add('show');
    toast('Pedido enviado para a cozinha!', 'verde');
    await carregarMesas();
  } catch (err) {
    console.error('[Garçom] Erro:', err);
    toast('Erro ao enviar pedido. Tente novamente.', 'vermelho');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${MI('skillet', 18)} Enviar para a Cozinha`;
  }
});

// ════════════════════════════════════════════════════════
//  SOCKET.IO
// ════════════════════════════════════════════════════════
let socket;
try {
  const socketOpts = {
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
    timeout: 10000,
    auth: { token: window.sigaAuth?.getToken() || '' }
  };
  socket = io(API, socketOpts);

  socket.on('connect', () => {
    const nomeUsuario = window.sigaAuth?.getUsuarioNome() || 'Garçom';
    socket.emit('entrar_sala', { sala: 'garcom', nome: nomeUsuario });
  });

  socket.on('item_pronto', ({ mesa_numero, todos_prontos }) => {
    mostrarNotifKDS(
      todos_prontos ? `Mesa ${mesa_numero} — Tudo Pronto!` : `Mesa ${mesa_numero} — Item Pronto`,
      todos_prontos ? 'Todos os itens prontos para servir.' : 'Um item está pronto para servir.'
    );
    $('notifDot').classList.add('show');
  });

  socket.on('mesa_liberada', ({ mesa_numero }) => {
    toast(`Mesa ${mesa_numero} liberada`, 'verde');
    carregarMesas();
  });

  socket.on('cardapio_atualizado', ({ nome, disponivel }) => {
    toast(disponivel ? `${nome} disponível` : `${nome} indisponível`, disponivel ? 'verde' : 'vermelho');
    if (State.fluxo) carregarCardapio();
  });

  socket.on('item_em_preparo', ({ mesa_numero }) => {
    if (State.mesa?.numero == mesa_numero)
      toast(`Cozinha iniciou preparo — Mesa ${mesa_numero}`, 'laranja');
  });

  setInterval(() => { if (socket.connected) socket.emit('ping_kds', { ts: Date.now() }); }, 30_000);
} catch (err) {
  console.warn('[Socket] Não disponível:', err.message);
}

function mostrarNotifKDS(titulo, corpo) {
  $('kdsNotifTitle').textContent = titulo;
  $('kdsNotifBody').textContent  = corpo;
  $('kdsNotif').classList.add('show');
  setTimeout(() => $('kdsNotif').classList.remove('show'), 7000);
}
$('kdsNotifClose').addEventListener('click', () => $('kdsNotif').classList.remove('show'));
$('btnNotif').addEventListener('click', () => $('notifDot').classList.remove('show'));

// ── Init ───────────────────────────────────────────────────
if (!window.sigaAuth.isLoggedIn()) {
  window.sigaAuth.logout();
}
carregarMesas();
setStep(1);
