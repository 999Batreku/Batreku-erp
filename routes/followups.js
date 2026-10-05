const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // 查看权限角色（可看全部数据）
  const VIEWER_ROLES = ['operations_director', 'technical_director', 'general_manager'];
  function hasRole(roles, role) { return roles.indexOf(role) >= 0; }
  async function getUserRoles(userId) {
    const rows = await db.all('SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?', [userId]);
    return rows.map(function(r){ return r.name; });
  }
  async function isViewer(userId) {
    const roles = await getUserRoles(userId);
    return VIEWER_ROLES.some(function(r){ return hasRole(roles, r); });
  }

  // GET /api/followups
  router.get('/', async (req, res) => {
    try {
      const { customer_id, customer_grade, followup_type, keyword } = req.query;
      const viewer = await isViewer(req.user.id);

      // 销售只能看自己创建的跟进记录；总监/总经理可看全部
      // 兼容历史数据：created_by 为 NULL 的老记录也对非 viewer 可见
      let ownerFilter = '';
      const params = [];
      if (!viewer) {
        ownerFilter = ' AND (f.created_by IS NULL OR f.created_by = ?)';
        params.push(req.user.username);
      }

      let sql = `SELECT f.*, c.customer_code FROM customer_followups f LEFT JOIN customers c ON c.id = f.customer_id WHERE 1=1` + ownerFilter;

      if (customer_id) { sql += ` AND f.customer_id = ?`; params.push(customer_id); }
      if (customer_grade) { sql += ` AND f.customer_grade = ?`; params.push(customer_grade); }
      if (followup_type) { sql += ` AND f.followup_type = ?`; params.push(followup_type); }
      if (keyword) {
        sql += ` AND (f.content LIKE ? OR f.feedback LIKE ? OR f.customer_name LIKE ?)`;
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw);
      }

      sql += ` ORDER BY f.followup_date DESC, f.id DESC`;
      const records = await db.all(sql, params);
      res.json({ success: true, data: records });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/followups/customers
  router.get('/customers', async (req, res) => {
    try {
      const viewer = await isViewer(req.user.id);
      let sql = `SELECT id, name, customer_code, grade FROM customers WHERE status = 1 AND customer_code IS NOT NULL AND customer_code != ''`;
      const params = [];
      if (!viewer) {
        sql += ` AND (created_by IS NULL OR created_by = ?)`;
        params.push(req.user.id);
      }
      sql += ` ORDER BY customer_code`;
      const customers = await db.all(sql, params);
      res.json({ success: true, data: customers });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/followups
  router.post('/', async (req, res) => {
    try {
      const { customer_id, customer_code, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name } = req.body;

      if (!customer_id || !followup_type || !followup_date || !content) {
        return res.json({ success: false, error: '请填写必填字段：客户、跟进方式、跟进日期、跟进内容' });
      }

      const result = await db.run(`
        INSERT INTO customer_followups (customer_id, customer_code, customer_name, customer_grade, followup_type, followup_date, next_followup_date, content, feedback, attachment, location_name, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        customer_id, customer_code || '', customer_name || '', customer_grade || '', followup_type || '', followup_date, next_followup_date || '', content || '', feedback || '', attachment || '', location_name || '', req.user.username
      ]);

      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/followups/:id
  router.delete('/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM customer_followups WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
