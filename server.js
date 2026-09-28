const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database/db');
const initDatabase = require('./database/pg-init');

// Import middleware
const { authMiddleware } = require('./middleware/auth');

// Import route factories
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const quotationRoutes = require('./routes/quotations');
const orderRoutes = require('./routes/orders');
const procurementRoutes = require('./routes/procurement');
const warehouseRoutes = require('./routes/warehouse');
const logisticsRoutes = require('./routes/logistics');
const productionRoutes = require('./routes/production');
const financeRoutes = require('./routes/finance');
const employeeRoutes = require('./routes/employees');
const customerRoutes = require('./routes/customers');
const followupRoutes = require('./routes/followups');
const inquiryRoutes = require('./routes/inquiries');
const adminRoutes = require('./routes/admin');

const app = express();
// 固定监听 3000，与 Railway Public Domain 绑定的目标端口保持一致（process.env.PORT 为随机值会导致 502）
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes(db));
app.use('/api/users', userRoutes(db));
app.use('/api/quotations', quotationRoutes(db));
app.use('/api/orders', orderRoutes(db));
app.use('/api/procurement', procurementRoutes(db));
app.use('/api/warehouse', warehouseRoutes(db));
app.use('/api/logistics', logisticsRoutes(db));
app.use('/api/production', productionRoutes(db));
app.use('/api/finance', financeRoutes(db));
app.use('/api/employees', employeeRoutes(db));
app.use('/api/customers', customerRoutes(db));
app.use('/api/followups', followupRoutes(db));
app.use('/api/inquiries', inquiryRoutes(db));
app.use('/api/admin', adminRoutes(db));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'BATREKU ERP API is running', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: '接口不存在' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// 先初始化数据库（仅全新空库时写入种子），再启动服务
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 BATREKU ERP Server running at http://0.0.0.0:${PORT}`);
      console.log(`📊 Database: PostgreSQL (${process.env.DATABASE_URL ? 'DATABASE_URL' : 'default'})`);
    });
  } catch (e) {
    console.error('❌ Failed to start:', e);
    process.exit(1);
  }
}

start();
