// 数据维护接口：仅总经理（general_manager）可逐条删除 / 清空模块数据
module.exports = function (db) {
  const express = require('express');
  const router = express.Router();
  const { authMiddleware } = require('../middleware/auth');

  router.use(authMiddleware);

  // 模块 → 表映射。主表在前，关联表一并清理
  const MODULE_TABLES = {
    customers:        ['customers'],
    inquiries:        ['inquiries'],
    quotations:       ['quotation_items', 'quotations'],
    orders:           ['order_items', 'orders'],
    procurement:      ['procurement_items', 'procurement_requests'],
    inbound:          ['inbound_orders'],
    outbound:         ['outbound_orders'],
    inventory:        ['inventory'],
    logistics:        ['logistics_orders'],
    production:       ['production_plans'],
    payments:         ['payment_records'],
    employees:        ['employees'],
    suppliers:        ['suppliers'],
    materials:        ['materials'],
    material_categories: ['material_categories'],
    followups:        ['customer_followups'],
    warehouses:       ['warehouses'],
  };

  function isGM(req) {
    const roles = (req.user && req.user.roles) || [];
    return roles.indexOf('general_manager') >= 0;
  }

  // GET /api/admin/modules —— 返回各模块记录数
  router.get('/modules', (req, res) => {
    if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可操作' });
    try {
      const counts = {};
      Object.keys(MODULE_TABLES).forEach(function (m) {
        const mainTable = MODULE_TABLES[m][MODULE_TABLES[m].length - 1];
        counts[m] = db.prepare('SELECT COUNT(*) AS n FROM ' + mainTable).get().n;
      });
      res.json({ success: true, data: counts });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/admin/:module/:id —— 逐条删除
  router.delete('/:module/:id', (req, res) => {
    if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可删除' });
    const tables = MODULE_TABLES[req.params.module];
    if (!tables) return res.status(400).json({ success: false, error: '未知模块' });
    try {
      const mainTable = tables[tables.length - 1];
      const existing = db.prepare('SELECT id FROM ' + mainTable + ' WHERE id = ?').get(req.params.id);
      if (!existing) return res.status(404).json({ success: false, error: '记录不存在' });

      // 关联表按外键清理
      const assoc = {
        quotations: [{ table: 'quotation_items', fk: 'quotation_id' }],
        orders: [{ table: 'order_items', fk: 'order_id' }],
        procurement: [{ table: 'procurement_items', fk: 'request_id' }],
      };
      const links = assoc[req.params.module] || [];
      const tx = db.transaction(function () {
        links.forEach(function (l) {
          db.prepare('DELETE FROM ' + l.table + ' WHERE ' + l.fk + ' = ?').run(req.params.id);
        });
        db.prepare('DELETE FROM ' + mainTable + ' WHERE id = ?').run(req.params.id);
      });
      tx();
      res.json({ success: true, message: '记录已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/admin/:module/clear-all —— 清空整个模块
  router.post('/:module/clear-all', (req, res) => {
    if (!isGM(req)) return res.status(403).json({ success: false, error: '仅总经理可清空数据' });
    const tables = MODULE_TABLES[req.params.module];
    if (!tables) return res.status(400).json({ success: false, error: '未知模块' });
    try {
      const mainTable = tables[tables.length - 1];
      const count = db.prepare('SELECT COUNT(*) AS n FROM ' + mainTable).get().n;
      const tx = db.transaction(function () {
        tables.forEach(function (t) {
          db.prepare('DELETE FROM ' + t).run();
        });
      });
      tx();
      res.json({ success: true, message: '已清空 ' + count + ' 条数据', count: count });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
