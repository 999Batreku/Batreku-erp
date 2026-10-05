const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // 三级审批流
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
  const APPROVAL_FLOW = ['pending_ops', 'pending_tech', 'pending_gm'];

  const APPROVER_ROLES = ['operations_director', 'general_manager', 'technical_director'];
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

  // GET /api/customers?approval_status=pending_ops&approval_status=pending_tech&approval_status=pending_gm
  // 支持多状态查询：?approval_status=pending_ops&approval_status=pending_tech
  // 数据权限：销售只能看自己录入的，运营总监/技术总监/总经理可看全部
  router.get('/', async (req, res) => {
    try {
      const userRoles = await getUserRoles(req.user.id);
      const isViewer = hasRole(userRoles, 'operations_director') || hasRole(userRoles, 'technical_director') || hasRole(userRoles, 'general_manager');
      // 数据权限：销售只能看自己录入的（兼容老数据 created_by 为 NULL 的情况）
      const ownerFilter = isViewer ? '' : ' AND (created_by IS NULL OR created_by = ?)';
      const baseParams = isViewer ? [] : [req.user.id];
      const baseSql = 'SELECT * FROM customers WHERE 1=1' + ownerFilter;

      let customers;
      const statusFilter = req.query.approval_status;
      if (statusFilter) {
        const statuses = Array.isArray(statusFilter) ? statusFilter : [statusFilter];
        const statusPlaceholders = statuses.map(function(){ return '?'; }).join(',');
        customers = await db.all(
          baseSql + ' AND approval_status IN (' + statusPlaceholders + ') ORDER BY id DESC',
          baseParams.concat(statuses)
        );
      } else {
        customers = await db.all(baseSql + ' ORDER BY id DESC', baseParams);
      }
      res.json({ success: true, data: customers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/customers/:id
  router.get('/:id', async (req, res) => {
    try {
      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      if (!customer) return res.json({ success: false, error: '客户不存在' });
      // 数据权限：销售只能看自己录入的客户
      const userRoles = await getUserRoles(req.user.id);
      const isViewer = hasRole(userRoles, 'operations_director') || hasRole(userRoles, 'technical_director') || hasRole(userRoles, 'general_manager');
      if (!isViewer && customer.created_by != null && customer.created_by !== req.user.id) {
        return res.status(403).json({ success: false, error: '无权查看此客户信息' });
      }
      res.json({ success: true, data: customer });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/customers
  router.post('/', async (req, res) => {
    try {
      const {
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, product_types, estimated_kw, estimated_kwh, locations,
        grade, source_channel, primary_owner, salesperson, approval_status
      } = req.body;

      // 自动生成客户编码
      const lastCustomer = await db.get("SELECT customer_code FROM customers ORDER BY id DESC LIMIT 1", []);
      let code = 'CUS-001';
      if (lastCustomer && lastCustomer.customer_code) {
        const num = parseInt(lastCustomer.customer_code.replace('CUS-', '')) + 1;
        code = 'CUS-' + String(num).padStart(3, '0');
      }

      const result = await db.run(`
        INSERT INTO customers (customer_code, company_type, name, short_name, tax_number, address,
          contact_person, contact_position, phone, email, whatsapp, other_contact,
          notes, product_types, estimated_kw, estimated_kwh, locations,
          grade, source_channel, primary_owner, salesperson, approval_status, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `, [
        code, company_type || '', name || '', short_name || '', tax_number || '', address || '',
        contact_person || '', contact_position || '', phone || '', email || '', whatsapp || '', other_contact || '',
        initial_needs || '', Array.isArray(product_types) ? product_types.join(',') : (product_types || ''),
        estimated_kw || null, estimated_kwh || null,
        Array.isArray(locations) ? JSON.stringify(locations) : (locations || ''),
        grade || '', source_channel || '', primary_owner || '', salesperson || '', approval_status || 'pending_ops',
        req.user.id
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid, customer_code: code } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id
  router.put('/:id', async (req, res) => {
    try {
      const {
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, product_types, estimated_kw, estimated_kwh, locations,
        grade, source_channel, primary_owner, salesperson, approval_status
      } = req.body;

      await db.run(`
        UPDATE customers SET
          company_type = COALESCE(?, company_type),
          name = COALESCE(?, name),
          short_name = COALESCE(?, short_name),
          tax_number = COALESCE(?, tax_number),
          address = COALESCE(?, address),
          contact_person = COALESCE(?, contact_person),
          contact_position = COALESCE(?, contact_position),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          whatsapp = COALESCE(?, whatsapp),
          other_contact = COALESCE(?, other_contact),
          notes = COALESCE(?, notes),
          product_types = COALESCE(?, product_types),
          estimated_kw = COALESCE(?, estimated_kw),
          estimated_kwh = COALESCE(?, estimated_kwh),
          locations = COALESCE(?, locations),
          grade = COALESCE(?, grade),
          source_channel = COALESCE(?, source_channel),
          primary_owner = COALESCE(?, primary_owner),
          salesperson = COALESCE(?, salesperson),
          approval_status = COALESCE(?, approval_status),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, Array.isArray(product_types) ? product_types.join(',') : product_types,
        estimated_kw, estimated_kwh,
        Array.isArray(locations) ? JSON.stringify(locations) : locations,
        grade, source_channel, primary_owner, salesperson, approval_status,
        req.params.id
      ]);

      // 如果 created_by 为空，补设为当前编辑者
      await db.run(`UPDATE customers SET created_by = ? WHERE id = ? AND created_by IS NULL`, [req.user.id, req.params.id]);

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id/approve — 三级审批流
  // pending_ops → pending_tech → pending_gm → approved
  router.put('/:id/approve', async (req, res) => {
    try {
      if (!canApprove(req)) {
        return res.status(403).json({ success: false, error: '无审批权限，需运营总监及以上角色' });
      }
      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      const aStatus = customer.approval_status || 'pending_ops';
      const currentIndex = APPROVAL_FLOW.indexOf(aStatus);
      if (currentIndex === -1) {
        return res.status(400).json({ success: false, error: '该客户当前状态(' + aStatus + ')不允许审批' });
      }

      const currentLevelRole = APPROVAL_LEVEL_ROLE[aStatus];
      const userRoles = await getUserRoles(req.user.id);
      if (!hasRole(userRoles, currentLevelRole)) {
        return res.status(403).json({
          success: false,
          error: '当前客户处于【' + APPROVAL_LEVEL_LABEL[aStatus] + '】审批环节，需要' + APPROVAL_LEVEL_LABEL[aStatus] + '角色，您无此权限'
        });
      }

      const remark = (req.body && req.body.remark) || '';
      const signature = (req.body && req.body.signature) || '';
      if (!signature || signature.indexOf('data:image') !== 0) {
        return res.status(400).json({ success: false, error: '审批通过必须签署电子签名' });
      }
      const approverName = (req.user.real_name || req.user.username || '') + '';

      // 计算下一级状态
      const isLastLevel = (currentIndex === APPROVAL_FLOW.length - 1);
      const nextStatus = isLastLevel ? 'approved' : APPROVAL_FLOW[currentIndex + 1];

      // 运营总监审批时设置客户编码
      let code = customer.customer_code;
      if (aStatus === 'pending_ops') {
        const inputCode = ((req.body && req.body.customer_code) || '').trim();
        if (inputCode) {
          const dup = await db.get("SELECT id, customer_code FROM customers WHERE UPPER(customer_code) = UPPER(?) AND id != ?",
            [inputCode, req.params.id]);
          if (dup) {
            return res.status(400).json({ success: false, error: '客户编码已存在：' + dup.customer_code });
          }
          code = inputCode;
        }
        if (!code) {
          const last = await db.get("SELECT customer_code FROM customers WHERE customer_code IS NOT NULL AND customer_code != '' ORDER BY id DESC LIMIT 1", []);
          let num = 1;
          if (last && last.customer_code) {
            num = parseInt(last.customer_code.replace('CUS-', '')) + 1;
          }
          code = 'CUS-' + String(num).padStart(3, '0');
        }
      }

      // 更新 approval_chain JSON
      const chain = parseChain(customer.approval_chain);
      chain.push({
        level: APPROVAL_LEVEL_LABEL[aStatus],
        status: aStatus,
        action: 'approve',
        approver: approverName,
        approver_id: req.user.id,
        remark: remark,
        signature: signature,
        timestamp: new Date().toISOString()
      });
      const chainJson = JSON.stringify(chain);

      // 最终审批（GM）时写 approved_by 等字段
      if (isLastLevel) {
        await db.run(`
          UPDATE customers SET
            approval_status = 'approved',
            customer_code = ?,
            approved_by = ?,
            approval_remark = ?,
            approval_signature = ?,
            approved_at = CURRENT_TIMESTAMP,
            approval_chain = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [code, approverName, remark, signature, chainJson, req.params.id]);

        res.json({ success: true, data: { id: req.params.id, approval_status: 'approved', customer_code: code },
          message: '三级审批全部完成，客户编码 ' + code });
      } else {
        await db.run(`
          UPDATE customers SET
            approval_status = ?,
            customer_code = ?,
            approval_chain = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [nextStatus, code, chainJson, req.params.id]);

        res.json({ success: true, data: { id: req.params.id, approval_status: nextStatus, customer_code: code },
          message: APPROVAL_LEVEL_LABEL[aStatus] + '已审批通过，流转至【' + APPROVAL_LEVEL_LABEL[nextStatus] + '】审批' });
      }

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['customer', req.params.id, 'approve_' + aStatus, req.user.id, remark || APPROVAL_LEVEL_LABEL[aStatus] + '审批通过']
      );

    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id/reject
  router.put('/:id/reject', async (req, res) => {
    try {
      if (!canApprove(req)) {
        return res.status(403).json({ success: false, error: '无审批权限，需运营总监及以上角色' });
      }
      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      const remark = (req.body && req.body.remark) || '';
      const approverName = (req.user.real_name || req.user.username || '') + '';
      await db.run(`
        UPDATE customers SET
          approval_status = 'rejected',
          approved_by = ?,
          approval_remark = ?,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [approverName, remark, req.params.id]);

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['customer', req.params.id, 'reject', req.user.id, remark || '驳回']
      );

      const updated = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      res.json({ success: true, data: updated, message: '已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/customers/:id
  router.delete('/:id', async (req, res) => {
    try {
      const roles = (req.user && req.user.roles) || [];
      const canDelete = roles.indexOf('general_manager') >= 0;
      if (!canDelete) {
        return res.status(403).json({ success: false, error: '无删除权限，仅总经理可操作' });
      }

      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      await db.run('DELETE FROM customers WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '客户已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/customers/clear-all
  router.post('/clear-all', async (req, res) => {
    try {
      const roles = (req.user && req.user.roles) || [];
      const canDelete = roles.indexOf('general_manager') >= 0;
      if (!canDelete) {
        return res.status(403).json({ success: false, error: '无权限，仅总经理可操作' });
      }

      const count = await db.run('DELETE FROM customers', []);
      res.json({ success: true, message: '已清空 ' + count.changes + ' 条客户数据' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
