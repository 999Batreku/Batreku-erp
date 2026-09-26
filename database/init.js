const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'batreku.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ========== 建表 ==========
db.exec(`
  -- 用户表
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    real_name TEXT,
    email TEXT,
    phone TEXT,
    department TEXT,
    status INTEGER DEFAULT 1, -- 1启用 0禁用
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 角色表
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT,
    description TEXT,
    level TEXT, -- L1/L2/management
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户角色关联
  CREATE TABLE IF NOT EXISTS user_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (role_id) REFERENCES roles(id),
    UNIQUE(user_id, role_id)
  );

  -- 员工表
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 客户表
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    company TEXT,
    tax_number TEXT,
    notes TEXT,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 供应商表
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    category TEXT,
    notes TEXT,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 物料品类
  CREATE TABLE IF NOT EXISTS material_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (parent_id) REFERENCES material_categories(id)
  );

  -- 物料表
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER,
    spec TEXT,
    unit TEXT,
    brand TEXT,
    cost_price REAL DEFAULT 0,
    sell_price REAL DEFAULT 0,
    safety_stock REAL DEFAULT 0,
    notes TEXT,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES material_categories(id)
  );

  -- 报价单主表
  CREATE TABLE IF NOT EXISTS quotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_no TEXT UNIQUE NOT NULL,
    customer_id INTEGER,
    title TEXT,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'IDR',
    status TEXT DEFAULT 'draft', -- draft/pending/approved/rejected
    valid_days INTEGER DEFAULT 30,
    notes TEXT,
    created_by INTEGER,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 报价单明细
  CREATE TABLE IF NOT EXISTS quotation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quotation_id INTEGER NOT NULL,
    material_id INTEGER,
    description TEXT,
    quantity REAL DEFAULT 0,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- 订单主表
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    quotation_id INTEGER,
    customer_id INTEGER,
    title TEXT,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'IDR',
    status TEXT DEFAULT 'confirmed', -- confirmed/processing/shipped/completed/cancelled
    payment_status TEXT DEFAULT 'unpaid', -- unpaid/partial/paid
    delivery_date DATE,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (quotation_id) REFERENCES quotations(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 订单明细
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    material_id INTEGER,
    description TEXT,
    quantity REAL DEFAULT 0,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- 采购申请
  CREATE TABLE IF NOT EXISTS procurement_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_no TEXT UNIQUE NOT NULL,
    order_id INTEGER,
    title TEXT,
    total_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'IDR',
    status TEXT DEFAULT 'draft', -- draft/pending/approved/rejected/ordered/received
    supplier_id INTEGER,
    notes TEXT,
    created_by INTEGER,
    approved_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 采购明细
  CREATE TABLE IF NOT EXISTS procurement_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    material_id INTEGER,
    description TEXT,
    quantity REAL DEFAULT 0,
    unit TEXT,
    unit_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    FOREIGN KEY (request_id) REFERENCES procurement_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id)
  );

  -- 仓库表
  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE,
    location TEXT,
    manager TEXT,
    status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 库存表
  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER NOT NULL,
    material_id INTEGER NOT NULL,
    quantity REAL DEFAULT 0,
    reserved_quantity REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (material_id) REFERENCES materials(id),
    UNIQUE(warehouse_id, material_id)
  );

  -- 入库单
  CREATE TABLE IF NOT EXISTS inbound_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inbound_no TEXT UNIQUE NOT NULL,
    warehouse_id INTEGER,
    procurement_id INTEGER,
    type TEXT DEFAULT 'purchase', -- purchase/return/transfer
    status TEXT DEFAULT 'pending', -- pending/completed/cancelled
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (procurement_id) REFERENCES procurement_requests(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 出库单
  CREATE TABLE IF NOT EXISTS outbound_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outbound_no TEXT UNIQUE NOT NULL,
    warehouse_id INTEGER,
    order_id INTEGER,
    type TEXT DEFAULT 'sale', -- sale/production/transfer
    status TEXT DEFAULT 'pending', -- pending/completed/cancelled
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 物流单
  CREATE TABLE IF NOT EXISTS logistics_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logistics_no TEXT UNIQUE NOT NULL,
    order_id INTEGER,
    carrier TEXT,
    tracking_no TEXT,
    origin TEXT,
    destination TEXT,
    status TEXT DEFAULT 'pending', -- pending/in_transit/delivered
    estimated_arrival DATE,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 生产计划
  CREATE TABLE IF NOT EXISTS production_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_no TEXT UNIQUE NOT NULL,
    order_id INTEGER,
    product_name TEXT,
    planned_quantity REAL DEFAULT 0,
    completed_quantity REAL DEFAULT 0,
    unit TEXT,
    status TEXT DEFAULT 'planned', -- planned/in_progress/completed/cancelled
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 收款记录
  CREATE TABLE IF NOT EXISTS payment_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_no TEXT UNIQUE NOT NULL,
    order_id INTEGER,
    customer_id INTEGER,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'IDR',
    payment_method TEXT,
    payment_date DATE,
    status TEXT DEFAULT 'confirmed', -- pending/confirmed
    notes TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 审批记录
  CREATE TABLE IF NOT EXISTS approval_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL, -- quotation/procurement/production
    target_id INTEGER NOT NULL,
    action TEXT NOT NULL, -- submit/approve/reject
    approver_id INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (approver_id) REFERENCES users(id)
  );
`);

// ========== 初始化数据 ==========

// 角色
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
];

const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, display_name, description, level) VALUES (?, ?, ?, ?)');
const insertRoles = db.transaction(() => {
  for (const r of rolesData) insertRole.run(...r);
});
insertRoles();

// 仓库
const insertWarehouse = db.prepare('INSERT OR IGNORE INTO warehouses (name, code, location) VALUES (?, ?, ?)');
insertWarehouse.run('主仓库', 'WH-001', 'Jakarta');
insertWarehouse.run('深圳仓', 'WH-002', 'Shenzhen');

// 用户 & 员工
const usersData = [
  ['admin', 'admin123', '管理员', 'admin@batreku.com', 'general_manager', '总经理'],
  ['alex', 'alex123', 'Alex', 'alex@batreku.com', 'technical_director', '技术总监'],
  ['sales1', 'sales123', 'Sarah', 'sarah@batreku.com', 'sales_manager', '销售经理'],
  ['sales2', 'sales223', 'Budi', 'budi@batreku.com', 'sales_rep', '销售代表'],
  ['purchase1', 'purchase123', 'Dewi', 'dewi@batreku.com', 'procurement_manager', '采购经理'],
  ['warehouse1', 'wh123', 'Agus', 'agus@batreku.com', 'warehouse_manager', '仓库主管'],
  ['finance1', 'finance123', 'Lisa', 'lisa@batreku.com', 'finance_manager', '财务主管'],
];

const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, real_name, email) VALUES (?, ?, ?, ?)');
const insertEmployee = db.prepare('INSERT OR IGNORE INTO employees (employee_no, name, email, department, position) VALUES (?, ?, ?, ?, ?)');
const insertUserRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');

const seedAll = db.transaction(() => {
  for (const [username, pwd, name, email, roleName, position] of usersData) {
    const hash = bcrypt.hashSync(pwd, 10);
    const dept = '管理部';
    insertUser.run(username, hash, name, email);
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    const role = getRoleId.get(roleName);
    if (user && role) insertUserRole.run(user.id, role.id);
    const empNo = 'EMP-' + String(user.id).padStart(3, '0');
    insertEmployee.run(empNo, name, email, dept, position);
  }
});
seedAll();

// 物料品类
const insertCat = db.prepare('INSERT OR IGNORE INTO material_categories (id, name, sort_order) VALUES (?, ?, ?)');
const cats = [
  [1, '光伏组件', 1], [2, '储能电池', 2], [3, '逆变器', 3],
  [4, '线缆', 4], [5, '支架', 5], [6, '配件', 6],
];
const insertCats = db.transaction(() => {
  for (const c of cats) insertCat.run(...c);
});
insertCats();

// 示例物料
const insertMaterial = db.prepare('INSERT OR IGNORE INTO materials (code, name, category_id, spec, unit, cost_price, sell_price) VALUES (?, ?, ?, ?, ?, ?, ?)');
const materials = [
  ['MAT-001', '单晶硅光伏板 550W', 1, '550W/片', '片', 1800000, 2500000],
  ['MAT-002', '磷酸铁锂电池 100Ah', 2, '48V/100Ah', '组', 8500000, 12000000],
  ['MAT-003', '混合逆变器 5kW', 3, '5kW/台', '台', 6000000, 8500000],
  ['MAT-004', 'MC4光伏线缆', 4, '4mm²/米', '米', 15000, 22000],
  ['MAT-005', '铝合金支架套件', 5, '标准套件', '套', 2000000, 2800000],
];
const insertMats = db.transaction(() => {
  for (const m of materials) insertMaterial.run(...m);
});
insertMats();

// 示例客户
const insertCustomer = db.prepare('INSERT OR IGNORE INTO customers (name, contact_person, phone, company) VALUES (?, ?, ?, ?)');
insertCustomer.run('PT Bogor Farm', 'John', '+62812345678', 'PT Bogor Farm');
insertCustomer.run('PT Kendal Industrial', 'Mike', '+62812345679', 'PT Kendal Industrial');

// 示例供应商
const insertSupplier = db.prepare('INSERT OR IGNORE INTO suppliers (name, contact_person, phone, category) VALUES (?, ?, ?, ?)');
insertSupplier.run('深圳光能科技', 'David', '+8613800001111', '光伏组件');
insertSupplier.run('东莞储能科技', 'Kevin', '+8613800002222', '储能电池');

console.log('✅ 数据库初始化完成：22张表，12个角色，7个用户，示例数据已就绪');

module.exports = db;
