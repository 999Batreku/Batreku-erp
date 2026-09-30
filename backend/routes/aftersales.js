const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const approval = require('../middleware/approval');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/aftersales — 支持多状态筛选
  router.get('/', async (req, res) => {
    try {
      const { status, priority, keyword } = req.query;
      let sql = 'SELECT * FROM aftersales_tickets WHERE 1=1';
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
      if (priority) { sql += ' AND priority = ?'; params.push(priority); }
      if (keyword) {
        sql += ' AND (ticket_no LIKE ? OR description LIKE ?)';
        params.push(`%${keyword}%`, `%${keyword}%`);
      }

      sql += ' ORDER BY id DESC';
      const rows = await db.all(sql, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/aftersales/:id
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM aftersales_tickets WHERE id = ?', [req.params.id]);
      if (!row) return res.json({ success: false, error: '工单不存在' });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/aftersales — 创建售后工单
  router.post('/', async (req, res) => {
    try {
      const d = req.body;
      const ticketNo = d.ticket_no || ('AS-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4));

      const result = await db.run(`
        INSERT INTO aftersales_tickets (ticket_no, order_id, customer_id, issue_type, priority,
          description, assigned_to, sla_deadline, approval_status, approval_chain, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_ops', '[]', ?)
      `, [
        ticketNo, d.order_id || null, d.customer_id || null, d.issue_type,
        d.priority || 'P3', d.description, d.assigned_to || null,
        d.sla_deadline || null, req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, ticket_no: ticketNo }, message: '售后工单创建成功，已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/aftersales/:id/submit
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const row = await db.get('SELECT approval_status FROM aftersales_tickets WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '工单不存在' });
      if (row.approval_status && row.approval_status !== 'pending_ops' && !['draft', 'new'].includes(row.approval_status)) {
        return res.json({ success: false, error: '当前状态不允许提交' });
      }
      await db.run(`UPDATE aftersales_tickets SET approval_status = 'pending_ops', approval_chain = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/aftersales/:id/approve — 三级审批
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const row = await db.get('SELECT * FROM aftersales_tickets WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '工单不存在' });

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

      await db.run(`UPDATE aftersales_tickets SET approval_status = ?, approval_chain = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextStatus, JSON.stringify(chain), id]);

      if (nextStatus === 'approved') {
        await db.run('UPDATE aftersales_tickets SET approved_by = ? WHERE id = ?', [req.user.id, id]);
      }

      res.json({ success: true, message: approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过，' + approval.getNextLabel(nextStatus), approval_status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/aftersales/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const row = await db.get('SELECT * FROM aftersales_tickets WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '工单不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);
      const permErr = approval.checkApprovalPermission(aStatus, userRoles);
      if (permErr) return res.status(403).json(permErr);

      if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, error: '驳回时必须填写审批意见' });
      }

      await db.run(`UPDATE aftersales_tickets SET approval_status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      res.json({ success: true, message: '售后工单已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/aftersales/:id — 编辑（更新处理情况）
  router.put('/:id', async (req, res) => {
    try {
      const d = req.body;
      const id = req.params.id;
      const existing = await db.get('SELECT * FROM aftersales_tickets WHERE id = ?', [id]);
      if (!existing) return res.json({ success: false, error: '工单不存在' });

      await db.run(`
        UPDATE aftersales_tickets SET issue_type=?, priority=?, description=?, resolution=?,
          assigned_to=?, sla_deadline=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [
        d.issue_type || existing.issue_type, d.priority || existing.priority,
        d.description || existing.description, d.resolution || existing.resolution,
        d.assigned_to || existing.assigned_to, d.sla_deadline || existing.sla_deadline, id
      ]);

      res.json({ success: true, message: '工单更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/aftersales/:id
  router.delete('/:id', async (req, res) => {
    try {
      const existing = await db.get('SELECT * FROM aftersales_tickets WHERE id = ?', [req.params.id]);
      if (!existing) return res.json({ success: false, error: '工单不存在' });
      await db.run('DELETE FROM aftersales_tickets WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
