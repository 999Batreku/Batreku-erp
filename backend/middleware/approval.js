/**
 * 三级审批流共享模块
 * 适用于：客户、报价、采购、询盘、物流发货、经销商准入、售后工单
 * 流程：pending_ops → pending_tech → pending_gm → approved
 */

const APPROVAL_FLOW = ['pending_ops', 'pending_tech', 'pending_gm'];

const APPROVAL_LEVEL_ROLE = {
  'pending_ops':  'operations_director',
  'pending_tech': 'technical_director',
  'pending_gm':   'general_manager',
};

const APPROVAL_LEVEL_LABEL = {
  'pending_ops':  '运营总监',
  'pending_tech': '技术总监',
  'pending_gm':   '总经理',
};

const APPROVER_ROLES = ['operations_director', 'technical_director', 'general_manager'];

function hasRole(roles, role) {
  return roles.indexOf(role) >= 0;
}

async function getUserRoles(db, userId) {
  const rows = await db.all(
    'SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?',
    [userId]
  );
  return rows.map(function(r){ return r.name; });
}

function canApproveAny(req) {
  const roles = (req.user && req.user.roles) || [];
  return roles.some(function(r){ return APPROVER_ROLES.indexOf(r) >= 0; });
}

function parseChain(raw) {
  try { return JSON.parse(raw || '[]'); } catch(e) { return []; }
}

/**
 * 验证当前用户是否有权审批当前级别
 * @returns {object|null} 错误响应对象，null表示通过
 */
function checkApprovalPermission(aStatus, userRoles) {
  if (!APPROVAL_FLOW.includes(aStatus)) {
    return { success: false, error: '当前状态(' + aStatus + ')不在审批流程中' };
  }
  const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
  const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];
  const userCanApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
  if (!userCanApprove) {
    return {
      success: false,
      error: '当前审批级别为' + requiredLabel + '，需要' + requiredLabel + '或总经理角色才能审批'
    };
  }
  return null;
}

/**
 * 计算下一级状态
 */
function getNextStatus(aStatus) {
  const currentIndex = APPROVAL_FLOW.indexOf(aStatus);
  if (currentIndex < APPROVAL_FLOW.length - 1) {
    return APPROVAL_FLOW[currentIndex + 1];
  }
  return 'approved';
}

/**
 * 添加审批链记录
 */
function addToChain(chain, aStatus, req, signature, comment) {
  chain.push({
    level: aStatus.replace('pending_', ''),
    level_label: APPROVAL_LEVEL_LABEL[aStatus],
    approver_id: req.user.id,
    approver_name: req.user.real_name || req.user.username,
    signature: signature || null,
    approved_at: new Date().toISOString(),
    comment: comment || '',
  });
  return chain;
}

/**
 * 获取下一级的中文提示
 */
function getNextLabel(nextStatus) {
  if (nextStatus === 'approved') return '已通过（全部审批完成）';
  return '等待' + APPROVAL_LEVEL_LABEL[nextStatus] + '审批';
}

module.exports = {
  APPROVAL_FLOW,
  APPROVAL_LEVEL_ROLE,
  APPROVAL_LEVEL_LABEL,
  APPROVER_ROLES,
  hasRole,
  getUserRoles,
  canApproveAny,
  parseChain,
  checkApprovalPermission,
  getNextStatus,
  addToChain,
  getNextLabel,
};
