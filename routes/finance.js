const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // =====================================================
  // 收款记录 (Receipts) — payment_records 表，加 entity_id
  // =====================================================

  // GET /api/finance/receipts
  router.get('/receipts', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let where = [];
      let params = [];
      if (entity_id) { where.push('p.entity_id = ?'); params.push(Number(entity_id)); }
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const rows = await db.all(`
        SELECT p.*, o.order_no, c.name as customer_name, u.real_name as creator_name,
               e.name as entity_name, e.code as entity_code
        FROM payment_records p
        LEFT JOIN orders o ON o.id = p.order_id
        LEFT JOIN customers c ON c.id = p.customer_id
        LEFT JOIN users u ON u.id = p.created_by
        LEFT JOIN entities e ON e.id = p.entity_id
        ${whereClause}
        ORDER BY p.id DESC
      `, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/finance/receipts
  router.post('/receipts', async (req, res) => {
    try {
      const { payment_no, order_id, customer_id, amount, currency, payment_method, payment_date, notes, entity_id } = req.body;

      // 生成编号：PAY-{ENTITY}-YYYY-NNN
      let no = payment_no;
      if (!no) {
        const entId = entity_id || 1;
        const ent = await db.get('SELECT purchase_prefix FROM entities WHERE id = ?', [entId]);
        const prefix = ent ? ent.purchase_prefix.replace('PR', 'PAY') : 'PAY';
        const year = new Date().getFullYear();
        const countRow = await db.get(
          "SELECT COUNT(*)::int as n FROM payment_records WHERE payment_no LIKE ?",
          [prefix + '-' + year + '-%']
        );
        const seq = String((countRow.n || 0) + 1).padStart(3, '0');
        no = prefix + '-' + year + '-' + seq;
      }

      const result = await db.run(`
        INSERT INTO payment_records (payment_no, order_id, customer_id, amount, currency, payment_method, payment_date, notes, entity_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, order_id, customer_id, amount, currency || 'IDR', payment_method, payment_date, notes, entity_id, req.user.id]);
      res.json({ success: true, data: { id: result.lastInsertRowid, payment_no: no }, message: '收款记录创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // =====================================================
  // 付款记录 (Outgoing Payments) — outgoing_payments 表
  // =====================================================

  // GET /api/finance/payments
  router.get('/payments', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let where = [];
      let params = [];
      if (entity_id) { where.push('op.entity_id = ?'); params.push(Number(entity_id)); }
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const rows = await db.all(`
        SELECT op.*, s.name as supplier_name, u.real_name as creator_name,
               pr.request_no as procurement_no, pr.title as procurement_title,
               e.name as entity_name, e.code as entity_code
        FROM outgoing_payments op
        LEFT JOIN suppliers s ON s.id = op.supplier_id
        LEFT JOIN users u ON u.id = op.created_by
        LEFT JOIN procurement_requests pr ON pr.id = op.procurement_request_id
        LEFT JOIN entities e ON e.id = op.entity_id
        ${whereClause}
        ORDER BY op.id DESC
      `, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/finance/payments — 付款记录（无需审批，财务直接录入）
  router.post('/payments', async (req, res) => {
    try {
      const { procurement_request_id, supplier_id, amount, currency, payment_method, payment_date, bank_account, reference_no, notes, entity_id } = req.body;

      if (!entity_id) {
        return res.status(400).json({ success: false, error: '必须指定实体 entity_id' });
      }

      // 生成编号：OP-{ENTITY}-YYYY-NNN
      const ent = await db.get('SELECT purchase_prefix FROM entities WHERE id = ?', [entity_id]);
      const prefix = ent ? ent.purchase_prefix.replace('PR', 'OP') : 'OP';
      const year = new Date().getFullYear();
      const countRow = await db.get(
        "SELECT COUNT(*)::int as n FROM outgoing_payments WHERE payment_no LIKE ?",
        [prefix + '-' + year + '-%']
      );
      const seq = String((countRow.n || 0) + 1).padStart(3, '0');
      const no = prefix + '-' + year + '-' + seq;

      const result = await db.run(`
        INSERT INTO outgoing_payments (entity_id, procurement_request_id, payment_no, supplier_id, amount, currency, payment_method, payment_date, bank_account, reference_no, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [entity_id, procurement_request_id, no, supplier_id, amount, currency || 'IDR', payment_method, payment_date, bank_account, reference_no, notes, req.user.id]);
      res.json({ success: true, data: { id: result.lastInsertRowid, payment_no: no }, message: '付款记录创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // =====================================================
  // 销项发票 (Invoices) — invoices 表
  // =====================================================

  // GET /api/finance/invoices
  router.get('/invoices', async (req, res) => {
    try {
      const { entity_id } = req.query;
      let where = [];
      let params = [];
      if (entity_id) { where.push('i.entity_id = ?'); params.push(Number(entity_id)); }
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

      const rows = await db.all(`
        SELECT i.*, o.order_no, c.name as customer_name, u.real_name as creator_name,
               e.name as entity_name, e.code as entity_code
        FROM invoices i
        LEFT JOIN orders o ON o.id = i.order_id
        LEFT JOIN customers c ON c.id = i.customer_id
        LEFT JOIN users u ON u.id = i.created_by
        LEFT JOIN entities e ON e.id = i.entity_id
        ${whereClause}
        ORDER BY i.id DESC
      `, params);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/finance/invoices
  router.post('/invoices', async (req, res) => {
    try {
      const { order_id, customer_id, amount, tax_amount, invoice_date, invoice_type, invoice_number, notes, entity_id } = req.body;

      if (!entity_id) {
        return res.status(400).json({ success: false, error: '必须指定实体 entity_id' });
      }

      // 生成编号：INV-{ENTITY}-YYYY-NNN
      const ent = await db.get('SELECT purchase_prefix FROM entities WHERE id = ?', [entity_id]);
      const prefix = ent ? ent.purchase_prefix.replace('PR', 'INV') : 'INV';
      const year = new Date().getFullYear();
      const countRow = await db.get(
        "SELECT COUNT(*)::int as n FROM invoices WHERE invoice_no LIKE ?",
        [prefix + '-' + year + '-%']
      );
      const seq = String((countRow.n || 0) + 1).padStart(3, '0');
      const no = prefix + '-' + year + '-' + seq;

      const result = await db.run(`
        INSERT INTO invoices (entity_id, order_id, invoice_no, customer_id, amount, tax_amount, invoice_date, invoice_type, invoice_number, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [entity_id, order_id, no, customer_id, amount, tax_amount || 0, invoice_date, invoice_type || 'output', invoice_number, notes, req.user.id]);
      res.json({ success: true, data: { id: result.lastInsertRowid, invoice_no: no }, message: '发票记录创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
