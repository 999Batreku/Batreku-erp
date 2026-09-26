const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/production/plans
  router.get('/plans', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT p.*, o.order_no, u.real_name as creator_name
        FROM production_plans p
        LEFT JOIN orders o ON o.id = p.order_id
        LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.id DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/production/plans
  router.post('/plans', (req, res) => {
    try {
      const { plan_no, order_id, product_name, planned_quantity, unit, start_date, end_date, notes } = req.body;
      const no = plan_no || 'PP-' + Date.now();
      const result = db.prepare(`
        INSERT INTO production_plans (plan_no, order_id, product_name, planned_quantity, unit, start_date, end_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(no, order_id, product_name, planned_quantity, unit, start_date, end_date, notes, req.user.id);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '生产计划创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
