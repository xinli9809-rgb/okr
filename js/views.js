/* ============================================================
 * 科创OKR管理机制 —— 视图层（views.js）
 * 依赖：Store（store.js）、App（main.js 全局对象）
 * ============================================================ */
(function (global) {
  'use strict';
  var S = global.Store;
  var Views = {};

  /* ---------------- 通用小部件 ---------------- */
  function esc(s) { return S.esc(s); }
  function chip(text, cls) { return '<span class="tag ' + (cls || 'tag-gray') + '">' + esc(text) + '</span>'; }
  function statusChip(o) {
    if (o.status === 'settled') return chip('已结算 · ' + o.settled.badge + '级', 'tag-green');
    if (o.status === 'approved') {
      if (o.approvedBy === 'chair') return chip('已批准·主席终审', 'tag-green');
      if (o.approvedBy === 'minister') return chip('已批准·部长已批', 'tag-green');
      return chip('已批准·生效中', 'tag-green');
    }
    if (o.status === 'pending') {
      if (o.type === 'dept') return chip('待主席审批', 'tag-amber');
      return chip('待审批', 'tag-amber');
    }
    if (o.status === 'rejected') {
      if (o.chairReviewed) return chip('主席已驳回', 'tag-red');
      return chip('已驳回', 'tag-red');
    }
    return chip('草稿', 'tag-gray');
  }
  function typeChip(o) {
    if (o.type === 'global') return chip('主席总目标', 'tag-purple');
    if (o.type === 'dept') return chip('部门OKR', 'tag-cyan');
    return chip('个人OKR', 'tag-blue');
  }
  function badgeMedal(b) { return '<span class="badge-medal badge-' + (b || 'C') + '">' + esc(b || '—') + '</span>'; }
  function progressBar(p) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    var cls = p >= 80 ? 'ok' : p >= 55 ? '' : 'warn';
    return '<span class="progress-track"><span class="progress-fill ' + cls + '" style="width:' + p + '%"></span></span> <span class="small">' + p + '%</span>';
  }
  function redTag(kr, o) {
    var r = S.krRed(kr, o.period);
    if (r.red) return '<span class="redlight">红灯 · 实际' + (kr.progress || 0) + '% < 预设' + Math.round(r.threshold) + '%</span>';
    return '';
  }
  function daysLeft(date) {
    var d = S.diffDays(S.today(), date);
    if (d < 0) return chip('已逾期' + (-d) + '天', 'tag-red');
    if (d === 0) return chip('今天截止', 'tag-red');
    if (d <= 3) return chip('剩' + d + '天', 'tag-amber');
    return chip('剩' + d + '天', 'tag-blue');
  }
  function ownerName(ownerId) {
    var u = S.getUser(ownerId);
    return u ? u.name : '（成员已移除）';
  }
  function ministerName(staffId) {
    var m = S.ministerOf(staffId);
    return m ? ownerName(m) : '未分配';
  }
  function rangeLabel() {
    var r = App.filterRange();
    if (!r) return '全部时间';
    if (r.from === r.to) return '今天（' + r.from + '）';
    return r.from + ' ~ ' + r.to;
  }

  /* ---------------- 导航 ---------------- */
  Views.nav = function () {
    var role = App.user.role;
    var tabs = [];
    if (role === 'chair') {
      tabs = [
        ['board', '📊 全局看板'], ['approve', '✅ 审批中心'], ['red', '🚨 红灯预警大盘'], ['analysis', '📈 时间跨度分析'],
        ['pipeline', '🔗 管线设置'], ['org', '🏛️ 组织管理'], ['calendar', '📅 里程碑日历'], ['export', '📤 数据导出']
      ];
    } else if (role === 'minister') {
      tabs = [
        ['board', '📋 部门看板'], ['approve', '✅ 审批中心'], ['review', '✍️ 点评管理'],
        ['window', '🪟 日期推进视窗'], ['calendar', '📅 里程碑日历'], ['export', '📤 数据导出']
      ];
    } else {
      tabs = [
        ['my', '🎯 我的OKR'], ['timeline', '🕐 个人时间轴'], ['stuff', '🏅 点评与徽章'], ['calendar', '📅 里程碑日历']
      ];
    }
    return tabs.map(function (t) {
      return '<button data-act="set-tab" data-tab="' + t[0] + '" class="' + (App.tab === t[0] ? 'active' : '') + '">' + t[1] + '</button>';
    }).join('');
  };

  Views.render = function () {
    var map = {
      board: Views.board, red: Views.red, analysis: Views.analysis, pipeline: Views.pipeline,
      org: Views.org, calendar: Views.calendar, export: Views.exportView,
      approve: Views.approve, review: Views.review, window: Views.windowView,
      my: Views.my, timeline: Views.timeline, stuff: Views.stuff
    };
    var fn = map[App.tab] || Views.board;
    return fn();
  };

  /* ---------------- OKR 卡片渲染 ---------------- */
  function krRowHTML(kr, o, idx, opts) {
    var lastUp = (kr.updates && kr.updates.length) ? kr.updates[kr.updates.length - 1] : null;
    var actions = '';
    if (opts.canProgress) {
      actions = '<button class="btn btn-sm btn-primary" data-act="okr-progress" data-id="' + o.id + '" data-kr="' + kr.id + '">更新进度</button>';
    }
    var note = lastUp && lastUp.note ? '<div class="note-line">📝 ' + esc(lastUp.note) + '（' + lastUp.date + '）</div>' : '';
    return '<div class="kr-row">' +
      '<div><div class="kr-text"><b>KR' + (idx + 1) + '</b>（权重 ' + kr.weight + '%）' + esc(kr.text) + '</div>' +
      '<div class="kr-meta">' + daysLeft(kr.deadline) + progressBar(kr.progress) + redTag(kr, o) + '</div>' + note + '</div>' +
      '<div class="kr-actions">' + actions + '</div></div>';
  }

  function okrCardHTML(o, opts) {
    opts = opts || {};
    var u = S.getUser(o.ownerId);
    var who = opts.noOwner ? '' : '<span class="who">' + esc(u ? u.name : '成员已移除') + '</span>' + (u ? chip(S.roleName(u.role), u.role === 'chair' ? 'tag-purple' : u.role === 'minister' ? 'tag-cyan' : 'tag-blue') : '');
    var head = '<div class="okr-head">' + who + chip(o.deptId ? S.deptName(o.deptId) : '主席团', 'tag-gray') + typeChip(o) + statusChip(o) +
      '<span class="period">🗓 ' + esc(o.period.name) + '（' + o.period.start + ' ~ ' + o.period.end + '）</span></div>';
    var oLine = '<div class="okr-o">🎯 O：' + esc(o.objective) + '</div>';
    var krs = o.krs.map(function (k, i) { return krRowHTML(k, o, i, opts); }).join('');
    var extra = '';
    if (o.status === 'rejected' && o.rejectReason) {
      extra += '<div class="reject-box">❌ 驳回原因：' + esc(o.rejectReason) + '</div>';
    }
    if (o.settled) {
      extra += '<div class="mt8 flex">' + badgeMedal(o.settled.badge) +
        '<span class="small">周期到期已结算：综合得分 <b>' + o.settled.score + '</b> 分（加权KR进度 ' + o.settled.weighted +
        ' ×60% ＋ 上级点评 ' + o.settled.reviewAvg + ' ×25% ＋ 更新留存 ' + o.settled.retention + ' ×15%）</span>' +
        '<button class="btn btn-sm" data-act="okr-score" data-id="' + o.id + '">查看结算明细</button></div>';
    }
    var tools = '';
    if (opts.canEdit) tools += '<button class="btn btn-sm" data-act="okr-edit" data-id="' + o.id + '">编辑</button>';
    if (opts.canSubmit) tools += '<button class="btn btn-sm btn-primary" data-act="okr-submit" data-id="' + o.id + '">提交审批</button>';
    if (opts.canDel) tools += '<button class="btn btn-sm btn-danger" data-act="okr-del" data-id="' + o.id + '">删除</button>';
    var toolsBar = tools ? '<div class="flex mt8">' + tools + '</div>' : '';
    return '<div class="card okr-card ' + (o.type === 'global' ? 'global' : o.type === 'dept' ? 'dept' : '') + '">' + head + oLine + krs + extra + toolsBar + '</div>';
  }

  /* ---------------- 主席界面：全局看板 ---------------- */
  Views.board = function () {
    var role = App.user.role;
    if (role === 'chair') return Views.board_chair();
    if (role === 'minister') return Views.board_minister();
    return Views.my();
  };

  Views.board_chair = function () {
    var okrs = S.activeOKRs(App.filterRange());
    var users = S.db.users;
    var reds = 0;
    okrs.forEach(function (o) { reds += S.okrRedKRs(o).length; });
    var html = '<div class="page-head"><h2>全局看板</h2><span class="desc">当前筛选：<b>' + rangeLabel() + '</b> · 主席可查看全员 OKR 与实时进度，并设置主席团全局总目标</span></div>';
    html += '<div class="stats">' +
      stat(S.db.departments.length, '部门数') +
      stat(users.filter(function (u) { return u.role === 'minister'; }).length + ' / ' + users.filter(function (u) { return u.role === 'staff'; }).length, '部长 / 干事') +
      stat(okrs.length, '当前范围 OKR 数') +
      stat(reds, '红灯 KR 数', 'red') +
      '</div>';
    // 主席总目标
    var globals = okrs.filter(function (o) { return o.type === 'global'; });
    html += '<div class="card" style="border-left:4px solid #7c3aed"><h3>👑 主席团全局总目标（总O） <span class="tools"><button class="btn btn-sm btn-primary" data-act="okr-new" data-type="global">' + (globals.length ? '新建/编辑总目标' : '设置总目标') + '</button></span></h3>';
    if (globals.length) { html += globals.map(function (o) { return okrCardHTML(o, { canProgress: true, canEdit: true }); }).join(''); }
    else { html += '<div class="empty">尚未设置全局总目标，点击右上角按钮创建</div>'; }
    html += '</div>';
    // 全员 OKR
    var deptSel = App._boardDept || '';
    html += '<div class="card"><h3>全员 / 全部门 OKR 列表 <span class="tools"><select data-act="board-dept">' +
      '<option value="">全部部门</option>' + S.db.departments.map(function (d) { return '<option value="' + d.id + '"' + (deptSel === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') +
      '</select><select data-act="board-status"><option value="">全部状态</option><option value="pending" ' + (App._boardStatus === 'pending' ? 'selected' : '') + '>待审批</option><option value="approved" ' + (App._boardStatus === 'approved' ? 'selected' : '') + '>已批准</option><option value="rejected" ' + (App._boardStatus === 'rejected' ? 'selected' : '') + '>已驳回</option><option value="settled" ' + (App._boardStatus === 'settled' ? 'selected' : '') + '>已结算</option></select></span></h3>';
    var list = okrs.filter(function (o) {
      if (deptSel && o.deptId !== deptSel) return false;
      if (App._boardStatus && o.status !== App._boardStatus) return false;
      return true;
    });
    if (!list.length) { html += '<div class="empty">当前筛选条件下暂无 OKR</div>'; }
    else { list.forEach(function (o) { html += okrCardHTML(o, {}); }); }
    html += '</div>';
    return html;
  };

  /* ---------------- 主席界面：红灯预警大盘 ---------------- */
  Views.red = function () {
    var okrs = S.activeOKRs(App.filterRange());
    var rows = [];
    okrs.forEach(function (o) {
      S.okrRedKRs(o).forEach(function (r) {
        rows.push({ o: o, kr: r.kr, expected: r.expected, threshold: r.threshold });
      });
    });
    var html = '<div class="page-head"><h2>🚨 全局红灯预警大盘</h2><span class="desc">当前筛选：<b>' + rangeLabel() + '</b> · 自动汇总实际进度低于预设时间进度 55% 的滞后 KR，便于主席跨部门调配资源帮扶</span></div>';
    if (!rows.length) {
      html += '<div class="green-banner">✅ 当前时间范围内没有红灯 KR，全员进度健康。</div>';
      return html;
    }
    html += '<div class="red-banner">⚠️ 共 <b>' + rows.length + '</b> 项 KR 亮红灯，建议主席联系对应部长，协调资源帮扶滞后干事。</div>';
    // 按部门汇总
    var byDept = {};
    rows.forEach(function (r) {
      var key = r.o.deptId || '主席团';
      byDept[key] = (byDept[key] || 0) + 1;
    });
    html += '<div class="stats">' + Object.keys(byDept).map(function (k) {
      return stat(byDept[k], '红灯数 · ' + esc(k === '主席团' ? '主席团' : S.deptName(k)), 'red');
    }).join('') + '</div>';
    html += '<table class="grid"><tr><th>部门</th><th>干事</th><th>所属部长</th><th>KR 内容</th><th>截止</th><th>实际进度</th><th>预设阈值</th><th>帮扶建议</th></tr>';
    rows.forEach(function (r) {
      var mn = S.ministerOf(r.o.ownerId);
      html += '<tr><td>' + esc(r.o.deptId ? S.deptName(r.o.deptId) : '主席团') + '</td><td><b>' + esc(ownerName(r.o.ownerId)) + '</b></td><td>' + esc(mn ? ownerName(mn) : '未分配') + '</td>' +
        '<td>' + esc(r.kr.text) + '</td><td>' + r.kr.deadline + '</td><td><b style="color:#dc2626">' + (r.kr.progress || 0) + '%</b></td><td>' + Math.round(r.threshold) + '%</td>' +
        '<td class="small">联系 <b>' + esc(mn ? ownerName(mn) : '对应部长') + '</b> 对接 ' + esc(ownerName(r.o.ownerId)) + '，针对卡点（材料、物料、人力）协调资源</td></tr>';
    });
    html += '</table>';
    return html;
  };

  /* ---------------- 主席界面：时间跨度分析 ---------------- */
  Views.analysis = function () {
    var a = App._ana || (function () {
      var t = S.today();
      var from = t.slice(0, 8) + '01';
      return { from: from, to: t };
    })();
    var depts = S.db.departments;
    var rows = depts.map(function (d) {
      var okrs = S.activeOKRs({ from: a.from, to: a.to }).filter(function (o) { return o.deptId === d.id && o.type !== 'global'; });
      var avg = okrs.length ? okrs.reduce(function (s, o) { return s + S.okrWeighted(o); }, 0) / okrs.length : 0;
      var reds = 0, krs = 0, ups = 0;
      okrs.forEach(function (o) { reds += S.okrRedKRs(o).length; krs += o.krs.length; ups += S.okrUpdateCount(o); });
      return { d: d, n: okrs.length, avg: avg, reds: reds, krs: krs, ups: ups };
    });
    var html = '<div class="page-head"><h2>📈 时间跨度分析</h2><span class="desc">按自定义日期区间对比各部门完成度，支持跨时间段对比</span></div>';
    html += '<div class="card"><h3>分析区间</h3><div class="flex">' +
      '<input type="date" id="anaFrom" value="' + a.from + '"><span>~</span><input type="date" id="anaTo" value="' + a.to + '">' +
      '<button class="btn btn-primary" data-act="ana-run">开始分析</button>' +
      '<button class="btn" data-act="ana-month">本月</button><button class="btn" data-act="ana-sem">本学期</button></div></div>';
    html += '<div class="card"><h3>各部门完成度对比</h3>';
    rows.forEach(function (r) {
      var w = Math.max(2, Math.round(r.avg));
      html += '<div class="ana-row"><b>' + esc(r.d.name) + '</b><div class="ana-bar"><div class="ana-fill" style="width:' + w + '%"></div></div><span class="ana-num">' + S.round1(r.avg) + '%</span></div>';
    });
    html += '</div>';
    html += '<div class="card"><h3>明细表</h3><table class="grid"><tr><th>部门</th><th>生效OKR数</th><th>KR总数</th><th>平均加权进度</th><th>红灯KR数</th><th>进度更新次数</th></tr>';
    rows.forEach(function (r) {
      html += '<tr><td><b>' + esc(r.d.name) + '</b></td><td>' + r.n + '</td><td>' + r.krs + '</td><td>' + S.round1(r.avg) + '%</td><td>' + (r.reds ? '<b style="color:#dc2626">' + r.reds + '</b>' : '0') + '</td><td>' + r.ups + '</td></tr>';
    });
    html += '</table></div>';
    return html;
  };

  /* ---------------- 主席界面：管线设置 ---------------- */
  Views.pipeline = function () {
    var ministers = S.usersByRole('minister');
    var staffs = S.usersByRole('staff');
    var pipe = S.db.pipeline;
    var assigned = {};
    Object.keys(pipe).forEach(function (k) { pipe[k].forEach(function (s) { assigned[s] = true; }); });
    var unassigned = staffs.filter(function (s) { return !assigned[s.id]; });
    var html = '<div class="page-head"><h2>🔗 管线映射设置</h2><span class="desc">主席专属：勾选矩阵，指定"哪位部长管理并查看哪几个干事的 OKR"，灵活调整团队归属与管理链路</span></div>';
    html += '<div class="card"><h3>部长 ↔ 干事 管线矩阵</h3><div class="matrix-wrap"><table class="grid">';
    html += '<tr><th>部长 \\ 干事</th>' + staffs.map(function (s) { return '<th>' + esc(s.name) + '</th>'; }).join('') + '</tr>';
    ministers.forEach(function (m) {
      html += '<tr><td><b>' + esc(m.name) + '</b><div class="small muted">' + esc(m.studentId) + '</div></td>';
      staffs.forEach(function (s) {
        var checked = (pipe[m.id] || []).indexOf(s.id) >= 0;
        html += '<td><input type="checkbox" data-pipe-min="' + m.id + '" data-pipe-staff="' + s.id + '"' + (checked ? ' checked' : '') + '></td>';
      });
      html += '</tr>';
    });
    html += '</table></div>';
    html += '<div class="flex mt8"><button class="btn btn-primary" data-act="pipe-save">保存管线配置</button><span class="small muted">保存后：干事提交的 OKR 将进入对应部长的审批中心与部门看板</span></div></div>';
    html += '<div class="card"><h3>未分配管线的干事</h3>';
    if (!unassigned.length) { html += '<div class="green-banner">✅ 所有干事均已分配部长。</div>'; }
    else {
      html += '<div class="red-banner">⚠️ 以下干事暂无上级部长，其 OKR 不会进入任何部长的审批中心，请及时分配：</div>';
      html += unassigned.map(function (s) { return chip(esc(s.name) + '（' + esc(s.studentId) + '）', 'tag-amber'); }).join(' ');
    }
    html += '</div>';
    return html;
  };

  /* ---------------- 主席界面：组织管理 ---------------- */
  Views.org = function () {
    var html = '<div class="page-head"><h2>🏛️ 组织管理</h2><span class="desc">动态部门建立 + 人员与权限配置（主席系统锁定仅 1 人）</span></div>';
    // 部门
    html += '<div class="card"><h3>部门管理 <span class="tools"><button class="btn btn-sm btn-primary" data-act="dept-add">+ 新增部门</button></span></h3><table class="grid"><tr><th>排序</th><th>部门名称</th><th>部长数</th><th>干事数</th><th>操作</th></tr>';
    S.db.departments.forEach(function (d, i) {
      var mn = S.db.users.filter(function (u) { return u.deptId === d.id && u.role === 'minister'; }).length;
      var st = S.db.users.filter(function (u) { return u.deptId === d.id && u.role === 'staff'; }).length;
      html += '<tr><td>' + (i + 1) + '</td><td><b>' + esc(d.name) + '</b></td><td>' + mn + '</td><td>' + st + '</td><td class="flex">' +
        '<button class="btn btn-xs" data-act="dept-move" data-id="' + d.id + '" data-dir="-1">↑</button>' +
        '<button class="btn btn-xs" data-act="dept-move" data-id="' + d.id + '" data-dir="1">↓</button>' +
        '<button class="btn btn-xs" data-act="dept-rename" data-id="' + d.id + '">重命名</button>' +
        '<button class="btn btn-xs btn-danger" data-act="dept-del" data-id="' + d.id + '">删除</button></td></tr>';
    });
    html += '</table><div class="small muted mt8">支持新增、重命名、删除或排序部门（如：竞赛部、赛训部、项目部等）。删除部门后，该部门成员将变为"未分配"。</div></div>';
    // 人员
    html += '<div class="card"><h3>人员与权限配置 <span class="tools"><button class="btn btn-sm btn-primary" data-act="user-add">+ 新增成员</button></span></h3>';
    html += '<table class="grid"><tr><th>姓名</th><th>学号/工号</th><th>角色</th><th>所属部门</th><th>管线上级</th><th>操作</th></tr>';
    S.db.users.forEach(function (u) {
      var locked = u.role === 'chair';
      var up = u.role === 'staff' ? ministerName(u.id) : (u.role === 'minister' ? '（管辖 ' + S.staffOf(u.id).length + ' 名干事）' : '—');
      html += '<tr><td><b>' + esc(u.name) + '</b>' + (locked ? chip('锁定', 'tag-gold') : '') + '</td><td>' + esc(u.studentId) + '</td><td>' + chip(S.roleName(u.role), u.role === 'chair' ? 'tag-purple' : u.role === 'minister' ? 'tag-cyan' : 'tag-blue') + '</td><td>' + esc(u.deptId ? S.deptName(u.deptId) : '主席团') + '</td><td class="small">' + esc(up) + '</td><td class="flex">' +
        '<button class="btn btn-xs" data-act="user-edit" data-id="' + u.id + '">编辑</button>' +
        (locked ? '<button class="btn btn-xs" disabled title="主席系统锁定">删除</button>' : '<button class="btn btn-xs btn-danger" data-act="user-del" data-id="' + u.id + '">删除</button>') +
        '</td></tr>';
    });
    html += '</table>';
    html += '<div class="small muted mt8">角色设定：<b>主席</b>（系统锁定仅 1 人，不可新增/删除/变更）、<b>部长</b>（可自由新增/删减）、<b>干事</b>（可自由新增/删减）。所有人的姓名、学号/工号、所属部门均可随时编辑。</div></div>';
    // 密码管理（主席专属）
    html += '<div class="card"><h3>🔑 密码管理（主席专属）</h3><table class="grid"><tr><th>成员</th><th>角色</th><th>密码状态</th><th>操作</th></tr>';
    S.db.users.forEach(function (u) {
      var set = S.userPassSet(u);
      html += '<tr><td><b>' + esc(u.name) + '</b></td><td>' + chip(S.roleName(u.role), u.role === 'chair' ? 'tag-purple' : u.role === 'minister' ? 'tag-cyan' : 'tag-blue') + '</td>' +
        '<td>' + (set ? chip('已设置', 'tag-green') : chip('未设置', 'tag-red')) + '</td>' +
        '<td><button class="btn btn-xs" data-act="set-pass" data-id="' + u.id + '">' + (set ? '重置密码' : '设置密码') + '</button></td></tr>';
    });
    html += '</table>';
    html += '<div class="small muted mt8">主席密码初始为 <b>070223</b>（登录后建议立即修改）；部长/干事初始密码为 <b>123456</b>，请逐人设置专属密码。密码仅主席可设置，其他成员无法查看。</div></div>';
    return html;
  };

  /* ---------------- 里程碑日历（三端共用） ---------------- */
  Views.calendar = function () {
    var role = App.user.role;
    var st = App._cal || { y: new Date().getFullYear(), m: new Date().getMonth(), sel: S.today() };
    var first = new Date(st.y, st.m, 1);
    var year = st.y, month = st.m;
    var dow = (first.getDay() + 6) % 7; // 周一开头
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = S.today();
    // 事件收集
    var events = {};
    function addEvent(date, html, cls) {
      if (!events[date]) events[date] = [];
      events[date].push({ html: html, cls: cls });
    }
    S.db.milestones.forEach(function (m) { addEvent(m.date, esc(m.title), 'ms'); });
    var scope = role === 'chair' ? S.db.okrs : role === 'minister' ? S.db.okrs.filter(function (o) {
      return (o.ownerId === App.user.id) || (S.staffOf(App.user.id).indexOf(o.ownerId) >= 0);
    }) : S.db.okrs.filter(function (o) { return o.ownerId === App.user.id; });
    scope.forEach(function (o) {
      o.krs.forEach(function (k) {
        var r = S.krRed(k, o.period);
        var d = S.diffDays(today, k.deadline);
        var cls = r.red ? 'kr-red' : (d <= 3 && d >= 0 ? 'kr-hot' : 'kr');
        var short = k.text.length > 14 ? k.text.slice(0, 14) + '…' : k.text;
        addEvent(k.deadline, esc(short) + '（' + esc(ownerName(o.ownerId)) + '）', cls);
      });
    });
    // 日历网格
    var cells = '';
    var dowNames = ['一', '二', '三', '四', '五', '六', '日'];
    cells += dowNames.map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');
    for (var i = 0; i < dow; i++) { cells += '<div class="cal-cell other"></div>'; }
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = S.fmt(new Date(year, month, day));
      var evs = events[ds] || [];
      var cls = 'cal-cell';
      if (ds === today) cls += ' today';
      if (ds === st.sel) cls += ' selected';
      cells += '<div class="' + cls + '" data-act="cal-day" data-date="' + ds + '"><div class="cal-date">' + day + '</div>' +
        evs.slice(0, 4).map(function (e) { return '<div class="cal-event ' + e.cls + '" title="' + e.html + '">' + e.html + '</div>'; }).join('') +
        (evs.length > 4 ? '<div class="small muted">+' + (evs.length - 4) + '</div>' : '') + '</div>';
    }
    var rest = (dow + daysInMonth) % 7;
    if (rest) { for (var j = 0; j < 7 - rest; j++) { cells += '<div class="cal-cell other"></div>'; } }
    // 详情
    var detail = '<h4>' + st.sel + ' 的事件</h4>';
    var dayEvents = events[st.sel] || [];
    if (!dayEvents.length) { detail += '<div class="empty" style="padding:12px">当天无里程碑 / KR 截止事件</div>'; }
    else {
      detail += dayEvents.map(function (e) { return '<div class="flex mb8"><span class="tag ' + (e.cls === 'ms' ? 'tag-purple' : e.cls === 'kr-red' ? 'tag-red' : e.cls === 'kr-hot' ? 'tag-amber' : 'tag-blue') + '">' + (e.cls === 'ms' ? '里程碑' : 'KR截止') + '</span><span class="small">' + e.html + '</span></div>'; }).join('');
    }
    var canAdd = role !== 'staff';
    var html = '<div class="page-head"><h2>📅 关键节点 / 里程碑日历</h2><span class="desc">赛事关键节点（如：市级材料报送、官网报名）自动关联并高亮对应 KR 截止日期</span></div>';
    html += '<div class="cal-wrap"><div class="card"><div class="cal-head"><button class="btn btn-sm" data-act="cal-prev">◀ 上月</button>' +
      '<b>' + year + ' 年 ' + (month + 1) + ' 月</b><span class="flex"><button class="btn btn-sm" data-act="cal-today">今天</button><button class="btn btn-sm" data-act="cal-next">下月 ▶</button></span></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
      '<div class="flex mt8"><span class="tag tag-purple">里程碑</span><span class="tag tag-blue">KR截止</span><span class="tag tag-amber">3天内到期</span><span class="tag tag-red">红灯KR</span></div></div>' +
      '<div class="cal-detail">' + detail +
      (canAdd ? '<hr style="border:none;border-top:1px dashed var(--line);margin:12px 0"><h4>添加赛事关键节点</h4><div class="flex"><input type="date" id="milDate" style="width:auto"><input type="text" id="milTitle" placeholder="如：8.10 市级材料报送" style="flex:1"><button class="btn btn-primary btn-sm" data-act="mil-add">添加</button></div>' : '') +
      '</div></div>';
    // 里程碑列表（管理）
    html += '<div class="card"><h3>已标记的关键节点</h3><table class="grid"><tr><th>日期</th><th>节点</th><th>操作</th></tr>';
    var msList = S.db.milestones.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!msList.length) { html += '<tr><td colspan="3" class="empty">暂无里程碑</td></tr>'; }
    msList.forEach(function (m) {
      html += '<tr><td>' + m.date + '</td><td>' + esc(m.title) + '</td><td>' + (canAdd ? '<button class="btn btn-xs btn-danger" data-act="mil-del" data-id="' + m.id + '">删除</button>' : '—') + '</td></tr>';
    });
    html += '</table></div>';
    return html;
  };

  /* ---------------- 导出（三端共用） ---------------- */
  Views.exportView = function () {
    var html = '<div class="page-head"><h2>📤 历史数据导出与交接留存</h2><span class="desc">按部门、按自定义日期范围一键导出全套 OKR 历史进度、备注记录及点评档案，解决换届经验断层问题</span></div>';
    html += '<div class="card"><h3>导出设置</h3><div class="mini-form">' +
      '<div class="field"><label>选择部门</label><select id="expDept"><option value="">全部部门（含主席团总目标）</option>' + S.db.departments.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>开始日期（周期生效）</label><input type="date" id="expFrom"></div>' +
      '<div class="field"><label>结束日期</label><input type="date" id="expTo"></div></div>' +
      '<div class="flex mt8"><button class="btn btn-primary" data-act="export-excel">📥 导出 Excel</button>' +
      '<button class="btn" data-act="export-pdf">🖨️ 导出 PDF（打印另存）</button>' +
      '<span class="small muted">导出内容：目标O、KR与权重、截止日期、实时进度、全部更新备注、部长点评、综合得分与徽章</span></div></div>';
    html += '<div class="card"><h3>交接留存建议</h3><div class="small muted">换届前由主席统一导出全员档案 → 归档为部门工作档案 → 新任部长可直接查阅往届赛事推进数据、工作标准，避免经验断层。</div></div>';
    return html;
  };

  /* ---------------- 部长界面：部门看板 ---------------- */
  Views.board_minister = function () {
    var me = App.user;
    var staffs = S.staffOf(me.id).map(S.getUser).filter(Boolean);
    var okrs = S.activeOKRs(App.filterRange());
    var myOkrs = okrs.filter(function (o) { return o.ownerId === me.id; });
    var staffOkrs = okrs.filter(function (o) { return staffs.some(function (s) { return s.id === o.ownerId; }); });
    // 红灯提醒
    var reds = [];
    staffOkrs.forEach(function (o) { S.okrRedKRs(o).forEach(function (r) { reds.push({ o: o, kr: r.kr }); }); });
    var html = '<div class="page-head"><h2>📋 部门汇总看板</h2><span class="desc">当前筛选：<b>' + rangeLabel() + '</b> · 实时查看辖下干事的 KR 推进进度、工作备注与材料提交情况</span></div>';
    if (reds.length) {
      html += '<div class="red-banner">🔔 <b>' + reds.length + '</b> 项红灯提醒：' + reds.map(function (r) {
        return '<b>' + esc(ownerName(r.o.ownerId)) + '</b>：' + esc(r.kr.text.slice(0, 24)) + (r.kr.text.length > 24 ? '…' : '');
      }).join('；') + '　→ 请主动对接卡点问题（材料修改困难、物料缺失等），协调资源帮扶。</div>';
    }
    // 部门 OKR
    html += '<div class="card" style="border-left:4px solid #0891b2"><h3>🏢 本部门 OKR <span class="tools"><button class="btn btn-sm btn-primary" data-act="okr-new" data-type="dept">' + (myOkrs.length ? '新建/编辑部门OKR' : '设置部门OKR') + '</button></span></h3>';
    if (myOkrs.length) { myOkrs.forEach(function (o) { html += okrCardHTML(o, { canProgress: o.status === 'approved', canEdit: true, canSubmit: o.status === 'rejected' }); }); }
    else { html += '<div class="empty">尚未设置部门 OKR，点击右上角创建（一页纸引导填报，提交后需主席审批）</div>'; }
    html += '</div>';
    // 干事汇总
    html += '<div class="card"><h3>辖下干事 OKR 汇总</h3><table class="grid"><tr><th>干事</th><th>OKR数</th><th>状态</th><th>平均加权进度</th><th>红灯KR</th><th>最近更新</th><th>最新工作备注 / 材料情况</th></tr>';
    staffs.forEach(function (s) {
      var sos = staffOkrs.filter(function (o) { return o.ownerId === s.id; });
      var avg = sos.length ? sos.reduce(function (a, o) { return a + S.okrWeighted(o); }, 0) / sos.length : 0;
      var red = 0, lastDate = '—', lastNote = '—';
      sos.forEach(function (o) {
        red += S.okrRedKRs(o).length;
        o.krs.forEach(function (k) {
          if (k.updates && k.updates.length) {
            var lu = k.updates[k.updates.length - 1];
            if (lastDate === '—' || lu.date > lastDate) { lastDate = lu.date; lastNote = lu.note || '（无备注，仅更新进度）'; }
          }
        });
      });
      var stChips = sos.map(function (o) { return statusChip(o); }).join(' ');
      html += '<tr><td><b>' + esc(s.name) + '</b><div class="small muted">' + esc(s.studentId) + '</div></td><td>' + sos.length + '</td><td>' + stChips + '</td><td>' + S.round1(avg) + '%</td><td>' + (red ? '<b style="color:#dc2626">' + red + '</b>' : 0) + '</td><td>' + lastDate + '</td><td class="small">' + esc(lastNote) + '</td></tr>';
    });
    if (!staffs.length) { html += '<tr><td colspan="7" class="empty">您名下暂无管辖干事，请联系主席在"管线设置"中为您分配</td></tr>'; }
    html += '</table></div>';
    return html;
  };

  /* ---------------- 审批中心（按角色：主席审批部长，部长审批干事） ---------------- */
  Views.approve = function () {
    return App.user.role === 'chair' ? Views.approve_chair() : Views.approve_minister();
  };
  // 主席：审批中心（查看并审批全员 OKR；主席终审优先于部长）
  Views.approve_chair = function () {
    var pend = S.db.okrs.filter(function (o) { return o.type !== 'global' && o.status === 'pending'; });
    var approved = S.db.okrs.filter(function (o) { return o.type !== 'global' && o.status === 'approved'; });
    var rejected = S.db.okrs.filter(function (o) { return o.type !== 'global' && o.status === 'rejected'; });
    var html = '<div class="page-head"><h2>✅ 审批中心 · 主席终审</h2><span class="desc">查看并审批<b>全员</b> OKR（部长的部门OKR、干事的个人OKR）；主席审批为主——部长已批准的，主席仍可驳回</span></div>';
    html += '<div class="card"><h3>⏳ 待主席审批（' + pend.length + '）</h3>';
    if (!pend.length) { html += '<div class="green-banner">✅ 当前没有待审批的 OKR。</div>'; }
    pend.forEach(function (o) {
      html += okrCardHTML(o, {});
      html += '<div class="flex" style="margin:-6px 0 14px 0"><button class="btn btn-primary btn-sm" data-act="approve" data-id="' + o.id + '">✔ 批准（终审）</button>' +
        '<button class="btn btn-warn btn-sm" data-act="reject" data-id="' + o.id + '">✖ 驳回（说明原因）</button></div>';
    });
    html += '</div>';
    html += '<div class="card"><h3>✅ 已批准（' + approved.length + '）· 主席可驳回，以主席审批为主</h3>';
    if (!approved.length) { html += '<div class="empty">暂无已批准的 OKR</div>'; }
    approved.forEach(function (o) {
      var hint = o.approvedBy === 'minister' ? '（部长已批准 → 主席可终审驳回）' : (o.approvedBy === 'chair' ? '（主席终审）' : '');
      html += okrCardHTML(o, {});
      html += '<div class="flex" style="margin:-6px 0 14px 0"><span class="small muted">' + hint + '</span>' +
        '<button class="btn btn-warn btn-sm" data-act="reject" data-id="' + o.id + '">✖ 主席驳回（覆盖部长意见）</button></div>';
    });
    html += '</div>';
    html += '<div class="card"><h3>🚫 已驳回（' + rejected.length + '）</h3>';
    if (!rejected.length) { html += '<div class="empty">暂无已驳回记录</div>'; }
    rejected.forEach(function (o) { html += okrCardHTML(o, {}); });
    html += '</div>';
    return html;
  };
  // 部长：审批所管辖干事的个人 OKR
  Views.approve_minister = function () {
    var me = App.user;
    var staffs = S.staffOf(me.id);
    var pend = S.db.okrs.filter(function (o) { return o.status === 'pending' && staffs.indexOf(o.ownerId) >= 0; });
    var rejected = S.db.okrs.filter(function (o) { return o.status === 'rejected' && staffs.indexOf(o.ownerId) >= 0; });
    var html = '<div class="page-head"><h2>✅ 审批中心</h2><span class="desc">审批 / 驳回 / 退回所管辖干事的 OKR；驳回时请明确修改方向，保证 KR 量化可落地</span></div>';
    html += '<div class="card"><h3>待审批（' + pend.length + '）</h3>';
    if (!pend.length) { html += '<div class="green-banner">✅ 当前没有待审批的 OKR。</div>'; }
    pend.forEach(function (o) {
      html += okrCardHTML(o, {});
      html += '<div class="flex" style="margin:-6px 0 14px 0"><button class="btn btn-primary btn-sm" data-act="approve" data-id="' + o.id + '">✔ 批准</button>' +
        '<button class="btn btn-warn btn-sm" data-act="reject" data-id="' + o.id + '">✖ 驳回（说明原因）</button></div>';
    });
    html += '</div>';
    html += '<div class="card"><h3>已驳回（' + rejected.length + '）</h3>';
    if (!rejected.length) { html += '<div class="empty">暂无已驳回记录</div>'; }
    rejected.forEach(function (o) {
      html += okrCardHTML(o, {});
      if (o.chairReviewed) {
        html += '<div class="small muted" style="margin:-6px 0 14px 0">👑 主席已复核该 OKR，以主席意见为准；请引导干事修改后重新提交</div>';
      }
    });
    html += '</div>';
    return html;
  };

  /* ---------------- 部长界面：点评管理 ---------------- */
  Views.review = function () {
    var me = App.user;
    var staffs = S.staffOf(me.id).map(S.getUser).filter(Boolean);
    var selId = App._reviewStaff || (staffs.length ? staffs[0].id : null);
    var html = '<div class="page-head"><h2>✍️ 部长专项点评</h2><span class="desc">对管辖干事的 OKR 进行定期 / 月度专项点评（点评分将计入周期到期综合得分的 25%）</span></div>';
    if (!staffs.length) { html += '<div class="card"><div class="empty">您名下暂无管辖干事</div></div>'; return html; }
    html += '<div class="card"><h3>选择干事</h3><div class="flex">' + staffs.map(function (s) {
      return '<button class="chip' + (selId === s.id ? ' active' : '') + '" data-act="review-staff" data-id="' + s.id + '">' + esc(s.name) + '</button>';
    }).join('') + '</div></div>';
    var sel = S.getUser(selId);
    if (sel) {
      var sos = S.db.okrs.filter(function (o) { return o.ownerId === sel.id; });
      html += '<div class="card"><h3>为 ' + esc(sel.name) + ' 添加点评</h3>';
      html += '<div class="field"><label>点评内容（可结合其 OKR 完成情况给出提升建议）</label><textarea id="rvText" rows="3" placeholder="如：材料初审细致、反馈及时，建议将常见问题整理成清单模板…"></textarea></div>';
      html += '<div class="field" style="max-width:220px"><label>点评分（0-100）</label><input type="number" id="rvScore" min="0" max="100" value="85"></div>';
      html += '<button class="btn btn-primary" data-act="review-add" data-staff="' + sel.id + '">提交点评</button></div>';
      html += '<div class="card"><h3>历史点评（' + sel.name + '）</h3>';
      var rvs = S.reviewsOf(sel.id);
      if (!rvs.length) { html += '<div class="empty">暂无点评记录</div>'; }
      rvs.forEach(function (r) {
        html += '<div class="flex mb8"><span class="tag tag-blue">' + r.date + '</span><span class="tag ' + (r.score >= 80 ? 'tag-green' : r.score >= 60 ? 'tag-amber' : 'tag-red') + '">' + r.score + ' 分</span><span class="small grow">' + esc(r.text) + '</span>' +
          (r.ministerId === me.id ? '<button class="btn btn-xs btn-danger" data-act="review-del" data-id="' + r.id + '">删除</button>' : '') + '</div>';
      });
      html += '</div>';
      if (sos.length) {
        html += '<div class="card"><h3>' + esc(sel.name) + ' 的 OKR 参考</h3>' + sos.map(function (o) { return okrCardHTML(o, {}); }).join('') + '</div>';
      }
    }
    return html;
  };

  /* ---------------- 部长界面：日期推进视窗 ---------------- */
  Views.windowView = function () {
    var me = App.user;
    var staffs = S.staffOf(me.id).map(S.getUser).filter(Boolean);
    var w = App._win || (function () {
      var t = S.today();
      return { from: S.addDays(t, -7), to: t };
    })();
    var html = '<div class="page-head"><h2>🪟 日期推进视窗</h2><span class="desc">根据选择的日期区间，查看干事在该周期内的阶段成果（进度快照 + 工作备注）</span></div>';
    html += '<div class="card"><h3>推进视窗区间</h3><div class="flex"><input type="date" id="winFrom" value="' + w.from + '"><span>~</span><input type="date" id="winTo" value="' + w.to + '">' +
      '<button class="btn btn-primary" data-act="win-run">查看</button><button class="btn" data-act="win-week">本周</button><button class="btn" data-act="win-month">本月</button></div></div>';
    if (!staffs.length) { html += '<div class="card"><div class="empty">您名下暂无管辖干事</div></div>'; return html; }
    var hasAny = false;
    staffs.forEach(function (s) {
      var sos = S.db.okrs.filter(function (o) { return o.ownerId === s.id; });
      var sHtml = '<div class="card"><h3>' + esc(s.name) + '（' + esc(s.studentId) + '）' + '</h3>';
      var any = false;
      sos.forEach(function (o) {
        var krBlocks = [];
        o.krs.forEach(function (k, idx) {
          var ups = (k.updates || []).filter(function (u) { return u.date >= w.from && u.date <= w.to; });
          if (ups.length) {
            any = true; hasAny = true;
            var list = ups.map(function (u) {
              return '<li>' + u.date + '　进度 <b>' + u.progress + '%</b>' + (u.note ? '　' + esc(u.note) : '') + '</li>';
            }).join('');
            krBlocks.push('<div class="mt8"><b>KR' + (idx + 1) + '</b>（' + k.weight + '%）' + esc(k.text) + '<ul>' + list + '</ul></div>');
          }
        });
        if (krBlocks.length) {
          sHtml += '<h4>🗓 ' + esc(o.period.name) + ' · ' + esc(o.objective.slice(0, 30)) + (o.objective.length > 30 ? '…' : '') + '</h4>' + krBlocks.join('');
        }
      });
      if (!any) { sHtml += '<div class="small muted">该区间内无进度更新记录</div>'; }
      sHtml += '</div>';
      html += sHtml;
    });
    if (!hasAny) { html += '<div class="card"><div class="empty">所选区间内全体干事均无更新记录</div></div>'; }
    return html;
  };

  /* ---------------- 干事界面：我的OKR ---------------- */
  Views.my = function () {
    var me = App.user;
    var okrs = S.userOKRs(me.id, App.filterRange());
    var reds = 0;
    okrs.forEach(function (o) { reds += S.okrRedKRs(o).length; });
    var html = '<div class="page-head"><h2>🎯 我的 OKR</h2><span class="desc">当前筛选：<b>' + rangeLabel() + '</b> · 填报并提交个人分岗/专项 OKR，按日期节点更新 KR 进度并填写工作备注</span></div>';
    html += '<div class="stats">' + stat(okrs.length, '我的 OKR 数') + stat(reds, '红灯 KR', 'red') +
      stat(S.reviewsOf(me.id).length, '部长点评数') + '</div>';
    html += '<div class="flex mb8"><button class="btn btn-primary" data-act="okr-new" data-type="personal">＋ 新建个人 OKR（一页纸智能助手）</button>' +
      '<span class="small muted">管线上级：<b>' + esc(ministerName(me.id)) + '</b> · 提交后将进入其审批中心</span></div>';
    if (!okrs.length) { html += '<div class="card"><div class="empty">当前筛选条件下暂无 OKR，点击上方按钮创建</div></div>'; }
    okrs.forEach(function (o) {
      var canEdit = o.status === 'draft' || o.status === 'rejected';
      var canSubmit = o.status === 'draft' || o.status === 'rejected';
      var canDel = o.status === 'draft' || o.status === 'rejected';
      var canProgress = o.status === 'approved';
      html += okrCardHTML(o, { canEdit: canEdit, canSubmit: canSubmit, canDel: canDel, canProgress: canProgress });
    });
    return html;
  };

  /* ---------------- 干事界面：个人时间轴 ---------------- */
  Views.timeline = function () {
    var me = App.user;
    var okrs = S.userOKRs(me.id, null);
    var items = [];
    okrs.forEach(function (o) {
      o.krs.forEach(function (k) {
        items.push({ o: o, k: k, days: S.diffDays(S.today(), k.deadline) });
      });
    });
    items.sort(function (a, b) { return a.days - b.days; });
    var html = '<div class="page-head"><h2>🕐 个人时间轴</h2><span class="desc">按日期清晰展示个人待办、即将到期的 KR 里程碑</span></div>';
    html += '<div class="card"><h3>KR 里程碑倒排</h3>';
    if (!items.length) { html += '<div class="empty">暂无 KR 里程碑，请先创建个人 OKR</div>'; }
    items.forEach(function (it) {
      var r = S.krRed(it.k, it.o.period);
      html += '<div class="kr-row"><div><div class="kr-text">' + esc(it.o.objective.slice(0, 24)) + (it.o.objective.length > 24 ? '…' : '') + ' → <b>KR：</b>' + esc(it.k.text) + '</div>' +
        '<div class="kr-meta">' + daysLeft(it.k.deadline) + progressBar(it.k.progress) + redTag(it.k, it.o) + '</div></div><div></div></div>';
    });
    html += '</div>';
    // 最近更新
    var ups = [];
    okrs.forEach(function (o) {
      o.krs.forEach(function (k) {
        (k.updates || []).forEach(function (u) { ups.push({ o: o, k: k, u: u }); });
      });
    });
    ups.sort(function (a, b) { return a.u.date < b.u.date ? 1 : -1; });
    html += '<div class="card"><h3>我的最近更新</h3>';
    if (!ups.length) { html += '<div class="empty">暂无更新记录，请每周固定更新 KR 进度并填写工作备注</div>'; }
    ups.slice(0, 10).forEach(function (it) {
      html += '<div class="flex mb8"><span class="tag tag-blue">' + it.u.date + '</span><span class="tag ' + (it.u.progress >= 80 ? 'tag-green' : it.u.progress >= 55 ? 'tag-blue' : 'tag-amber') + '">' + it.u.progress + '%</span><span class="small grow">' + esc(it.k.text.slice(0, 30)) + (it.k.text.length > 30 ? '…' : '') + (it.u.note ? ' — ' + esc(it.u.note) : '') + '</span></div>';
    });
    html += '</div>';
    html += '<div class="green-banner">💡 提醒：KR 进度低于预设时间进度的 55% 将自动亮红灯并通知您的部长。每周五固定更新，进度真实不注水。</div>';
    return html;
  };

  /* ---------------- 干事界面：点评与徽章 ---------------- */
  Views.stuff = function () {
    var me = App.user;
    var html = '<div class="page-head"><h2>🏅 我的点评与成长徽章</h2><span class="desc">部长点评、周期到期自动评分（加权KR进度60% + 上级点评25% + 更新留存15%）与 S/A/B/C 成长徽章</span></div>';
    // 徽章（已结算）
    var settled = S.db.okrs.filter(function (o) { return o.ownerId === me.id && o.settled; });
    html += '<div class="card"><h3>已结算周期与徽章</h3>';
    if (!settled.length) {
      html += '<div class="empty">暂无已结算周期。OKR 周期到期后系统将自动评分并颁发徽章：<br><br>' +
        '<span class="badge-medal badge-S">S</span> ≥90 卓越　<span class="badge-medal badge-A">A</span> ≥80 优秀　<span class="badge-medal badge-B">B</span> ≥70 良好　<span class="badge-medal badge-C">C</span> &lt;70 待提升</div>';
    } else {
      settled.forEach(function (o) {
        html += '<div class="flex mb8">' + badgeMedal(o.settled.badge) + '<div><b>' + o.settled.badge + '级 · 综合得分 ' + o.settled.score + ' 分</b><div class="small muted">' + esc(o.period.name) + '（' + o.period.start + ' ~ ' + o.period.end + '）</div></div>' +
          '<button class="btn btn-sm" data-act="okr-score" data-id="' + o.id + '">查看结算明细</button></div>';
      });
    }
    html += '</div>';
    // 进行中预览
    var active = S.userOKRs(me.id, null).filter(function (o) { return !o.settled && o.status !== 'draft'; });
    if (active.length) {
      html += '<div class="card"><h3>进行中 OKR 实时预估</h3><table class="grid"><tr><th>周期</th><th>加权KR进度</th><th>点评均分</th><th>更新留存率</th><th>预估得分</th></tr>';
      active.forEach(function (o) {
        var c = S.computeScore(o);
        html += '<tr><td>' + esc(o.period.name) + '</td><td>' + c.weighted + '</td><td>' + c.reviewAvg + '</td><td>' + c.retention + '%</td><td><b>' + c.score + '</b></td></tr>';
      });
      html += '</table><div class="small muted mt8">* 预估仅供参考，周期到期后按最终数据结算</div></div>';
    }
    // 点评
    var rvs = S.reviewsOf(me.id);
    html += '<div class="card"><h3>部长点评记录</h3>';
    if (!rvs.length) { html += '<div class="empty">暂无部长点评</div>'; }
    rvs.forEach(function (r) {
      html += '<div class="flex mb8"><span class="tag tag-blue">' + r.date + '</span><span class="tag ' + (r.score >= 80 ? 'tag-green' : r.score >= 60 ? 'tag-amber' : 'tag-red') + '">' + r.score + ' 分</span><span class="small grow">' + esc(r.text) + '</span></div>';
    });
    html += '</div>';
    return html;
  };

  function stat(num, label, cls) {
    return '<div class="stat"><div class="num ' + (cls || '') + '">' + num + '</div><div class="t">' + esc(label) + '</div></div>';
  }

  /* ---------------- 按角色路由 ---------------- */
  Views.board_chair = Views.board_chair;
  Views.dispatch = function (tab) {
    var map = {
      board: Views.board, red: Views.red, analysis: Views.analysis, pipeline: Views.pipeline,
      org: Views.org, calendar: Views.calendar, export: Views.exportView,
      approve: Views.approve, review: Views.review, window: Views.windowView,
      my: Views.my, timeline: Views.timeline, stuff: Views.stuff
    };
    return (map[tab] || Views.board)();
  };

  global.Views = Views;
})(typeof window !== 'undefined' ? window : globalThis);
