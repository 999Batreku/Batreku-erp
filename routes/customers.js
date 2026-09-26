const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // 确保 customers 表有完整字段
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN company_type TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN short_name TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN tax_number TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN customer_code TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN contact_position TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN whatsapp TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN other_contact TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN product_types TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN estimated_kw REAL').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN estimated_kwh REAL').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN locations TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN grade TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN source_channel TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN salesperson TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN approval_status TEXT DEFAULT "pending"').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN approved_by TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN approval_remark TEXT').run();
  } catch(e) {}
  try {
    db.prepare('ALTER TABLE customers ADD COLUMN approved_at TEXT').run();
  } catch(e) {}

  // 可审批角色
  const APPROVER_ROLES = ['operations_director', 'general_manager', 'technical_director'];
  function canApprove(req) {
    const roles = (req.user && req.user.roles) || [];
    return roles.some(function(r){ return APPROVER_ROLES.indexOf(r) >= 0; });
  }

  // GET /api/customers?approval_status=pending
  router.get('/', (req, res) => {
    try {
      let customers;
      if (req.query.approval_status) {
        customers = db.prepare(`
          SELECT * FROM customers WHERE approval_status = ? ORDER BY id DESC
        `).all(req.query.approval_status);
      } else {
        customers = db.prepare(`
          SELECT * FROM customers ORDER BY id DESC
        `).all();
      }
      res.json({ success: true, data: customers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/customers/:id
  router.get('/:id', (req, res) => {
    try {
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      if (!customer) return res.json({ success: false, error: '客户不存在' });
      res.json({ success: true, data: customer });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/customers
  router.post('/', (req, res) => {
    try {
      const {
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, product_types, estimated_kw, estimated_kwh, locations,
        grade, source_channel, salesperson, approval_status
      } = req.body;

      // 自动生成客户编码
      const lastCustomer = db.prepare("SELECT customer_code FROM customers ORDER BY id DESC LIMIT 1").get();
      let code = 'CUS-001';
      if (lastCustomer && lastCustomer.customer_code) {
        const num = parseInt(lastCustomer.customer_code.replace('CUS-', '')) + 1;
        code = 'CUS-' + String(num).padStart(3, '0');
      }

      const result = db.prepare(`
        INSERT INTO customers (customer_code, company_type, name, short_name, tax_number, address,
          contact_person, contact_position, phone, email, whatsapp, other_contact,
          notes, product_types, estimated_kw, estimated_kwh, locations,
          grade, source_channel, salesperson, approval_status, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        code, company_type || '', name || '', short_name || '', tax_number || '', address || '',
        contact_person || '', contact_position || '', phone || '', email || '', whatsapp || '', other_contact || '',
        initial_needs || '', Array.isArray(product_types) ? product_types.join(',') : (product_types || ''),
        estimated_kw || null, estimated_kwh || null,
        Array.isArray(locations) ? JSON.stringify(locations) : (locations || ''),
        grade || '', source_channel || '', salesperson || '', approval_status || 'pending'
      );

      res.json({ success: true, data: { id: result.lastInsertRowid, customer_code: code } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id
  router.put('/:id', (req, res) => {
    try {
      const {
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, product_types, estimated_kw, estimated_kwh, locations,
        grade, source_channel, salesperson, approval_status
      } = req.body;

      db.prepare(`
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
      `).run(
        company_type, name, short_name, tax_number, address,
        contact_person, contact_position, phone, email, whatsapp, other_contact,
        initial_needs, Array.isArray(product_types) ? product_types.join(',') : product_types,
        estimated_kw, estimated_kwh,
        Array.isArray(locations) ? JSON.stringify(locations) : locations,
        grade, source_channel, salesperson, approval_status,
        req.params.id
      );

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id/approve  审批通过
  router.put('/:id/approve', (req, res) => {
    try {
      if (!canApprove(req)) {
        return res.status(403).json({ success: false, error: '无审批权限，需运营总监及以上角色' });
      }
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      // 客户编码：优先使用运营总监手动输入的编码
      const inputCode = (req.body && req.body.customer_code || '').trim();
      if (inputCode) {
        // 校验唯一性
        const dup = db.prepare("SELECT id, customer_code FROM customers WHERE UPPER(customer_code) = UPPER(?) AND id != ?").get(inputCode, req.params.id);
        if (dup) {
          return res.status(400).json({ success: false, error: '客户编码已存在：' + dup.customer_code });
        }
      }
      let code = inputCode || customer.customer_code;
      if (!code) {
        const last = db.prepare("SELECT customer_code FROM customers WHERE customer_code IS NOT NULL AND customer_code != '' ORDER BY id DESC LIMIT 1").get();
        let num = 1;
        if (last && last.customer_code) {
          num = parseInt(last.customer_code.replace('CUS-', '')) + 1;
        }
        code = 'CUS-' + String(num).padStart(3, '0');
      }

      const remark = (req.body && req.body.remark) || '';
      const approverName = (req.user.real_name || req.user.username || '') + '';
      db.prepare(`
        UPDATE customers SET
          approval_status = 'approved',
          customer_code = ?,
          approved_by = ?,
          approval_remark = ?,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(code, approverName, remark, req.params.id);

      const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      res.json({ success: true, data: updated, message: '已审批通过，客户编码 ' + code });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/customers/:id/reject  审批驳回
  router.put('/:id/reject', (req, res) => {
    try {
      if (!canApprove(req)) {
        return res.status(403).json({ success: false, error: '无审批权限，需运营总监及以上角色' });
      }
      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      const remark = (req.body && req.body.remark) || '';
      const approverName = (req.user.real_name || req.user.username || '') + '';
      db.prepare(`
        UPDATE customers SET
          approval_status = 'rejected',
          approved_by = ?,
          approval_remark = ?,
          approved_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(approverName, remark, req.params.id);

      const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      res.json({ success: true, data: updated, message: '已驳回' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/customers/:id  删除客户（仅总经理）
  router.delete('/:id', (req, res) => {
    try {
      const roles = (req.user && req.user.roles) || [];
      const canDelete = roles.indexOf('general_manager') >= 0;
      if (!canDelete) {
        return res.status(403).json({ success: false, error: '无删除权限，仅总经理可操作' });
      }

      const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
      if (!customer) return res.json({ success: false, error: '客户不存在' });

      db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: '客户已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/customers/clear-all  清空所有客户（仅总经理）
  router.post('/clear-all', (req, res) => {
    try {
      const roles = (req.user && req.user.roles) || [];
      const canDelete = roles.indexOf('general_manager') >= 0;
      if (!canDelete) {
        return res.status(403).json({ success: false, error: '无权限，仅总经理可操作' });
      }

      const count = db.prepare('DELETE FROM customers').run().changes;
      res.json({ success: true, message: '已清空 ' + count + ' 条客户数据' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
