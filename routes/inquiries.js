const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/inquiries
  router.get('/', async (req, res) => {
    try {
      const { status, channel, keyword } = req.query;
      let sql = 'SELECT * FROM inquiries WHERE 1=1';
      const params = [];

      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (channel) { sql += ' AND channel = ?'; params.push(channel); }
      if (keyword) { sql += ' AND (company_name LIKE ? OR inquiry_no LIKE ? OR contact_person LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

      sql += ' ORDER BY id DESC';
      const rows = await db.all(sql, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/inquiries/:id
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM inquiries WHERE id = ?', [req.params.id]);
      if (!row) return res.json({ success: false, error: '询盘不存在' });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/inquiries
  router.post('/', async (req, res) => {
    try {
      const d = req.body;
      const inquiryNo = d.inquiry_no || ('LT-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-3));

      const result = await db.run(`
        INSERT INTO inquiries (inquiry_no, company_name, contact_person, phone, email, product_description,
          estimated_capacity, estimated_power, project_location, budget_range, channel, urgency, source_detail,
          notes, status, assigned_to, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        inquiryNo, d.company_name, d.contact_person, d.phone, d.email, d.product_description,
        d.estimated_capacity, d.estimated_power, d.project_location, d.budget_range, d.channel,
        d.urgency || '普通', d.source_detail, d.notes, d.status || 'new', d.assigned_to, req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, inquiry_no: inquiryNo }, message: '询盘创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/inquiries/:id
  router.put('/:id', async (req, res) => {
    try {
      const d = req.body;
      const id = req.params.id;
      const existing = await db.get('SELECT * FROM inquiries WHERE id = ?', [id]);
      if (!existing) return res.json({ success: false, error: '询盘不存在' });

      await db.run(`
        UPDATE inquiries SET company_name=?, contact_person=?, phone=?, email=?, product_description=?,
          estimated_capacity=?, estimated_power=?, project_location=?, budget_range=?, channel=?,
          urgency=?, source_detail=?, notes=?, status=?, assigned_to=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        d.company_name || existing.company_name, d.contact_person || existing.contact_person,
        d.phone || existing.phone, d.email || existing.email, d.product_description || existing.product_description,
        d.estimated_capacity || existing.estimated_capacity, d.estimated_power || existing.estimated_power,
        d.project_location || existing.project_location, d.budget_range || existing.budget_range,
        d.channel || existing.channel, d.urgency || existing.urgency, d.source_detail || existing.source_detail,
        d.notes !== undefined ? d.notes : existing.notes, d.status || existing.status,
        d.assigned_to || existing.assigned_to, id
      ]);

      res.json({ success: true, message: '询盘更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/inquiries/:id
  router.delete('/:id', async (req, res) => {
    try {
      const existing = await db.get('SELECT * FROM inquiries WHERE id = ?', [req.params.id]);
      if (!existing) return res.json({ success: false, error: '询盘不存在' });
      await db.run('DELETE FROM inquiries WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
