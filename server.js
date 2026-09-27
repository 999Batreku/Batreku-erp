const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize database
const db = require('./database/init');

// Run idempotent upgrades (new roles/accounts)
require('./database/upgrade')(db);

// Import middleware
const { authMiddleware } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth')(db);
const userRoutes = require('./routes/users')(db);
const quotationRoutes = require('./routes/quotations')(db);
const orderRoutes = require('./routes/orders')(db);
const procurementRoutes = require('./routes/procurement')(db);
const warehouseRoutes = require('./routes/warehouse')(db);
const logisticsRoutes = require('./routes/logistics')(db);
const productionRoutes = require('./routes/production')(db);
const financeRoutes = require('./routes/finance')(db);
const employeeRoutes = require('./routes/employees')(db);
const customerRoutes = require('./routes/customers')(db);
const followupRoutes = require('./routes/followups')(db);
const inquiryRoutes = require('./routes/inquiries')(db);
const adminRoutes = require('./routes/admin')(db);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/procurement', procurementRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/inquiries', inquiryRoutes);
app.use('/api/admin', adminRoutes);

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BATREKU ERP Server running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Database: ${path.join(__dirname, 'database/batreku.db')}`);
});
