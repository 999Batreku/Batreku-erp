const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const approval = require('../middleware/approval');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/logistics — 支持多状态筛选
  router.get('/', async (req, res) => {
    try {
      const { status, keyword } = req.query;
      let sql = 'SELECT * FROM logistics_orders WHERE 1=1';
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
      if (keyword) { sql += ' AND (logistics_no LIKE ? OR carrier LIKE ? OR tracking_no LIKE ? OR order_id LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

      sql += ' ORDER BY id DESC';
      const rows = await db.all(sql, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/logistics/:id
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get('SELECT * FROM logistics_orders WHERE id = ?', [req.params.id]);
      if (!row) return res.json({ success: false, error: '发货单不存在' });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/logistics — 创建发货申请
  router.post('/', async (req, res) => {
    try {
      const d = req.body;
      const logisticsNo = d.logistics_no || ('LGS-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4));

      const result = await db.run(`
        INSERT INTO logistics_orders (logistics_no, order_id, carrier, tracking_no, origin, destination,
          status, estimated_arrival, notes, created_by, approval_status, approval_chain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_ops', '[]')
      `, [
        logisticsNo, d.order_id, d.carrier, d.tracking_no, d.origin, d.destination,
        d.status || 'pending', d.estimated_arrival, d.notes || '', req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, logistics_no: logisticsNo }, message: '发货申请创建成功，已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/logistics/:id/submit
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const row = await db.get('SELECT approval_status FROM logistics_orders WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '发货单不存在' });
      if (row.approval_status && row.approval_status !== 'pending_ops' && !['pending', 'draft'].includes(row.approval_status)) {
        return res.json({ success: false, error: '当前状态不允许提交' });
      }
      await db.run(`UPDATE logistics_orders SET approval_status = 'pending_ops', approval_chain = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/logistics/:id/approve — 三级审批
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const row = await db.get('SELECT * FROM logistics_orders WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '发货单不存在' });

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

      await db.run(`UPDATE logistics_orders SET approval_status = ?, approval_chain = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nextStatus, JSON.stringify(chain), nextStatus, id]);

      if (nextStatus === 'approved') {
        await db.run('UPDATE logistics_orders SET status = ? WHERE id = ?', ['approved', id]);
      }

      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['logistics', id, 'approve_' + aStatus, req.user.id, comment || approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过']);

      res.json({ success: true, message: approval.APPROVAL_LEVEL_LABEL[aStatus] + '审批通过，' + approval.getNextLabel(nextStatus), approval_status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/logistics/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const row = await db.get('SELECT * FROM logistics_orders WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '发货单不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);
      const permErr = approval.checkApprovalPermission(aStatus, userRoles);
      if (permErr) return res.status(403).json(permErr);

      if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, error: '驳回时必须填写审批意见' });
      }

      await db.run(`UPDATE logistics_orders SET approval_status = 'rejected', status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);

      res.json({ success: true, message: '发货申请已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/logistics/:id
  router.delete('/:id', async (req, res) => {
    try {
      const existing = await db.get('SELECT * FROM logistics_orders WHERE id = ?', [req.params.id]);
      if (!existing) return res.json({ success: false, error: '发货单不存在' });
      await db.run('DELETE FROM logistics_orders WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
