const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/quotations
  router.get('/', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT q.*, c.name as customer_name, u.real_name as creator_name
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        LEFT JOIN users u ON u.id = q.created_by
        ORDER BY q.id DESC
      `).all();
      // 附带明细数量
      const result = rows.map(q => {
        const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM quotation_items WHERE quotation_id = ?').get(q.id);
        return { ...q, item_count: itemCount.cnt };
      });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/quotations/:id
  router.get('/:id', (req, res) => {
    try {
      const q = db.prepare(`
        SELECT q.*, c.name as customer_name, c.contact_person, c.phone as customer_phone, c.address as customer_address
        FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
      `).get(req.params.id);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      const items = db.prepare(`
        SELECT qi.*, m.name as material_name, m.code as material_code
        FROM quotation_items qi LEFT JOIN materials m ON m.id = qi.material_id
        WHERE qi.quotation_id = ? ORDER BY qi.sort_order
      `).all(q.id);
      res.json({ success: true, data: { ...q, items } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/quotations
  router.post('/', (req, res) => {
    try {
      const { quotation_no, customer_id, title, currency, valid_days, notes, items } = req.body;
      const no = quotation_no || 'QT-' + Date.now();
      
      let total = 0;
      if (items && items.length) {
        total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
      }

      const result = db.prepare(`
        INSERT INTO quotations (quotation_no, customer_id, title, total_amount, currency, valid_days, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(no, customer_id, title, total, currency || 'IDR', valid_days || 30, notes, req.user.id);

      const qid = result.lastInsertRowid;
      if (items && items.length) {
        const ins = db.prepare(`
          INSERT INTO quotation_items (quotation_id, material_id, description, quantity, unit, unit_price, amount, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        items.forEach((item, idx) => {
          const amt = (item.quantity || 0) * (item.unit_price || 0);
          ins.run(qid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, amt, idx + 1);
        });
      }

      res.json({ success: true, data: { id: qid }, message: '报价单创建成功' });
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.json({ success: false, error: '报价单号已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/quotations/:id
  router.put('/:id', (req, res) => {
    try {
      const { customer_id, title, currency, valid_days, notes, items } = req.body;
      const id = req.params.id;
      const q = db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      if (q.status !== 'draft') return res.json({ success: false, error: '只能编辑草稿状态报价单' });

      let total = q.total_amount;
      if (items && items.length) {
        total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
      }

      db.prepare(`
        UPDATE quotations SET customer_id=?, title=?, total_amount=?, currency=?, valid_days=?, notes=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(customer_id, title, total, currency, valid_days, notes, id);

      if (items !== undefined) {
        db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(id);
        if (items.length) {
          const ins = db.prepare(`
            INSERT INTO quotation_items (quotation_id, material_id, description, quantity, unit, unit_price, amount, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          items.forEach((item, idx) => {
            const amt = (item.quantity || 0) * (item.unit_price || 0);
            ins.run(id, item.material_id, item.description, item.quantity, item.unit, item.unit_price, amt, idx + 1);
          });
        }
      }

      res.json({ success: true, message: '报价单更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/quotations/:id
  router.delete('/:id', (req, res) => {
    try {
      const q = db.prepare('SELECT status FROM quotations WHERE id = ?').get(req.params.id);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      if (q.status !== 'draft') return res.json({ success: false, error: '只能删除草稿状态报价单' });
      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(req.params.id);
      db.prepare('DELETE FROM quotations WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/quotations/:id/submit
  router.post('/:id/submit', (req, res) => {
    try {
      const id = req.params.id;
      const q = db.prepare('SELECT status FROM quotations WHERE id = ?').get(id);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      if (q.status !== 'draft') return res.json({ success: false, error: '只能提交草稿状态报价单' });
      db.prepare('UPDATE quotations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('pending', id);
      db.prepare('INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)').run('quotation', id, 'submit', req.user.id, '提交审批');
      res.json({ success: true, message: '已提交审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
