const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/employees
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all('SELECT * FROM employees ORDER BY id', []);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/employees
  router.post('/', async (req, res) => {
    try {
      const { employee_no, name, gender, id_number, phone, email, department, position, entry_date } = req.body;
      const no = employee_no || 'EMP-' + Date.now();
      const result = await db.run(`
        INSERT INTO employees (employee_no, name, gender, id_number, phone, email, department, position, entry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, name, gender, id_number, phone, email, department, position, entry_date]);
      res.json({ success: true, data: { id: result.lastInsertRowid }, message: '员工创建成功' });
    } catch (e) {
      if (/unique|duplicate key/i.test(e.message)) return res.json({ success: false, error: '员工编号已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/employees/:id
  router.put('/:id', async (req, res) => {
    try {
      const { name, gender, id_number, phone, email, department, position, entry_date } = req.body;
      await db.run(`
        UPDATE employees SET name=?, gender=?, id_number=?, phone=?, email=?, department=?, position=?, entry_date=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [name, gender, id_number, phone, email, department, position, entry_date, req.params.id]);
      res.json({ success: true, message: '员工更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/employees/:id
  router.delete('/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '员工已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
