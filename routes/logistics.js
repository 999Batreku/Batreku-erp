const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/logistics
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT l.*, o.order_no, u.real_name as creator_name
        FROM logistics_orders l
        LEFT JOIN orders o ON o.id = l.order_id
        LEFT JOIN users u ON u.id = l.created_by
        ORDER BY l.id DESC
      `).all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/logistics
  router.post('/', (req, res) => {
    try {
      const { logistics_no, order_id, carrier, tracking_no, origin, destination, estimated_arrival, notes } = req.body;
      const no = logistics_no || 'LG-' + Date.now();
      const result = db.prepare(`
        INSERT INTO logistics_orders (logistics_no, order_id, carrier, tracking_no, origin, destination, estimated_arrival, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(no, order_id, carrier, tracking_no, origin, destination, estimated_arrival, notes, req.user.id);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '物流单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
