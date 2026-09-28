const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/finance/payments
  router.get('/payments', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT p.*, o.order_no, c.name as customer_name, u.real_name as creator_name
        FROM payment_records p
        LEFT JOIN orders o ON o.id = p.order_id
        LEFT JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.id DESC
      `, []);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/finance/payments
  router.post('/payments', async (req, res) => {
    try {
      const { payment_no, order_id, customer_id, amount, currency, payment_method, payment_date, notes } = req.body;
      const no = payment_no || 'PAY-' + Date.now();
      const result = await db.run(`
        INSERT INTO payment_records (payment_no, order_id, customer_id, amount, currency, payment_method, payment_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, order_id, customer_id, amount, currency || 'IDR', payment_method, payment_date, notes, req.user.id]);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '收款记录创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
