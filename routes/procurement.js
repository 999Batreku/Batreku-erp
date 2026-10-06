const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // ===== 实体差异化审批流 =====
  const ENTITY_FLOWS = {
    'JTF': ['pending_ops',  'pending_tech', 'pending_gm'],  // 运营总监→技术总监→总经理
    'PFB': ['pending_factory', 'pending_tech', 'pending_gm'], // 厂长→技术总监→总经理
    'SZJ': ['pending_tech', 'pending_gm'],                   // 技术总监→总经理
  };

  const APPROVAL_LEVEL_ROLE = {
    'pending_ops':     'operations_director',
    'pending_factory': 'factory_director',
    'pending_tech':    'technical_director',
    'pending_gm':      'general_manager',
  };

  const APPROVAL_LEVEL_LABEL = {
    'pending_ops':     '运营总监',
    'pending_factory': '厂长',
    'pending_tech':    '技术总监',
    'pending_gm':      '总经理',
  };

  const ALL_APPROVER_ROLES = ['operations_director', 'factory_director', 'technical_director', 'general_manager'];

  function hasRole(roles, role) { return roles.indexOf(role) >= 0; }

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

  // 获取实体对应的审批流
  async function getEntityFlow(entityId) {
    const ent = await db.get('SELECT code FROM entities WHERE id = ?', [entityId]);
    if (!ent) return ENTITY_FLOWS['JTF']; // fallback
    return ENTITY_FLOWS[ent.code] || ENTITY_FLOWS['JTF'];
  }

  // 获取实体的编号前缀
  async function getEntityPrefix(entityId) {
    const ent = await db.get('SELECT purchase_prefix FROM entities WHERE id = ?', [entityId]);
    return ent ? ent.purchase_prefix : 'PR';
  }

  // 获取当前实体的首个审批状态
  async function getInitialStatus(entityId) {
    const flow = await getEntityFlow(entityId);
    return flow[0] || 'pending_ops';
  }

  // GET /api/procurement/materials — 物料列表（支持按实体过滤）
  router.get('/materials', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let query = 'SELECT m.*, e.name as entity_name, e.code as entity_code FROM materials m LEFT JOIN entities e ON m.entity_id = e.id WHERE m.status = \'active\'';
      let params = [];
      if (entity_id) {
        query += ' AND m.entity_id = $' + (params.length + 1);
        params.push(entity_id);
      }
      query += ' ORDER BY m.name';
      const materials = await db.query(query, params);
      res.json({ success: true, data: materials.rows });
    } catch (err) {
      console.error('List materials error:', err);
      res.json({ success: true, data: [] });
    }
  });

  // GET /api/procurement/requests — 支持实体 + 状态筛选
  router.get('/requests', async (req, res) => {
    try {
      const { entity_id, status } = req.query;
      let where = [];
      let params = [];

      if (entity_id) {
        where.push('p.entity_id = ?');
        params.push(Number(entity_id));
      }
      if (status) {
        const statuses = Array.isArray(status) ? status : [status];
        if (statuses.length === 1) {
          where.push('p.status = ?');
          params.push(statuses[0]);
        } else {
          const placeholders = statuses.map(function(){ return '?'; }).join(',');
          where.push('p.status IN (' + placeholders + ')');
          params = params.concat(statuses);
        }
      }

      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const rows = await db.all(
        `SELECT p.*, s.name as supplier_name, u.real_name as creator_name,
                e.name as entity_name, e.code as entity_code,
                te.name as target_entity_name
         FROM procurement_requests p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN users u ON u.id = p.created_by
         LEFT JOIN entities e ON e.id = p.entity_id
         LEFT JOIN entities te ON te.id = p.target_entity_id
         ${whereClause}
         ORDER BY p.id DESC`,
        params
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/procurement/:id
  router.get('/requests/:id', async (req, res) => {
    try {
      const p = await db.get(`
        SELECT p.*, s.name as supplier_name,
               e.name as entity_name, e.code as entity_code,
               te.name as target_entity_name
        FROM procurement_requests p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
        LEFT JOIN entities e ON e.id = p.entity_id
        LEFT JOIN entities te ON te.id = p.target_entity_id
        WHERE p.id = ?
      `, [req.params.id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });

      const items = await db.all(`
        SELECT pi.*, m.name as material_name, m.code as material_code
        FROM procurement_items pi LEFT JOIN materials m ON m.id = pi.material_id
        WHERE pi.request_id = ?
      `, [p.id]);

      // 附加审批流信息
      const entityFlow = await getEntityFlow(p.entity_id);
      const approvalFlowInfo = entityFlow.map(function(s) {
        return { status: s, role: APPROVAL_LEVEL_ROLE[s], label: APPROVAL_LEVEL_LABEL[s] };
      });

      res.json({ success: true, data: { ...p, items, approval_flow: approvalFlowInfo } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement — 创建采购申请（必须指定 entity_id）
  router.post('/requests', async (req, res) => {
    try {
      const { request_no, order_id, title, supplier_id, currency, notes, items, entity_id, target_entity_id } = req.body;

      if (!entity_id) {
        return res.status(400).json({ success: false, error: '必须指定采购实体 entity_id' });
      }

      // 获取实体编号前缀
      const prefix = await getEntityPrefix(entity_id);

      // 生成编号：PR-{ENTITY}-YYYY-NNN
      const year = new Date().getFullYear();
      const countRow = await db.get(
        "SELECT COUNT(*)::int as n FROM procurement_requests WHERE request_no LIKE ?",
        [prefix + '-' + year + '-%']
      );
      const seq = String((countRow.n || 0) + 1).padStart(3, '0');
      const no = request_no || (prefix + '-' + year + '-' + seq);

      let total = 0;
      if (items && items.length) total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

      const result = await db.run(`
        INSERT INTO procurement_requests (request_no, order_id, title, total_amount, currency, supplier_id, entity_id, target_entity_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, order_id, title, total, currency || 'IDR', supplier_id, entity_id, target_entity_id, notes, req.user.id]);
      const pid = result.lastInsertRowid;

      if (items && items.length) {
        for (const item of items) {
          await db.run(`
            INSERT INTO procurement_items (request_id, material_id, description, quantity, unit, unit_price, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [pid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]);
        }
      }

      const entityFlow = await getEntityFlow(entity_id);
      res.json({ success: true, data: { id: pid, request_no: no, approval_flow: entityFlow }, message: '采购申请创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/procurement/:id/submit — 提交审批（根据实体设定初始状态）
  router.post('/requests/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const p = await db.get('SELECT status, entity_id FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });
      if (p.status !== 'draft') return res.json({ success: false, error: '只能提交草稿状态' });

      const initialStatus = await getInitialStatus(p.entity_id);
      const firstLabel = APPROVAL_LEVEL_LABEL[initialStatus];

      await db.run('UPDATE procurement_requests SET status = ?, approval_chain = \'[]\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', [initialStatus, id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['procurement', id, 'submit', req.user.id, '提交审批']);

      res.json({ success: true, message: '已提交审批，等待' + firstLabel + '审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/procurement/:id/approve — 差异化审批流
  router.put('/requests/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature } = req.body || {};

      const p = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });

      const aStatus = p.status || 'pending_ops';
      const validStatuses = Object.keys(APPROVAL_LEVEL_ROLE);
      if (!validStatuses.includes(aStatus)) {
        return res.json({ success: false, error: '当前状态不在审批流程中' });
      }

      const userRoles = await getUserRoles(req.user.id);
      const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
      const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];

      const userCanApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
      if (!userCanApprove) {
        return res.status(403).json({
          success: false,
          error: '当前审批级别为' + requiredLabel + '，需要' + requiredLabel + '或总经理角色才能审批'
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

      // 根据实体查找下一步
      const entityFlow = await getEntityFlow(p.entity_id);
      const currentIndex = entityFlow.indexOf(aStatus);
      let nextStatus;
      if (currentIndex < entityFlow.length - 1) {
        nextStatus = entityFlow[currentIndex + 1];
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
        ['procurement', id, 'approve_' + aStatus, req.user.id, comment || (requiredLabel + '审批通过')]
      );

      const nextLabel = nextStatus === 'approved' ? '已通过（全部审批完成）' : '等待' + APPROVAL_LEVEL_LABEL[nextStatus] + '审批';
      res.json({ success: true, message: requiredLabel + '审批通过，' + nextLabel, status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/procurement/:id/reject
  router.put('/requests/:id/reject', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment } = req.body || {};

      const p = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [id]);
      if (!p) return res.json({ success: false, error: '采购申请不存在' });

      const aStatus = p.status || 'pending_ops';
      const validStatuses = Object.keys(APPROVAL_LEVEL_ROLE);
      if (!validStatuses.includes(aStatus)) {
        return res.json({ success: false, error: '当前状态不在审批流程中' });
      }

      const userRoles = await getUserRoles(req.user.id);
      const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
      const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];

      const userCanApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
      if (!userCanApprove) {
        return res.status(403).json({
          success: false,
          error: '当前审批级别为' + requiredLabel + '，需要' + requiredLabel + '或总经理角色才能驳回'
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
        ['procurement', id, 'reject', req.user.id, comment || (requiredLabel + '驳回')]
      );

      res.json({ success: true, message: '采购申请已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
