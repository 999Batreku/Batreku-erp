const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // 三级审批流
  const APPROVAL_FLOW = ['pending_ops', 'pending_tech', 'pending_gm'];
  const APPROVAL_LEVEL_ROLE = {
    'pending_ops':  'operations_director',
    'pending_tech': 'technical_director',
    'pending_gm':   'general_manager',
  };
  const APPROVAL_LEVEL_LABEL = {
    'pending_ops':  '运营总监',
    'pending_tech': '技术总监',
    'pending_gm':   '总经理',
  };

  const APPROVER_ROLES = ['operations_director', 'technical_director', 'general_manager'];
  function canApprove(req) {
    const roles = (req.user && req.user.roles) || [];
    return roles.some(function(r){ return APPROVER_ROLES.indexOf(r) >= 0; });
  }
  function hasRole(roles, role) {
    return roles.indexOf(role) >= 0;
  }
  async function getUserRoles(userId) {
    const rows = await db.all(
      'SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?',
      [userId]
    );
    return rows.map(function(r){ return r.name; });
  }
  function parseChain(raw) {
    try { return JSON.parse(raw || '[]'); } catch(e) { return []; }
  }

  // GET /api/procurement — 支持多状态筛选
  router.get('/', async (req, res) => {
    try {
      let rows;
      const statusFilter = req.query.status;
      if (statusFilter) {
        const statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
        if (statuses.length === 1) {
          rows = await db.all(`
            SELECT p.*, s.name as supplier_name, u.real_name as creator_name
            FROM procurement_requests p
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN users u ON u.id = p.created_by
            WHERE p.status = ?
            ORDER BY p.id DESC
          `, [statuses[0]]);
        } else {
          const placeholders = statuses.map(function(){ return '?'; }).join(',');
          rows = await db.all(`
            SELECT p.*, s.name as supplier_name, u.real_name as creator_name
            FROM procurement_requests p
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            LEFT JOIN users u ON u.id = p.created_by
            WHERE p.status IN (${placeholders})
            ORDER BY p.id DESC
          `, statuses);
        }
      } else {
        rows = await db.all(`
          SELECT p.*, s.name as supplier_name, u.real_name as creator_name
          FROM procurement_requests p
          LEFT JOIN suppliers s ON s.id = p.supplier_id
          LEFT JOIN users u ON u.id = p.created_by
          ORDER BY p.id DESC
        `, []);
      }
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/procurement/:id
  router.get('/:id', async (req, res) => {
    try {
      const p = await db.get(`
        SELECT p.*, s.name as supplier_name FROM procurement_requests p
        LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?
      `, [req.params.id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });
      const items = await db.all(`
        SELECT pi.*, m.name as material_name, m.code as material_code
        FROM procurement_items pi LEFT JOIN materials m ON m.id = pi.material_id
        WHERE pi.request_id = ?
      `, [p.id]);
      res.json({ success: true, data: { ...p, items } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement
  router.post('/', async (req, res) => {
    try {
      const { request_no, order_id, title, supplier_id, currency, notes, items } = req.body;
      const no = request_no || 'PR-' + Date.now();
      let total = 0;
      if (items && items.length) total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

      const result = await db.run(`
        INSERT INTO procurement_requests (request_no, order_id, title, total_amount, currency, supplier_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, order_id, title, total, currency || 'IDR', supplier_id, notes, req.user.id]);
      const pid = result.lastInsertRowid;

      if (items && items.length) {
        for (const item of items) {
          await db.run(`
            INSERT INTO procurement_items (request_id, material_id, description, quantity, unit, unit_price, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [pid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]);
        }
      }

      res.json({ success: true, data: { id: pid }, message: '采购申请创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement/:id/submit — 提交审批，状态变为 pending_ops
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const p = await db.get('SELECT status FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });
      if (p.status !== 'draft') return res.json({ success: false, error: '只能提交草稿状态' });
      await db.run('UPDATE procurement_requests SET status = ?, approval_chain = \'[]\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending_ops', id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['procurement', id, 'submit', req.user.id, '提交审批']);
      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/procurement/:id/approve — 三级审批流
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const p = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });

      const aStatus = p.status || 'pending_ops';
      if (!['pending_ops', 'pending_tech', 'pending_gm'].includes(aStatus)) {
        return res.json({ success: false, error: '当前状态不在审批流程中' });
      }

      const userRoles = await getUserRoles(req.user.id);
      const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
      const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];

      const userCanApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
      if (!userCanApprove) {
        return res.status(403).json({
          success: false,
          error: `当前审批级别为${requiredLabel}，需要${requiredLabel}或总经理角色才能审批`
        });
      }

      if (!signature || String(signature).indexOf('data:image') !== 0) {
        return res.status(400).json({ success: false, error: '审批通过必须签署电子签名' });
      }

      const now = new Date().toISOString();
      const chain = parseChain(p.approval_chain);
      chain.push({
        level: aStatus.replace('pending_', ''),
        level_label: requiredLabel,
        approver_id: req.user.id,
        approver_name: req.user.real_name || req.user.username,
        signature: signature,
        approved_at: now,
        comment: comment || '',
      });

      const currentIndex = APPROVAL_FLOW.indexOf(aStatus);
      let nextStatus;
      if (currentIndex < APPROVAL_FLOW.length - 1) {
        nextStatus = APPROVAL_FLOW[currentIndex + 1];
      } else {
        nextStatus = 'approved';
      }

      await db.run(`
        UPDATE procurement_requests SET
          status = ?,
          approval_chain = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [nextStatus, JSON.stringify(chain), id]);

      if (nextStatus === 'approved') {
        await db.run('UPDATE procurement_requests SET approved_by = ? WHERE id = ?', [req.user.id, id]);
      }

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['procurement', id, 'approve_' + aStatus, req.user.id, comment || `${requiredLabel}审批通过`]
      );

      const nextLabel = nextStatus === 'approved' ? '已通过（全部审批完成）' : `等待${APPROVAL_LEVEL_LABEL[nextStatus]}审批`;
      res.json({ success: true, message: `${requiredLabel}审批通过，${nextLabel}`, status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/procurement/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const p = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });

      const aStatus = p.status || 'pending_ops';
      if (!['pending_ops', 'pending_tech', 'pending_gm'].includes(aStatus)) {
        return res.json({ success: false, error: '当前状态不在审批流程中' });
      }

      const userRoles = await getUserRoles(req.user.id);
      const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
      const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];

      const userCanApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
      if (!userCanApprove) {
        return res.status(403).json({
          success: false,
          error: `当前审批级别为${requiredLabel}，需要${requiredLabel}或总经理角色才能驳回`
        });
      }

      if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, error: '驳回时必须填写审批意见' });
      }

      await db.run(`
        UPDATE procurement_requests SET
          status = 'rejected',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [id]);

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['procurement', id, 'reject', req.user.id, comment || `${requiredLabel}驳回`]
      );

      res.json({ success: true, message: '采购申请已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
