import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 3000);
const ROOT = resolve(import.meta.dirname);
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'vet-stock.sqlite');
const SESSION_TTL_MS = 1000 * 60 * 60 * 10;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
const sessions = new Map();

const roleNames = {
  admin: 'Administrador',
  manager: 'Gerente',
  veterinarian: 'Veterinario'
};

const locations = [
  ['internal', 'Estoque interno'],
  ['consultorio1', 'Consultorio 1'],
  ['consultorio2', 'Consultorio 2'],
  ['internacao', 'Internacao']
];

function exec(sql) {
  db.exec(sql);
}

function run(sql, params = {}) {
  return db.prepare(sql).run(params);
}

function all(sql, params = {}) {
  return db.prepare(sql).all(params);
}

function get(sql, params = {}) {
  return db.prepare(sql).get(params);
}

function now() {
  return new Date().toISOString();
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, key] = stored.split(':');
  const attempted = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === attempted.length && timingSafeEqual(expected, attempted);
}

function initDb() {
  exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'veterinarian')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'un',
      ml_per_unit REAL,
      min_stock REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_balances (
      product_id INTEGER NOT NULL,
      location TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, location),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('entry', 'exit', 'vet_usage')),
      quantity REAL NOT NULL,
      quantity_unit TEXT NOT NULL DEFAULT 'un',
      quantity_base REAL,
      reason TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      reference TEXT,
      created_by INTEGER NOT NULL,
      approved_record_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS vet_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_number TEXT NOT NULL,
      location TEXT NOT NULL,
      veterinarian_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
      notes TEXT,
      reviewer_id INTEGER,
      review_notes TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (veterinarian_id) REFERENCES users(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS vet_record_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      quantity_unit TEXT NOT NULL DEFAULT 'un',
      quantity_base REAL,
      FOREIGN KEY (record_id) REFERENCES vet_records(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      notes TEXT,
      apply_adjustments INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS stock_audit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      expected_quantity REAL NOT NULL,
      counted_quantity REAL NOT NULL,
      counted_unit TEXT NOT NULL DEFAULT 'un',
      counted_base REAL NOT NULL,
      difference REAL NOT NULL,
      FOREIGN KEY (audit_id) REFERENCES stock_audits(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
  migrateSchema();

  if (!get('SELECT id FROM users WHERE email = @email', { email: 'admin@vetstock.local' })) {
    createSeedUser('Administrador', 'admin@vetstock.local', 'Admin#2026!', 'admin');
  }

  const productCount = get('SELECT COUNT(*) AS total FROM products').total;
  if (productCount === 0) {
    [
      ['MED-001', 'Dipirona 500mg/ml', 'ml', 20],
      ['MAT-002', 'Seringa 5ml', 'un', 50],
      ['HIG-003', 'Clorexidina 2%', 'ml', 100],
      ['MED-004', 'Enrofloxacino 50mg', 'cp', 30]
    ].forEach(([sku, name, unit, minStock]) => {
      const id = run(
        'INSERT INTO products (sku, name, unit, ml_per_unit, min_stock, created_at) VALUES (@sku, @name, @unit, @mlPerUnit, @minStock, @createdAt)',
        { sku, name, unit, mlPerUnit: null, minStock, createdAt: now() }
      ).lastInsertRowid;
      locations.forEach(([location]) => setBalance(id, location, 0));
    });
  }
}

function migrateSchema() {
  [
    'ALTER TABLE products ADD COLUMN ml_per_unit REAL',
    "ALTER TABLE movements ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT 'un'",
    'ALTER TABLE movements ADD COLUMN quantity_base REAL',
    "ALTER TABLE vet_record_items ADD COLUMN quantity_unit TEXT NOT NULL DEFAULT 'un'",
    'ALTER TABLE vet_record_items ADD COLUMN quantity_base REAL',
    "ALTER TABLE stock_audit_items ADD COLUMN counted_unit TEXT NOT NULL DEFAULT 'un'",
    'ALTER TABLE stock_audit_items ADD COLUMN counted_base REAL'
  ].forEach((statement) => {
    try {
      db.exec(statement);
    } catch (error) {
      if (!String(error.message).includes('duplicate column name')) throw error;
    }
  });
  run('UPDATE movements SET quantity_base = quantity WHERE quantity_base IS NULL');
  run('UPDATE vet_record_items SET quantity_base = quantity WHERE quantity_base IS NULL');
  run('UPDATE stock_audit_items SET counted_base = counted_quantity WHERE counted_base IS NULL');
}

function nextInternalSku() {
  const value = get("SELECT seq FROM sqlite_sequence WHERE name = 'products'")?.seq || 0;
  return `INT-${String(Number(value) + 1).padStart(5, '0')}`;
}

function normalizeUnit(unit) {
  return unit === 'ml' ? 'ml' : 'un';
}

function normalizeQuantityUnit(unit) {
  return unit === 'ml' ? 'ml' : 'un';
}

function getProduct(productId) {
  const product = get('SELECT * FROM products WHERE id = @id AND active = 1', { id: productId });
  if (!product) throw httpError(404, 'Produto nao encontrado.');
  return product;
}

function normalizeMlPerUnit(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function conversionFactor(product) {
  const factor = normalizeMlPerUnit(product.ml_per_unit);
  if (!factor) throw httpError(400, `Informe ml por unidade para usar ${product.name} em outra medida.`);
  return factor;
}

function toStockQuantity(product, quantity, quantityUnit) {
  const normalizedQuantity = Number(quantity);
  const normalizedUnit = normalizeQuantityUnit(quantityUnit || product.unit);
  if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0) {
    throw httpError(400, 'Quantidade invalida.');
  }
  if (product.unit === normalizedUnit) return normalizedQuantity;
  const factor = conversionFactor(product);
  return product.unit === 'un' ? normalizedQuantity / factor : normalizedQuantity * factor;
}

function formatQuantity(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function ensureManualProduct(item, actor) {
  if (item.productId) return Number(item.productId);
  const name = String(item.name || '').trim();
  if (!name) throw httpError(400, 'Informe o nome do produto.');
  const unit = normalizeUnit(item.unit);
  const mlPerUnit = normalizeMlPerUnit(item.mlPerUnit);
  const existing = get(
    'SELECT id FROM products WHERE lower(name) = lower(@name) AND unit = @unit AND active = 1',
    { name, unit }
  );
  if (existing) {
    updateMlPerUnitIfNeeded(existing.id, mlPerUnit);
    return existing.id;
  }
  const sku = nextInternalSku();
  const id = run(
    'INSERT INTO products (sku, name, unit, ml_per_unit, min_stock, created_at) VALUES (@sku, @name, @unit, @mlPerUnit, @minStock, @createdAt)',
    { sku, name, unit, mlPerUnit, minStock: Number(item.minStock || 0), createdAt: now() }
  ).lastInsertRowid;
  locations.forEach(([location]) => setBalance(id, location, 0));
  audit(actor, 'product.created_manual_entry', 'product', id, { sku, name, unit, mlPerUnit });
  return id;
}

function updateMlPerUnitIfNeeded(productId, mlPerUnit) {
  if (!mlPerUnit) return;
  const product = get('SELECT ml_per_unit FROM products WHERE id = @id', { id: productId });
  if (!product?.ml_per_unit) {
    run('UPDATE products SET ml_per_unit = @mlPerUnit WHERE id = @id', { id: productId, mlPerUnit });
  }
}

function createSeedUser(name, email, password, role) {
  run(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (@name, @email, @passwordHash, @role, @createdAt)',
    { name, email, passwordHash: hashPassword(password), role, createdAt: now() }
  );
}

function setBalance(productId, location, quantity) {
  run(
    `INSERT INTO stock_balances (product_id, location, quantity)
     VALUES (@productId, @location, @quantity)
     ON CONFLICT(product_id, location) DO UPDATE SET quantity = @quantity`,
    { productId, location, quantity }
  );
}

function changeStock(productId, location, delta) {
  const current = get(
    'SELECT quantity FROM stock_balances WHERE product_id = @productId AND location = @location',
    { productId, location }
  );
  const next = Number(current?.quantity || 0) + Number(delta);
  if (next < 0) throw httpError(400, 'Estoque insuficiente para concluir a movimentacao.');
  setBalance(productId, location, next);
}

function audit(actor, action, entity, entityId, details = {}) {
  run(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, details, created_at)
     VALUES (@actorId, @actorName, @actorRole, @action, @entity, @entityId, @details, @createdAt)`,
    {
      actorId: actor?.id || null,
      actorName: actor?.name || 'Sistema',
      actorRole: actor?.role || null,
      action,
      entity,
      entityId: entityId == null ? null : String(entityId),
      details: JSON.stringify(details),
      createdAt: now()
    }
  );
}

function locationIsValid(value) {
  return locations.some(([id]) => id === value);
}

function createSession(user) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function readSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)vetstock_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = get('SELECT id, name, email, role, active, created_at FROM users WHERE id = @id AND active = 1', {
    id: session.userId
  });
  if (!user) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, user };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, { error: error.message || 'Erro interno.' });
  if (status >= 500) console.error(error);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireAuth(req) {
  const session = readSession(req);
  if (!session) throw httpError(401, 'Login necessario.');
  return session.user;
}

function requireRole(user, roles) {
  if (!roles.includes(user.role)) throw httpError(403, 'Permissao insuficiente.');
}

function canManageUser(actor, targetRole) {
  if (actor.role === 'admin') return ['admin', 'manager'].includes(targetRole);
  if (actor.role === 'manager') return targetRole === 'veterinarian';
  return false;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if ((req.headers['content-type'] || '').includes('application/json')) {
    return JSON.parse(raw);
  }
  return { raw };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: Boolean(user.active),
    created_at: user.created_at,
    role_label: roleNames[user.role]
  };
}

function inventorySnapshot() {
  const rows = all(`
    SELECT p.id, p.sku, p.name, p.unit, p.ml_per_unit, p.min_stock, p.active, b.location, b.quantity
    FROM products p
    LEFT JOIN stock_balances b ON b.product_id = p.id
    ORDER BY p.name, b.location
  `);
  const products = new Map();
  rows.forEach((row) => {
    if (!products.has(row.id)) {
      products.set(row.id, {
        id: row.id,
        sku: row.sku,
        name: row.name,
        unit: row.unit,
        ml_per_unit: row.ml_per_unit,
        min_stock: row.min_stock,
        active: Boolean(row.active),
        balances: Object.fromEntries(locations.map(([id]) => [id, 0]))
      });
    }
    if (row.location) products.get(row.id).balances[row.location] = row.quantity;
  });
  return [...products.values()];
}

function movementRows(limit = 100) {
  return all(
    `SELECT m.*, p.name AS product_name, p.sku, u.name AS actor_name
     FROM movements m
     JOIN products p ON p.id = m.product_id
     JOIN users u ON u.id = m.created_by
     ORDER BY m.created_at DESC
     LIMIT @limit`,
    { limit }
  );
}

function vetRecords(user) {
  const scope = user.role === 'veterinarian' ? 'WHERE vr.veterinarian_id = @userId' : '';
  const params = user.role === 'veterinarian' ? { userId: user.id } : {};
  const records = all(
    `SELECT vr.*, u.name AS veterinarian_name, reviewer.name AS reviewer_name
     FROM vet_records vr
     JOIN users u ON u.id = vr.veterinarian_id
     LEFT JOIN users reviewer ON reviewer.id = vr.reviewer_id
     ${scope}
     ORDER BY vr.created_at DESC`,
    params
  );
  const items = all(`
    SELECT vri.record_id, vri.product_id, vri.quantity, vri.quantity_unit, vri.quantity_base, p.name AS product_name, p.sku, p.unit, p.ml_per_unit
    FROM vet_record_items vri
    JOIN products p ON p.id = vri.product_id
  `);
  const grouped = Map.groupBy(items, (item) => item.record_id);
  return records.map((record) => ({ ...record, items: grouped.get(record.id) || [] }));
}

function dashboards() {
  const products = inventorySnapshot();
  const totalsByLocation = Object.fromEntries(locations.map(([id]) => [id, 0]));
  products.forEach((product) => {
    Object.entries(product.balances).forEach(([location, quantity]) => {
      totalsByLocation[location] += quantity;
    });
  });
  const lowStock = products.filter((product) => {
    const total = Object.values(product.balances).reduce((sum, value) => sum + Number(value), 0);
    return total <= product.min_stock;
  });
  const pendingRecords = get("SELECT COUNT(*) AS total FROM vet_records WHERE status = 'pending'").total;
  const movementsToday = get("SELECT COUNT(*) AS total FROM movements WHERE date(created_at) = date('now')").total;
  return { totalsByLocation, lowStock, pendingRecords, movementsToday };
}

function parseXmlProducts(xml) {
  const cleaned = xml.replace(/\r?\n/g, ' ');
  const detBlocks = [...cleaned.matchAll(/<det\b[^>]*>(.*?)<\/det>/gi)].map((match) => match[1]);
  const blocks = detBlocks.length ? detBlocks : [...cleaned.matchAll(/<prod\b[^>]*>(.*?)<\/prod>/gi)].map((match) => match[1]);
  return blocks
    .map((block) => {
      const prod = block.match(/<prod\b[^>]*>(.*?)<\/prod>/i)?.[1] || block;
      const text = (tag) => prod.match(new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, 'i'))?.[1]?.trim() || '';
      const sku = text('cProd') || text('sku');
      const name = text('xProd') || text('name');
      const unit = text('uCom') || text('unit') || 'un';
      const quantity = Number(String(text('qCom') || text('quantity') || '0').replace(',', '.'));
      return { sku, name, unit, quantity: Number.isFinite(quantity) ? quantity : 0 };
    })
    .filter((item) => item.sku && item.name && item.quantity > 0);
}

function ensureProductFromXml(item, actor) {
  const existing = get('SELECT id FROM products WHERE sku = @sku', { sku: item.sku });
  const mlPerUnit = normalizeMlPerUnit(item.mlPerUnit);
  if (existing) {
    updateMlPerUnitIfNeeded(existing.id, mlPerUnit);
    return existing.id;
  }
  const unit = normalizeUnit(item.unit);
  const id = run(
    'INSERT INTO products (sku, name, unit, ml_per_unit, min_stock, created_at) VALUES (@sku, @name, @unit, @mlPerUnit, 0, @createdAt)',
    { sku: item.sku, name: item.name, unit, mlPerUnit, createdAt: now() }
  ).lastInsertRowid;
  locations.forEach(([location]) => setBalance(id, location, 0));
  audit(actor, 'product.created_from_xml', 'product', id, { ...item, unit, mlPerUnit });
  return id;
}

function visibleUsersFor(user) {
  if (user.role === 'veterinarian') return [];
  const sql =
    user.role === 'manager'
      ? "SELECT id, name, email, role, active, created_at FROM users WHERE role = 'veterinarian' ORDER BY name"
      : 'SELECT id, name, email, role, active, created_at FROM users ORDER BY name';
  return all(sql);
}

function stockAuditRows(limit = 50) {
  const audits = all(
    `SELECT sa.*, u.name AS actor_name,
            COUNT(sai.id) AS item_count,
            SUM(CASE WHEN ABS(sai.difference) > 0.0001 THEN 1 ELSE 0 END) AS divergence_count,
            SUM(ABS(sai.difference)) AS total_difference
     FROM stock_audits sa
     JOIN users u ON u.id = sa.created_by
     LEFT JOIN stock_audit_items sai ON sai.audit_id = sa.id
     GROUP BY sa.id
     ORDER BY sa.created_at DESC
     LIMIT @limit`,
    { limit }
  );
  const items = all(
    `SELECT sai.*, p.name AS product_name, p.sku, p.unit, p.ml_per_unit
     FROM stock_audit_items sai
     JOIN products p ON p.id = sai.product_id
     WHERE sai.audit_id IN (SELECT id FROM stock_audits ORDER BY created_at DESC LIMIT @limit)
     ORDER BY p.name`,
    { limit }
  );
  const grouped = Map.groupBy(items, (item) => item.audit_id);
  return audits.map((auditRow) => ({ ...auditRow, items: grouped.get(auditRow.id) || [] }));
}

function auditExpectedQuantity(productId, location) {
  return Number(
    get('SELECT quantity FROM stock_balances WHERE product_id = @productId AND location = @location', {
      productId,
      location
    })?.quantity || 0
  );
}

function handleApi(req, res, pathname) {
  return Promise.resolve()
    .then(async () => {
      if (req.method === 'POST' && pathname === '/api/login') {
        const body = await readBody(req);
        const user = get('SELECT * FROM users WHERE email = @email AND active = 1', { email: body.email || '' });
        if (!user || !verifyPassword(body.password || '', user.password_hash)) {
          throw httpError(401, 'E-mail ou senha invalidos.');
        }
        const token = createSession(user);
        audit(user, 'auth.login', 'session', user.id);
        return sendJson(res, 200, { user: publicUser(user) }, {
          'Set-Cookie': `vetstock_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
        });
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        const session = readSession(req);
        if (session) {
          audit(session.user, 'auth.logout', 'session', session.user.id);
          sessions.delete(session.token);
        }
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': 'vetstock_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
        });
      }

      if (req.method === 'GET' && pathname === '/api/health') {
        get('SELECT 1 AS ok');
        return sendJson(res, 200, { ok: true, service: 'vet-stock-control' });
      }

      const user = requireAuth(req);

      if (req.method === 'GET' && pathname === '/api/me') {
        return sendJson(res, 200, { user: publicUser(user) });
      }

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        return sendJson(res, 200, {
          user: publicUser(user),
          locations: locations.map(([id, name]) => ({ id, name })),
          products: inventorySnapshot(),
          dashboard: dashboards(),
          vetRecords: vetRecords(user),
          movements: user.role === 'admin' ? movementRows(250) : movementRows(50),
          users: visibleUsersFor(user),
          stockAudits: user.role === 'admin' ? stockAuditRows(25) : []
        });
      }

      if (req.method === 'POST' && pathname === '/api/products') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        const sku = String(body.sku || '').trim();
        const name = String(body.name || '').trim();
        if (!sku || !name) throw httpError(400, 'Informe SKU e nome do produto.');
        const id = run(
          'INSERT INTO products (sku, name, unit, ml_per_unit, min_stock, created_at) VALUES (@sku, @name, @unit, @mlPerUnit, @minStock, @createdAt)',
          {
            sku,
            name,
            unit: normalizeUnit(body.unit),
            mlPerUnit: normalizeMlPerUnit(body.mlPerUnit),
            minStock: Number(body.minStock || 0),
            createdAt: now()
          }
        ).lastInsertRowid;
        locations.forEach(([location]) => setBalance(id, location, 0));
        audit(user, 'product.created', 'product', id, { sku, name });
        return sendJson(res, 201, { ok: true, id });
      }

      if (req.method === 'POST' && pathname === '/api/users/veterinarians') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        if (!body.name || !body.email || !body.password) throw httpError(400, 'Preencha nome, e-mail e senha.');
        const id = run(
          'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (@name, @email, @passwordHash, @role, @createdAt)',
          {
            name: body.name.trim(),
            email: body.email.trim().toLowerCase(),
            passwordHash: hashPassword(body.password),
            role: 'veterinarian',
            createdAt: now()
          }
        ).lastInsertRowid;
        audit(user, 'user.veterinarian_created', 'user', id, { email: body.email });
        return sendJson(res, 201, { ok: true, id });
      }

      if (req.method === 'POST' && pathname === '/api/users') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        const role = String(body.role || '').trim();
        if (!canManageUser(user, role)) throw httpError(403, 'Voce nao pode criar esse perfil.');
        if (!body.name || !body.email || !body.password) throw httpError(400, 'Preencha nome, e-mail e senha.');
        const id = run(
          'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (@name, @email, @passwordHash, @role, @createdAt)',
          {
            name: body.name.trim(),
            email: body.email.trim().toLowerCase(),
            passwordHash: hashPassword(body.password),
            role,
            createdAt: now()
          }
        ).lastInsertRowid;
        audit(user, 'user.created', 'user', id, { email: body.email, role });
        return sendJson(res, 201, { ok: true, id });
      }

      const deleteUserMatch = pathname.match(/^\/api\/users\/(\d+)$/);
      if (req.method === 'DELETE' && deleteUserMatch) {
        requireRole(user, ['admin', 'manager']);
        const targetId = Number(deleteUserMatch[1]);
        const target = get('SELECT id, name, email, role, active FROM users WHERE id = @id', { id: targetId });
        if (!target) throw httpError(404, 'Usuario nao encontrado.');
        if (target.id === user.id) throw httpError(400, 'Voce nao pode excluir seu proprio usuario.');
        if (!canManageUser(user, target.role)) throw httpError(403, 'Voce nao pode excluir esse perfil.');
        if (target.role === 'admin') {
          const activeAdmins = get("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1").total;
          if (activeAdmins <= 1) throw httpError(400, 'Mantenha pelo menos um administrador ativo.');
        }
        run('UPDATE users SET active = 0 WHERE id = @id', { id: targetId });
        audit(user, 'user.deleted', 'user', targetId, { email: target.email, role: target.role });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/stock/entry') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        const requestedLocation = body.location || 'internal';
        if (user.role === 'manager' && requestedLocation !== 'internal') {
          throw httpError(403, 'Gerentes so podem dar entrada no estoque interno.');
        }
        const location = user.role === 'manager' ? 'internal' : requestedLocation;
        if (!locationIsValid(location)) throw httpError(400, 'Estoque invalido.');
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) throw httpError(400, 'Informe ao menos um item.');
        const tx = db.createTagStore();
        db.exec('BEGIN');
        try {
          items.forEach((item) => {
            const entryItem =
              body.source === 'xml' && body.unit
                ? { ...item, unit: normalizeUnit(body.unit), mlPerUnit: body.mlPerUnit }
                : item;
            const productId = body.source === 'xml' ? ensureProductFromXml(entryItem, user) : ensureManualProduct(entryItem, user);
            const product = getProduct(productId);
            const quantity = Number(item.quantity);
            const quantityUnit = normalizeQuantityUnit(entryItem.unit || product.unit);
            const quantityBase = toStockQuantity(product, quantity, quantityUnit);
            changeStock(productId, location, quantityBase);
            tx.run`
              INSERT INTO movements (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, reference, created_by, created_at)
              VALUES (${productId}, ${location}, 'entry', ${quantity}, ${quantityUnit}, ${quantityBase}, ${body.reason || 'Entrada de estoque'}, ${body.source || 'manual'}, ${body.reference || null}, ${user.id}, ${now()})
            `;
          });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        audit(user, 'stock.entry', 'movement', null, { location, source: body.source || 'manual', count: items.length });
        return sendJson(res, 201, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/stock/transfer') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        const productId = Number(body.productId);
        const quantity = Number(body.quantity);
        const product = productId ? getProduct(productId) : null;
        const quantityUnit = normalizeQuantityUnit(body.quantityUnit || product?.unit);
        const quantityBase = product ? toStockQuantity(product, quantity, quantityUnit) : 0;
        const fromLocation = body.fromLocation;
        const toLocation = body.toLocation;
        const reason = String(body.reason || 'Transferencia entre estoques').trim();
        if (
          !productId ||
          quantityBase <= 0 ||
          !locationIsValid(fromLocation) ||
          !locationIsValid(toLocation) ||
          fromLocation === toLocation
        ) {
          throw httpError(400, 'Informe produto, origem, destino e quantidade validos.');
        }
        db.exec('BEGIN');
        try {
          changeStock(productId, fromLocation, -quantityBase);
          changeStock(productId, toLocation, quantityBase);
          run(
            `INSERT INTO movements (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, reference, created_by, created_at)
             VALUES (@productId, @location, 'exit', @quantity, @quantityUnit, @quantityBase, @reason, 'transfer', @reference, @createdBy, @createdAt)`,
            {
              productId,
              location: fromLocation,
              quantity,
              quantityUnit,
              quantityBase,
              reason,
              reference: `Para ${toLocation}`,
              createdBy: user.id,
              createdAt: now()
            }
          );
          run(
            `INSERT INTO movements (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, reference, created_by, created_at)
             VALUES (@productId, @location, 'entry', @quantity, @quantityUnit, @quantityBase, @reason, 'transfer', @reference, @createdBy, @createdAt)`,
            {
              productId,
              location: toLocation,
              quantity,
              quantityUnit,
              quantityBase,
              reason,
              reference: `De ${fromLocation}`,
              createdBy: user.id,
              createdAt: now()
            }
          );
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        audit(user, 'stock.transfer', 'movement', null, { productId, fromLocation, toLocation, quantity, quantityUnit, quantityBase, reason });
        return sendJson(res, 201, { ok: true });
      }

      if (req.method === 'POST' && pathname === '/api/stock/exit') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        const productId = Number(body.productId);
        const quantity = Number(body.quantity);
        const product = productId ? getProduct(productId) : null;
        const quantityUnit = normalizeQuantityUnit(body.quantityUnit || product?.unit);
        const quantityBase = product ? toStockQuantity(product, quantity, quantityUnit) : 0;
        const reason = String(body.reason || '').trim();
        if (!locationIsValid(body.location) || !productId || quantityBase <= 0 || !reason) {
          throw httpError(400, 'Informe produto, estoque, quantidade e motivo.');
        }
        changeStock(productId, body.location, -quantityBase);
        const id = run(
          `INSERT INTO movements (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, created_by, created_at)
           VALUES (@productId, @location, 'exit', @quantity, @quantityUnit, @quantityBase, @reason, 'manual', @createdBy, @createdAt)`,
          { productId, location: body.location, quantity, quantityUnit, quantityBase, reason, createdBy: user.id, createdAt: now() }
        ).lastInsertRowid;
        audit(user, 'stock.exit', 'movement', id, { productId, location: body.location, quantity, quantityUnit, quantityBase, reason });
        return sendJson(res, 201, { ok: true, id });
      }

      if (req.method === 'POST' && pathname === '/api/xml/preview') {
        requireRole(user, ['admin', 'manager']);
        const body = await readBody(req);
        return sendJson(res, 200, { items: parseXmlProducts(body.xml || body.raw || '') });
      }

      if (req.method === 'POST' && pathname === '/api/stock-audits') {
        requireRole(user, ['admin']);
        const body = await readBody(req);
        const location = body.location;
        const items = Array.isArray(body.items) ? body.items : [];
        const applyAdjustments = Boolean(body.applyAdjustments);
        if (!locationIsValid(location) || !items.length) {
          throw httpError(400, 'Informe o estoque e ao menos um produto contado.');
        }

        db.exec('BEGIN');
        let auditId;
        let divergenceCount = 0;
        try {
          auditId = run(
            `INSERT INTO stock_audits (location, notes, apply_adjustments, created_by, created_at)
             VALUES (@location, @notes, @applyAdjustments, @createdBy, @createdAt)`,
            {
              location,
              notes: body.notes || null,
              applyAdjustments: applyAdjustments ? 1 : 0,
              createdBy: user.id,
              createdAt: now()
            }
          ).lastInsertRowid;

          items.forEach((item) => {
            const productId = Number(item.productId);
            const product = productId ? getProduct(productId) : null;
            const countedQuantity = Number(item.countedQuantity);
            const countedUnit = normalizeQuantityUnit(item.countedUnit || product?.unit);
            if (!product || !Number.isFinite(countedQuantity) || countedQuantity < 0) {
              throw httpError(400, 'Contagem invalida no balanco.');
            }
            const countedBase = countedQuantity === 0 ? 0 : toStockQuantity(product, countedQuantity, countedUnit);
            const expectedQuantity = auditExpectedQuantity(productId, location);
            const difference = countedBase - expectedQuantity;
            if (Math.abs(difference) > 0.0001) divergenceCount += 1;

            run(
              `INSERT INTO stock_audit_items
               (audit_id, product_id, expected_quantity, counted_quantity, counted_unit, counted_base, difference)
               VALUES (@auditId, @productId, @expectedQuantity, @countedQuantity, @countedUnit, @countedBase, @difference)`,
              {
                auditId,
                productId,
                expectedQuantity,
                countedQuantity,
                countedUnit,
                countedBase,
                difference
              }
            );

            if (applyAdjustments && Math.abs(difference) > 0.0001) {
              changeStock(productId, location, difference);
              const type = difference > 0 ? 'entry' : 'exit';
              const quantity = Math.abs(difference);
              run(
                `INSERT INTO movements
                 (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, reference, created_by, created_at)
                 VALUES (@productId, @location, @type, @quantity, @quantityUnit, @quantityBase, @reason, 'stock_audit', @reference, @createdBy, @createdAt)`,
                {
                  productId,
                  location,
                  type,
                  quantity,
                  quantityUnit: product.unit,
                  quantityBase: quantity,
                  reason: `Ajuste de balanco #${auditId}`,
                  reference: `Balanco #${auditId}`,
                  createdBy: user.id,
                  createdAt: now()
                }
              );
            }
          });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }

        audit(user, 'stock_audit.created', 'stock_audit', auditId, {
          location,
          applyAdjustments,
          itemCount: items.length,
          divergenceCount
        });
        return sendJson(res, 201, { ok: true, id: auditId });
      }

      if (req.method === 'POST' && pathname === '/api/vet-records') {
        requireRole(user, ['admin', 'manager', 'veterinarian']);
        const body = await readBody(req);
        const commandNumber = String(body.commandNumber || '').trim();
        const items = Array.isArray(body.items) ? body.items : [];
        if (!commandNumber || !locationIsValid(body.location) || !items.length) {
          throw httpError(400, 'Informe comanda, setor e produtos.');
        }
        db.exec('BEGIN');
        let recordId;
        try {
          recordId = run(
            `INSERT INTO vet_records (command_number, location, veterinarian_id, notes, created_at)
             VALUES (@commandNumber, @location, @veterinarianId, @notes, @createdAt)`,
            {
              commandNumber,
              location: body.location,
              veterinarianId: user.role === 'veterinarian' ? user.id : Number(body.veterinarianId || user.id),
              notes: body.notes || null,
              createdAt: now()
            }
          ).lastInsertRowid;
          items.forEach((item) => {
            const productId = Number(item.productId);
            const quantity = Number(item.quantity);
            const product = productId ? getProduct(productId) : null;
            const quantityUnit = normalizeQuantityUnit(item.quantityUnit || product?.unit);
            const quantityBase = product ? toStockQuantity(product, quantity, quantityUnit) : 0;
            if (!productId || quantityBase <= 0) throw httpError(400, 'Item invalido.');
            run(
              `INSERT INTO vet_record_items (record_id, product_id, quantity, quantity_unit, quantity_base)
               VALUES (@recordId, @productId, @quantity, @quantityUnit, @quantityBase)`,
              { recordId, productId, quantity, quantityUnit, quantityBase }
            );
          });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        audit(user, 'vet_record.created', 'vet_record', recordId, { commandNumber, location: body.location });
        return sendJson(res, 201, { ok: true, id: recordId });
      }

      const approveMatch = pathname.match(/^\/api\/vet-records\/(\d+)\/(approve|reject)$/);
      if (req.method === 'POST' && approveMatch) {
        requireRole(user, ['admin', 'manager']);
        const recordId = Number(approveMatch[1]);
        const action = approveMatch[2];
        const body = await readBody(req);
        const record = get('SELECT * FROM vet_records WHERE id = @id', { id: recordId });
        if (!record) throw httpError(404, 'Registro nao encontrado.');
        if (record.status !== 'pending') throw httpError(400, 'Registro ja revisado.');
        const items = all('SELECT * FROM vet_record_items WHERE record_id = @recordId', { recordId });
        db.exec('BEGIN');
        try {
          if (action === 'approve') {
            items.forEach((item) => {
              const quantityBase = Number(item.quantity_base || item.quantity);
              changeStock(item.product_id, record.location, -quantityBase);
              run(
                `INSERT INTO movements (product_id, location, type, quantity, quantity_unit, quantity_base, reason, source, reference, created_by, approved_record_id, created_at)
                 VALUES (@productId, @location, 'vet_usage', @quantity, @quantityUnit, @quantityBase, @reason, 'veterinarian', @reference, @createdBy, @recordId, @createdAt)`,
                {
                  productId: item.product_id,
                  location: record.location,
                  quantity: item.quantity,
                  quantityUnit: item.quantity_unit || 'un',
                  quantityBase,
                  reason: `Uso em atendimento - comanda ${record.command_number}`,
                  reference: record.command_number,
                  createdBy: user.id,
                  recordId,
                  createdAt: now()
                }
              );
            });
          }
          run(
            `UPDATE vet_records
             SET status = @status, reviewer_id = @reviewerId, review_notes = @reviewNotes, reviewed_at = @reviewedAt
             WHERE id = @id`,
            {
              status: action === 'approve' ? 'approved' : 'rejected',
              reviewerId: user.id,
              reviewNotes: body.reviewNotes || null,
              reviewedAt: now(),
              id: recordId
            }
          );
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        audit(user, `vet_record.${action}`, 'vet_record', recordId, { reviewNotes: body.reviewNotes || null });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && pathname === '/api/reports') {
        requireRole(user, ['admin']);
        const logs = all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500');
        return sendJson(res, 200, {
          dashboard: dashboards(),
          inventory: inventorySnapshot(),
          movements: movementRows(500),
          vetRecords: vetRecords(user),
          users: all('SELECT id, name, email, role, active, created_at FROM users ORDER BY role, name'),
          stockAudits: stockAuditRows(100),
          logs
        });
      }

      throw httpError(404, 'Rota nao encontrada.');
    })
    .catch((error) => sendError(res, error));
}

function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(PUBLIC_DIR, `.${target}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = readFileSync(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = readFileSync(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  }
}

initDb();

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url.pathname);
    return serveStatic(req, res, url.pathname);
  })
  .listen(PORT, () => {
    console.log(`Vet Stock Control em http://localhost:${PORT}`);
  });
