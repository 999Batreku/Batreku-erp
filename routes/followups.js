const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // 创建 customer_followups 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      customer_name TEXT,
      customer_grade TEXT,
      followup_type TEXT,
      followup_date TEXT,
      next_followup_date TEXT,
      content TEXT,
      feedback TEXT,
      attachment TEXT,
      location_name TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);
  // 兼容迁移：添加 location_name 列
  try { db.prepare('ALTER TABLE customer_followups ADD COLUMN location_name TEXT').run(); } catch(e) {}

  // GET /api/followups - 获取跟进记录列表（支持筛选）
  router.get('/', (req, res) => {
    try {
      const { customer_id, customer_grade, followup_type, keyword } = req.query;
      
      let sql = `SELECT f.*, c.customer_code FROM customer_followups f LEFT JOIN customers c ON c.id = f.customer_id WHERE 1=1`;
      const params = [];

      if (customer_id) {
        sql += ` AND customer_id = ?`;
        params.push(customer_id);
      }
      if (customer_grade) {
        sql += ` AND customer_grade = ?`;
        params.push(customer_grade);
      }
      if (followup_type) {
        sql += ` AND followup_type = ?`;
        params.push(followup_type);
      }
      if (keyword) {
        sql += ` AND (content LIKE ? OR feedback LIKE ? OR customer_name LIKE ?)`;
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw);
      }

      sql += ` ORDER BY followup_date DESC, id DESC`;

      const records = db.prepare(sql).all(...params);
      res.json({ success: true, data: records });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/followups/customers - 获取客户下拉列表（用于新建跟进时选择）
  router.get('/customers', (req, res) => {
    try {
      const customers = db.prepare(`SELECT id, name, customer_code, grade FROM customers WHERE status = 1 ORDER BY name`).all();
      res.json({ success: true, data: customers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/followups - 新建跟进记录
  router.post('/', (req, res) => {
    try {
      const { customer_id, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name } = req.body;

      if (!customer_id || !followup_type || !followup_date || !content) {
        return res.json({ success: false, error: '请填写必填字段：客户、跟进方式、跟进日期、跟进内容' });
      }

      const result = db.prepare(`
        INSERT INTO customer_followups (customer_id, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customer_id, customer_name || '', customer_grade || '', followup_type || '', followup_date, next_followup_date || '', content || '', feedback || '', attachment || '', location_name || '', req.user?.username || ''
      );

      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/followups/:id - 删除跟进记录
  router.delete('/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM customer_followups WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
