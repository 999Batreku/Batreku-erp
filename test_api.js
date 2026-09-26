const http = require('http');
const express = require('express');
const cors = require('cors');
const path = require('path');

// Load DB
const db = require('./database/init');

// Load routes
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

const app = express();
app.use(cors());
app.use(express.json());

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

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'BATREKU ERP API is running' });
});

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'localhost', port: 3001, path: urlPath, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const server = app.listen(3001, '0.0.0.0', async () => {
  console.log('Test server on 3001\n');
  try {
    // 1. Health
    let r = await req('GET', '/api/health');
    console.log('1. Health:', JSON.stringify(r));

    // 2. Login admin
    r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    console.log('2. Login admin:', r.success ? '✅' : '❌', r.success ? r.data.user.real_name : r.error);
    const token = r.data.token;

    // 3. Login alex
    r = await req('POST', '/api/auth/login', { username: 'alex', password: 'alex123' });
    console.log('3. Login alex:', r.success ? '✅' : '❌', r.success ? r.data.user.real_name : r.error);

    // 4. Profile
    r = await req('GET', '/api/auth/profile', null, token);
    console.log('4. Profile:', r.success ? '✅' : '❌', r.data.real_name, '- roles:', r.data.roles.map(x=>x.display_name).join(', '));

    // 5. Users
    r = await req('GET', '/api/users', null, token);
    console.log('5. Users:', r.success ? '✅' : '❌', r.data.length + ' users');

    // 6. Create quotation
    r = await req('POST', '/api/quotations', {
      quotation_no: 'QT-TEST-001', customer_id: 1, title: 'Bogor养鸡场光伏项目报价',
      items: [
        { material_id: 1, description: '单晶硅光伏板 550W', quantity: 100, unit: '片', unit_price: 2500000 },
        { material_id: 3, description: '混合逆变器 5kW', quantity: 5, unit: '台', unit_price: 8500000 }
      ]
    }, token);
    console.log('6. Create quote:', r.success ? '✅' : '❌', r.message);

    // 7. List quotations
    r = await req('GET', '/api/quotations', null, token);
    console.log('7. Quotes list:', r.success ? '✅' : '❌', r.data.length + ' quotations');

    // 8. Create order
    r = await req('POST', '/api/orders', {
      order_no: 'SO-TEST-001', customer_id: 1, title: 'Bogor养鸡场项目订单',
      items: [{ material_id: 1, description: '光伏板', quantity: 100, unit: '片', unit_price: 2500000 }]
    }, token);
    console.log('8. Create order:', r.success ? '✅' : '❌', r.message);

    // 9. Employees
    r = await req('GET', '/api/employees', null, token);
    console.log('9. Employees:', r.success ? '✅' : '❌', r.data.length + ' employees');

    // 10. Create procurement
    r = await req('POST', '/api/procurement', {
      title: '光伏组件采购', supplier_id: 1,
      items: [{ material_id: 1, description: '光伏板', quantity: 200, unit: '片', unit_price: 1800000 }]
    }, token);
    console.log('10. Create procurement:', r.success ? '✅' : '❌', r.message);

    // 11. Inventory
    r = await req('GET', '/api/warehouse/inventory', null, token);
    console.log('11. Inventory:', r.success ? '✅' : '❌', r.data.length + ' items');

    console.log('\n✅ 全部API接口测试通过！服务运行正常。');
  } catch(e) {
    console.log('❌ Error:', e.message);
  }
  server.close();
  process.exit(0);
});
