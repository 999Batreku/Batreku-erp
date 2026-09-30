const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const approval = require('../middleware/approval');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/inquiries — 支持多状态筛选
  router.get('/', async (req, res) => {
    try {
      const { status, channel, keyword } = req.query;
      let sql = 'SELECT * FROM inquiries WHERE 1=1';
      const params = [];

      // 支持多状态筛选
      const statusFilter = status || req.query.approval_status;
      if (statusFilter) {
        const statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
        if (statuses.length === 1) {
          sql += ' AND approval_status = ?'; params.push(statuses[0]);
        } else {
          const ph = statuses.map(() => '?').join(',');
          sql += ' AND approval_status IN (' + ph + ')'; params.push(...statuses);
        }
      }
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
          notes, status, assigned_to, created_by, approval_status, approval_chain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ops', '[]')
      `, [
        inquiryNo, d.company_name, d.contact_person, d.phone, d.email, d.product_description,
        d.estimated_capacity, d.estimated_power, d.project_location, d.budget_range, d.channel,
        d.urgency || '普通', d.source_detail, d.notes, d.status || 'new', d.assigned_to, req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, inquiry_no: inquiryNo }, message: '询盘创建成功，已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/inquiries/:id/submit — 提交审批
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const row = await db.get('SELECT approval_status FROM inquiries WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '询盘不存在' });
      if (row.approval_status && row.approval_status !== 'pending_ops' && !['new', 'draft'].includes(row.approval_status)) {
        return res.json({ success: false, error: '当前状态不允许提交' });
      }
      await db.run(`UPDATE inquiries SET approval_status = 'pending_ops', approval_chain = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['inquiry', id, 'submit', req.user.id, '提交询盘审批']);
      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/inquiries/:id/approve — 三级审批
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const row = await db.get('SELECT * FROM inquiries WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '询盘不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);
      const permErr = approval.checkApprovalPermission(aStatus, userRoles);
      if (permErr) return res.status(403).json(permErr);

      if (!signature || String(signature).indexOf('data:image') !== 0) {
        return res.status(400).json({ success: false, error: '审批通过必须签署电子签名' });
      }

      const chain = approval.parseChain(row.approval_chain);
      approval.addToChain(chain, aStatus, req, signature, comment);
      const nextStatus = approval.getNextStatus(aStatus);

      await db.run(`UPDATE inquiries SET approval_status = ?, approval_chain = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextStatus, JSON.stringify(chain), id]);

      if (nextStatus === 'approved') {
        await db.run('UPDATE inquiries SET approved_by = ? WHERE id = ?', [req.user.id, id]);
      }

      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['inquiry', id, 'approve_' + aStatus, req.user.id, comment || approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过']);

      res.json({ success: true, message: approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过，' + approval.getNextLabel(nextStatus), approval_status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/inquiries/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const row = await db.get('SELECT * FROM inquiries WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '询盘不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);
      const permErr = approval.checkApprovalPermission(aStatus, userRoles);
      if (permErr) return res.status(403).json(permErr);

      if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, error: '驳回时必须填写审批意见' });
      }

      await db.run(`UPDATE inquiries SET approval_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['inquiry', id, 'reject', req.user.id, comment]);

      res.json({ success: true, message: '询盘已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/inquiries/:id (保留原有编辑)
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
