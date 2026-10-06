const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // GET /api/entities — 返回所有实体列表
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all(
        'SELECT id, code, name, name_id, type, purchase_prefix FROM entities ORDER BY id',
        []
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/entities/:id — 获取单个实体详情
  router.get('/:id', async (req, res) => {
    try {
      const row = await db.get(
        'SELECT id, code, name, name_id, type, purchase_prefix FROM entities WHERE id = ?',
        [req.params.id]
      );
      if (!row) return res.json({ success: false, error: '实体不存在' });
      res.json({ success: true, data: row });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
