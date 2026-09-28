const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/procurement
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT p.*, s.name as supplier_name, u.real_name as creator_name
        FROM procurement_requests p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.id DESC
      `, []);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/procurement/:id
  router.get('/:id', async (req, res) => {
    try {
      const p = await db.get(`
        SELECT p.*, s.name as supplier_name FROM procurement_requests p
        LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?
      `, [req.params.id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });
      const items = await db.all(`
        SELECT pi.*, m.name as material_name, m.code as material_code
        FROM procurement_items pi LEFT JOIN materials m ON m.id = pi.material_id
        WHERE pi.request_id = ?
      `, [p.id]);
      res.json({ success: true, data: { ...p, items } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement
  router.post('/', async (req, res) => {
    try {
      const { request_no, order_id, title, supplier_id, currency, notes, items } = req.body;
      const no = request_no || 'PR-' + Date.now();
      let total = 0;
      if (items && items.length) total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

      const result = await db.run(`
        INSERT INTO procurement_requests (request_no, order_id, title, total_amount, currency, supplier_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, order_id, title, total, currency || 'IDR', supplier_id, notes, req.user.id]);
      const pid = result.lastInsertRowid;

      if (items && items.length) {
        for (const item of items) {
          await db.run(`
            INSERT INTO procurement_items (request_id, material_id, description, quantity, unit, unit_price, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [pid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]);
        }
      }

      res.json({ success: true, data: { id: pid }, message: '采购申请创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement/:id/submit
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const p = await db.get('SELECT status FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });
      if (p.status !== 'draft') return res.json({ success: false, error: '只能提交草稿状态' });
      await db.run('UPDATE procurement_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending', id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['procurement', id, 'submit', req.user.id, '提交审批']);
      res.json({ success: true, message: '已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
