// PostgreSQL 建表 + 首次种子（幂等）
// 仅当 users 表为空（全新库）时写入示例数据，避免删除的数据在重新部署后复活
const bcrypt = require('bcryptjs');
const db = require('./db');

const DDL = `
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  real_name TEXT,
  email TEXT,
  phone TEXT,
  department TEXT,
  signature_image TEXT,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  display_name TEXT,
  description TEXT,
  level TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户角色关联
CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  UNIQUE(user_id, role_id)
);

-- 员工表
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_no TEXT UNIQUE,
  name TEXT NOT NULL,
  gender TEXT,
  id_number TEXT,
  phone TEXT,
  email TEXT,
  department TEXT,
  position TEXT,
  entry_date DATE,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 客户表（含全部扩展字段）
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  customer_code TEXT,
  company_type TEXT,
  name TEXT NOT NULL,
  short_name TEXT,
  tax_number TEXT,
  address TEXT,
  contact_person TEXT,
  contact_position TEXT,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  other_contact TEXT,
  company TEXT,
  notes TEXT,
  product_types TEXT,
  estimated_kw DOUBLE PRECISION,
  estimated_kwh DOUBLE PRECISION,
  locations TEXT,
  grade TEXT,
  source_channel TEXT,
  salesperson TEXT,
  approval_status TEXT DEFAULT 'pending',
  approved_by TEXT,
  approval_remark TEXT,
  approved_at TEXT,
  approval_signature TEXT,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 实体表（多公司隔离）
CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_id TEXT,
  type TEXT NOT NULL,
  purchase_prefix TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 供应商表
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  category TEXT,
  notes TEXT,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 物料品类
CREATE TABLE IF NOT EXISTS material_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES material_categories(id),
  sort_order INTEGER DEFAULT 0
);

-- 物料表
CREATE TABLE IF NOT EXISTS materials (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES material_categories(id),
  spec TEXT,
  unit TEXT,
  brand TEXT,
  cost_price DOUBLE PRECISION DEFAULT 0,
  sell_price DOUBLE PRECISION DEFAULT 0,
  safety_stock DOUBLE PRECISION DEFAULT 0,
  entity_id INTEGER REFERENCES entities(id),
  notes TEXT,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 报价单主表（含审批流字段）
CREATE TABLE IF NOT EXISTS quotations (
  id SERIAL PRIMARY KEY,
  quotation_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  title TEXT,
  total_amount DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  status TEXT DEFAULT 'draft',
  approval_status TEXT DEFAULT 'draft',
  approval_chain TEXT DEFAULT '[]',
  rejected_by TEXT,
  rejected_at TIMESTAMP,
  rejection_reason TEXT,
  valid_days INTEGER DEFAULT 30,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 报价单明细
CREATE TABLE IF NOT EXISTS quotation_items (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id),
  description TEXT,
  quantity DOUBLE PRECISION DEFAULT 0,
  unit TEXT,
  unit_price DOUBLE PRECISION DEFAULT 0,
  amount DOUBLE PRECISION DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- 订单主表
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  quotation_id INTEGER REFERENCES quotations(id),
  customer_id INTEGER REFERENCES customers(id),
  title TEXT,
  total_amount DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  status TEXT DEFAULT 'confirmed',
  payment_status TEXT DEFAULT 'unpaid',
  delivery_date DATE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 订单明细
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id),
  description TEXT,
  quantity DOUBLE PRECISION DEFAULT 0,
  unit TEXT,
  unit_price DOUBLE PRECISION DEFAULT 0,
  amount DOUBLE PRECISION DEFAULT 0
);

-- 采购申请
CREATE TABLE IF NOT EXISTS procurement_requests (
  id SERIAL PRIMARY KEY,
  request_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  title TEXT,
  total_amount DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  status TEXT DEFAULT 'draft',
  supplier_id INTEGER REFERENCES suppliers(id),
  entity_id INTEGER REFERENCES entities(id),
  target_entity_id INTEGER REFERENCES entities(id),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 采购明细
CREATE TABLE IF NOT EXISTS procurement_items (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES materials(id),
  description TEXT,
  quantity DOUBLE PRECISION DEFAULT 0,
  unit TEXT,
  unit_price DOUBLE PRECISION DEFAULT 0,
  amount DOUBLE PRECISION DEFAULT 0
);

-- 仓库表
CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  location TEXT,
  manager TEXT,
  status INTEGER DEFAULT 1,
  entity_id INTEGER REFERENCES entities(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 库存表
CREATE TABLE IF NOT EXISTS inventory (
  id SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  entity_id INTEGER REFERENCES entities(id),
  quantity DOUBLE PRECISION DEFAULT 0,
  reserved_quantity DOUBLE PRECISION DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(warehouse_id, material_id)
);

-- 入库单
CREATE TABLE IF NOT EXISTS inbound_orders (
  id SERIAL PRIMARY KEY,
  inbound_no TEXT UNIQUE NOT NULL,
  warehouse_id INTEGER REFERENCES warehouses(id),
  procurement_id INTEGER REFERENCES procurement_requests(id),
  entity_id INTEGER REFERENCES entities(id),
  type TEXT DEFAULT 'purchase',
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 出库单
CREATE TABLE IF NOT EXISTS outbound_orders (
  id SERIAL PRIMARY KEY,
  outbound_no TEXT UNIQUE NOT NULL,
  warehouse_id INTEGER REFERENCES warehouses(id),
  order_id INTEGER REFERENCES orders(id),
  entity_id INTEGER REFERENCES entities(id),
  type TEXT DEFAULT 'sale',
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 出库明细表
CREATE TABLE IF NOT EXISTS outbound_items (
  id SERIAL PRIMARY KEY,
  outbound_id INTEGER REFERENCES outbound_orders(id) ON DELETE CASCADE,
  material_name TEXT NOT NULL,
  material_code TEXT,
  quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'pcs',
  batch_no TEXT,
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 物流单
CREATE TABLE IF NOT EXISTS logistics_orders (
  id SERIAL PRIMARY KEY,
  logistics_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  customer_code TEXT,
  applicant_name TEXT,
  applicant_id INTEGER REFERENCES users(id),
  receiver_name TEXT,
  receiver_phone TEXT,
  shipping_type TEXT,
  carrier TEXT,
  tracking_no TEXT,
  origin TEXT,
  destination TEXT,
  planned_ship_date DATE,
  status TEXT DEFAULT 'pending',
  estimated_arrival DATE,
  notes TEXT,
  items JSONB,
  materials JSONB,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approval_status TEXT DEFAULT 'pending_ops',
  approval_chain TEXT DEFAULT '[]'
);

-- 生产计划
CREATE TABLE IF NOT EXISTS production_plans (
  id SERIAL PRIMARY KEY,
  plan_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  product_name TEXT,
  planned_quantity DOUBLE PRECISION DEFAULT 0,
  completed_quantity DOUBLE PRECISION DEFAULT 0,
  unit TEXT,
  status TEXT DEFAULT 'planned',
  start_date DATE,
  end_date DATE,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 收款记录
CREATE TABLE IF NOT EXISTS payment_records (
  id SERIAL PRIMARY KEY,
  payment_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  customer_id INTEGER REFERENCES customers(id),
  amount DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  payment_method TEXT,
  payment_date DATE,
  status TEXT DEFAULT 'confirmed',
  entity_id INTEGER REFERENCES entities(id),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 付款记录（采购付款，无需审批）
CREATE TABLE IF NOT EXISTS outgoing_payments (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER REFERENCES entities(id),
  procurement_request_id INTEGER REFERENCES procurement_requests(id),
  payment_no TEXT UNIQUE NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  amount DOUBLE PRECISION DEFAULT 0,
  currency TEXT DEFAULT 'IDR',
  payment_method TEXT,
  payment_date DATE,
  bank_account TEXT,
  reference_no TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 销项发票
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER REFERENCES entities(id),
  order_id INTEGER REFERENCES orders(id),
  invoice_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  amount DOUBLE PRECISION DEFAULT 0,
  tax_amount DOUBLE PRECISION DEFAULT 0,
  invoice_date DATE,
  invoice_type TEXT DEFAULT 'output',
  invoice_number TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 审批记录
CREATE TABLE IF NOT EXISTS approval_records (
  id SERIAL PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  approver_id INTEGER REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 询盘表
CREATE TABLE IF NOT EXISTS inquiries (
  id SERIAL PRIMARY KEY,
  inquiry_no TEXT,
  company_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  product_description TEXT,
  estimated_capacity TEXT,
  estimated_power TEXT,
  project_location TEXT,
  budget_range TEXT,
  channel TEXT,
  urgency TEXT,
  source_detail TEXT,
  notes TEXT,
  status TEXT DEFAULT 'new',
  assigned_to TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 客户跟进记录
CREATE TABLE IF NOT EXISTS customer_followups (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_code TEXT,
  customer_name TEXT,
  customer_grade TEXT,
  followup_type TEXT,
  followup_date TEXT,
  next_followup_date TEXT,
  content TEXT,
  feedback TEXT,
  attachment TEXT,
  location_name TEXT,
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 经销商准入申请
CREATE TABLE IF NOT EXISTS dealer_applications (
  id SERIAL PRIMARY KEY,
  application_no TEXT UNIQUE,
  dealer_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  business_license TEXT,
  business_scope TEXT,
  annual_revenue TEXT,
  cooperation_history TEXT,
  notes TEXT,
  approval_status TEXT DEFAULT 'pending_ops',
  approval_chain TEXT DEFAULT '[]',
  approved_by INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 售后工单
CREATE TABLE IF NOT EXISTS aftersales_tickets (
  id SERIAL PRIMARY KEY,
  ticket_no TEXT UNIQUE,
  order_id INTEGER REFERENCES orders(id),
  customer_id INTEGER REFERENCES customers(id),
  issue_type TEXT,
  priority TEXT DEFAULT 'P3',
  description TEXT,
  resolution TEXT,
  assigned_to INTEGER,
  sla_deadline TIMESTAMP,
  approval_status TEXT DEFAULT 'pending_ops',
  approval_chain TEXT DEFAULT '[]',
  approved_by INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const rolesData = [
  ['sales_manager', '销售经理', '销售部门管理', 'L1'],
  ['sales_rep', '销售代表', '客户开发与报价', 'L1'],
  ['procurement_manager', '采购经理', '采购审批与供应商管理', 'L1'],
  ['procurement_staff', '采购员', '采购执行', 'L1'],
  ['warehouse_manager', '仓库主管', '仓储管理', 'L1'],
  ['production_manager', '生产主管', '生产计划与执行', 'L1'],
  ['finance_manager', '财务主管', '财务审批与报表', 'L1'],
  ['general_manager', '总经理', '全局管理权限', 'management'],
  ['technical_director', '技术总监', '技术与工程管理', 'management'],
  ['hr_manager', '人事主管', '人事管理', 'management'],
  ['viewer', '只读用户', '仅查看权限', 'management'],
  ['operations_director', '运营总监', '负责客户审批、客户编码发放及整体运营管理', 'management'],
  ['factory_director', '厂长', '工厂生产管理最高负责人', 'management'],
];

const usersData = [
  ['admin', 'admin123', '管理员', 'admin@batreku.com', 'general_manager', '总经理'],
  ['alex', 'alex123', 'Alex', 'alex@batreku.com', 'technical_director', '技术总监'],
  ['sales1', 'sales123', 'Sarah', 'sarah@batreku.com', 'sales_manager', '销售经理'],
  ['sales2', 'sales223', 'Budi', 'budi@batreku.com', 'sales_rep', '销售代表'],
  ['purchase1', 'purchase123', 'Dewi', 'dewi@batreku.com', 'procurement_manager', '采购经理'],
  ['warehouse1', 'wh123', 'Agus', 'agus@batreku.com', 'warehouse_manager', '仓库主管'],
  ['finance1', 'finance123', 'Lisa', 'lisa@batreku.com', 'finance_manager', '财务主管'],
  ['ops', 'ops123', '运营总监', 'ops@batreku.com', 'operations_director', '运营总监'],
  ['factory', 'factory321', 'Pabrik Director', 'factory@batreku.com', 'factory_director', '厂长'],
];

const cats = [
  [1, '光伏组件', 1], [2, '储能电池', 2], [3, '逆变器', 3],
  [4, '线缆', 4], [5, '支架', 5], [6, '配件', 6],
];

const materials = [
  ['MAT-001', '单晶硅光伏板 550W', 1, '550W/片', '片', 1800000, 2500000],
  ['MAT-002', '磷酸铁锂电池 100Ah', 2, '48V/100Ah', '组', 8500000, 12000000],
  ['MAT-003', '混合逆变器 5kW', 3, '5kW/台', '台', 6000000, 8500000],
  ['MAT-004', 'MC4光伏线缆', 4, '4mm²/米', '米', 15000, 22000],
  ['MAT-005', '铝合金支架套件', 5, '标准套件', '套', 2000000, 2800000],
];

async function seedFresh(t) {
  // 角色
  for (const r of rolesData) {
    await t.run('INSERT INTO roles (name, display_name, description, level) VALUES (?,?,?,?)', r);
  }
  // 仓库
  await t.run('INSERT INTO warehouses (name, code, location) VALUES (?,?,?)', ['主仓库', 'WH-001', 'Jakarta']);
  await t.run('INSERT INTO warehouses (name, code, location) VALUES (?,?,?)', ['深圳仓', 'WH-002', 'Shenzhen']);

  // 用户、角色关联、员工
  for (const [username, pwd, name, email, roleName, position] of usersData) {
    const hash = bcrypt.hashSync(pwd, 10);
    const u = await t.run(
      'INSERT INTO users (username, password, real_name, email, department) VALUES (?,?,?,?,?)',
      [username, hash, name, email, position === '运营总监' ? '运营部' : '管理部']
    );
    const role = await t.get('SELECT id FROM roles WHERE name = ?', [roleName]);
    if (role) await t.run('INSERT INTO user_roles (user_id, role_id) VALUES (?,?)', [u.id, role.id]);
    const empNo = 'EMP-' + String(u.id).padStart(3, '0');
    await t.run(
      'INSERT INTO employees (employee_no, name, email, department, position) VALUES (?,?,?,?,?)',
      [empNo, name, email, position === '运营总监' ? '运营部' : '管理部', position]
    );
  }

  // 物料品类（固定 id）
  for (const c of cats) {
    await t.run('INSERT INTO material_categories (id, name, sort_order) VALUES (?,?,?)', c);
  }
  await t.query("SELECT setval(pg_get_serial_sequence('material_categories','id'), (SELECT MAX(id) FROM material_categories))", []);

  // 示例物料
  for (const m of materials) {
    await t.run(
      'INSERT INTO materials (code, name, category_id, spec, unit, cost_price, sell_price) VALUES (?,?,?,?,?,?,?)',
      m
    );
  }

  // 示例客户（已批准并带编码）
  await t.run(
    `INSERT INTO customers (customer_code, name, contact_person, phone, company, approval_status, approved_by)
     VALUES (?,?,?,?,?,?,?)`,
    ['CUS-001', 'PT Bogor Farm', 'John', '+62812345678', 'PT Bogor Farm', 'approved', '系统初始化']
  );
  await t.run(
    `INSERT INTO customers (customer_code, name, contact_person, phone, company, approval_status, approved_by)
     VALUES (?,?,?,?,?,?,?)`,
    ['CUS-002', 'PT Kendal Industrial', 'Mike', '+62812345679', 'PT Kendal Industrial', 'approved', '系统初始化']
  );

  // 示例供应商
  await t.run('INSERT INTO suppliers (name, contact_person, phone, category) VALUES (?,?,?,?)',
    ['深圳光能科技', 'David', '+8613800001111', '光伏组件']);
  await t.run('INSERT INTO suppliers (name, contact_person, phone, category) VALUES (?,?,?,?)',
    ['东莞储能科技', 'Kevin', '+8613800002222', '储能电池']);
}

// 幂等补列：为已存在的老库补充新字段（Postgres 无原生 ADD COLUMN IF NOT EXISTS 兼容问题，直接用即可）
async function ensureColumns() {
  await db.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS approval_signature TEXT', []);
  await db.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS approval_chain TEXT DEFAULT \'[]\'', []);
  await db.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS attachments TEXT', []);
  await db.query('ALTER TABLE procurement_requests ADD COLUMN IF NOT EXISTS approval_chain TEXT DEFAULT \'[]\'', []);
  // inquiries 加审批字段
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending_tech'", []);
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS approval_chain TEXT DEFAULT '[]'", []);
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS approved_by INTEGER", []);
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS approval_remark TEXT", []);
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS approval_signature TEXT", []);
  await db.query("ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS tech_guidance TEXT", []);
  // logistics_orders 加审批字段与新字段
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending_ops'", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS approval_chain TEXT DEFAULT '[]'", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS customer_code TEXT", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS applicant_name TEXT", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS applicant_id INTEGER REFERENCES users(id)", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS receiver_name TEXT", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS receiver_phone TEXT", []);
  // customer_followups 加 customer_code
  await db.query("ALTER TABLE customer_followups ADD COLUMN IF NOT EXISTS customer_code TEXT", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS shipping_type TEXT", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS planned_ship_date DATE", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS items JSONB", []);
  await db.query("ALTER TABLE logistics_orders ADD COLUMN IF NOT EXISTS materials JSONB", []);
  await db.query(`CREATE TABLE IF NOT EXISTS logistics_tracking (
    id SERIAL PRIMARY KEY, logistics_id INTEGER REFERENCES logistics_orders(id) ON DELETE CASCADE,
    tracking_no TEXT UNIQUE NOT NULL, current_node INTEGER DEFAULT 1,
    node_history JSONB DEFAULT '[]', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, []);
  // 迁移：将旧的 'pending' 状态升级为 'pending_ops'（三级审批流）
  await db.query("UPDATE customers SET approval_status = 'pending_ops' WHERE approval_status = 'pending'", []);
  await db.query("UPDATE procurement_requests SET status = 'pending_ops' WHERE status = 'pending'", []);
  await db.query("UPDATE inquiries SET approval_status = 'pending_tech' WHERE approval_status IS NULL OR approval_status = 'new' OR approval_status = 'pending_ops'", []);
  await db.query("UPDATE logistics_orders SET approval_status = 'pending_ops' WHERE approval_status IS NULL OR approval_status = 'pending'", []);
  // 仓储相关表加 entity_id
  await db.query('ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id)', []);
  await db.query('ALTER TABLE inventory ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id)', []);
  await db.query('ALTER TABLE inbound_orders ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id)', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS entity_id INTEGER REFERENCES entities(id)', []);
  // 出库单审批字段
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_status TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_dept_manager TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_ops_director TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_tech_director TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_gm TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approval_remark TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS rejected_by TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT', []);
  await db.query('ALTER TABLE outbound_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP', []);
  // 出库明细表
  await db.query(`CREATE TABLE IF NOT EXISTS outbound_items (
    id SERIAL PRIMARY KEY,
    outbound_id INTEGER REFERENCES outbound_orders(id) ON DELETE CASCADE,
    material_name TEXT NOT NULL,
    material_code TEXT,
    quantity NUMERIC(15,2) NOT NULL DEFAULT 0,
    unit TEXT DEFAULT 'pcs',
    batch_no TEXT,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, []);
}

// 幂等新增角色
async function ensureRoles() {
  const extraRoles = [
    ['accountant', '会计', '账务核算、凭证管理', 'L1'],
    ['aftersales_staff', '售后专员', '售后工单受理与跟进', 'L1'],
    ['maintenance_staff', '运维专员', '设备运维、现场巡检', 'L1'],
    ['warehouse_staff', '仓管员', '仓库出入库操作', 'L1'],
    ['factory_director', '厂长', '工厂生产管理最高负责人', 'management'],
  ];
  for (const r of extraRoles) {
    await db.query(
      `INSERT INTO roles (name, display_name, description, level)
       VALUES (?,?,?,?) ON CONFLICT (name) DO NOTHING`, r
    );
  }
}

// 幂等：确保三个实体 + factory 用户有 production_manager 角色 + 仓库实体分配
async function ensureEntities() {
  const entities = [
    ['JTF', 'PT JOYFULL TECHNOLOGY INDONESIA', 'PT JOYFULL TECHNOLOGY INDONESIA', 'sales', 'PR-JTF'],
    ['PFB', 'PT BATREKU PABRIK BATERAI', 'PT BATREKU PABRIK BATERAI', 'factory', 'PR-PFB'],
    ['SZJ', 'SZ JOYFULL', 'SZ JOYFULL', 'supply_chain', 'PR-SZJ'],
  ];
  for (const e of entities) {
    await db.query(
      `INSERT INTO entities (code, name, name_id, type, purchase_prefix)
       VALUES (?,?,?,?,?) ON CONFLICT (code) DO NOTHING`, e
    );
  }

  // factory 用户补 production_manager 角色
  const factory = await db.get("SELECT id FROM users WHERE username = 'factory'", []);
  const pmRole = await db.get("SELECT id FROM roles WHERE name = 'production_manager'", []);
  if (factory && pmRole) {
    await db.query(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?,?) ON CONFLICT DO NOTHING',
      [factory.id, pmRole.id]
    );
  }

  // 分配现有仓库到实体：主仓库(Jakarta) → JTF, 深圳仓 → SZJ
  const jtf = await db.get("SELECT id FROM entities WHERE code = 'JTF'", []);
  const pfb = await db.get("SELECT id FROM entities WHERE code = 'PFB'", []);
  const szj = await db.get("SELECT id FROM entities WHERE code = 'SZJ'", []);
  if (jtf) await db.query('UPDATE warehouses SET entity_id = ? WHERE code = ? AND entity_id IS NULL', [jtf.id, 'WH-001']);
  if (szj) await db.query('UPDATE warehouses SET entity_id = ? WHERE code = ? AND entity_id IS NULL', [szj.id, 'WH-002']);

  // 创建工厂仓库（如不存在）
  const factoryWh = await db.get("SELECT id FROM warehouses WHERE code = 'WH-PFB'", []);
  if (!factoryWh && pfb) {
    await db.query(
      "INSERT INTO warehouses (name, code, location, status, entity_id) VALUES ('工厂仓库', 'WH-PFB', 'Indonesia Factory', 1, ?)",
      [pfb.id]
    );
  }
}

async function initDatabase() {
  await db.query(DDL, []);
  await ensureColumns();
  await ensureRoles();
  await ensureEntities();

  // 生产环境保护：SEED_DATA=false 时永不写入种子数据，防止已录入数据被覆盖
  if (process.env.SEED_DATA === 'false') {
    console.log('🔒 SEED_DATA=false：跳过种子数据写入（生产环境保护模式）');
    return;
  }

  const check = await db.get('SELECT COUNT(*)::int AS n FROM users', []);
  if (check.n === 0) {
    await db.tx(seedFresh);
    console.log('✅ 全新数据库：已建表并写入初始数据（12角色、8用户、示例数据）');
  } else {
    console.log('ℹ️ 检测到已有数据，跳过种子（不会恢复已删除数据）');
  }
}

module.exports = initDatabase;

// 允许直接运行：node database/pg-init.js
if (require.main === module) {
  initDatabase()
    .then(() => { console.log('✅ pg-init 执行完成'); return db.close(); })
    .then(() => process.exit(0))
    .catch((e) => { console.error('❌ pg-init 失败:', e); process.exit(1); });
}
