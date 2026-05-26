'use strict';
// ══════════════════════════════════════════════════════════
//  SIGA-MF | Admin — app.js
// ══════════════════════════════════════════════════════════

const state = {
  insumos: [],
  produtos: [],
  historico: [],
  fichas: {},
  usuarios: [], // Adicionado estado de usuários
  kpiVendasTotal: 0,
  kpiVendasQtd: 0,
  unidadeMap: { 'g':1, 'kg':2, 'ml':3, 'L':4, 'un':5, 'cx':6, 'fd':7, 'pct':8 }
};

// ── Utilitários ────────────────────────────────────────────
function fmtBRL(v) { return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }

const MI = (icon, size = 18) => `<span class="material-symbols-outlined" style="font-size:${size}px;">${icon}</span>`;

function toast(msg, tipo = 'info', duracao = 4500) {
  const c = document.getElementById('toast-container');
  const icons = { success:'check_circle', error:'error', warning:'warning', info:'info' };
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span class="material-symbols-outlined">${icons[tipo]||'info'}</span><span style="flex:1">${msg}</span>`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = '0.3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 310);
  }, duracao);
}

async function apiFetch(url, opts = {}) {
  // 1. Pega o crachá digital que o login salvou
  const token = localStorage.getItem('siga_mf_token'); 

  // 2. Prepara os cabeçalhos enviando o token
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 3. Faz a requisição
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));

  // 4. Se o servidor disser que o token é inválido/expirou, manda de volta pro login!
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('siga_mf_token'); // limpa o crachá velho
    alert(data.erro || 'Sessão expirada ou acesso negado. Faça login novamente.');
    window.location.href = '../assets/login.html';
    throw new Error('Acesso negado');
  }

  if (!res.ok) throw new Error(data.message || data.error || data.erro || `HTTP ${res.status}`);
  return data;
}

// ── Sidebar / Mobile ────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}
window.toggleSidebar = toggleSidebar;
window.closeSidebar  = closeSidebar;

// ── Navegação (ATUALIZADA) ─────────────────────────────────
const pageTitles   = { dashboard:'Dashboard', estoque:'Estoque', fichas:'Fichas Técnicas', cardapio:'Cardápio', relatorios:'Relatórios', usuarios:'Usuários' };
const sectionLoaders = { dashboard: carregarDashboard, estoque: carregarInsumos, fichas: carregarFichas, cardapio: carregarCardapio, relatorios: carregarRelatorios, usuarios: carregarUsuarios };

function navegarPara(secao) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${secao}`).classList.add('active');
  document.querySelector(`.nav-item[data-section="${secao}"]`).classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[secao] || secao;
  closeSidebar();
  if (sectionLoaders[secao]) sectionLoaders[secao]();
}
window.navegarPara = navegarPara;

// ── Modais ─────────────────────────────────────────────────
function abrirModal(id) { document.getElementById(id).classList.add('show'); }
function fecharModal(id) { document.getElementById(id).classList.remove('show'); }
window.abrirModal  = abrirModal;
window.fecharModal = fecharModal;

function customConfirm(titulo, mensagem, isDelete = false) {
  return new Promise((resolve) => {
    document.getElementById('confirm-title-text').textContent = titulo;
    document.getElementById('confirm-message').textContent = mensagem;

    const iconSpan = document.getElementById('confirm-icon-span');
    if (isDelete) {
      iconSpan.textContent = 'warning';
      iconSpan.style.color = 'var(--rosa)'; 
    } else {
      iconSpan.textContent = 'done_all';
      iconSpan.style.color = '#2ecc71'; 
    }

    const btnOk = document.getElementById('confirm-btn-ok');
    const btnCancel = document.getElementById('confirm-btn-cancel');

    const newBtnOk = btnOk.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    btnOk.parentNode.replaceChild(newBtnOk, btnOk);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    abrirModal('modal-confirm');

    newBtnOk.addEventListener('click', () => {
      fecharModal('modal-confirm');
      resolve(true);
    });

    newBtnCancel.addEventListener('click', () => {
      fecharModal('modal-confirm');
      resolve(false);
    });
  });
}

// ── Socket.IO ──────────────────────────────────────────────
let socket;
function conectarSocket() {
  try {
    const socketOpts = {
      transports: ['websocket', 'polling'],
      auth: { token: window.sigaAuth?.getToken() || localStorage.getItem('siga_mf_token') || '' }
    };
    socket = io(window.location.origin, socketOpts);
    socket.on('connect', () => {
      const nomeUsuario = window.sigaAuth?.getUsuarioNome() || localStorage.getItem('siga_mf_usuario') || 'Admin';
      socket.emit('entrar_sala', { sala: 'admin', nome: nomeUsuario });
      document.getElementById('badge-conexao').textContent = '● Online';
      document.getElementById('badge-conexao').className = 'badge-conexao online';
    });
    socket.on('disconnect', () => {
      document.getElementById('badge-conexao').textContent = '● Offline';
      document.getElementById('badge-conexao').className = 'badge-conexao offline';
    });
    socket.on('alertas_estoque', data => {
      const itens = Array.isArray(data) ? data : [data];
      itens.forEach(i => toast(`Estoque crítico: ${i.nome || i} — ${i.estoque_atual ?? ''} ${i.unidade || ''}`, 'error', 8000));
      if (document.getElementById('section-estoque').classList.contains('active')) carregarInsumos();
    });
    socket.on('venda_registrada', data => {
      const val = parseFloat(data?.total || data?.valor || 0);
      state.kpiVendasTotal += val;
      state.kpiVendasQtd  += 1;
      document.getElementById('kpi-vendas').textContent    = fmtBRL(state.kpiVendasTotal);
      document.getElementById('kpi-vendas-qtd').textContent = `${state.kpiVendasQtd} transações`;
      toast(`Venda registrada: ${fmtBRL(val)}`, 'success', 3000);
    });
    socket.on('estoque_sync', data => { if (data?.id) atualizarLinhaInsumo(data); });
  } catch (e) {
    console.warn('Socket.IO:', e.message);
    document.getElementById('badge-conexao').textContent = '● Sem Socket';
    document.getElementById('badge-conexao').className = 'badge-conexao offline';
  }
}

function atualizarLinhaInsumo(insumo) {
  const tr = document.querySelector(`tr[data-insumo-id="${insumo.id}"]`);
  if (!tr) return;
  const alerta = parseFloat(insumo.estoque_atual) <= parseFloat(insumo.estoque_minimo);
  tr.innerHTML = buildInsumoRow(insumo, alerta);
}


// ── Dashboard ───────────────────────────────────────────────
async function carregarDashboard() {
  try {
    // CORREÇÃO: Calcula a data de hoje no fuso do Brasil (Arujá)
    const agora = new Date();
    const hojeLocal = agora.toLocaleDateString('en-CA'); // Gera "2026-04-24"

    const resultados = await Promise.allSettled([
      apiFetch('/api/mesas'),
      apiFetch('/api/estoque/alertas'),
      apiFetch(`/api/caixa/historico?data=${hojeLocal}`), // <--- Agora ele pede a data certa!
      apiFetch('/api/estoque/produtos')
    ]);

    const getData = (index, defaultVal = []) => {
      if (resultados[index].status === 'fulfilled') return resultados[index].value;
      return defaultVal;
    };

    // Atualiza Mesas
    const mesasData = getData(0);
    document.getElementById('kpi-mesas').textContent = Array.isArray(mesasData) ? mesasData.length : (mesasData.abertas || 0);

    // Atualiza Alertas
    const resAlertas = getData(1, {});
    const alertasItens = Array.isArray(resAlertas) ? resAlertas : (resAlertas.abaixo_minimo || resAlertas.itens || []);
    document.getElementById('kpi-alertas').textContent = alertasItens.length;
    renderizarDashAlertas(alertasItens);

    // Atualiza Vendas (Gráfico e KPIs)
    const resVendas = getData(2);
    // Nota: O seu back-end retorna um objeto { pagamentos: [] }, por isso usamos .pagamentos aqui
    const hist = resVendas.pagamentos || (Array.isArray(resVendas) ? resVendas : []);
    
    state.historico = hist;
    state.kpiVendasTotal = hist.reduce((s, v) => s + parseFloat(v.valor_total || 0), 0);
    state.kpiVendasQtd = hist.length;
    
    document.getElementById('kpi-vendas').textContent = fmtBRL(state.kpiVendasTotal);
    document.getElementById('kpi-vendas-qtd').textContent = `${state.kpiVendasQtd} transações`;
    
    renderizarGrafico(hist);

    // Atualiza Produtos
    const resProdutos = getData(3);
    const prods = Array.isArray(resProdutos) ? resProdutos : (resProdutos.produtos || []);
    const ativos = prods.filter(p => p.disponivel || p.ativo).length;
    document.getElementById('kpi-produtos').textContent = ativos;

  } catch (e) {
    console.error("Erro crítico no dashboard:", e);
  }
}

// adicionarNovasMesas() é chamado diretamente pelo botão "Adicionar Mesas" no HTML, então não precisa ser chamado aqui. Ele ficará disponível globalmente para quando o admin clicar no botão.
// Abre o modal bonito
function adicionarNovasMesas() {
  document.getElementById('qtd-novas-mesas').value = ''; // Limpa o campo
  abrirModal('modal-mesas');
  setTimeout(() => document.getElementById('qtd-novas-mesas').focus(), 300);
}
window.adicionarNovasMesas = adicionarNovasMesas;

// Executa a criação das mesas quando clica no botão do modal
async function confirmarNovasMesas() {
  const quantidade = parseInt(document.getElementById('qtd-novas-mesas').value);

  if (isNaN(quantidade) || quantidade <= 0) {
    return toast('Digite uma quantidade válida maior que zero.', 'warning');
  }

  try {
    await apiFetch('/api/mesas/gerar', {
      method: 'POST',
      body: JSON.stringify({ quantidade: quantidade, capacidade: 4, localizacao: 'Salão Principal' })
    });

    toast(`${quantidade} mesas criadas com sucesso!`, 'success');
    
    fecharModal('modal-mesas'); // Fecha a janelinha
    carregarDashboard(); // Atualiza a tela
  } catch (e) {
    toast('Erro ao criar mesas: ' + e.message, 'error');
  }
}
window.confirmarNovasMesas = confirmarNovasMesas;

// abrirNovoInsumoRapido() é chamado diretamente pelo botão "Criar Insumo Rápido" no HTML, então não precisa ser chamado aqui. Ele ficará disponível globalmente para quando o admin clicar no botão.
function abrirNovoInsumoRapido() {
  document.getElementById('insumo-rapido-nome').value = '';
  document.getElementById('insumo-rapido-unidade').value = 'un';
  abrirModal('modal-insumo-rapido');
  setTimeout(() => document.getElementById('insumo-rapido-nome').focus(), 300);
}

// salvarInsumoRapido() é chamado diretamente pelo formulário de criação rápida de insumo, então não precisa ser chamado aqui. Ele ficará disponível globalmente para quando o admin submeter o formulário.
async function salvarInsumoRapido() {
  const nome = document.getElementById('insumo-rapido-nome').value.trim();
  const unidade = document.getElementById('insumo-rapido-unidade').value;

  if (!nome) {
    toast('Por favor, digite o nome do insumo.', 'warning');
    return;
  }

  const payload = {
    nome: nome,
    unidade_id: state.unidadeMap[unidade] || 5,
    estoque_atual: 0,
    estoque_minimo: 0,
    custo_unitario: 0,
    perecivel: 0
  };

  try {
    const novoInsumo = await apiFetch('/api/estoque/insumos', { 
      method: 'POST', 
      body: JSON.stringify(payload) 
    });

    toast('Insumo criado e pronto para uso!', 'success');
    fecharModal('modal-insumo-rapido');
    await carregarInsumos();

    setTimeout(() => {
      const selectLote = document.getElementById('lote-insumo-id');
      if (novoInsumo && novoInsumo.id) {
        selectLote.value = novoInsumo.id;
      } else {
        for (let i = 0; i < selectLote.options.length; i++) {
          if (selectLote.options[i].text.includes(nome)) {
            selectLote.selectedIndex = i;
            break;
          }
        }
      }
    }, 200);

  } catch (e) {
    toast('Erro ao criar insumo: ' + e.message, 'error');
  }
}

//  renderizarDashAlertas() é chamado dentro de carregarDashboard() para mostrar os alertas críticos de estoque. Ele recebe a lista de alertas do servidor e atualiza a seção de alertas no dashboard.
function renderizarDashAlertas(alertas) {
  const el = document.getElementById('dash-alertas-lista');
  if (!alertas.length) { el.innerHTML = '<div class="empty-state" style="padding:20px">Nenhum alerta de estoque.</div>'; return; }
  el.innerHTML = alertas.slice(0, 8).map(a => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--cinza-medio);font-size:0.85rem">
      <span style="font-weight:600;color:var(--cinza-texto)">${a.nome||a}</span>
      <span class="badge badge-alerta">${a.estoque_atual??'?'} ${a.unidade||''}</span>
    </div>`).join('');
}

// renderizarGrafico() é chamado dentro de carregarDashboard() para mostrar a distribuição dos métodos de pagamento nas vendas do dia. Ele recebe o histórico de vendas do servidor e constrói um gráfico de barras simples.
function renderizarGrafico(hist) {
  const totais = {};
  hist.forEach(v => {
    const m = v.metodo || v.metodo_pagamento || 'outro';
    totais[m] = (totais[m] || 0) + parseFloat(v.valor_total || v.total || v.valor || 0);
  });
  const maximo = Math.max(...Object.values(totais), 1);
  const labels = { dinheiro:'Dinheiro', pix:'PIX', cartao_credito:'Crédito', cartao_debito:'Débito', voucher:'Voucher' };
  const el = document.getElementById('chart-vendas');
  if (!Object.keys(totais).length) { el.innerHTML = '<div class="empty-state">Sem dados de vendas hoje.</div>'; return; }
  el.innerHTML = Object.entries(totais).map(([m, v]) => {
    const pct = Math.round((v / maximo) * 100);
    return `
      <div class="chart-row">
        <div class="chart-label">${labels[m]||m}</div>
        <div class="chart-bar-wrap"><div class="chart-bar bar-${m}" style="width:${pct}%"></div></div>
        <div class="chart-val">${fmtBRL(v)}</div>
      </div>`;
  }).join('');
}

// ── Estoque ────────────────────────────────────────────────
async function carregarInsumos() {
  try {
    const data    = await apiFetch('/api/estoque/insumos');
    const insumos = Array.isArray(data) ? data : (data.insumos || []);
    state.insumos = insumos;
    renderizarInsumos(insumos);
    popularSelectsInsumos(insumos);
  } catch (e) {
    document.getElementById('insumos-tbody').innerHTML = `<tr><td colspan="7" class="empty-state">Erro: ${e.message}</td></tr>`;
  }
}

function buildInsumoRow(ins, alerta) {
  return `
    <td>${ins.nome}</td>
    <td>${ins.unidade||'—'}</td>
    <td><strong>${parseFloat(ins.estoque_atual||0).toFixed(2)}</strong></td>
    <td>${parseFloat(ins.estoque_minimo||0).toFixed(2)}</td>
    <td><span class="badge ${alerta?'badge-alerta':'badge-ok'}">${alerta? MI('warning',14)+' Baixo': MI('check_circle',14)+' OK'}</span></td>
    <td>${fmtBRL(ins.custo_unitario)}</td>
    <td><button class="btn btn-sm btn-secondary" onclick="abrirEditarInsumo(${ins.id})" title="Editar">${MI('edit',16)}</button></td>`;
}

function renderizarInsumos(insumos) {
  const tbody = document.getElementById('insumos-tbody');
  if (!insumos.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum insumo cadastrado.</td></tr>'; return; }
  tbody.innerHTML = insumos.map(ins => {
    const alerta = parseFloat(ins.estoque_atual) <= parseFloat(ins.estoque_minimo);
    return `<tr data-insumo-id="${ins.id}">${buildInsumoRow(ins, alerta)}</tr>`;
  }).join('');
}

function popularSelectsInsumos(insumos) {
  ['lote-insumo-id', 'ajuste-insumo-id', 'ficha-novo-insumo'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = '<option value="">Selecione...</option>' +
      insumos.map(i => `<option value="${i.id}">${i.nome} (${i.unidade})</option>`).join('');
    if (val) sel.value = val;
  });
}

function abrirEditarInsumo(id) {
  const ins = state.insumos.find(i => i.id === id);
  if (!ins) return;
  document.getElementById('insumo-edit-id').value     = ins.id;
  document.getElementById('insumo-edit-nome').value   = ins.nome;
  document.getElementById('insumo-edit-unidade').value = ins.unidade || 'kg';
  document.getElementById('insumo-edit-atual').value  = ins.estoque_atual;
  document.getElementById('insumo-edit-minimo').value = ins.estoque_minimo;
  document.getElementById('insumo-edit-custo').value  = ins.custo_unitario;
  abrirModal('modal-insumo');
}
window.abrirEditarInsumo = abrirEditarInsumo;

async function salvarInsumo() {
  const id = document.getElementById('insumo-edit-id').value;
  const unidadeSigla = document.getElementById('insumo-edit-unidade').value;
  const payload = {
    nome           : document.getElementById('insumo-edit-nome').value,
    unidade_id     : state.unidadeMap[unidadeSigla] || parseInt(unidadeSigla) || 5,
    estoque_atual  : parseFloat(document.getElementById('insumo-edit-atual').value),
    estoque_minimo : parseFloat(document.getElementById('insumo-edit-minimo').value),
    custo_unitario : parseFloat(document.getElementById('insumo-edit-custo').value),
    perecivel      : 0
  };
  try {
    await apiFetch(`/api/estoque/insumos/${id}`, { method:'PUT', body: JSON.stringify(payload) });
    toast('Insumo atualizado!', 'success');
    fecharModal('modal-insumo');
    carregarInsumos();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.salvarInsumo = salvarInsumo;

function abrirModalLote() {
  document.getElementById('lote-data-entrada').value = new Date().toISOString().split('T')[0];
  abrirModal('modal-lote');
}
window.abrirModalLote = abrirModalLote;

async function salvarLote() {
  const payload = {
    insumo_id      : parseInt(document.getElementById('lote-insumo-id').value),
    quantidade     : parseFloat(document.getElementById('lote-quantidade').value),
    custo_unitario : parseFloat(document.getElementById('lote-custo').value),
    data_entrada   : document.getElementById('lote-data-entrada').value,
    data_validade  : document.getElementById('lote-data-validade').value,
    fornecedor     : document.getElementById('lote-fornecedor').value
  };
  if (!payload.insumo_id) { toast('Selecione o insumo.', 'warning'); return; }
  try {
    await apiFetch('/api/estoque/lotes', { method:'POST', body: JSON.stringify(payload) });
    toast('Lote registrado! (PEPS)', 'success');
    fecharModal('modal-lote');
    carregarInsumos();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.salvarLote = salvarLote;

function abrirModalAjuste() { abrirModal('modal-ajuste'); }
window.abrirModalAjuste = abrirModalAjuste;

async function salvarAjuste() {
  const tipoRaw = document.getElementById('ajuste-tipo').value;
  const tipoMap = { perda:'perda', ajuste_positivo:'entrada', ajuste_negativo:'ajuste' };
  const payload = {
    insumo_id     : parseInt(document.getElementById('ajuste-insumo-id').value),
    tipo          : tipoMap[tipoRaw] || tipoRaw,
    quantidade    : parseFloat(document.getElementById('ajuste-quantidade').value),
    justificativa : document.getElementById('ajuste-motivo').value
  };
  if (!payload.insumo_id) { toast('Selecione o insumo.', 'warning'); return; }
  try {
    await apiFetch('/api/estoque/ajuste', { method:'POST', body: JSON.stringify(payload) });
    toast('Ajuste registrado!', 'success');
    fecharModal('modal-ajuste');
    carregarInsumos();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.salvarAjuste = salvarAjuste;

// ── Fichas Técnicas ────────────────────────────────────────
async function carregarFichas() {
  try {
    const data  = await apiFetch('/api/estoque/produtos');
    const prods = Array.isArray(data) ? data : (data.produtos || []);
    state.produtos = prods;
    renderizarFichas(prods);
  } catch (e) {
    document.getElementById('fichas-tbody').innerHTML = `<tr><td colspan="5" class="empty-state">Erro: ${e.message}</td></tr>`;
  }
}

function renderizarFichas(prods) {
  const tbody = document.getElementById('fichas-tbody');
  if (!prods.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum produto encontrado.</td></tr>'; return; }
  tbody.innerHTML = prods.map(p => `
    <tr>
      <td><strong>${p.nome}</strong></td>
      <td>${p.categoria||'—'}</td>
      <td>${fmtBRL(p.preco)}</td>
      <td><span class="badge badge-ok">${p.num_insumos||state.fichas[p.id]?.length||'—'} insumos</span></td>
      <td><button class="btn btn-sm btn-primary" onclick="verFicha(${p.id}, '${p.nome.replace(/'/g,"\\'")}')"><span class="material-symbols-outlined" style="font-size:16px;">description</span> Ver/Editar</button></td>
    </tr>`).join('');
}

async function verFicha(produtoId, nomeProduto) {
  document.getElementById('modal-ficha-titulo').innerHTML = `${MI('description', 20)} Ficha: ${nomeProduto}`;
  document.getElementById('ficha-produto-id').value = produtoId;
  document.getElementById('ficha-itens-lista').innerHTML = '<div class="empty-state"><span class="loading-spin dark"></span></div>';
  abrirModal('modal-ficha');

  if (!state.insumos.length) {
    const ins = await apiFetch('/api/estoque/insumos').catch(() => []);
    state.insumos = Array.isArray(ins) ? ins : (ins.insumos || []);
    popularSelectsInsumos(state.insumos);
  }

  try {
    const data = await apiFetch(`/api/estoque/fichas-tecnicas/${produtoId}`);
    const itens = Array.isArray(data) ? data : (data.linhas || data.itens || data.insumos || []);
    state.fichas[produtoId] = itens;
    renderizarItensFicha(produtoId, itens);
  } catch (e) {
    document.getElementById('ficha-itens-lista').innerHTML = `<div class="empty-state">Erro: ${e.message}</div>`;
  }
}
window.verFicha = verFicha;

function renderizarItensFicha(produtoId, itens) {
  const el = document.getElementById('ficha-itens-lista');
  if (!itens.length) { el.innerHTML = '<div class="empty-state">Nenhum insumo nesta ficha.</div>'; return; }
  el.innerHTML = `
    <table class="data-table" style="font-size:0.83rem">
      <thead><tr><th>Insumo</th><th>Qtd</th><th>Un.</th><th></th></tr></thead>
      <tbody>${itens.map(i => `
        <tr>
          <td>${i.insumo_nome||i.nome||i.insumo||'—'}</td>
          <td>${parseFloat(i.quantidade||i.qtd||0).toFixed(3)}</td>
          <td>${i.unidade||'—'}</td>
          <td><button class="btn btn-sm btn-danger" onclick="removerItemFicha(${produtoId},${i.insumo_id||i.id})" title="Remover">${MI('delete',16)}</button></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

async function adicionarItemFicha() {
  const produtoId  = document.getElementById('ficha-produto-id').value;
  const insumoId   = document.getElementById('ficha-novo-insumo').value;
  const quantidade = parseFloat(document.getElementById('ficha-nova-qtd').value);
  if (!insumoId)               { toast('Selecione um insumo.', 'warning'); return; }
  if (!quantidade || quantidade <= 0) { toast('Informe quantidade válida.', 'warning'); return; }
  try {
    await apiFetch('/api/estoque/fichas-tecnicas', { method:'POST', body: JSON.stringify({ produto_id: produtoId, insumo_id: insumoId, quantidade }) });
    toast('Insumo adicionado à ficha!', 'success');
    document.getElementById('ficha-nova-qtd').value   = '';
    document.getElementById('ficha-novo-insumo').value = '';
    const nome = document.getElementById('modal-ficha-titulo').textContent.replace(/^\s*Ficha:\s*/, '').trim();
    await verFicha(produtoId, nome);
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.adicionarItemFicha = adicionarItemFicha;

async function removerItemFicha(produtoId, insumoId) {
  const confirmado = await customConfirm(
    'Remover Insumo?', 
    'Tem certeza que deseja remover este insumo da ficha técnica?', 
    true
  );
  
  if (!confirmado) return;

  try {
    await apiFetch(`/api/estoque/fichas-tecnicas/${produtoId}/${insumoId}`, { method:'DELETE' });
    toast('Insumo removido.', 'success');
    const nome = document.getElementById('modal-ficha-titulo').textContent.replace(/^\s*Ficha:\s*/, '').trim();
    await verFicha(produtoId, nome);
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.removerItemFicha = removerItemFicha;



// ── Cardápio ───────────────────────────────────────────────
async function carregarCardapio() {
  try {
    const data  = await apiFetch('/api/estoque/produtos');
    const prods = Array.isArray(data) ? data : (data.produtos || []);
    state.produtos = prods;
    renderizarCardapio(prods);
  } catch (e) {
    document.getElementById('cardapio-tbody').innerHTML = `<tr><td colspan="5" class="empty-state">Erro: ${e.message}</td></tr>`;
  }
}

function renderizarCardapio(prods) {
  const tbody = document.getElementById('cardapio-tbody');
  if (!prods.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum produto no cardápio.</td></tr>'; return; }
  
  tbody.innerHTML = prods.map(p => {
    // Aplicamos o estilo INATIVO apenas nas colunas de texto!
    const estiloTexto = p.disponivel ? '' : 'text-decoration: line-through; opacity: 0.5;';
    
    return `
      <tr>
        <td style="${estiloTexto}"><strong>${p.nome}</strong></td>
        <td style="${estiloTexto}">${p.categoria||'—'}</td>
        <td style="${estiloTexto}">${fmtBRL(p.preco)}</td>
        <td>
          <label class="switch" title="${p.disponivel?'Disponível':'Indisponível'}">
            <input type="checkbox" ${p.disponivel?'checked':''} onchange="toggleDisponivel(${p.id},this.checked)"/>
            <span class="slider"></span>
          </label>
        </td>
        <td>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-sm btn-secondary" onclick="abrirEditarProduto(${p.id})" title="Editar">
              <span class="material-symbols-outlined" style="font-size:16px;">edit</span>
            </button>
            <button class="btn btn-sm btn-danger" onclick="removerProduto(${p.id},'${p.nome.replace(/'/g,"\\'")}')" title="Excluir">
              <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function toggleDisponivel(id, disponivel) {
  try {
    await apiFetch(`/api/estoque/produtos/${id}`, { method:'PUT', body: JSON.stringify({ disponivel }) });
    toast(`Produto ${disponivel?'disponibilizado':'desativado'}!`, 'success', 2500);
    const prod = state.produtos.find(p => p.id === id);
    if (prod) {
      prod.disponivel = disponivel;
      renderizarCardapio(state.produtos); // Redesenha instantaneamente
    }
  } catch (e) { 
    toast('Erro: ' + e.message, 'error'); 
    carregarCardapio(); 
  }
}
window.toggleDisponivel = toggleDisponivel;

async function removerProduto(id, nome) {
  const confirmado = await customConfirm(
    'Excluir Produto?', 
    `Deseja realmente excluir "${nome}" do cardápio?`, 
    true
  );
  if (!confirmado) return;

  try {
    await apiFetch(`/api/estoque/produtos/${id}`, { method: 'DELETE' });
    toast('Produto removido!', 'success');
    carregarCardapio();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}
window.removerProduto = removerProduto;

let categoriasCache = [];

async function carregarCategorias() {
  if (categoriasCache.length) return categoriasCache;
  try {
    const data = await apiFetch('/api/estoque/categorias');
    categoriasCache = Array.isArray(data) ? data : (data.categorias || []);
  } catch (e) {
    categoriasCache = [];
  }
  return categoriasCache;
}

async function abrirModalProduto() {
  document.getElementById('produto-id').value = ''; 
  document.getElementById('produto-nome').value = '';
  document.getElementById('produto-preco').value = '';
  document.getElementById('produto-descricao').value = '';
  document.getElementById('produto-obs-rapidas').value = '';
  document.getElementById('produto-e-pizza').value = '0';
  document.getElementById('produto-imagem').value = '';

  const cats = await carregarCategorias();
  const sel = document.getElementById('produto-categoria');
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome} (${c.fluxo})</option>`).join('');

  document.getElementById('modal-produto-titulo').innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">add_circle</span> Novo Produto';
  abrirModal('modal-produto');
  setTimeout(() => document.getElementById('produto-nome').focus(), 300);
}
window.abrirModalProduto = abrirModalProduto;

async function abrirEditarProduto(id) {
  const prod = state.produtos.find(p => p.id === id);
  if (!prod) return;

  document.getElementById('produto-id').value = prod.id;
  document.getElementById('produto-nome').value = prod.nome;
  document.getElementById('produto-preco').value = prod.preco;
  document.getElementById('produto-descricao').value = prod.descricao || '';
  document.getElementById('produto-obs-rapidas').value = prod.obs_rapidas || '';
  document.getElementById('produto-e-pizza').value = prod.e_pizza ? "1" : "0";
  document.getElementById('produto-imagem').value = prod.imagem_url || '';

  const cats = await carregarCategorias();
  const sel = document.getElementById('produto-categoria');
  sel.innerHTML = cats.map(c => `<option value="${c.id}">${c.nome} (${c.fluxo})</option>`).join('');
  sel.value = prod.categoria_id;

  document.getElementById('modal-produto-titulo').innerHTML = '<span class="material-symbols-outlined" style="font-size:20px;">edit</span> Editar Produto';
  abrirModal('modal-produto');
}
window.abrirEditarProduto = abrirEditarProduto;

async function salvarNovoProduto() {
  const id = document.getElementById('produto-id').value;
  const nome = document.getElementById('produto-nome').value.trim();
  const categoria_id = parseInt(document.getElementById('produto-categoria').value);
  const preco = parseFloat(document.getElementById('produto-preco').value);
  const descricao = document.getElementById('produto-descricao').value.trim();
  const obs_rapidas = document.getElementById('produto-obs-rapidas').value.trim() || null;
  const e_pizza = parseInt(document.getElementById('produto-e-pizza').value);
  const imagem_url = document.getElementById('produto-imagem').value.trim() || null;

  if (!nome) { toast('Informe o nome do produto.', 'warning'); return; }
  if (!categoria_id) { toast('Selecione uma categoria.', 'warning'); return; }
  if (!preco || preco <= 0) { toast('Informe um preço válido.', 'warning'); return; }

  let disponivel = 1; 
  if (id) {
    const prod = state.produtos.find(p => p.id == id);
    if (prod) disponivel = prod.disponivel;
  }

  const payload = { categoria_id, nome, descricao: descricao || null, preco, e_pizza, imagem_url, obs_rapidas, disponivel };

  try {
    if (id) {
      await apiFetch(`/api/estoque/produtos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast('Produto atualizado com sucesso!', 'success');
    } else {
      await apiFetch('/api/estoque/produtos', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('Produto cadastrado com sucesso!', 'success');
    }
    
    fecharModal('modal-produto');
    carregarCardapio();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}
window.salvarNovoProduto = salvarNovoProduto;



// ── Relatórios ─────────────────────────────────────────────
async function carregarRelatorios() {
  try {
    // 1. Tenta pegar a data do calendário
    let inputData = document.getElementById('filtro-data-relatorio').value;
    
    // 2. Se estiver vazio (ao abrir a página), calcula o "Hoje" real do Brasil
    if (!inputData) {
      const agora = new Date();
      // Ajuste de fuso horário manual para garantir a data correta no Brasil
      const offset = agora.getTimezoneOffset() * 60000;
      inputData = (new Date(agora - offset)).toISOString().split('T')[0];
    }

    console.log("Buscando vendas da data:", inputData);
    
    let url = `/api/caixa/historico?data=${inputData}`;
    const res = await apiFetch(url);
    const hist = res.pagamentos || (Array.isArray(res) ? res : []);
    
    renderizarRelatorio(hist);
  } catch (e) {
    document.getElementById('relatorio-vendas').innerHTML = `<div class="empty-state">Erro ao carregar: ${e.message}</div>`;
  }
}

function renderizarRelatorio(hist) {
  const el = document.getElementById('relatorio-vendas');
  if (!hist.length) { el.innerHTML = '<div class="empty-state">Nenhuma venda registrada hoje.</div>'; return; }
  const totalDia = hist.reduce((s, v) => s + parseFloat(v.valor_total || v.total || v.valor || 0), 0);
  const labels   = { dinheiro:'Dinheiro', pix:'PIX', cartao_credito:'Crédito', cartao_debito:'Débito', voucher:'Voucher' };
  el.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Mesa</th><th>Horário</th><th>Método</th><th>Garçom</th><th>Total</th></tr></thead>
        <tbody>
          ${hist.map(v => {
            const hora = v.criado_em || v.fechado_em || v.created_at
              ? new Date(v.criado_em||v.fechado_em||v.created_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
              : '—';
            const m = v.metodo || v.metodo_pagamento || '—';
            return `
              <tr>
                <td>Mesa ${v.mesa_numero||v.numero_mesa||v.mesa||'—'}</td>
                <td>${hora}</td>
                <td><span class="badge" style="background:var(--cinza-medio);color:var(--cinza-texto)">${labels[m]||m}</span></td>
                <td>${v.caixa_nome||v.garcom||v.nome_garcom||'—'}</td>
                <td><strong>${fmtBRL(v.valor_total||v.total||v.valor)}</strong></td>
              </tr>`;
          }).join('')}
          <tr style="background:var(--cinza-claro)">
            <td colspan="4" style="font-weight:800;color:var(--vinho-escuro)">Total do Dia</td>
            <td style="font-weight:800;color:var(--vinho-escuro);font-size:1.05rem">${fmtBRL(totalDia)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

// ── Usuários (NOVO) ────────────────────────────────────────
const perfisMap = { 1: 'Admin', 2: 'Garçom', 3: 'Cozinheiro', 4: 'Caixa' };

async function carregarUsuarios() {
  try {
    const data = await apiFetch('/api/usuarios');
    const users = Array.isArray(data) ? data : (data.usuarios || []);
    state.usuarios = users;
    renderizarUsuarios(users);
  } catch (e) {
    document.getElementById('usuarios-tbody').innerHTML = `<tr><td colspan="5" class="empty-state">O backend ainda não tem a rota /api/usuarios: ${e.message}</td></tr>`;
  }
}

function renderizarUsuarios(users) {
  const tbody = document.getElementById('usuarios-tbody');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum usuário cadastrado.</td></tr>'; return; }
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${u.nome}</strong></td>
      <td>${u.login}</td>
      <td><span class="badge" style="background:var(--cinza-medio);color:var(--cinza-texto)">${perfisMap[u.perfil_id] || 'Desconhecido'}</span></td>
      <td>
        <label class="switch" title="${u.ativo ? 'Ativo' : 'Inativo'}">
          <input type="checkbox" ${u.ativo ? 'checked' : ''} onchange="toggleAtivoUsuario(${u.id},this.checked)"/>
          <span class="slider"></span>
        </label>
      </td>
      <td><button class="btn btn-sm btn-secondary" onclick="abrirModalUsuario(${u.id})">${MI('edit',16)}</button></td>
    </tr>`).join('');
}

function abrirModalUsuario(id = null) {
  const u = id ? state.usuarios.find(x => x.id === id) : null;
  document.getElementById('modal-usuario-titulo').innerHTML = u ? `${MI('edit',20)} Editar Usuário` : `${MI('person_add',20)} Novo Usuário`;
  document.getElementById('usuario-id').value = u ? u.id : '';
  document.getElementById('usuario-nome').value = u ? u.nome : '';
  document.getElementById('usuario-login').value = u ? u.login : '';
  document.getElementById('usuario-perfil').value = u ? u.perfil_id : '2';
  document.getElementById('usuario-ativo').value = u ? (u.ativo ? '1' : '0') : '1';
  document.getElementById('usuario-senha').value = '';
  document.getElementById('senha-hint').textContent = u ? '(Preencha apenas se quiser trocar a senha)' : '(Obrigatório)';
  abrirModal('modal-usuario');
}

async function salvarUsuario() {
  const id = document.getElementById('usuario-id').value;
  const payload = {
    nome: document.getElementById('usuario-nome').value.trim(),
    login: document.getElementById('usuario-login').value.trim(),
    perfil_id: parseInt(document.getElementById('usuario-perfil').value),
    ativo: parseInt(document.getElementById('usuario-ativo').value)
  };
  const senha = document.getElementById('usuario-senha').value.trim();
  if (senha) payload.senha = senha;

  if (!payload.nome || !payload.login) { toast('Nome e Login são obrigatórios.', 'warning'); return; }
  if (!id && !senha) { toast('Para um usuário novo, a senha é obrigatória.', 'warning'); return; }

  try {
    const url = id ? `/api/usuarios/${id}` : '/api/usuarios';
    const method = id ? 'PUT' : 'POST';
    await apiFetch(url, { method, body: JSON.stringify(payload) });
    toast(`Usuário ${id ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
    fecharModal('modal-usuario');
    carregarUsuarios();
  } catch (e) { toast('Erro: ' + e.message, 'error'); }
}

async function toggleAtivoUsuario(id, ativo) {
  try {
    await apiFetch(`/api/usuarios/${id}`, { method:'PUT', body: JSON.stringify({ ativo: ativo ? 1 : 0 }) });
    toast(`Acesso do usuário ${ativo ? 'liberado' : 'bloqueado'}!`, 'success', 2500);
    const u = state.usuarios.find(x => x.id === id);
    if (u) u.ativo = ativo ? 1 : 0;
  } catch (e) { toast('Erro: ' + e.message, 'error'); carregarUsuarios(); }
}
window.abrirModalUsuario = abrirModalUsuario;
window.salvarUsuario = salvarUsuario;
window.toggleAtivoUsuario = toggleAtivoUsuario;

// ── Polling fallback ───────────────────────────────────────
setInterval(() => {
  const secaoAtiva = document.querySelector('.section.active');
  if (!secaoAtiva) return;
  const id = secaoAtiva.id.replace('section-', '');
  if (sectionLoaders[id]) sectionLoaders[id]();
}, 60000);


// ── Init ───────────────────────────────────────────────────
(function init() {
  conectarSocket();
  carregarDashboard();
  
  const hoje = new Date().toISOString().split('T')[0];
  
  if(document.getElementById('lote-data-entrada')) {
    document.getElementById('lote-data-entrada').value = hoje;
    flatpickr("#lote-data-entrada", { locale: "pt", dateFormat: "Y-m-d" });
    flatpickr("#lote-data-validade", { locale: "pt", dateFormat: "Y-m-d" });
  }
  
  if(document.getElementById('filtro-data-relatorio')) {
    // ATENÇÃO: Adicionamos o 'onReady' para ele carregar os dados automático
    flatpickr("#filtro-data-relatorio", {
      locale: "pt",
      dateFormat: "Y-m-d",
      defaultDate: "today", // Força o calendário a começar em hoje
      altInput: true,
      altFormat: "d/m/Y",
      onReady: function(selectedDates, dateStr, instance) {
        carregarRelatorios(); // <--- CARREGA O RELATÓRIO ASSIM QUE ABRE
      },
      onChange: function(selectedDates, dateStr, instance) {
        carregarRelatorios(); // Recarrega se o usuário mudar a data
      }
    });
  }
})();