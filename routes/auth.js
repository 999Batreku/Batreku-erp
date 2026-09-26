const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_EXPIRES } = require('../middleware/auth');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();

  // POST /api/auth/login
  router.post('/login', (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.json({ success: false, error: '用户名和密码不能为空' });
      }
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.json({ success: false, error: '用户名或密码错误' });
      }
      if (user.status !== 1) {
        return res.json({ success: false, error: '账号已被禁用' });
      }
      // 获取角色
      const roles = db.prepare(`
        SELECT r.name, r.display_name FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `).all(user.id);

      const token = jwt.sign({
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        roles: roles.map(r => r.name)
      }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            username: user.username,
            real_name: user.real_name,
            email: user.email,
            roles
          }
        },
        message: '登录成功'
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/auth/logout
  router.post('/logout', authMiddleware, (req, res) => {
    res.json({ success: true, message: '已退出登录' });
  });

  // GET /api/auth/profile
  router.get('/profile', authMiddleware, (req, res) => {
    try {
      const user = db.prepare('SELECT id, username, real_name, email, phone, status, created_at FROM users WHERE id = ?').get(req.user.id);
      const roles = db.prepare(`
        SELECT r.name, r.display_name, r.level FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = ?
      `).all(req.user.id);
      res.json({ success: true, data: { ...user, roles } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
