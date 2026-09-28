const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  const APPROVER_ROLES = ['operations_director', 'general_manager', 'technical_director'];
  function canApprove(req) {
    const roles = (req.user && req.user.roles) || [];
    return roles.some(function(r){ return APPROVER_ROLES.indexOf(r) >= 0; });
  }

  // GET /api/customers?approval_status=pending
  router.get('/', async (req, res) => {
    try {
      let customers;
      if (req.query.approval_status) {
        customers = await db.all(`
          SELECT * FROM customers WHERE approval_status = ? ORDER BY id DESC
        `, [req.query.approval_status]);
      } else {
        customers = await db.all(`
          SELECT * FROM customers ORDER BY id DESC
        `, []);
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
        grade, source_channel, salesperson, approval_status
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
          grade, source_channel, salesperson, approval_status, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [
        code, company_type || '', name || '', short_name || '', tax_number || '', address || '',
        contact_person || '', contact_position || '', phone || '', email || '', whatsapp || '', other_contact || '',
        initial_needs || '', Array.isArray(product_types) ? product_types.join(',') : (product_types || ''),
        estimated_kw || null, estimated_kwh || null,
        Array.isArray(locations) ? JSON.stringify(locations) : (locations || ''),
        grade || '', source_channel || '', salesperson || '', approval_status || 'pending'
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
        grade, source_channel, salesperson, approval_status
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
        grade, source_channel, salesperson, approval_status,
        req.params.id
      ]);

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id/approve
  router.put('/:id/approve', async (req, res) => {
    try {
      if (!canApprove(req)) {
        return res.status(403).json({ success: false, error: '无审批权限，需运营总监及以上角色' });
      }
      const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      const inputCode = ((req.body && req.body.customer_code) || '').trim();
      if (inputCode) {
        const dup = await db.get("SELECT id, customer_code FROM customers WHERE UPPER(customer_code) = UPPER(?) AND id != ?",
          [inputCode, req.params.id]);
        if (dup) {
          return res.status(400).json({ success: false, error: '客户编码已存在：' + dup.customer_code });
        }
      }
      let code = inputCode || customer.customer_code;
      if (!code) {
        const last = await db.get("SELECT customer_code FROM customers WHERE customer_code IS NOT NULL AND customer_code != '' ORDER BY id DESC LIMIT 1", []);
        let num = 1;
        if (last && last.customer_code) {
          num = parseInt(last.customer_code.replace('CUS-', '')) + 1;
        }
        code = 'CUS-' + String(num).padStart(3, '0');
      }

      const remark = (req.body && req.body.remark) || '';
      const approverName = (req.user.real_name || req.user.username || '') + '';
      await db.run(`
        UPDATE customers SET
          approval_status = 'approved',
          customer_code = ?,
          approved_by = ?,
          approval_remark = ?,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [code, approverName, remark, req.params.id]);

      const updated = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
      res.json({ success: true, data: updated, message: '已审批通过，客户编码 ' + code });
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
