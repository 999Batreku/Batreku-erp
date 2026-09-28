const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/followups
  router.get('/', async (req, res) => {
    try {
      const { customer_id, customer_grade, followup_type, keyword } = req.query;

      let sql = `SELECT f.*, c.customer_code FROM customer_followups f LEFT JOIN customers c ON c.id = f.customer_id WHERE 1=1`;
      const params = [];

      if (customer_id) { sql += ` AND customer_id = ?`; params.push(customer_id); }
      if (customer_grade) { sql += ` AND customer_grade = ?`; params.push(customer_grade); }
      if (followup_type) { sql += ` AND followup_type = ?`; params.push(followup_type); }
      if (keyword) {
        sql += ` AND (content LIKE ? OR feedback LIKE ? OR customer_name LIKE ?)`;
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw);
      }

      sql += ` ORDER BY followup_date DESC, id DESC`;
      const records = await db.all(sql, params);
      res.json({ success: true, data: records });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/followups/customers
  router.get('/customers', async (req, res) => {
    try {
      const customers = await db.all(`SELECT id, name, customer_code, grade FROM customers WHERE status = 1 ORDER BY name`, []);
      res.json({ success: true, data: customers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/followups
  router.post('/', async (req, res) => {
    try {
      const { customer_id, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name } = req.body;

      if (!customer_id || !followup_type || !followup_date || !content) {
        return res.json({ success: false, error: '请填写必填字段：客户、跟进方式、跟进日期、跟进内容' });
      }

      const result = await db.run(`
        INSERT INTO customer_followups (customer_id, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        customer_id, customer_name || '', customer_grade || '', followup_type || '', followup_date, next_followup_date || '', content || '', feedback || '', attachment || '', location_name || '', req.user?.username || ''
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/followups/:id
  router.delete('/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM customer_followups WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
