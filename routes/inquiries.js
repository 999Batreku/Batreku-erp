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

      // 审批列表自审拦截：有审批角色的用户看不到自己创建的待审批记录
      const userRolesForFilter = req.user.roles || [];
      const hasApprovalRole = userRolesForFilter.includes('operations_director') || userRolesForFilter.includes('technical_director');
      if (hasApprovalRole) {
        sql += ' AND (created_by IS NULL OR created_by != ?)';
        params.push(req.user.id);
      }

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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_tech', '[]')
      `, [
        inquiryNo, d.company_name, d.contact_person, d.phone, d.email, d.product_description,
        d.estimated_capacity, d.estimated_power, d.project_location, d.budget_range, d.channel,
        d.urgency || '普通', d.source_detail, d.notes, d.status || 'new', d.assigned_to, req.user.id
      ]);

      // 自审拦截：创建人如果有审批角色，自动跳过对应审批级别
      const creatorRoles = req.user.roles || [];
      const inquiryApprovalFlow = ['pending_ops', 'pending_tech'];
      const inquiryLevelRoleMap = {
        'pending_ops': 'operations_director',
        'pending_tech': 'technical_director'
      };
      let inquiryFinalStatus = 'pending_tech';
      // 默认是 pending_tech，检查 tech director 是否需要跳过
      if (creatorRoles.includes('technical_director')) {
        inquiryFinalStatus = 'approved';
        await db.run('UPDATE inquiries SET approval_status = ? WHERE id = ?', [inquiryFinalStatus, result.lastInsertRowid]);
      }

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

      // 自审拦截：提交人如果有审批角色，自动跳过对应级别
      const creatorRoles = req.user.roles || [];
      const inquiryApprovalFlow = ['pending_ops', 'pending_tech'];
      const inquiryLevelRoleMap = { 'pending_ops': 'operations_director', 'pending_tech': 'technical_director' };
      let inquiryFinalStatus = 'pending_ops';
      for (let i = 0; i < inquiryApprovalFlow.length; i++) {
        if (creatorRoles.includes(inquiryLevelRoleMap[inquiryApprovalFlow[i]])) {
          inquiryFinalStatus = (i < inquiryApprovalFlow.length - 1) ? inquiryApprovalFlow[i + 1] : 'approved';
        } else { break; }
      }

      await db.run(`UPDATE inquiries SET approval_status = ?, approval_chain = '[]', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [inquiryFinalStatus, id]);
      await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['inquiry', id, 'submit', req.user.id, '提交询盘审批']);
      res.json({ success: true, message: inquiryFinalStatus === 'approved' ? '已提交并自动审批通过' : '已提交审批，已自动跳过您的审批级别' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/inquiries/:id/approve — 运营总监/技术总监审批
  router.put('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { comment, signature, tech_guidance } = req.body || {};

      const row = await db.get('SELECT * FROM inquiries WHERE id = ?', [id]);
      if (!row) return res.json({ success: false, error: '询盘不存在' });

      const aStatus = row.approval_status || 'pending_ops';
      const userRoles = await approval.getUserRoles(db, req.user.id);

      // Ops director: pending_ops → pending_tech (no tech_guidance required)
      if (aStatus === 'pending_ops' && approval.hasRole(userRoles, 'operations_director')) {
        const chain = approval.parseChain(row.approval_chain);
        approval.addToChain(chain, 'pending_ops', req, signature, comment);
        await db.run(`UPDATE inquiries SET approval_status = 'pending_tech', approval_chain = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [JSON.stringify(chain), id]);
        await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
          ['inquiry', id, 'approve_ops', req.user.id, comment || '运营总监审核通过']);
        return res.json({ success: true, message: '运营总监审核通过，已流转至技术总监', approval_status: 'pending_tech' });
      }

      // Tech director: pending_tech (or escalated pending_ops) → approved (tech_guidance required)
      if (['pending_tech', 'pending_ops'].includes(aStatus) && approval.hasRole(userRoles, 'technical_director')) {
        if (!tech_guidance || !tech_guidance.trim()) {
          return res.status(400).json({ success: false, error: '技术总监审批必须填写方案指导意见' });
        }
        const chain = approval.parseChain(row.approval_chain);
        approval.addToChain(chain, 'pending_tech', req, signature || 'system_approval', comment);
        await db.run(`UPDATE inquiries SET approval_status = 'approved', approval_chain = ?, tech_guidance = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [JSON.stringify(chain), tech_guidance, req.user.id, id]);
        await db.run('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
          ['inquiry', id, 'approve_tech', req.user.id, tech_guidance]);
        return res.json({ success: true, message: '技术总监方案指导完成，业务员可创建初步报价', approval_status: 'approved', tech_guidance });
      }

      return res.status(403).json({ success: false, error: '当前用户无权限审批此询盘' });
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

      const aStatus = row.approval_status || 'pending_tech';
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
