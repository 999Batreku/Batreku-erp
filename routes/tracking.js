const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/tracking/:logisticsId — 获取某发货单的物流追踪
  router.get('/:logisticsId', async (req, res) => {
    try {
      const tracking = await db.get('SELECT * FROM logistics_tracking WHERE logistics_id = ?', [req.params.logisticsId]);
      const order = await db.get('SELECT * FROM logistics_orders WHERE id = ?', [req.params.logisticsId]);
      if (!order) return res.json({ success: false, error: '发货单不存在' });
      res.json({ success: true, data: { order, tracking } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/tracking/:logisticsId — 更新节点
  router.put('/:logisticsId', async (req, res) => {
    try {
      const { node, operator, notes } = req.body || {};
      const id = req.params.logisticsId;
      const tracking = await db.get('SELECT * FROM logistics_tracking WHERE logistics_id = ?', [id]);
      if (!tracking) {
        // 自动创建追踪记录
        const trackingNo = 'TRK-' + new Date().getFullYear() + '-' + String(id).padStart(4, '0');
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        await db.run(
          `INSERT INTO logistics_tracking (logistics_id, tracking_no, current_node, node_history, updated_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [id, trackingNo, node || 1, JSON.stringify([{ node: node || 1, name: '节点' + (node || 1), time: now, operator: operator || '系统', notes: notes || '' }])]
        );
        return res.json({ success: true, message: '物流追踪已创建并更新' });
      }
      const history = JSON.parse(tracking.node_history || '[]');
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      history.push({ node: node || (tracking.current_node + 1), time: now, operator: operator || req.user.real_name, notes: notes || '' });
      await db.run('UPDATE logistics_tracking SET current_node = ?, node_history = ?, updated_at = CURRENT_TIMESTAMP WHERE logistics_id = ?',
        [node || (tracking.current_node + 1), JSON.stringify(history), id]);
      res.json({ success: true, message: '物流节点已更新' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/tracking — 列表
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT t.*, l.logistics_no, l.customer_code, l.applicant_name
        FROM logistics_tracking t
        JOIN logistics_orders l ON l.id = t.logistics_id
        ORDER BY t.id DESC
      `, []);
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
