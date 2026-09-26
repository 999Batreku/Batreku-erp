const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/employees
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM employees ORDER BY id').all();
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/employees
  router.post('/', (req, res) => {
    try {
      const { employee_no, name, gender, id_number, phone, email, department, position, entry_date } = req.body;
      const no = employee_no || 'EMP-' + Date.now();
      const result = db.prepare(`
        INSERT INTO employees (employee_no, name, gender, id_number, phone, email, department, position, entry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(no, name, gender, id_number, phone, email, department, position, entry_date);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '员工创建成功' });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.json({ success: false, error: '员工编号已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/employees/:id
  router.put('/:id', (req, res) => {
    try {
      const { name, gender, id_number, phone, email, department, position, entry_date } = req.body;
      db.prepare(`
        UPDATE employees SET name=?, gender=?, id_number=?, phone=?, email=?, department=?, position=?, entry_date=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(name, gender, id_number, phone, email, department, position, entry_date, req.params.id);
      res.json({ success: true, message: '员工更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/employees/:id
  router.delete('/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: '员工已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
