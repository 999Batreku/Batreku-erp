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
        INSERT INTO outbound_orders (outbound_no, warehouse_id, order_id, type, notes, created_by, entity_id, approval_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_dept') RETURNING id
      `, [no, warehouse_id, order_id, type || 'sale', notes, req.user.id, entity_id || null]);
      res.json({ success: true, data: { id: result.rows[0].id }, message: '出库单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/warehouse/outbound-approvals — 出库审批列表（按审批状态）
  router.get('/outbound-approvals', async (req, res) => {
    try {
      const { status } = req.query;
      let sql = `
        SELECT o.*, w.name as warehouse_name, u.real_name as creator_name,
               e.name as entity_name, e.code as entity_code
        FROM outbound_orders o
        LEFT JOIN warehouses w ON w.id = o.warehouse_id
        LEFT JOIN users u ON u.id = o.created_by
        LEFT JOIN entities e ON COALESCE(o.entity_id, w.entity_id) = e.id
        WHERE o.approval_status IS NOT NULL
      `;
      const params = [];
      if (status && status !== 'all') {
        sql += ' AND o.approval_status = $1';
        params.push(status);
      }
      sql += ' ORDER BY o.created_at DESC';
      const result = await db.query(sql, params);
      res.json({ success: true, data: result.rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/warehouse/outbound/:id/approve — 审批通过
  router.put('/outbound/:id/approve', async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body; // dept_manager, ops_director, tech_director, gm
      const userId = req.user.id;
      const userName = req.user.real_name;

      const current = await db.get('SELECT approval_status FROM outbound_orders WHERE id = $1', [id]);
      if (!current) return res.status(404).json({ success: false, error: '出库单不存在' });

      const flow = { pending_dept: 'dept_manager', pending_ops: 'ops_director', pending_tech: 'tech_director', pending_gm: 'gm' };
      const roleField = { dept_manager: 'approval_dept_manager', ops_director: 'approval_ops_director', tech_director: 'approval_tech_director', gm: 'approval_gm' };
      const nextStatus = { pending_dept: 'pending_ops', pending_ops: 'pending_tech', pending_tech: 'pending_gm', pending_gm: 'approved' };

      if (flow[current.approval_status] !== role) {
        return res.status(400).json({ success: false, error: '当前审批节点不匹配' });
      }

      const field = roleField[role];
      const next = nextStatus[current.approval_status];
      await db.run(`UPDATE outbound_orders SET ${field} = $1, approval_status = $2, approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE NULL END, status = CASE WHEN $2 = 'approved' THEN 'completed' ELSE status END WHERE id = $3`, [userName, next, id]);
      res.json({ success: true, message: '审批通过' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/warehouse/outbound/:id/reject — 审批拒绝
  router.put('/outbound/:id/reject', async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await db.run(`UPDATE outbound_orders SET approval_status = 'rejected', rejected_by = $1, rejection_reason = $2 WHERE id = $3`, [req.user.real_name, reason || '未说明原因', id]);
      res.json({ success: true, message: '已拒绝' });
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
