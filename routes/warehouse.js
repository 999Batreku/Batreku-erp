const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/warehouse/inbound — 入库列表（支持实体过滤）
  router.get('/inbound', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let sql = `
        SELECT i.*, w.name as warehouse_name, u.real_name as creator_name,
               e.name as entity_name, e.code as entity_code
        FROM inbound_orders i
        LEFT JOIN warehouses w ON w.id = i.warehouse_id
        LEFT JOIN users u ON u.id = i.created_by
        LEFT JOIN entities e ON COALESCE(i.entity_id, w.entity_id) = e.id
      `;
      let params = [];
      if (entity_id) {
        sql += ' WHERE COALESCE(i.entity_id, w.entity_id) = $1';
        params.push(entity_id);
      }
      sql += ' ORDER BY i.id DESC';
      const rows = await db.query(sql, params);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/warehouse/inbound — 创建入库单
  router.post('/inbound', async (req, res) => {
    try {
      const { inbound_no, warehouse_id, procurement_id, type, notes, entity_id } = req.body;
      const no = inbound_no || 'IN-' + Date.now();
      const result = await db.query(`
        INSERT INTO inbound_orders (inbound_no, warehouse_id, procurement_id, type, notes, created_by, entity_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [no, warehouse_id, procurement_id, type || 'purchase', notes, req.user.id, entity_id || null]);
      res.json({ success: true, data: { id: result.rows[0].id }, message: '入库单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/outbound — 出库列表（支持实体过滤）
  router.get('/outbound', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let sql = `
        SELECT o.*, w.name as warehouse_name, u.real_name as creator_name,
               e.name as entity_name, e.code as entity_code
        FROM outbound_orders o
        LEFT JOIN warehouses w ON w.id = o.warehouse_id
        LEFT JOIN users u ON u.id = o.created_by
        LEFT JOIN entities e ON COALESCE(o.entity_id, w.entity_id) = e.id
      `;
      let params = [];
      if (entity_id) {
        sql += ' WHERE COALESCE(o.entity_id, w.entity_id) = $1';
        params.push(entity_id);
      }
      sql += ' ORDER BY o.id DESC';
      const rows = await db.query(sql, params);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/warehouse/outbound — 创建出库单
  router.post('/outbound', async (req, res) => {
    try {
      const { outbound_no, warehouse_id, order_id, type, notes, entity_id } = req.body;
      const no = outbound_no || 'OUT-' + Date.now();
      const result = await db.query(`
        INSERT INTO outbound_orders (outbound_no, warehouse_id, order_id, type, notes, created_by, entity_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [no, warehouse_id, order_id, type || 'sale', notes, req.user.id, entity_id || null]);
      res.json({ success: true, data: { id: result.rows[0].id }, message: '出库单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/inventory — 库存列表（支持实体过滤）
  router.get('/inventory', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let sql = `
        SELECT i.*, w.name as warehouse_name, m.name as material_name, m.code as material_code, m.unit,
               e.name as entity_name, e.code as entity_code
        FROM inventory i
        LEFT JOIN warehouses w ON w.id = i.warehouse_id
        LEFT JOIN materials m ON m.id = i.material_id
        LEFT JOIN entities e ON COALESCE(i.entity_id, w.entity_id, m.entity_id) = e.id
      `;
      let params = [];
      if (entity_id) {
        sql += ' WHERE COALESCE(i.entity_id, w.entity_id, m.entity_id) = $1';
        params.push(entity_id);
      }
      sql += ' ORDER BY w.name, m.name';
      const rows = await db.query(sql, params);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/warehouses — 仓库列表（支持实体过滤）
  router.get('/warehouses', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let sql = `
        SELECT w.*, e.name as entity_name, e.code as entity_code
        FROM warehouses w
        LEFT JOIN entities e ON w.entity_id = e.id
        WHERE w.status = 1
      `;
      let params = [];
      if (entity_id) {
        sql += ' AND w.entity_id = $1';
        params.push(entity_id);
      }
      sql += ' ORDER BY w.name';
      const rows = await db.query(sql, params);
      res.json({ success: true, data: rows.rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
