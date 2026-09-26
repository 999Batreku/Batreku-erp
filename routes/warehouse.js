const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/warehouse/inbound
  router.get('/inbound', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT i.*, w.name as warehouse_name, u.real_name as creator_name
        FROM inbound_orders i
        LEFT JOIN warehouses w ON w.id = i.warehouse_id
        LEFT JOIN users u ON u.id = i.created_by
        ORDER BY i.id DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/warehouse/inbound
  router.post('/inbound', (req, res) => {
    try {
      const { inbound_no, warehouse_id, procurement_id, type, notes } = req.body;
      const no = inbound_no || 'IN-' + Date.now();
      const result = db.prepare(`
        INSERT INTO inbound_orders (inbound_no, warehouse_id, procurement_id, type, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(no, warehouse_id, procurement_id, type || 'purchase', notes, req.user.id);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '入库单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/outbound
  router.get('/outbound', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT o.*, w.name as warehouse_name, u.real_name as creator_name
        FROM outbound_orders o
        LEFT JOIN warehouses w ON w.id = o.warehouse_id
        LEFT JOIN users u ON u.id = o.created_by
        ORDER BY o.id DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/warehouse/outbound
  router.post('/outbound', (req, res) => {
    try {
      const { outbound_no, warehouse_id, order_id, type, notes } = req.body;
      const no = outbound_no || 'OUT-' + Date.now();
      const result = db.prepare(`
        INSERT INTO outbound_orders (outbound_no, warehouse_id, order_id, type, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(no, warehouse_id, order_id, type || 'sale', notes, req.user.id);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '出库单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/inventory
  router.get('/inventory', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT i.*, w.name as warehouse_name, m.name as material_name, m.code as material_code, m.unit
        FROM inventory i
        LEFT JOIN warehouses w ON w.id = i.warehouse_id
        LEFT JOIN materials m ON m.id = i.material_id
        ORDER BY w.name, m.name
      `).all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
