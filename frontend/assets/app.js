'use strict';

// ── Utilitário de Notificação (Padrão Siga-MF) ────────────────
function toast(msg, tipo = 'info', duracao = 4500) {
  const container = document.getElementById('toast-container');
  
  // Se não tiver o container na página de login, cria um rápido
  if (!container) {
    const newDiv = document.createElement('div');
    newDiv.id = 'toast-container';
    document.body.appendChild(newDiv);
  }

  const icons = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `
    <span class="material-symbols-outlined">${icons[tipo] || 'info'}</span>
    <span style="flex:1">${msg}</span>
  `;

  document.getElementById('toast-container').appendChild(el);

  setTimeout(() => {
    el.style.transition = '0.3s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 310);
  }, duracao);
}

// ── Lógica de Login ──────────────────────────────────────────

function togglePassword(fieldId, iconEl) {
  const input = document.getElementById(fieldId);
  const icon = iconEl.querySelector('span');
  if (input.type === 'password') { 
    input.type = 'text'; 
    icon.textContent = 'visibility_off'; 
  } else { 
    input.type = 'password'; 
    icon.textContent = 'visibility'; 
  }
}

async function handleLogin(e) {
  e.preventDefault();
  
  const modulo = document.getElementById('modulo-select').value;
  const loginStr = document.getElementById('login').value;
  const passwordStr = document.getElementById('password').value;
  const btn = document.getElementById('btn-submit');

  if (!modulo) {
    toast('Selecione o setor que deseja acessar.', 'warning');
    return;
  }

  btn.textContent = 'Verificando credenciais...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginStr, senha: passwordStr, modulo })
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('siga_mf_token', data.token);
      localStorage.setItem('siga_mf_usuario_id', data.usuario.id);
      localStorage.setItem('siga_mf_usuario', data.usuario.nome);
      localStorage.setItem('siga_mf_perfil', data.usuario.perfil);
      localStorage.setItem('siga_mf_perfil_id', data.usuario.perfil_id);
      
      toast(`Bem-vindo, ${data.usuario.nome}!`, 'success');
      
      // Pequeno delay para o usuário ver o toast de sucesso
      setTimeout(() => {
        window.location.href = `../${modulo}/index.html`; 
      }, 800);

    } else {
      // SUBSTITUÍDO: alert por toast de erro
      toast(data.erro || 'Usuário ou senha incorretos.', 'error');
      btn.textContent = 'Acessar Sistema';
      btn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    toast('Sem conexão com o servidor. O sistema está online?', 'error');
    btn.textContent = 'Acessar Sistema';
    btn.disabled = false;
  }
}

// ── Helper Global de Autenticação ─────────────────────────────
window.sigaAuth = {
  getToken() {
    return localStorage.getItem('siga_mf_token');
  },
  getPerfil() {
    return localStorage.getItem('siga_mf_perfil');
  },
  getPerfilId() {
    return localStorage.getItem('siga_mf_perfil_id');
  },
  getUsuarioNome() {
    return localStorage.getItem('siga_mf_usuario');
  },
  getUsuarioId() {
    return localStorage.getItem('siga_mf_usuario_id');
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  /** Faz fetch com Authorization header automaticamente.
   *  Diferente do apiFetch do admin, este retorna o Response object
   *  (para os módulos que chamam .json() depois). */
  async apiFetch(url, opts = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('siga_mf_token');
      toast('Sessão expirada ou acesso negado. Faça login novamente.', 'error');
      setTimeout(() => { window.location.href = '../assets/login.html'; }, 1500);
      throw new Error('Acesso negado');
    }
    return res;
  },
  /** Versão que já faz .json() — usada pelo admin */
  async apiFetchJSON(url, opts = {}) {
    const res = await this.apiFetch(url, opts);
    return res.json();
  },
  logout() {
    localStorage.removeItem('siga_mf_token');
    localStorage.removeItem('siga_mf_usuario_id');
    localStorage.removeItem('siga_mf_usuario');
    localStorage.removeItem('siga_mf_perfil');
    localStorage.removeItem('siga_mf_perfil_id');
    window.location.href = '../assets/login.html';
  }
};