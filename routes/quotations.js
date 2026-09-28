const express = require('express');
const { authMiddleware } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  router.use(authMiddleware);

  // ========== 辅助函数 ==========

  async function getUserRoles(userId) {
    const rows = await db.all(`
      SELECT r.name FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `, [userId]);
    return rows.map(r => r.name);
  }

  function hasRole(roles, roleName) {
    return roles.includes(roleName);
  }

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

  const APPROVAL_FLOW = ['pending_ops', 'pending_tech', 'pending_gm'];

  function parseChain(chainStr) {
    try {
      return JSON.parse(chainStr || '[]');
    } catch {
      return [];
    }
  }

  // ========== 基础 CRUD ==========

  // GET /api/quotations
  router.get('/', async (req, res) => {
    try {
      const rows = await db.all(`
        SELECT q.*, c.name as customer_name, u.real_name as creator_name
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        LEFT JOIN users u ON u.id = q.created_by
        ORDER BY q.id DESC
      `, []);
      const result = [];
      for (const q of rows) {
        const itemCount = await db.get('SELECT COUNT(*) as cnt FROM quotation_items WHERE quotation_id = ?', [q.id]);
        const chain = parseChain(q.approval_chain);
        result.push({ ...q, item_count: Number(itemCount.cnt), approval_chain: chain });
      }
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/quotations/:id
  router.get('/:id', async (req, res) => {
    try {
      const q = await db.get(`
        SELECT q.*, c.name as customer_name, c.contact_person, c.phone as customer_phone, c.address as customer_address
        FROM quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
      `, [req.params.id]);
      if (!q) return res.json({ success: false, error: '报价单不存在' });

      const items = await db.all(`
        SELECT qi.*, m.name as material_name, m.code as material_code
        FROM quotation_items qi LEFT JOIN materials m ON m.id = qi.material_id
        WHERE qi.quotation_id = ? ORDER BY qi.sort_order
      `, [q.id]);

      const chain = parseChain(q.approval_chain);

      res.json({
        success: true,
        data: {
          ...q,
          approval_chain: chain,
          items,
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/quotations
  router.post('/', async (req, res) => {
    try {
      const { quotation_no, customer_id, title, currency, valid_days, notes, items } = req.body;
      const no = quotation_no || 'QT-' + Date.now();

      let total = 0;
      if (items && items.length) {
        total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
      }

      const result = await db.run(`
        INSERT INTO quotations (quotation_no, customer_id, title, total_amount, currency, valid_days, notes, created_by, approval_status, approval_chain)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', '[]')
      `, [no, customer_id, title, total, currency || 'IDR', valid_days || 30, notes, req.user.id]);

      const qid = result.lastInsertRowid;
      if (items && items.length) {
        let idx = 0;
        for (const item of items) {
          const amt = (item.quantity || 0) * (item.unit_price || 0);
          await db.run(`
            INSERT INTO quotation_items (quotation_id, material_id, description, quantity, unit, unit_price, amount, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [qid, item.material_id, item.description, item.quantity, item.unit, item.unit_price, amt, idx + 1]);
          idx += 1;
        }
      }

      res.json({ success: true, data: { id: qid }, message: '报价单创建成功' });
    } catch (e) {
      if (/unique|duplicate key/i.test(e.message)) return res.json({ success: false, error: '报价单号已存在' });
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PUT /api/quotations/:id
  router.put('/:id', async (req, res) => {
    try {
      const { customer_id, title, currency, valid_days, notes, items } = req.body;
      const id = req.params.id;
      const q = await db.get('SELECT * FROM quotations WHERE id = ?', [id]);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      const aStatus = q.approval_status || 'draft';
      if (aStatus !== 'draft') return res.json({ success: false, error: '只能编辑草稿状态的报价单' });

      let total = q.total_amount;
      if (items && items.length) {
        total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);
      }

      await db.run(`
        UPDATE quotations SET customer_id=?, title=?, total_amount=?, currency=?, valid_days=?, notes=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [customer_id, title, total, currency, valid_days, notes, id]);

      if (items !== undefined) {
        await db.run('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
        if (items.length) {
          let idx = 0;
          for (const item of items) {
            const amt = (item.quantity || 0) * (item.unit_price || 0);
            await db.run(`
              INSERT INTO quotation_items (quotation_id, material_id, description, quantity, unit, unit_price, amount, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, item.material_id, item.description, item.quantity, item.unit, item.unit_price, amt, idx + 1]);
            idx += 1;
          }
        }
      }

      res.json({ success: true, message: '报价单更新成功' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /api/quotations/:id
  router.delete('/:id', async (req, res) => {
    try {
      const q = await db.get('SELECT approval_status FROM quotations WHERE id = ?', [req.params.id]);
      if (!q) return res.json({ success: false, error: '报价单不存在' });
      const aStatus = q.approval_status || 'draft';
      if (aStatus !== 'draft') return res.json({ success: false, error: '只能删除草稿状态的报价单' });
      await db.run('DELETE FROM quotation_items WHERE quotation_id = ?', [req.params.id]);
      await db.run('DELETE FROM quotations WHERE id = ?', [req.params.id]);
      res.json({ success: true, message: '已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ========== 审批流接口 ==========

  // POST /api/quotations/:id/submit
  router.post('/:id/submit', async (req, res) => {
    try {
      const id = req.params.id;
      const q = await db.get('SELECT * FROM quotations WHERE id = ?', [id]);
      if (!q) return res.json({ success: false, error: '报价单不存在' });

      const aStatus = q.approval_status || 'draft';
      if (aStatus !== 'draft') {
        return res.json({ success: false, error: '只有草稿状态的报价单可以提交审批' });
      }

      const userRoles = await getUserRoles(req.user.id);
      const isCreator = Number(q.created_by) === Number(req.user.id);
      const isGM = hasRole(userRoles, 'general_manager');
      if (!isCreator && !isGM) {
        return res.json({ success: false, error: '只有报价创建者或总经理可以提交审批' });
      }

      await db.run(`
        UPDATE quotations SET approval_status = 'pending_ops', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `, [id]);

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['quotation', id, 'submit', req.user.id, '提交三级审批']
      );

      res.json({ success: true, message: '已提交审批，等待运营总监审批' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/quotations/:id/approve
  router.post('/:id/approve', async (req, res) => {
    try {
      const id = req.params.id;
      const { action, comment, signature } = req.body;

      if (!action || !['approve', 'reject'].includes(action)) {
        return res.json({ success: false, error: 'action 必须为 approve 或 reject' });
      }

      const q = await db.get('SELECT * FROM quotations WHERE id = ?', [id]);
      if (!q) return res.json({ success: false, error: '报价单不存在' });

      const aStatus = q.approval_status || 'draft';
      if (!['pending_ops', 'pending_tech', 'pending_gm'].includes(aStatus)) {
        return res.json({ success: false, error: '当前状态不在审批流程中' });
      }

      const userRoles = await getUserRoles(req.user.id);

      const requiredRole = APPROVAL_LEVEL_ROLE[aStatus];
      const requiredLabel = APPROVAL_LEVEL_LABEL[aStatus];

      const canApprove = hasRole(userRoles, 'general_manager') || hasRole(userRoles, requiredRole);
      if (!canApprove) {
        return res.json({
          success: false,
          error: `当前审批级别为${requiredLabel}，需要${requiredLabel}或总经理角色才能审批`
        });
      }

      const now = new Date().toISOString();

      if (action === 'reject') {
        await db.run(`
          UPDATE quotations SET
            rejected_by = ?,
            rejected_at = ?,
            rejection_reason = ?,
            approval_status = 'rejected',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `, [req.user.id, now, comment || '', id]);

        await db.run(
          'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
          ['quotation', id, 'reject', req.user.id, comment || `驳回（${requiredLabel}审批）`]
        );

        return res.json({ success: true, message: '报价单已驳回' });
      }

      // 通过 — 推进到下一级
      if (!signature || String(signature).indexOf('data:image') !== 0) {
        return res.json({ success: false, error: '审批通过必须签署电子签名' });
      }
      const chain = parseChain(q.approval_chain);
      chain.push({
        level: aStatus.replace('pending_', ''),
        level_label: requiredLabel,
        approver_id: req.user.id,
        approver_name: req.user.real_name || req.user.username,
        signature: signature || null,
        approved_at: now,
        comment: comment || '',
      });

      const currentIndex = APPROVAL_FLOW.indexOf(aStatus);
      let nextStatus;
      if (currentIndex < APPROVAL_FLOW.length - 1) {
        nextStatus = APPROVAL_FLOW[currentIndex + 1];
      } else {
        nextStatus = 'approved';
      }

      await db.run(`
        UPDATE quotations SET
          approval_status = ?,
          approval_chain = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [nextStatus, JSON.stringify(chain), id]);

      await db.run(
        'INSERT INTO approval_records (target_type, target_id, action, approver_id, comment) VALUES (?, ?, ?, ?, ?)',
        ['quotation', id, 'approve', req.user.id, comment || `${requiredLabel}审批通过`]
      );

      const nextLabel = nextStatus === 'approved' ? '已通过（全部审批完成）' : `等待${APPROVAL_LEVEL_LABEL[nextStatus]}审批`;
      res.json({ success: true, message: `${requiredLabel}审批通过，${nextLabel}`, approval_status: nextStatus });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/quotations/:id/export
  router.get('/:id/export', async (req, res) => {
    try {
      const q = await db.get(`
        SELECT q.*, c.name as customer_name, c.contact_person, c.phone as customer_phone, c.address as customer_address, u.real_name as creator_name
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        LEFT JOIN users u ON u.id = q.created_by
        WHERE q.id = ?
      `, [req.params.id]);

      if (!q) return res.json({ success: false, error: '报价单不存在' });

      const aStatus = q.approval_status || 'draft';
      if (aStatus !== 'approved') {
        return res.json({ success: false, error: '只有已通过的报价单可以导出' });
      }

      const items = await db.all(`
        SELECT qi.*, m.name as material_name, m.code as material_code
        FROM quotation_items qi LEFT JOIN materials m ON m.id = qi.material_id
        WHERE qi.quotation_id = ? ORDER BY qi.sort_order
      `, [q.id]);

      const chain = parseChain(q.approval_chain);

      const itemRows = items.map(item => `
        <tr>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${item.sort_order || ''}</td>
          <td style="border:1px solid #ddd;padding:8px">${item.description || item.material_name || ''}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${item.material_code || ''}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${item.quantity}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${item.unit || ''}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right">${Number(item.unit_price).toLocaleString()}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:right">${Number(item.amount).toLocaleString()}</td>
        </tr>
      `).join('');

      const approvalRows = chain.map((a, i) => `
        <tr>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${i + 1}</td>
          <td style="border:1px solid #ddd;padding:8px">${a.level_label || a.level}</td>
          <td style="border:1px solid #ddd;padding:8px">${a.approver_name || ''}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">${a.approved_at ? new Date(a.approved_at).toLocaleString() : ''}</td>
          <td style="border:1px solid #ddd;padding:8px">${a.comment || ''}</td>
          <td style="border:1px solid #ddd;padding:8px;text-align:center">
            ${a.signature ? `<img src="${a.signature}" style="max-height:40px;max-width:120px" />` : '—'}
          </td>
        </tr>
      `).join('');

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>报价单 ${q.quotation_no}</title>
  <style>
    @media print { @page { size: A4; margin: 15mm; } }
    body { font-family: -apple-system, "Microsoft YaHei", sans-serif; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { text-align: center; color: #1a237e; margin-bottom: 5px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 20px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin-bottom: 20px; }
    .info-item { display: flex; }
    .info-label { color: #666; min-width: 80px; }
    .info-value { font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f5f5f5; font-weight: 600; }
    .total-row td { font-weight: bold; font-size: 1.1em; background: #fafafa; }
    .approval-section { margin-top: 30px; }
    .approval-section h3 { color: #1a237e; border-bottom: 2px solid #1a237e; padding-bottom: 5px; }
    .notes { background: #f9f9f9; padding: 12px; border-radius: 4px; margin-top: 20px; }
  </style>
</head>
<body>
  <h1>BATREKU 报价单</h1>
  <p class="subtitle">${q.quotation_no}</p>

  <div class="info-grid">
    <div class="info-item"><span class="info-label">客户：</span><span class="info-value">${q.customer_name || ''}</span></div>
    <div class="info-item"><span class="info-label">联系人：</span><span class="info-value">${q.contact_person || ''}</span></div>
    <div class="info-item"><span class="info-label">电话：</span><span class="info-value">${q.customer_phone || ''}</span></div>
    <div class="info-item"><span class="info-label">地址：</span><span class="info-value">${q.customer_address || ''}</span></div>
    <div class="info-item"><span class="info-label">报价主题：</span><span class="info-value">${q.title || ''}</span></div>
    <div class="info-item"><span class="info-label">币种：</span><span class="info-value">${q.currency || 'IDR'}</span></div>
    <div class="info-item"><span class="info-label">有效期：</span><span class="info-value">${q.valid_days || 30} 天</span></div>
    <div class="info-item"><span class="info-label">创建日期：</span><span class="info-value">${q.created_at ? new Date(q.created_at).toLocaleDateString() : ''}</span></div>
    <div class="info-item"><span class="info-label">创建人：</span><span class="info-value">${q.creator_name || ''}</span></div>
    <div class="info-item"><span class="info-label">审批状态：</span><span class="info-value" style="color:green;font-weight:bold">已批准</span></div>
  </div>

  <table>
    <thead>
      <tr style="background:#1a237e;color:#fff">
        <th style="border:1px solid #ddd;padding:8px;width:40px">#</th>
        <th style="border:1px solid #ddd;padding:8px">描述</th>
        <th style="border:1px solid #ddd;padding:8px;width:80px">编码</th>
        <th style="border:1px solid #ddd;padding:8px;width:60px">数量</th>
        <th style="border:1px solid #ddd;padding:8px;width:50px">单位</th>
        <th style="border:1px solid #ddd;padding:8px;width:100px">单价</th>
        <th style="border:1px solid #ddd;padding:8px;width:100px">金额</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
      <tr class="total-row">
        <td colspan="6" style="border:1px solid #ddd;padding:8px;text-align:right">合计：</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right">${Number(q.total_amount).toLocaleString()} ${q.currency || 'IDR'}</td>
      </tr>
    </tbody>
  </table>

  ${q.notes ? `<div class="notes"><strong>备注：</strong>${q.notes}</div>` : ''}

  <div class="approval-section">
    <h3>审批记录</h3>
    <table>
      <thead>
        <tr style="background:#1a237e;color:#fff">
          <th style="border:1px solid #ddd;padding:8px">#</th>
          <th style="border:1px solid #ddd;padding:8px">审批级别</th>
          <th style="border:1px solid #ddd;padding:8px">审批人</th>
          <th style="border:1px solid #ddd;padding:8px">审批时间</th>
          <th style="border:1px solid #ddd;padding:8px">意见</th>
          <th style="border:1px solid #ddd;padding:8px">签名</th>
        </tr>
      </thead>
      <tbody>
        ${approvalRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};
