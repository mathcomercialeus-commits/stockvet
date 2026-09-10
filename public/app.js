const app = document.querySelector('#app');

const state = {
  user: null,
  data: null,
  view: 'dashboard',
  reportMonths: {
    entry: '',
    exit: ''
  }
};

const roleTabs = {
  admin: [
    ['dashboard', 'Dashboard'],
    ['stock', 'Estoque'],
    ['entry', 'Entrada manual'],
    ['exit', 'Saida'],
    ['stockAudit', 'Balanco'],
    ['reports', 'Relatorios'],
    ['logs', 'Logs'],
    ['users', 'Usuarios'],
    ['registrations', 'Cadastros']
  ],
  manager: [
    ['dashboard', 'Painel'],
    ['stock', 'Estoque'],
    ['entry', 'Entrada manual'],
    ['exit', 'Saida']
  ]
};

const roleInitialView = {
  admin: 'dashboard',
  manager: 'dashboard'
};

const locationLabels = {
  internal: 'Estoque'
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

function monthKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value) {
  if (!value) return 'Todos os meses';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return 'Todos os meses';
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function productOptions() {
  return state.data.products
    .filter((product) => product.active)
    .map((product) => `<option value="${product.id}">${escapeHtml(product.name)} (${escapeHtml(product.sku)})</option>`)
    .join('');
}

function productLookupValue(product) {
  return `${product.name} (${product.sku})`;
}

function productSuggestionOptions() {
  return state.data.products
    .filter((product) => product.active)
    .map((product) => `<option value="${escapeHtml(productLookupValue(product))}"></option>`)
    .join('');
}

function locationLabel(location) {
  return locationLabels[location] || 'Estoque';
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
          <p>Controle interno de estoque, conferencias e relatorios em uma rotina simples para clinicas veterinarias.</p>
        </div>
        <p>Estoque unico com rastreabilidade desde a entrada ate a saida.</p>
      </section>
      <section class="login-panel">
        <form class="login-card" data-action="login">
          <h2>Entrar</h2>
          <p class="muted">Acesse com seu perfil de trabalho.</p>
          <label class="field">
            Login
            <input name="email" type="text" autocomplete="username" required />
          </label>
          <label class="field">
            Senha
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <button class="btn full" type="submit">Entrar</button>
        </form>
      </section>
    </main>
  `;
}

function renderApp() {
  const tabs = roleTabs[state.user.role] || roleTabs.manager;
  const initialView = roleInitialView[state.user.role] || tabs[0]?.[0] || 'dashboard';
  if (!tabs.some(([id]) => id === state.view)) state.view = initialView;
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
    stockAudit: renderStockAudit,
    reports: renderReports,
    logs: renderLogs,
    users: renderUsers,
    registrations: renderRegistrations,
    entry: renderEntry,
    exit: renderExit,
    stock: renderStock
  };
  return views[state.view]?.() || renderDashboard();
}

function renderDashboard() {
  const d = state.data.dashboard;
  return `
    ${pageHeader('Dashboard', 'Resumo do estoque e movimentos recentes.')}
    <section class="stat-grid">
      ${Object.entries(d.totalsByLocation)
        .map(([location, total]) => `<div class="stat"><span>${locationLabel(location)}</span><strong>${total}</strong></div>`)
        .join('')}
    </section>
    <section class="grid cols-2" style="margin-top:16px">
      <div class="card">
        <h2>Alertas</h2>
        ${d.lowStock.length ? renderLowStockTable(d.lowStock) : '<div class="empty">Nenhum produto abaixo do minimo.</div>'}
      </div>
      <div class="card">
        <h2>Operacao</h2>
        <div class="stat-grid" style="grid-template-columns:1fr">
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

function renderStockAudit() {
  return `
    ${pageHeader('Balanco de estoque', 'Conte o estoque fisico, compare com o sistema e gere auditoria.')}
    <section class="grid cols-2">
      <form class="card" data-action="stock-audit">
        <h2>Nova conferencia</h2>
        <div class="grid cols-2">
          <input name="location" type="hidden" value="internal" />
          <label class="field">Estoque<input value="Estoque" disabled /></label>
          <label class="field">Aplicar ajuste
            <select name="applyAdjustments">
              <option value="false">Somente auditar</option>
              <option value="true">Auditar e ajustar saldo</option>
            </select>
          </label>
        </div>
        <label class="field">Observacao<textarea name="notes" placeholder="Responsavel pela contagem, turno ou justificativa"></textarea></label>
        <div class="table-wrap audit-counts">
          <table>
            <thead><tr><th>Produto</th><th>Saldo no estoque</th><th>Contagem fisica</th><th>Medida</th></tr></thead>
            <tbody>
              ${state.data.products.map((product) => auditCountRow(product)).join('')}
            </tbody>
          </table>
        </div>
        <button class="btn full" type="submit">Salvar balanco</button>
      </form>
      <div class="card">
        <h2>Historico de auditorias</h2>
        ${renderStockAudits(state.data.stockAudits || [])}
      </div>
    </section>
  `;
}

function renderReports() {
  return `
    ${pageHeader('Relatorios', 'Entradas, saidas e historico do estoque.')}
    ${renderMovementReport('entry', 'Todas as entradas')}
    ${renderMovementReport('exit', 'Relatorio de saidas')}
    <section class="card screen-only" style="margin-top:16px"><h2>Estoque</h2>${renderInventory()}</section>
    <section class="card screen-only" style="margin-top:16px"><h2>Auditorias de estoque</h2>${renderStockAudits(state.data.stockAudits || [])}</section>
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

function renderEntry() {
  return `
    ${pageHeader('Entrada manual', 'Lancamento de produtos recebidos.')}
    <section class="card no-print">
      <form data-action="manual-entry">
        <div class="grid cols-2">
          <input name="location" type="hidden" value="internal" />
          <label class="field">Estoque<input value="Estoque" disabled /></label>
          <label class="field">Referencia<input name="reference" placeholder="NF, pedido ou observacao" /></label>
        </div>
        <datalist id="product-suggestions">${productSuggestionOptions()}</datalist>
        <div data-items>
          ${itemRow()}
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="btn secondary" type="button" data-action="add-item">Adicionar produto</button>
          <button class="btn" type="submit">Salvar entrada</button>
        </div>
      </form>
    </section>
    ${renderMovementReport('entry', 'Todas as entradas')}
  `;
}

function renderExit() {
  return `
    ${pageHeader('Saida manual', 'Baixa com motivo registrado.')}
    <section class="card no-print">
      <form data-action="stock-exit">
        <div class="grid cols-2">
          <input name="location" type="hidden" value="internal" />
          <label class="field">Estoque<input value="Estoque" disabled /></label>
          <label class="field">Motivo<input name="reason" required placeholder="Perda, vencimento, ajuste..." /></label>
        </div>
        <div data-items>
          ${productItemRow()}
        </div>
        <div class="actions" style="margin-top:12px">
          <button class="btn secondary" type="button" data-action="add-item">Adicionar produto</button>
          <button class="btn" type="submit">Salvar saida</button>
        </div>
      </form>
    </section>
    ${renderMovementReport('exit', 'Relatorio de saidas')}
  `;
}

function renderStock() {
  return `
    ${pageHeader('Estoque', 'Saldo disponivel.')}
    <section class="card">${renderInventory()}</section>
  `;
}

function itemRow() {
  if (state.view === 'entry') return entryItemRow();
  return productItemRow();
}

function productItemRow() {
  return `
    <div class="form-row" data-item-row>
      <select name="productId">${productOptions()}</select>
      <input name="quantity" type="number" min="0.01" step="0.01" placeholder="Qtd." required />
      <button class="icon-btn" type="button" data-action="remove-item" title="Remover">x</button>
    </div>
  `;
}

function entryItemRow() {
  return `
    <div class="form-row entry-row" data-item-row>
      <input name="name" list="product-suggestions" placeholder="Digite o produto" autocomplete="off" required />
      <input name="quantity" type="number" min="0.01" step="0.01" placeholder="Qtd." required />
      <button class="icon-btn" type="button" data-action="remove-item" title="Remover">x</button>
    </div>
  `;
}

function quantityUnitOptions(selected = 'un') {
  return ['un', 'ml']
    .map((unit) => `<option value="${unit}" ${selected === unit ? 'selected' : ''}>${unit === 'un' ? 'Unidade' : 'ml'}</option>`)
    .join('');
}

function auditCountRow(product) {
  return `
    <tr data-audit-row data-product-id="${product.id}">
      <td>${escapeHtml(product.name)}<br><span class="muted">${escapeHtml(product.sku)}</span></td>
      <td data-current>${formatBalance(product, 'internal')}</td>
      <td><input name="countedQuantity" type="number" min="0" step="0.01" placeholder="Nao contado" /></td>
      <td><select name="countedUnit">${quantityUnitOptions(product.unit)}</select></td>
    </tr>
  `;
}

function renderStockAudits(audits) {
  if (!audits.length) return '<div class="empty">Nenhum balanco registrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Estoque</th><th>Itens</th><th>Divergencias</th><th>Ajuste</th><th>Responsavel</th></tr></thead>
        <tbody>
          ${audits
            .map(
              (audit) => `
              <tr>
                <td>${fmtDate(audit.created_at)}</td>
                <td>${locationLabel(audit.location)}</td>
                <td>${audit.item_count || 0}</td>
                <td>${audit.divergence_count || 0}</td>
                <td>${audit.apply_adjustments ? 'Aplicado' : 'Nao aplicado'}</td>
                <td>${escapeHtml(audit.actor_name || '-')}</td>
              </tr>
              <tr>
                <td colspan="6">${renderStockAuditItems(audit.items || [])}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStockAuditItems(items) {
  if (!items.length) return '<span class="muted">Sem itens registrados.</span>';
  return `
    <div class="audit-detail">
      ${items
        .map((item) => {
          const status = Math.abs(Number(item.difference || 0)) > 0.0001 ? 'pending' : 'approved';
          return `<span class="tag ${status}">${escapeHtml(item.product_name)}: sistema ${formatNumber(item.expected_quantity)} ${escapeHtml(item.unit)}, contado ${formatNumber(item.counted_quantity)} ${escapeHtml(item.counted_unit)}, dif. ${formatNumber(item.difference)} ${escapeHtml(item.unit)}</span>`;
        })
        .join('')}
    </div>
  `;
}

function renderInventory() {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Produto</th><th>SKU</th><th>Un.</th><th>ml/un.</th><th>Min.</th><th>Saldo</th></tr>
        </thead>
        <tbody>
          ${state.data.products
            .map(
              (product) => `
              <tr>
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.sku)}</td>
                <td>${escapeHtml(product.unit)}</td>
                <td>${product.ml_per_unit || '-'}</td>
                <td>${product.min_stock}</td>
                <td>${formatBalance(product, 'internal')}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function formatBalance(product, location) {
  const value = Number(product.balances[location] || 0);
  const main = `${formatNumber(value)} ${product.unit}`;
  if (product.unit === 'un' && product.ml_per_unit) {
    return `${main}<br><span class="muted">${formatNumber(value * Number(product.ml_per_unit))} ml</span>`;
  }
  if (product.unit === 'ml' && product.ml_per_unit) {
    return `${main}<br><span class="muted">${formatNumber(value / Number(product.ml_per_unit))} un</span>`;
  }
  return main;
}

function formatNumber(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
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
                <td><span class="tag">${movementTypeLabel(m.type)}</span></td>
                <td>${escapeHtml(m.product_name)}</td>
                <td>${locationLabel(m.location)}</td>
                <td>${formatNumber(m.quantity)} ${escapeHtml(m.quantity_unit || '')}</td>
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

function movementTypeLabel(type) {
  return { entry: 'Entrada', exit: 'Saida', vet_usage: 'Uso' }[type] || escapeHtml(type);
}

function movementsByType(type) {
  const selectedMonth = state.reportMonths[type] || '';
  return (state.data.movements || []).filter((movement) => {
    if (movement.type !== type) return false;
    return !selectedMonth || monthKey(movement.created_at) === selectedMonth;
  });
}

function renderMovementReport(type, title) {
  const movements = movementsByType(type);
  const selectedMonth = state.reportMonths[type] || '';
  return `
    <section class="card print-section" data-report-type="${type}" style="margin-top:16px">
      <div class="report-heading">
        <div>
          <h2>${title}</h2>
          <div class="muted">${movements.length} movimento(s) registrado(s) - ${monthLabel(selectedMonth)}</div>
        </div>
        <div class="report-actions screen-only">
          <label class="field compact">Mes
            <input name="reportMonth" type="month" value="${escapeHtml(selectedMonth)}" data-action="report-month-filter" data-report-type="${type}" />
          </label>
          <button class="btn secondary" type="button" data-action="clear-report-month" data-report-type="${type}">Limpar</button>
          <button class="btn secondary" type="button" data-action="print-report" data-report-type="${type}">Imprimir relatorio</button>
        </div>
      </div>
      <div class="print-only">
        <h1>${title}</h1>
        <p>${monthLabel(selectedMonth)} - gerado em ${fmtDate(new Date().toISOString())}</p>
      </div>
      ${renderMovements(movements)}
    </section>
  `;
}

function renderUsersTable(filterRole = '', withActions = false, allowedRoles = []) {
  const users = state.data.users.filter((user) => {
    const roleMatches = !filterRole || user.role === filterRole;
    const allowedMatches = !allowedRoles.length || allowedRoles.includes(user.role);
    return roleMatches && allowedMatches;
  });
  if (!users.length) return '<div class="empty">Nenhum usuario cadastrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Criado em</th><th>Acoes</th></tr></thead>
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
                <td>${withActions ? deleteUserButton(user) : '-'}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderUsers() {
  const roles = ['admin', 'manager'];
  return `
    ${pageHeader('Usuarios', 'Crie e exclua acessos da administracao.')}
    <section class="grid cols-2">
      <form class="card" data-action="create-user">
        <h2>Novo usuario</h2>
        <label class="field">Nome<input name="name" required /></label>
        <label class="field">E-mail<input name="email" type="email" required /></label>
        <label class="field">Perfil<select name="role">${roles.map((role) => `<option value="${role}">${roleLabel(role)}</option>`).join('')}</select></label>
        <label class="field">Senha inicial<input name="password" type="password" required /></label>
        <button class="btn full" type="submit">Cadastrar</button>
      </form>
      <div class="card"><h2>Administracao</h2>${renderUsersTable('', true, roles)}</div>
    </section>
  `;
}

function renderRegistrations() {
  return `
    ${pageHeader('Cadastros', 'Exclusao segura de cadastros de produtos.')}
    <section class="card">
      <h2>Produtos cadastrados</h2>
      ${renderProductRegistrations()}
    </section>
  `;
}

function renderProductRegistrations() {
  if (!state.data.products.length) return '<div class="empty">Nenhum produto cadastrado.</div>';
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Produto</th><th>Codigo</th><th>Unidade</th><th>Saldo total</th><th>Status</th><th>Acoes</th></tr></thead>
        <tbody>
          ${state.data.products
            .map((product) => {
              const total = productTotal(product);
              return `
                <tr>
                  <td>${escapeHtml(product.name)}</td>
                  <td>${escapeHtml(product.sku)}</td>
                  <td>${escapeHtml(product.unit)}${product.ml_per_unit ? ` (${formatNumber(product.ml_per_unit)} ml/un.)` : ''}</td>
                  <td>${formatNumber(total)} ${escapeHtml(product.unit)}</td>
                  <td>${product.active ? 'Ativo' : 'Inativo'}</td>
                  <td>${deleteProductButton(product, total)}</td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function productTotal(product) {
  return Object.values(product.balances).reduce((sum, value) => sum + Math.abs(Number(value || 0)), 0);
}

function deleteProductButton(product, total) {
  if (!product.active) return '-';
  return `<button class="btn danger" data-action="delete-product" data-id="${product.id}" data-name="${escapeHtml(product.name)}" data-total="${formatNumber(total)}" data-unit="${escapeHtml(product.unit)}">Excluir</button>`;
}

function roleLabel(role) {
  return { admin: 'Administrador', manager: 'Gerente' }[role] || role;
}

function deleteUserButton(user) {
  const allowed =
    user.active &&
    user.id !== state.user.id &&
    state.user.role === 'admin' &&
    ['admin', 'manager'].includes(user.role);
  if (!allowed) return '-';
  return `<button class="btn danger" data-action="delete-user" data-id="${user.id}" data-name="${escapeHtml(user.name)}">Excluir</button>`;
}

function collectItems(form) {
  return [...form.querySelectorAll('[data-item-row]')]
    .map((row) => {
      const typedName = row.querySelector('[name="name"]')?.value || '';
      const matchedProduct = typedName ? findProductByEntryName(typedName) : null;
      const selectedProductId = Number(row.querySelector('[name="productId"]')?.value || matchedProduct?.id || 0);
      return {
        productId: selectedProductId,
        name: selectedProductId ? '' : typedName,
        quantity: Number(row.querySelector('[name="quantity"]').value),
        quantityUnit: row.querySelector('[name="quantityUnit"]')?.value
      };
    })
    .filter((item) => (item.productId || item.name) && item.quantity > 0);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function findProductByEntryName(value) {
  const normalized = normalizeSearchText(value);
  return state.data.products.find((product) => {
    if (!product.active) return false;
    return (
      normalizeSearchText(productLookupValue(product)) === normalized ||
      normalizeSearchText(product.name) === normalized ||
      normalizeSearchText(product.sku) === normalized
    );
  });
}

function syncEntryProductFields(input) {
  const product = findProductByEntryName(input.value);
  if (!product) return;
  input.title = `Cadastro selecionado: ${product.name} (${product.sku})`;
}

function collectStockAuditItems(form) {
  return [...form.querySelectorAll('[data-audit-row]')]
    .map((row) => ({
      productId: Number(row.dataset.productId),
      countedQuantity: row.querySelector('[name="countedQuantity"]').value,
      countedUnit: row.querySelector('[name="countedUnit"]').value
    }))
    .filter((item) => item.countedQuantity !== '')
    .map((item) => ({ ...item, countedQuantity: Number(item.countedQuantity) }));
}

function updateAuditCurrentBalances(select) {
  const location = select.value;
  document.querySelectorAll('[data-audit-row]').forEach((row) => {
    const product = state.data.products.find((item) => item.id === Number(row.dataset.productId));
    const current = row.querySelector('[data-current]');
    if (product && current) current.innerHTML = formatBalance(product, location);
  });
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
    if (action === 'stock-exit') {
      await api('/api/stock/exit', {
        method: 'POST',
        body: JSON.stringify({ location: data.location, reason: data.reason, items: collectItems(form) })
      });
      notify('Saida registrada.');
    }
    if (action === 'stock-audit') {
      await api('/api/stock-audits', {
        method: 'POST',
        body: JSON.stringify({
          location: data.location,
          notes: data.notes,
          applyAdjustments: data.applyAdjustments === 'true',
          items: collectStockAuditItems(form)
        })
      });
      notify('Balanco registrado.');
    }
    if (action === 'create-user') {
      await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
      notify('Usuario cadastrado.');
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
    if (action === 'delete-user') {
      if (!confirm(`Excluir o usuario ${target.dataset.name}?`)) return;
      await api(`/api/users/${target.dataset.id}`, { method: 'DELETE' });
      await refresh(true);
      notify('Usuario excluido.');
      return;
    }
    if (action === 'delete-product') {
      const total = Number(target.dataset.total || 0);
      const balanceWarning =
        total > 0
          ? `\n\nEste cadastro tem saldo total de ${target.dataset.total} ${target.dataset.unit}. O cadastro sera inativado e o historico sera preservado.`
          : '';
      if (!confirm(`Excluir o cadastro ${target.dataset.name}?${balanceWarning}`)) return;
      await api(`/api/products/${target.dataset.id}`, { method: 'DELETE' });
      await refresh(true);
      notify('Cadastro excluido.');
      return;
    }
    if (action === 'print-report') {
      if (target.dataset.reportType) document.body.dataset.printReport = target.dataset.reportType;
      window.print();
      return;
    }
    if (action === 'clear-report-month') {
      state.reportMonths[target.dataset.reportType] = '';
      renderApp();
      return;
    }
  } catch (error) {
    notify(error.message);
  }
}

async function handleChange(event) {
  if (event.target.matches('form[data-action="manual-entry"] input[name="name"]')) {
    syncEntryProductFields(event.target);
  }
  if (event.target.matches('[data-action="report-month-filter"]')) {
    state.reportMonths[event.target.dataset.reportType] = event.target.value;
    renderApp();
  }
  if (event.target.matches('[data-action="audit-location-change"]')) {
    updateAuditCurrentBalances(event.target);
  }
}

function handleInput(event) {
  if (event.target.matches('form[data-action="manual-entry"] input[name="name"]')) {
    syncEntryProductFields(event.target);
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
document.addEventListener('change', handleChange);
document.addEventListener('input', handleInput);
window.addEventListener('afterprint', () => {
  delete document.body.dataset.printReport;
});

api('/api/me')
  .then(() => refresh(false))
  .catch(() => renderLogin());
