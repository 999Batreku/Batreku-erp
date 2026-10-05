const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/orders
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT o.*, c.name as customer_name, c.customer_code as customer_code, u.real_name as creator_name
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN users u ON u.id = o.created_by
        ORDER BY o.id DESC
      `, []);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/orders/:id
  router.get('/:id', async (req, res) => {
    try {
      const o = await db.get(`
        SELECT o.*, c.name as customer_name, c.customer_code as customer_code, c.contact_person, c.phone as customer_phone, c.address as customer_address
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?
      `, [req.params.id]);
      if (!o) return res.json({ success: false, error: '订单不存在' });
      const items = await db.all(`
        SELECT oi.*, m.name as material_name, m.code as material_code
        FROM order_items oi LEFT JOIN materials m ON m.id = oi.material_id WHERE oi.order_id = ?
      `, [o.id]);
      res.json({ success: true, data: { ...o, items } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/orders
  router.post('/', async (req, res) => {
    try {
      const { order_no, quotation_id, customer_id, title, currency, delivery_date, notes, items } = req.body;
      const no = order_no || 'SO-' + Date.now();
      let total = 0;
      if (items && items.length) total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

      const result = await db.run(`
        INSERT INTO orders (order_no, quotation_id, customer_id, title, total_amount, currency, delivery_date, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [no, quotation_id, customer_id, title, total, currency || 'IDR', delivery_date, notes, req.user.id]);
      const oid = result.lastInsertRowid;

      if (items && items.length) {
        for (const item of items) {
          await db.run(`
            INSERT INTO order_items (order_id, material_id, description, quantity, unit, unit_price, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [oid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]);
        }
      }

      res.json({ success: true, data: { id: oid }, message: '订单创建成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/orders/:id
  router.put('/:id', async (req, res) => {
    try {
      const { customer_id, title, currency, delivery_date, notes, items } = req.body;
      const id = req.params.id;
      const o = await db.get('SELECT status FROM orders WHERE id = ?', [id]);
      if (!o) return res.json({ success: false, error: '订单不存在' });
      if (!['draft', 'contract_signed', 'advance_paid'].includes(o.status)) return res.json({ success: false, error: '只能编辑草稿或早期阶段订单' });

      let total = 0;
      if (items && items.length) total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

      await db.run('UPDATE orders SET customer_id=?, title=?, total_amount=?, currency=?, delivery_date=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [customer_id, title, total, currency, delivery_date, notes, id]);

      if (items !== undefined) {
        await db.run('DELETE FROM order_items WHERE order_id = ?', [id]);
        if (items.length) {
          for (const item of items) {
            await db.run('INSERT INTO order_items (order_id, material_id, description, quantity, unit, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [id, item.material_id, item.description, item.quantity, item.unit, item.unit_price, item.quantity * item.unit_price]);
          }
        }
      }

      res.json({ success: true, message: '订单更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/orders/:id/advance
  router.post('/:id/advance', async (req, res) => {
    try {
      const id = req.params.id;
      const { next_status } = req.body;
      const statusFlow = ['contract_signed', 'advance_paid', 'processing', 'shipped', 'logistics', 'accepted', 'invoiced', 'completed'];
      const o = await db.get('SELECT status FROM orders WHERE id = ?', [id]);
      if (!o) return res.json({ success: false, error: '订单不存在' });

      const curIdx = statusFlow.indexOf(o.status);
      if (curIdx === -1) return res.json({ success: false, error: '当前状态不允许推进' });
      const next = next_status || statusFlow[curIdx + 1];
      if (!next) return res.json({ success: false, error: '已到最终状态' });
      if (!statusFlow.includes(next)) return res.json({ success: false, error: '无效目标状态' });

      await db.run('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [next, id]);
      res.json({ success: true, message: `订单已推进至: ${next}` });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
