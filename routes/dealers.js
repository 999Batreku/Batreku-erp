const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const approval = require('../middleware/approval');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/dealers — 支持多状态筛选
  router.get('/', async (req, res) => {
    try {
      const { status, keyword } = req.query;
      let sql = 'SELECT * FROM dealer_applications WHERE 1=1';
      const params = [];

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
      if (keyword) {
        sql += ' AND (dealer_name LIKE ? OR contact_person LIKE ? OR application_no LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }

      sql += ' ORDER BY id DESC';
      const rows = await db.all(sql, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/dealers/:id
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM dealer_applications WHERE id = ?', [req.params.id]);
      if (!row) return res.json({ success: false, error: '申请不存在' });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/dealers — 创建经销商准入申请
  router.post('/', async (req, res) => {
    try {
      const d = req.body;
      const appNo = d.application_no || ('DA-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4));

      const result = await db.run(`
        INSERT INTO dealer_applications (application_no, dealer_name, contact_person, phone, email,
          address, business_license, business_scope, annual_revenue, cooperation_history,
          notes, approval_status, approval_chain, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ops', '[]', ?)
      `, [
        appNo, d.dealer_name, d.contact_person, d.phone, d.email,
        d.address, d.business_license, d.business_scope, d.annual_revenue, d.cooperation_history,
        d.notes || '', req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, application_no: appNo }, message: '经销商准入申请创建成功，已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/dealers/:id/submit
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const row = await db.get('SELECT approval_status FROM dealer_applications WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '申请不存在' });
      if (row.approval_status && row.approval_status !== 'pending_ops' && !['draft', 'new'].includes(row.approval_status)) {
        return res.json({ success: false, error: '当前状态不允许提交' });
      }
      await db.run(`UPDATE dealer_applications SET approval_status = 'pending_ops', approval_chain = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/dealers/:id/approve — 三级审批
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const row = await db.get('SELECT * FROM dealer_applications WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '申请不存在' });

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

      await db.run(`UPDATE dealer_applications SET approval_status = ?, approval_chain = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextStatus, JSON.stringify(chain), id]);

      if (nextStatus === 'approved') {
        await db.run('UPDATE dealer_applications SET approved_by = ? WHERE id = ?', [req.user.id, id]);
      }

      res.json({ success: true, message: approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过，' + approval.getNextLabel(nextStatus), approval_status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/dealers/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const row = await db.get('SELECT * FROM dealer_applications WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '申请不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);
      const permErr = approval.checkApprovalPermission(aStatus, userRoles);
      if (permErr) return res.status(403).json(permErr);

      if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, error: '驳回时必须填写审批意见' });
      }

      await db.run(`UPDATE dealer_applications SET approval_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      res.json({ success: true, message: '经销商准入申请已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/dealers/:id — 编辑
  router.put('/:id', async (req, res) => {
    try {
      const d = req.body;
      const id = req.params.id;
      const existing = await db.get('SELECT * FROM dealer_applications WHERE id = ?', [id]);
      if (!existing) return res.json({ success: false, error: '申请不存在' });

      await db.run(`
        UPDATE dealer_applications SET dealer_name=?, contact_person=?, phone=?, email=?,
          address=?, business_license=?, business_scope=?, annual_revenue=?, cooperation_history=?,
          notes=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        d.dealer_name || existing.dealer_name, d.contact_person || existing.contact_person,
        d.phone || existing.phone, d.email || existing.email, d.address || existing.address,
        d.business_license || existing.business_license, d.business_scope || existing.business_scope,
        d.annual_revenue || existing.annual_revenue, d.cooperation_history || existing.cooperation_history,
        d.notes !== undefined ? d.notes : existing.notes, id
      ]);

      res.json({ success: true, message: '申请更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/dealers/:id
  router.delete('/:id', async (req, res) => {
    try {
      const existing = await db.get('SELECT * FROM dealer_applications WHERE id = ?', [req.params.id]);
      if (!existing) return res.json({ success: false, error: '申请不存在' });
      await db.run('DELETE FROM dealer_applications WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
