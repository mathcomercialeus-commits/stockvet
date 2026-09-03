const app = document.querySelector('#app');

const state = {
  user: null,
  data: null,
  view: 'dashboard',
  xmlItems: []
};

const roleTabs = {
  admin: [
    ['dashboard', 'Dashboard'],
    ['conference', 'Conferencia'],
    ['reports', 'Relatorios'],
    ['logs', 'Logs'],
    ['users', 'Usuarios']
  ],
  manager: [
    ['dashboard', 'Painel'],
    ['entry', 'Entrada'],
    ['xml', 'Entrada XML'],
    ['exit', 'Saida'],
    ['products', 'Produtos'],
    ['vets', 'Veterinarios'],
    ['approvals', 'Aprovacoes']
  ],
  veterinarian: [
    ['attendance', 'Atendimento'],
    ['myRecords', 'Meus registros'],
    ['stock', 'Estoque']
  ]
};

const roleInitialView = {
  admin: 'dashboard',
  manager: 'dashboard',
  veterinarian: 'attendance'
};

const locationLabels = {
  internal: 'Estoque interno',
  consultorio1: 'Consultorio 1',
  consultorio2: 'Consultorio 2',
  internacao: 'Internacao'
};

const statusLabels = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado'
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function productOptions() {
  return state.data.products
    .filter((product) => product.active)
    .map((product) => `<option value="${product.id}">${escapeHtml(product.name)} (${escapeHtml(product.sku)})</option>`)
    .join('');
}

function locationOptions(allowInternal = true) {
  return state.data.locations
    .filter((location) => allowInternal || location.id !== 'internal')
    .map((location) => `<option value="${location.id}">${escapeHtml(location.name)}</option>`)
    .join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Nao foi possivel concluir.');
  return payload;
}

function notify(message) {
  let notice = document.querySelector('.notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'notice';
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.classList.add('show');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => notice.classList.remove('show'), 3200);
}

async function refresh(keepView = true) {
  const payload = await api('/api/bootstrap');
  state.user = payload.user;
  state.data = payload;
  if (!keepView) state.view = roleInitialView[state.user.role];
  renderApp();
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-hero">
        <div class="brand-mark">VS</div>
        <div>
          <h1>Vet Stock Control</h1>
          <p>Controle interno de estoque, conferencias, aprovacoes e relatorios em uma rotina simples para clinicas veterinarias.</p>
        </div>
        <p>Estoque interno, consultorios e internacao com rastreabilidade desde a entrada ate o uso em atendimento.</p>
      </section>
      <section class="login-panel">
        <form class="login-card" data-action="login">
          <h2>Entrar</h2>
          <p class="muted">Acesse com seu perfil de trabalho.</p>
          <label class="field">
            E-mail
            <input name="email" type="email" autocomplete="email" required />
          </label>
          <label class="field">
            Senha
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="btn full" type="submit">Entrar</button>
          <div class="demo-logins">
            <button type="button" data-demo="admin">Admin</button>
            <button type="button" data-demo="manager">Gerente</button>
            <button type="button" data-demo="veterinarian">Vet</button>
          </div>
        </form>
      </section>
    </main>
  `;
}

function renderApp() {
  const tabs = roleTabs[state.user.role];
  if (!tabs.some(([id]) => id === state.view)) state.view = roleInitialView[state.user.role];
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="side-brand">
          <span class="brand-mark">VS</span>
          <span>Vet Stock <span>${escapeHtml(state.user.role_label)}</span></span>
        </div>
        <nav class="nav">
          ${tabs.map(([id, label]) => `<button data-view="${id}" class="${state.view === id ? 'active' : ''}">${label}</button>`).join('')}
        </nav>
        <div class="profile-box">
          <strong>${escapeHtml(state.user.name)}</strong>
          <span class="muted">${escapeHtml(state.user.email)}</span>
          <button class="btn secondary" data-action="logout">Sair</button>
        </div>
      </aside>
      <main class="content">
        ${renderView()}
      </main>
    </div>
  `;
}

function pageHeader(title, subtitle = '') {
  return `
    <div class="topbar">
      <div>
        <h1>${title}</h1>
        ${subtitle ? `<div class="muted">${subtitle}</div>` : ''}
      </div>
      <button class="btn secondary" data-action="refresh">Atualizar</button>
    </div>
  `;
}

function renderView() {
  const views = {
    dashboard: renderDashboard,
    conference: renderConference,
    reports: renderReports,
    logs: renderLogs,
    users: renderUsers,
    entry: renderEntry,
    xml: renderXml,
    exit: renderExit,
    products: renderProducts,
    vets: renderVets,
    approvals: renderApprovals,
    attendance: renderAttendance,
    myRecords: renderMyRecords,
    stock: renderStock
  };
  return views[state.view]?.() || renderDashboard();
}

function renderDashboard() {
  const d = state.data.dashboard;
  return `
    ${pageHeader('Dashboard', 'Resumo dos estoques, pendencias e movimentos recentes.')}
    <section class="stat-grid">
      ${Object.entries(d.totalsByLocation)
        .map(([location, total]) => `<div class="stat"><span>${locationLabels[location]}</span><strong>${total}</strong></div>`)
        .join('')}
    </section>
    <section class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Alertas</h2>
        ${d.lowStock.length ? renderLowStockTable(d.lowStock) : '<div class="empty">Nenhum produto abaixo do minimo.</div>'}
      </div>
      <div class="card">
        <h2>Operacao</h2>
        <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="stat"><span>Aprovacoes pendentes</span><strong>${d.pendingRecords}</strong></div>
          <div class="stat"><span>Movimentos hoje</span><strong>${d.movementsToday}</strong></div>
        </div>
      </div>
    </section>
    <section class="card" style="margin-top:16px">
      <h2>Movimentos recentes</h2>
      ${renderMovements(state.data.movements.slice(0, 8))}
    </section>
  `;
}

function renderLowStockTable(products) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Produto</th><th>SKU</th><th>Minimo</th><th>Total</th></tr></thead>
        <tbody>
          ${products
            .map((product) => {
              const total = Object.values(product.balances).reduce((sum, value) => sum + Number(value), 0);
              return `<tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.sku)}</td><td>${product.min_stock}</td><td>${total}</td></tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderConference() {
  return `
    ${pageHeader('Conferencia', 'Saldos separados por estoque.')}
    <section class="card">${renderInventory()}</section>
  `;
}

function renderReports() {
  return `
    ${pageHeader('Relatorios', 'Visao consolidada para administracao.')}
    <section class="grid cols-2">
      <div class="card"><h2>Estoque</h2>${renderInventory()}</div>
      <div class="card"><h2>Registros veterinarios</h2>${renderRecords(state.data.vetRecords)}</div>
    </section>
    <section class="card" style="margin-top:16px"><h2>Movimentos</h2>${renderMovements(state.data.movements)}</section>
  `;
}

function renderLogs() {
  return `
    ${pageHeader('Logs', 'Auditoria completa do sistema.')}
    <section class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data</th><th>Usuario</th><th>Perfil</th><th>Acao</th><th>Entidade</th><th>Detalhes</th></tr></thead>
          <tbody id="logs-body"></tbody>
        </table>
      </div>
    </section>
  `;
}

function renderUsers() {
  return `
    ${pageHeader('Usuarios', 'Perfis cadastrados.')}
    <section class="card">${renderUsersTable()}</section>
  `;
}

function renderEntry() {
  return `
    ${pageHeader('Entrada manual', 'Lancamento de produtos recebidos.')}
    <section class="card">
      <form data-action="manual-entry">
        <div class="grid cols-2">
          <label class="field">Estoque<select name="location">${locationOptions(true)}</select></label>
          <label class="field">Referencia<input name="reference" placeholder="NF, pedido ou observacao" /></label>
        </div>
        <div data-items>
          ${itemRow()}
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="btn secondary" type="button" data-action="add-item">Adicionar item</button>
          <button class="btn" type="submit">Salvar entrada</button>
        </div>
      </form>
    </section>
  `;
}

function renderXml() {
  return `
    ${pageHeader('Entrada via XML', 'Importacao de itens de nota fiscal.')}
    <section class="grid cols-2">
      <form class="card" data-action="xml-preview">
        <h2>XML</h2>
        <label class="field">Conteudo do XML<textarea name="xml" placeholder="<NFe>...</NFe>" required></textarea></label>
        <button class="btn full" type="submit">Ler XML</button>
      </form>
      <form class="card" data-action="xml-entry">
        <h2>Itens lidos</h2>
        <label class="field">Estoque<select name="location">${locationOptions(true)}</select></label>
        <label class="field">Referencia<input name="reference" placeholder="Numero da nota" /></label>
        <div class="xml-preview">${renderXmlItems()}</div>
        <button class="btn full" type="submit">Confirmar entrada</button>
      </form>
    </section>
  `;
}

function renderExit() {
  return `
    ${pageHeader('Saida manual', 'Baixa com motivo registrado.')}
    <section class="card">
      <form data-action="stock-exit">
        <div class="grid cols-2">
          <label class="field">Produto<select name="productId">${productOptions()}</select></label>
          <label class="field">Estoque<select name="location">${locationOptions(true)}</select></label>
          <label class="field">Quantidade<input name="quantity" type="number" min="0.01" step="0.01" required /></label>
          <label class="field">Motivo<input name="reason" required placeholder="Perda, vencimento, ajuste..." /></label>
        </div>
        <button class="btn full" type="submit">Salvar saida</button>
      </form>
    </section>
  `;
}

function renderProducts() {
  return `
    ${pageHeader('Produtos', 'Cadastro e saldos atuais.')}
    <section class="grid cols-2">
      <form class="card" data-action="create-product">
        <h2>Novo produto</h2>
        <label class="field">SKU<input name="sku" required /></label>
        <label class="field">Nome<input name="name" required /></label>
        <div class="grid cols-2">
          <label class="field">Unidade<input name="unit" value="un" required /></label>
          <label class="field">Minimo<input name="minStock" type="number" min="0" step="0.01" value="0" /></label>
        </div>
        <button class="btn full" type="submit">Cadastrar</button>
      </form>
      <div class="card"><h2>Lista</h2>${renderInventory()}</div>
    </section>
  `;
}

function renderVets() {
  return `
    ${pageHeader('Veterinarios', 'Cadastro feito por gerente.')}
    <section class="grid cols-2">
      <form class="card" data-action="create-vet">
        <h2>Novo veterinario</h2>
        <label class="field">Nome<input name="name" required /></label>
        <label class="field">E-mail<input name="email" type="email" required /></label>
        <label class="field">Senha inicial<input name="password" type="password" required /></label>
        <button class="btn full" type="submit">Cadastrar</button>
      </form>
      <div class="card"><h2>Cadastrados</h2>${renderUsersTable('veterinarian')}</div>
    </section>
  `;
}

function renderApprovals() {
  const pending = state.data.vetRecords.filter((record) => record.status === 'pending');
  return `
    ${pageHeader('Aprovacoes', 'Registros feitos pelos veterinarios.')}
    <section class="card">${pending.length ? renderRecords(pending, true) : '<div class="empty">Nenhum registro pendente.</div>'}</section>
  `;
}

function renderAttendance() {
  return `
    ${pageHeader('Atendimento', 'Registro de uso por comanda.')}
    <section class="card">
      <form data-action="vet-record">
        <div class="grid cols-2">
          <label class="field">Numero da comanda<input name="commandNumber" required /></label>
          <label class="field">Setor<select name="location">${locationOptions(false)}</select></label>
        </div>
        <label class="field">Observacoes<textarea name="notes"></textarea></label>
        <div data-items>${itemRow()}</div>
        <div class="actions" style="margin-top:12px">
          <button class="btn secondary" type="button" data-action="add-item">Adicionar item</button>
          <button class="btn" type="submit">Enviar para aprovacao</button>
        </div>
      </form>
    </section>
  `;
}

function renderMyRecords() {
  return `
    ${pageHeader('Meus registros', 'Historico enviado para conferencia.')}
    <section class="card">${renderRecords(state.data.vetRecords)}</section>
  `;
}

function renderStock() {
  return `
    ${pageHeader('Estoque', 'Saldos disponiveis por setor.')}
    <section class="card">${renderInventory()}</section>
  `;
}

function itemRow() {
  return `
    <div class="form-row" data-item-row>
      <select name="productId">${productOptions()}</select>
      <input name="quantity" type="number" min="0.01" step="0.01" placeholder="Qtd." required />
      <button class="icon-btn" type="button" data-action="remove-item" title="Remover">x</button>
    </div>
  `;
}

function renderXmlItems() {
  if (!state.xmlItems.length) return '<div class="empty">Aguardando XML.</div>';
  return `
    <table>
      <thead><tr><th>SKU</th><th>Produto</th><th>Un.</th><th>Qtd.</th></tr></thead>
      <tbody>
        ${state.xmlItems
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.sku)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.unit)}</td><td>${item.quantity}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function renderInventory() {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Produto</th><th>SKU</th><th>Un.</th><th>Min.</th><th>Interno</th><th>Consultorio 1</th><th>Consultorio 2</th><th>Internacao</th></tr>
        </thead>
        <tbody>
          ${state.data.products
            .map(
              (product) => `
              <tr>
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.sku)}</td>
                <td>${escapeHtml(product.unit)}</td>
                <td>${product.min_stock}</td>
                <td>${product.balances.internal || 0}</td>
                <td>${product.balances.consultorio1 || 0}</td>
                <td>${product.balances.consultorio2 || 0}</td>
                <td>${product.balances.internacao || 0}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderMovements(movements) {
  if (!movements.length) return '<div class="empty">Nenhum movimento registrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Tipo</th><th>Produto</th><th>Estoque</th><th>Qtd.</th><th>Motivo</th><th>Usuario</th></tr></thead>
        <tbody>
          ${movements
            .map(
              (m) => `
              <tr>
                <td>${fmtDate(m.created_at)}</td>
                <td><span class="tag">${escapeHtml(m.type)}</span></td>
                <td>${escapeHtml(m.product_name)}</td>
                <td>${locationLabels[m.location] || m.location}</td>
                <td>${m.quantity}</td>
                <td>${escapeHtml(m.reason || '-')}</td>
                <td>${escapeHtml(m.actor_name)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecords(records, withActions = false) {
  if (!records.length) return '<div class="empty">Nenhum registro encontrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Comanda</th><th>Setor</th><th>Vet</th><th>Itens</th><th>Status</th><th>Acoes</th></tr></thead>
        <tbody>
          ${records
            .map(
              (record) => `
              <tr>
                <td>${fmtDate(record.created_at)}</td>
                <td>${escapeHtml(record.command_number)}</td>
                <td>${locationLabels[record.location] || record.location}</td>
                <td>${escapeHtml(record.veterinarian_name)}</td>
                <td>${record.items.map((item) => `${escapeHtml(item.product_name)} (${item.quantity} ${escapeHtml(item.unit)})`).join('<br>')}</td>
                <td><span class="tag ${record.status}">${statusLabels[record.status]}</span></td>
                <td>
                  ${
                    withActions
                      ? `<div class="actions"><button class="btn" data-action="approve-record" data-id="${record.id}">Aprovar</button><button class="btn danger" data-action="reject-record" data-id="${record.id}">Rejeitar</button></div>`
                      : escapeHtml(record.review_notes || '-')
                  }
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderUsersTable(filterRole = '') {
  const users = state.data.users.filter((user) => !filterRole || user.role === filterRole);
  if (!users.length) return '<div class="empty">Nenhum usuario cadastrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Criado em</th></tr></thead>
        <tbody>
          ${users
            .map(
              (user) => `
              <tr>
                <td>${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.email)}</td>
                <td><span class="tag">${escapeHtml(user.role)}</span></td>
                <td>${user.active ? 'Ativo' : 'Inativo'}</td>
                <td>${fmtDate(user.created_at)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function collectItems(form) {
  return [...form.querySelectorAll('[data-item-row]')]
    .map((row) => ({
      productId: Number(row.querySelector('[name="productId"]').value),
      quantity: Number(row.querySelector('[name="quantity"]').value)
    }))
    .filter((item) => item.productId && item.quantity > 0);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handleSubmit(event) {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const data = formData(form);
  try {
    if (action === 'login') {
      await api('/api/login', { method: 'POST', body: JSON.stringify(data) });
      await refresh(false);
      notify('Login realizado.');
      return;
    }
    if (action === 'manual-entry') {
      await api('/api/stock/entry', {
        method: 'POST',
        body: JSON.stringify({ location: data.location, reference: data.reference, items: collectItems(form) })
      });
      notify('Entrada registrada.');
    }
    if (action === 'xml-preview') {
      const preview = await api('/api/xml/preview', { method: 'POST', body: JSON.stringify({ xml: data.xml }) });
      state.xmlItems = preview.items;
      renderApp();
      notify(`${preview.items.length} item(ns) lido(s).`);
      return;
    }
    if (action === 'xml-entry') {
      await api('/api/stock/entry', {
        method: 'POST',
        body: JSON.stringify({ location: data.location, reference: data.reference, source: 'xml', items: state.xmlItems })
      });
      state.xmlItems = [];
      notify('Entrada por XML registrada.');
    }
    if (action === 'stock-exit') {
      await api('/api/stock/exit', { method: 'POST', body: JSON.stringify(data) });
      notify('Saida registrada.');
    }
    if (action === 'create-product') {
      await api('/api/products', { method: 'POST', body: JSON.stringify(data) });
      notify('Produto cadastrado.');
    }
    if (action === 'create-vet') {
      await api('/api/users/veterinarians', { method: 'POST', body: JSON.stringify(data) });
      notify('Veterinario cadastrado.');
    }
    if (action === 'vet-record') {
      await api('/api/vet-records', {
        method: 'POST',
        body: JSON.stringify({
          commandNumber: data.commandNumber,
          location: data.location,
          notes: data.notes,
          items: collectItems(form)
        })
      });
      notify('Registro enviado.');
    }
    await refresh(true);
  } catch (error) {
    notify(error.message);
  }
}

async function handleClick(event) {
  const target = event.target.closest('button');
  if (!target) return;

  if (target.dataset.view) {
    state.view = target.dataset.view;
    renderApp();
    if (state.view === 'logs') hydrateLogs();
    return;
  }

  if (target.dataset.demo) {
    const creds = {
      admin: ['admin@vetstock.local', 'Admin#2026!'],
      manager: ['gerente@vetstock.local', 'Gerente#2026!'],
      veterinarian: ['vet@vetstock.local', 'Vet#2026!']
    }[target.dataset.demo];
    document.querySelector('[name="email"]').value = creds[0];
    document.querySelector('[name="password"]').value = creds[1];
    return;
  }

  const action = target.dataset.action;
  if (!action) return;

  try {
    if (action === 'logout') {
      await api('/api/logout', { method: 'POST', body: '{}' });
      state.user = null;
      state.data = null;
      renderLogin();
      return;
    }
    if (action === 'refresh') {
      await refresh(true);
      if (state.view === 'logs') hydrateLogs();
      notify('Dados atualizados.');
      return;
    }
    if (action === 'add-item') {
      const form = target.closest('form');
      form.querySelector('[data-items]').insertAdjacentHTML('beforeend', itemRow());
      return;
    }
    if (action === 'remove-item') {
      const rows = target.closest('form').querySelectorAll('[data-item-row]');
      if (rows.length > 1) target.closest('[data-item-row]').remove();
      return;
    }
    if (action === 'approve-record' || action === 'reject-record') {
      const reviewNotes =
        action === 'reject-record' ? prompt('Motivo da rejeicao') || 'Rejeitado na conferencia' : 'Conferido e aprovado';
      const path = `/api/vet-records/${target.dataset.id}/${action === 'approve-record' ? 'approve' : 'reject'}`;
      await api(path, { method: 'POST', body: JSON.stringify({ reviewNotes }) });
      await refresh(true);
      notify(action === 'approve-record' ? 'Registro aprovado.' : 'Registro rejeitado.');
    }
  } catch (error) {
    notify(error.message);
  }
}

async function hydrateLogs() {
  if (state.user?.role !== 'admin') return;
  try {
    const report = await api('/api/reports');
    const body = document.querySelector('#logs-body');
    if (!body) return;
    body.innerHTML = report.logs
      .map(
        (log) => `
        <tr>
          <td>${fmtDate(log.created_at)}</td>
          <td>${escapeHtml(log.actor_name)}</td>
          <td>${escapeHtml(log.actor_role || '-')}</td>
          <td>${escapeHtml(log.action)}</td>
          <td>${escapeHtml(log.entity)} #${escapeHtml(log.entity_id || '-')}</td>
          <td>${escapeHtml(log.details || '{}')}</td>
        </tr>`
      )
      .join('');
  } catch (error) {
    notify(error.message);
  }
}

document.addEventListener('submit', handleSubmit);
document.addEventListener('click', handleClick);

api('/api/me')
  .then(() => refresh(false))
  .catch(() => renderLogin());
