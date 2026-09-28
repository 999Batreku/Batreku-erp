const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  const MODULE_TABLES = {
    customers: ['customers'],
    inquiries: ['inquiries'],
    quotations: ['quotation_items', 'quotations'],
    orders: ['order_items', 'orders'],
    procurement: ['procurement_items', 'procurement_requests'],
    inbound: ['inbound_orders'],
    outbound: ['outbound_orders'],
    inventory: ['inventory'],
    logistics: ['logistics_orders'],
    production: ['production_plans'],
    payments: ['payment_records'],
    employees: ['employees'],
    suppliers: ['suppliers'],
    materials: ['materials'],
    material_categories: ['material_categories'],
    followups: ['customer_followups'],
    warehouses: ['warehouses']
  };

  function isGM(req) {
    return req.user && req.user.roles && req.user.roles.indexOf('general_manager') >= 0;
  }

  // GET /api/admin/modules - 可清空模块列表
  router.get('/modules', (req, res) => {
    if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可访问' });
    res.json({
      success: true,
      data: Object.keys(MODULE_TABLES).map(key => ({ key, label: key }))
    });
  });

  // DELETE /api/admin/:module/:id - GM 删除单条记录（含关联子表）
  router.delete('/:module/:id', async (req, res) => {
    try {
      if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可删除' });

      const tables = MODULE_TABLES[req.params.module];
      if (!tables) return res.json({ success: false, error: '未知模块' });

      const id = Number(req.params.id);

      await db.tx(async (client) => {
        // 有子表的模块：先删子表，再删主表
        if (req.params.module === 'quotations') {
          await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [id]);
        } else if (req.params.module === 'orders') {
          await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
        } else if (req.params.module === 'procurement') {
          await client.query('DELETE FROM procurement_items WHERE request_id = $1', [id]);
        } else if (req.params.module === 'customers') {
          // 删除客户前清理所有引用该客户的业务数据
          await client.query('DELETE FROM quotation_items WHERE quotation_id IN (SELECT id FROM quotations WHERE customer_id = $1)', [id]);
          await client.query('DELETE FROM quotations WHERE customer_id = $1', [id]);
          await client.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)', [id]);
          await client.query('DELETE FROM orders WHERE customer_id = $1', [id]);
          await client.query('DELETE FROM payment_records WHERE customer_id = $1', [id]);
          await client.query('DELETE FROM customer_followups WHERE customer_id = $1', [id]);
        }
        const mainTable = tables[tables.length - 1];
        await client.query(`DELETE FROM ${mainTable} WHERE id = $1`, [id]);
      });

      // GM 操作留痕
      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        [req.params.module, id, 'gm_delete', req.user.id, `总经理删除记录 #${id}`]
      );

      res.json({ success: true, message: '删除成功（总经理操作已记录）' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/admin/:module/clear-all - GM 清空整个模块
  router.post('/:module/clear-all', async (req, res) => {
    try {
      if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可清空' });

      const tables = MODULE_TABLES[req.params.module];
      if (!tables) return res.json({ success: false, error: '未知模块' });

      await db.tx(async (client) => {
        // 清空客户模块：先清所有引用客户的业务表
        if (req.params.module === 'customers') {
          await client.query('DELETE FROM quotation_items');
          await client.query('DELETE FROM quotations');
          await client.query('DELETE FROM order_items');
          await client.query('DELETE FROM orders');
          await client.query('DELETE FROM payment_records');
          await client.query('DELETE FROM customer_followups');
        }
        // tables 顺序已是子表在前、主表在后
        for (const t of tables) {
          await client.query(`DELETE FROM ${t}`);
        }
      });

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        [req.params.module, 0, 'gm_clear_all', req.user.id, `总经理清空模块 ${req.params.module}`]
      );

      res.json({ success: true, message: `已清空 ${req.params.module}（总经理操作已记录）` });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
