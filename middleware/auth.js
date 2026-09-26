const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'batreku-erp-secret-2026';
const JWT_EXPIRES = '24h';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未登录或token已过期' });
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, error: 'token无效或已过期' });
  }
}

module.exports = { authMiddleware, JWT_SECRET, JWT_EXPIRES };
