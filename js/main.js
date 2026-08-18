/* ============================================================
 * 科创OKR管理机制 —— 主逻辑（main.js）
 * 职责：应用状态、身份切换、导航、事件委托、一页纸智能助手
 *       弹窗、进度更新、点评、导出（Excel/PDF）、初始化。
 * 依赖：Store（store.js）、Views（views.js）
 * ============================================================ */
(function () {
  'use strict';
  var S = window.Store;
  var Views = window.Views;
  var App = {
    user: null,
    tab: 'board',
    filter: { mode: 'all' },
    _modalKind: null
  };
  window.App = App;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return S.esc(s); }

  App.toast = function (msg, type) {
    var root = $('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(function () { el.remove(); }, 420); }, 2600);
  };

  App.confirmBox = function (msg) { return window.confirm(msg); };
  App.promptBox = function (msg, def) { return window.prompt(msg, def == null ? '' : def); };

  /* ---------------- 时间筛选 ---------------- */
  App.filterRange = function () {
    var f = App.filter;
    if (!f || f.mode === 'all') return null;
    var t = S.today();
    if (f.mode === 'today') return { from: t, to: t };
    if (f.mode === 'week') {
      var dow = (S.parse(t).getDay() + 6) % 7;
      var mon = S.addDays(t, -dow);
      return { from: mon, to: S.addDays(mon, 6) };
    }
    if (f.mode === 'custom') {
      var from = $('filterFrom') ? $('filterFrom').value : '';
      var to = $('filterTo') ? $('filterTo').value : '';
      if (!from && !to) return null;
      return { from: from || null, to: to || null };
    }
    return null;
  };

  function renderFilterBar() {
    var mode = App.filter.mode;
    document.querySelectorAll('.filter-bar .chip[data-mode]').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-mode') === mode);
    });
    var hint = $('filterHint');
    var r = App.filterRange();
    if (!r) hint.textContent = '查看全部时间生效的 OKR';
    else if (r.from === r.to) hint.textContent = '当前范围：今天（' + r.from + '）';
    else hint.textContent = '当前范围：' + r.from + ' ~ ' + r.to;
  }

  /* ---------------- 渲染 ---------------- */
  function renderNav() {
    $('mainNav').innerHTML = Views.nav();
  }
  function renderView() {
    $('viewRoot').innerHTML = Views.dispatch(App.tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderAll() {
    renderUserBadge();
    renderFilterBar();
    renderNav();
    renderView();
  }
  function renderUserBadge() {
    var u = App.user;
    if (!u) return;
    var up = u.role === 'staff' ? (' · 上级：' + (S.ministerOf(u.id) ? (S.getUser(S.ministerOf(u.id)) || {}).name : '未分配')) : '';
    $('userBadge').innerHTML = '👤 <b>' + esc(u.name) + '</b>　' + esc(S.roleName(u.role)) + '　' + esc(u.deptId ? S.deptName(u.deptId) : '主席团') + up;
  }

  /* ---------------- 身份 ---------------- */
  function defaultTab(role) {
    return role === 'staff' ? 'my' : 'board';
  }
  var loginState = { role: 'chair', id: null };
  function openLogin() {
    loginState = { role: 'chair', id: null };
    var html = '<div class="modal"><div class="modal-head">🚀 科创OKR管理机制 · 密码登录</div><div class="modal-body">';
    html += '<div class="small muted">🔒 所有角色均需密码登录：主席密码由本人管理；部长/干事密码由主席在【组织管理 → 密码管理】中设置。</div>';
    html += '<div class="role-tabs">' + ['chair', 'minister', 'staff'].map(function (r) {
      return '<button class="chip" data-act="login-role" data-role="' + r + '">' + (r === 'chair' ? '👑 主席' : r === 'minister' ? '📋 部长' : '🎯 干事') + '</button>';
    }).join('') + '</div><div id="loginList"></div>';
    html += '<div id="loginPassPanel" class="hidden"><div class="field"><label id="lpInfo">输入密码</label>' +
      '<input type="password" id="lpPass" placeholder="登录密码" autocomplete="off"></div>' +
      '<div class="flex"><button class="btn btn-primary" data-act="login-enter">🔓 进入</button>' +
      '<button class="btn" data-act="login-back">← 返回</button></div>' +
      '<div class="small muted" id="lpHint"></div></div>';
    html += '</div></div>';
    $('loginOverlay').innerHTML = html;
    $('loginOverlay').classList.remove('hidden');
    renderLoginList('chair');
  }
  function renderLoginList(role) {
    loginState.role = role;
    loginState.id = null;
    var list = S.usersByRole(role);
    var box = $('loginList');
    if (!box) return;
    document.querySelectorAll('#loginOverlay .chip[data-role]').forEach(function (c) {
      c.classList.toggle('active', c.getAttribute('data-role') === role);
    });
    var panel = $('loginPassPanel');
    if (panel) panel.classList.add('hidden');
    if (!list.length) { box.innerHTML = '<div class="empty">该角色暂无成员</div>'; return; }
    box.innerHTML = '<div class="person-list">' + list.map(function (u) {
      var noPass = S.userPassSet(u) ? '' : ' · <b style="color:#dc2626">未设密码</b>';
      return '<button class="person" data-act="login-pick" data-id="' + u.id + '"><div class="pn">' + esc(u.name) + '</div><div class="pi">' + esc(u.studentId) + ' · ' + esc(u.deptId ? S.deptName(u.deptId) : '主席团') + noPass + '</div></button>';
    }).join('') + '</div>';
  }

  /* ---------------- 弹窗 ---------------- */
  function openModal(html, kind) {
    App._modalKind = kind || '';
    $('modalRoot').innerHTML = '<div class="overlay" data-act="modal-bg"><div class="modal' + (kind === 'okr' ? ' modal-lg' : '') + '" data-act="modal-box">' + html + '</div></div>';
  }
  function closeModal() {
    App._modalKind = '';
    $('modalRoot').innerHTML = '';
  }
  App.openScore = function (okrId) {
    var o = S.getOKR(okrId);
    if (!o || !o.settled) return;
    var st = o.settled;
    var rows = [
      ['加权 KR 进度（60%）', st.weighted + ' 分 × 60%', Math.round(st.weighted * 0.6)],
      ['上级点评分（25%）', st.reviewAvg + ' 分 × 25%', Math.round(st.reviewAvg * 0.25)],
      ['定期更新留存率（15%）', st.retention + ' 分 × 15%', Math.round(st.retention * 0.15)]
    ];
    var html = '<div class="modal-head">🏅 周期结算明细 <button class="x" data-act="close-modal">✕</button></div><div class="modal-body">';
    html += '<div class="flex mb8">' + (function () {
      var m = '<span class="badge-medal badge-' + st.badge + '">' + st.badge + '</span>';
      return m;
    })() + '<div><b>' + S.badgeName(st.badge) + '</b><div class="small muted">综合得分 <b>' + st.score + '</b> 分 · 结算日期 ' + st.date + '</div></div></div>';
    html += '<table class="grid"><tr><th>评分项</th><th>计算</th><th>得分</th></tr>';
    rows.forEach(function (r) { html += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><b>' + r[2] + '</b></td></tr>'; });
    html += '<tr><td><b>综合得分</b></td><td>加权KR进度60% + 上级点评25% + 更新留存15%</td><td><b>' + st.score + '</b></td></tr></table>';
    html += '<div class="tip-line mt8">徽章标准：S级 ≥90（卓越）· A级 ≥80（优秀）· B级 ≥70（良好）· C级 &lt;70（待提升）</div>';
    html += '</div><div class="modal-foot"><button class="btn" data-act="close-modal">关闭</button></div>';
    openModal(html, 'score');
  };

  /* ============ 一页纸智能助手（OKR 编辑器） ============ */
  var OE = { okrId: null, type: 'personal', mode: 'create' };

  var VAGUE = ['加强', '提升', '组织', '促进', '增强', '优化', '推动', '深化', '重视', '关注', '努力', '积极', '进一步'];
  var RESULT_WORDS = /(完成|达到|交付|通过|实现|发布|提交|覆盖|清零|达标|输出|落地|保障|合格|上线|搭建|整理|归档|汇总|回复|解决|处理|建立|建成|开展|举行|举办|培训|对接|录入|收集|审核|报送|答复|推送|辅导|演练)/;

  App.openOKREditor = function (okrId, type) {
    OE.okrId = okrId || null;
    OE.type = type || 'personal';
    var o = okrId ? S.getOKR(okrId) : null;
    var isStaff = App.user.role === 'staff';
    var headTitle = o ? '编辑 OKR' : (type === 'global' ? '设置主席团全局总目标' : type === 'dept' ? '设置部门 OKR' : '新建个人 OKR');    var html = '<div class="modal-head">📝 一页纸智能助手 · ' + headTitle + ' <button class="x" data-act="close-modal">✕</button></div>';
    html += '<div class="modal-body"><div class="assist-grid"><div>';
    html += '<div class="formula">📌 目标（O）引导句式：在 [自定义时间段/起止日期] 内，我要让 [对象] 变成 [样子] —— 一句话、有挑战性、指明方向，不罗列零散任务</div>';
    html += '<div class="field"><label>周期名称</label><input type="text" id="oePeriod" placeholder="如：创青春8.1-8.20选拔期 / 本学期 / 本月" value="' + esc(o ? o.period.name : '创青春专项选拔期') + '"></div>';
    html += '<div class="field"><label>周期起止日期</label><div class="flex"><input type="date" id="oeStart" value="' + (o ? o.period.start : '') + '"><span>~</span><input type="date" id="oeEnd" value="' + (o ? o.period.end : '') + '"></div></div>';
    html += '<div class="field"><label>目标 O</label><textarea id="oeO" rows="3" placeholder="在 [时间段] 内，我要让 [对象] 变成 [样子]">' + esc(o ? o.objective : '') + '</textarea></div>';
    html += '<div class="formula">📌 关键结果（KR）引导句式：在 [具体截止日期] 前，完成 [具体动作/内容]，达到 [定量数字] —— 2-5 条、可量化、带截止日期、体现最终成果</div>';
    html += '<div id="oeKrs"></div>';
    html += '<div class="flex"><button class="btn btn-sm" data-act="oe-addkr">＋ 添加 KR</button><span class="small muted">（自由添加，最多 10 条；权重自设，总和必须 = 100%）</span></div>';
    html += '<div class="tip-line">💬 写不出来的空，就是你还没想清楚的地方——先找部长聊十分钟。</div>';
    html += '</div><div class="check-side"><h4>🧭 右侧自查校验（未通过无法提交）</h4>';
    html += '<div class="check-item" id="oeChkO1"><span class="dot"></span><span>O 是一句话（不含句号/分号分隔多句）</span></div>';
    html += '<div class="check-item" id="oeChkO2"><span class="dot"></span><span>O 有方向（含方向词或明确对象）</span></div>';
    html += '<div class="check-item" id="oeChkO3"><span class="dot"></span><span>O 通过引导句式自查</span></div>';
    html += '<div class="check-item" id="oeChkK1"><span class="dot"></span><span>KR 数量 1-10 条（自由添加）</span></div>';
    html += '<div class="check-item" id="oeChkK2"><span class="dot"></span><span>每条 KR 含定量数字</span></div>';
    html += '<div class="check-item" id="oeChkK3"><span class="dot"></span><span>KR 像"成果"而非动作（关键词辅助判断）</span></div>';
    html += '<div class="check-item" id="oeChkK4"><span class="dot"></span><span>KR 权重加和 = 100%</span></div>';
    html += '<div class="check-item" id="oeChkK5"><span class="dot"></span><span>KR 已避免模糊动词（加强/提升/组织/促进…）</span></div>';
    html += '<div class="check-item" id="oeChkK6"><span class="dot"></span><span>KR 截止日期均晚于周期起点</span></div>';
    html += '<label class="check-item"><input type="checkbox" id="oeAckO"> <span>我已自查确认：O 一句话、方向明确</span></label>';
    html += '<label class="check-item"><input type="checkbox" id="oeAckK"> <span>我已自查确认：KR 写的是成果而非过程动作</span></label>';
    html += '<div id="oeWarn"></div></div></div></div>';
    html += '<div class="modal-foot">';
    if (isStaff) { html += '<button class="btn" data-act="oe-save-draft">保存草稿</button>'; }
    var submitLabel = isStaff ? '保存并提交审批' : (App.user.role === 'chair' ? '保存生效' : '保存并提交主席审批');
    html += '<button class="btn btn-primary" id="oeSubmitBtn" data-act="oe-save-submit">' + submitLabel + '</button>';
    html += '<button class="btn" data-act="close-modal">取消</button></div>';
    openModal(html, 'okr');
    // 初始 KR 行（可自由添加）
    var krs = o ? o.krs : [
      { text: '', weight: 100, deadline: '' }
    ];
    krs.forEach(function (k) { oeAddKrRow(k); });
    oeValidate();
  };

  function oeAddKrRow(data) {
    data = data || { text: '', weight: 10, deadline: '' };
    var idx = document.querySelectorAll('#oeKrs .kr-editor').length;
    var box = $('oeKrs');
    var div = document.createElement('div');
    div.className = 'kr-editor';
    div.innerHTML =
      '<div class="row"><b>KR ' + (idx + 1) + '</b>　权重 <input type="number" class="oeWeight" min="0" max="100" value="' + (data.weight || 0) + '" style="width:76px"> %　截止 <input type="date" class="oeDeadline" value="' + esc(data.deadline || '') + '">' +
      '<button class="btn btn-xs btn-danger" data-act="oe-delkr">✕ 删除</button></div>' +
      '<textarea class="oeKrText" rows="2" placeholder="在 [截止日期] 前，完成 [具体动作/内容]，达到 [定量数字]">' + esc(data.text || '') + '</textarea>';
    box.appendChild(div);
    oeRenumber();
  }
  function oeRenumber() {
    var rows = document.querySelectorAll('#oeKrs .kr-editor');
    rows.forEach(function (r, i) {
      r.querySelector('b').textContent = 'KR ' + (i + 1);
      var del = r.querySelector('[data-act="oe-delkr"]');
      if (del) del.style.visibility = rows.length > 1 ? 'visible' : 'hidden';
    });
  }

  function oeValidate() {
    if (App._modalKind !== 'okr') return;
    var oText = $('oeO') ? $('oeO').value : '';
    var rows = document.querySelectorAll('#oeKrs .kr-editor');
    var pass = { O1: false, O2: false, K1: false, K2: true, K3: true, K4: false, K5: true, K6: true };
    var warns = [];
    // O 校验
    pass.O1 = oText.trim().length > 0 && !/[。；;]/.test(oText);
    pass.O2 = /(让|使|实现|达成|完成|建设|打造|建成|保障|构建|搭建|成为|提升|达到|建立)/.test(oText) || /让\s*\S+\s*(变成|成为|实现|达成)/.test(oText);
    // KR 校验
    pass.K1 = rows.length >= 1 && rows.length <= 10;
    var wSum = 0, badDeadline = false, anyNoDigit = false, anyNoResult = false, anyVague = false, vagueWords = [];
    rows.forEach(function (r) {
      var t = r.querySelector('.oeKrText').value;
      var w = parseFloat(r.querySelector('.oeWeight').value) || 0;
      var d = r.querySelector('.oeDeadline').value;
      wSum += w;
      if (!/\d/.test(t)) anyNoDigit = true;
      if (t && !RESULT_WORDS.test(t)) anyNoResult = true;
      VAGUE.forEach(function (v) { if (t.indexOf(v) >= 0 && vagueWords.indexOf(v) < 0) vagueWords.push(v); });
      if (vagueWords.length) anyVague = true;
      var start = $('oeStart').value;
      if (d && start && d < start) badDeadline = true;
    });
    pass.K2 = !anyNoDigit;
    pass.K3 = !anyNoResult;
    pass.K4 = Math.abs(wSum - 100) < 0.001;
    pass.K5 = !anyVague;
    pass.K6 = !badDeadline;
    if (anyNoResult) warns.push('部分 KR 未识别到"成果类"关键词，请确认写的是最终成果而非过程动作');
    if (anyVague) warns.push('检测到模糊动词：' + vagueWords.join('、') + ' —— 建议替换为可量化表达（如"完成X份/达到X%"）');
    if (badDeadline) warns.push('存在早于周期起点的 KR 截止日期');
    // 勾选
    var ackO = $('oeAckO') ? $('oeAckO').checked : false;
    var ackK = $('oeAckK') ? $('oeAckK').checked : false;
    // 渲染
    function setChk(id, ok) {
      var el = $(id);
      if (!el) return;
      el.classList.remove('pass', 'fail', 'warn');
      el.classList.add(ok ? 'pass' : 'fail');
    }
    setChk('oeChkO1', pass.O1); setChk('oeChkO2', pass.O2);
    setChk('oeChkK1', pass.K1); setChk('oeChkK2', pass.K2);
    setChk('oeChkK3', pass.K3); setChk('oeChkK4', pass.K4);
    setChk('oeChkK5', pass.K5); setChk('oeChkK6', pass.K6);
    ['oeChkO3', 'oeChkK5'].forEach(function (id) {});
    var warnBox = $('oeWarn');
    if (warnBox) {
      warnBox.innerHTML = warns.length ? '<div class="vague-words mt8">⚠ ' + warns.join('<br>⚠ ') + '</div>' : '';
    }
    var weightEl = document.querySelector('#oeKrs .row b');
    // 权重条
    var wt = document.getElementById('oeWeightSum');
    if (!wt) {
      var rowsBox = $('oeKrs');
      if (rowsBox && !rowsBox.parentNode.querySelector('.weight-sum')) {
        var el = document.createElement('div');
        el.id = 'oeWeightSum';
        el.className = 'weight-sum small mt8';
        el.innerHTML = '权重合计：<span id="oeWeightVal"></span>';
        rowsBox.insertAdjacentElement('afterend', el);
      }
      wt = document.getElementById('oeWeightSum');
    }
    if (wt) {
      var val = document.getElementById('oeWeightVal');
      val.textContent = wSum + '%';
      wt.className = 'weight-sum small mt8 ' + (Math.abs(wSum - 100) < 0.001 ? 'ok' : 'bad');
      if (Math.abs(wSum - 100) >= 0.001) val.textContent += wSum > 100 ? '（超额，请调低）' : '（未满，请补足）';
    }
    // 提交按钮
    var btn = $('oeSubmitBtn');
    if (btn) {
      var ready = pass.O1 && pass.O2 && pass.K1 && pass.K2 && pass.K4 && pass.K6 && ackO && ackK &&
        $('oePeriod').value.trim() && $('oeStart').value && $('oeEnd').value && oText.trim();
      btn.disabled = !ready;
      btn.title = ready ? '' : '请完成全部必过项：周期、O一句话且有方向、KR数量1-10条、每条含数字、权重合计=100%、KR截止晚于起点、勾选两项自查确认';
    }
  }

  function oeCollect() {
    var rows = [];
    document.querySelectorAll('#oeKrs .kr-editor').forEach(function (r) {
      rows.push({
        text: r.querySelector('.oeKrText').value.trim(),
        weight: parseFloat(r.querySelector('.oeWeight').value) || 0,
        deadline: r.querySelector('.oeDeadline').value
      });
    });
    return {
      period: { name: $('oePeriod').value.trim(), start: $('oeStart').value, end: $('oeEnd').value },
      objective: $('oeO').value.trim(),
      krs: rows
    };
  }

  function oeSave(submit) {
    var d = oeCollect();
    var isStaff = App.user.role === 'staff';
    var o = OE.okrId ? S.getOKR(OE.okrId) : null;
    var newStatus;
    if (isStaff) {
      newStatus = submit ? 'pending' : (o && o.status === 'rejected' ? 'rejected' : 'draft');
    } else if (App.user.role === 'chair') {
      newStatus = 'approved'; // 主席总目标直接生效
    } else {
      newStatus = 'pending';  // 部长部门OKR：提交后需主席审批
    }
    if (!o) {
      o = {
        id: S.uid('okr'), ownerId: App.user.id, type: OE.type,
        deptId: App.user.role === 'staff' || OE.type === 'dept' ? App.user.deptId : null,
        status: newStatus,
        krs: []
      };
    } else {
      o.status = newStatus;
      if (newStatus === 'pending') { o.rejectReason = ''; o.chairReviewed = false; o.approvedBy = null; }
    }
    o.period = d.period;
    o.objective = d.objective;
    // 保留已有 KR 的更新记录
    var newKrs = d.krs.map(function (k, i) {
      var old = o.krs[i];
      if (old && old.id) { old.text = k.text; old.weight = k.weight; old.deadline = k.deadline; return old; }
      return { id: S.uid('kr'), text: k.text, weight: k.weight, deadline: k.deadline, progress: 0, updates: [] };
    });
    o.krs = newKrs;
    S.saveOKR(o);
    closeModal();
    var msg = '已保存';
    if (isStaff) msg = submit ? '已提交审批，请等待部长审批' : '已保存草稿';
    else if (App.user.role === 'chair') msg = '已保存生效';
    else msg = '已提交部门OKR，请等待主席审批';
    App.toast(msg, 'ok');
    renderView();
  }

  /* ---------------- 进度更新弹窗 ---------------- */
  App.openProgress = function (okrId, krId) {
    var o = S.getOKR(okrId);
    if (!o) return;
    var kr = o.krs.find(function (k) { return k.id === krId; });
    if (!kr) return;
    var idx = o.krs.indexOf(kr) + 1;
    var html = '<div class="modal-head">📈 更新 KR 进度 <button class="x" data-act="close-modal">✕</button></div>';
    html += '<div class="modal-body">';
    html += '<div class="small muted mb8">' + esc(o.objective.slice(0, 40)) + (o.objective.length > 40 ? '…' : '') + '</div>';
    html += '<div class="field"><label>KR' + idx + '（权重 ' + kr.weight + '%）：' + esc(kr.text) + '</label></div>';
    html += '<div class="field"><label>当前进度 %（0-100，真实不注水）</label><input type="number" id="prgVal" min="0" max="100" value="' + (kr.progress || 0) + '"></div>';
    html += '<div class="field"><label>工作备注（含材料提交情况，如"已提交X份材料/已对接X团队"）</label><textarea id="prgNote" rows="3" placeholder="本周进展、卡点问题、材料提交情况…"></textarea></div>';
    html += '<div class="tip-line">💡 每周固定更新（建议周五），进度低于预设时间进度的 55% 将自动亮红灯并通知部长。</div>';
    html += '</div><div class="modal-foot"><button class="btn btn-primary" data-act="prg-save" data-id="' + o.id + '" data-kr="' + kr.id + '">保存更新</button><button class="btn" data-act="close-modal">取消</button></div>';
    openModal(html, 'progress');
  };

  /* ---------------- 成员编辑弹窗 ---------------- */
  App.openUserModal = function (userId) {
    var u = userId ? S.getUser(userId) : null;
    var isChair = u && u.role === 'chair';
    var html = '<div class="modal-head">' + (u ? '编辑成员：' + esc(u.name) : '新增成员') + ' <button class="x" data-act="close-modal">✕</button></div>';
    html += '<div class="modal-body"><div class="mini-form">';
    html += '<div class="field"><label>姓名 *</label><input type="text" id="umName" value="' + esc(u ? u.name : '') + '"></div>';
    html += '<div class="field"><label>学号/工号</label><input type="text" id="umSid" value="' + esc(u ? u.studentId : '') + '"></div>';
    html += '<div class="field"><label>角色</label><select id="umRole"' + (isChair ? ' disabled' : '') + '>' +
      '<option value="staff"' + (u && u.role === 'staff' ? ' selected' : '') + '>干事</option>' +
      '<option value="minister"' + (u && u.role === 'minister' ? ' selected' : '') + '>部长</option>' +
      (u && u.role === 'chair' ? '<option value="chair" selected>主席（锁定）</option>' : '') +
      '</select>' + (isChair ? '<div class="small muted">主席角色系统锁定，不可变更</div>' : '') + '</div>';
    html += '<div class="field"><label>所属部门</label><select id="umDept"><option value="">主席团（无部门）</option>' +
      S.db.departments.map(function (d) { return '<option value="' + d.id + '"' + (u && u.deptId === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select></div>';
    html += '</div></div>';
    html += '<div class="modal-foot"><button class="btn btn-primary" data-act="user-save" data-id="' + (u ? u.id : '') + '">保存</button><button class="btn" data-act="close-modal">取消</button></div>';
    openModal(html, 'user');
  };

  /* ---------------- 导出 ---------------- */
  function exportFilter() {
    return {
      deptId: $('expDept') ? $('expDept').value || null : null,
      from: $('expFrom') ? $('expFrom').value || null : null,
      to: $('expTo') ? $('expTo').value || null : null
    };
  }
  function doExportExcel() {
    var f = exportFilter();
    var html = S.exportExcel(f);
    var blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = S.exportFilename(f) + '.xls';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    App.toast('Excel 已导出：' + a.download, 'ok');
  }
  function doExportPdf() {
    var f = exportFilter();
    $('printArea').innerHTML = S.exportPrintHTML(f);
    window.print();
  }

  /* ---------------- 全局事件委托 ---------------- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    switch (act) {
      /* 弹窗基础 */
      case 'close-modal': closeModal(); break;
      case 'modal-bg':
        if (e.target === el) closeModal();
        break;
      case 'modal-box': break;

      /* 身份（密码登录） */
      case 'switch-user': openLogin(); break;
      case 'login-role': renderLoginList(el.getAttribute('data-role')); break;
      case 'login-pick': {
        loginState.id = id;
        var lu = S.getUser(id);
        $('lpInfo').textContent = '请输入「' + (lu ? lu.name : '') + '」的登录密码';
        $('lpHint').textContent = S.userPassSet(lu) ? '提示：初始密码请联系主席确认' : '该成员尚未设置密码，请联系主席设置';
        $('loginPassPanel').classList.remove('hidden');
        var lp = $('lpPass');
        lp.value = '';
        setTimeout(function () { if ($('lpPass')) $('lpPass').focus(); }, 30);
        break;
      }
      case 'login-back':
        $('loginPassPanel').classList.add('hidden');
        break;
      case 'login-enter': {
        var pass = $('lpPass').value;
        if (!pass) { App.toast('请输入密码', 'err'); break; }
        S.login(loginState.id, pass).then(function (res) {
          if (res.ok) {
            App._pass = pass;
            App.user = res.user;
            App.tab = defaultTab(App.user.role);
            closeModal();
            $('loginOverlay').classList.add('hidden');
            renderAll();
            App.toast('欢迎，' + App.user.name + '！', 'ok');
          } else {
            App.toast(res.msg, 'err');
          }
        });
        break;
      }
      case 'set-pass': {
        var tu = S.getUser(id);
        if (!tu) break;
        var np = App.promptBox('为「' + tu.name + '」设置新密码（4-32 位）：', '');
        if (np === null) break;
        np = String(np).trim();
        if (np.length < 4) { App.toast('密码至少 4 位', 'err'); break; }
        S.setPass(id, np).then(function (r) {
          if (r.ok) { App.toast('「' + tu.name + '」的密码已更新', 'ok'); renderView(); }
          else { App.toast(r.msg, 'err'); }
        });
        break;
      }

      /* 导航 & 筛选 */
      case 'set-tab':
        App.tab = el.getAttribute('data-tab');
        renderNav(); renderView();
        break;
      case 'filter':
        App.filter = { mode: el.getAttribute('data-mode') };
        renderFilterBar(); renderView();
        break;
      case 'filter-apply':
        App.filter = { mode: 'custom' };
        renderFilterBar(); renderView();
        break;

      /* OKR */
      case 'okr-new': App.openOKREditor(null, el.getAttribute('data-type')); break;
      case 'okr-edit': App.openOKREditor(id); break;
      case 'okr-submit':
        if (S.submitOKR(id).ok) { App.toast('已提交审批，等待部长审批', 'ok'); renderView(); }
        break;
      case 'okr-del':
        if (App.confirmBox('确定删除该 OKR？删除后不可恢复。')) { S.delOKR(id); App.toast('已删除'); renderView(); }
        break;
      case 'okr-progress': App.openProgress(id, el.getAttribute('data-kr')); break;
      case 'okr-score': App.openScore(id); break;

      /* 一页纸助手 */
      case 'oe-addkr':
        if (document.querySelectorAll('#oeKrs .kr-editor').length >= 10) { App.toast('KR 最多 10 条'); break; }
        oeAddKrRow(); oeValidate();
        break;
      case 'oe-delkr':
        if (document.querySelectorAll('#oeKrs .kr-editor').length <= 1) { App.toast('至少保留 1 条 KR'); break; }
        el.closest('.kr-editor').remove(); oeRenumber(); oeValidate();
        break;
      case 'oe-save-draft': oeSave(false); break;
      case 'oe-save-submit': oeSave(true); break;

      /* 进度更新 */
      case 'prg-save': {
        var v = parseFloat($('prgVal').value) || 0;
        var n = $('prgNote').value;
        if (v < 0 || v > 100) { App.toast('进度需在 0-100 之间', 'err'); break; }
        S.addUpdate(id, el.getAttribute('data-kr'), v, n);
        closeModal();
        App.toast('进度已更新' + (S.krRed(S.getOKR(id).krs.find(function (k) { return k.id === el.getAttribute('data-kr'); }), S.getOKR(id).period).red ? '，⚠ 该 KR 已亮红灯' : ''), 'ok');
        renderView();
        break;
      }

      /* 审批（主席审批为主：主席终审优先于部长） */
      case 'approve': {
        var isChair = App.user.role === 'chair';
        if (!App.confirmBox('批准该 OKR？' + (isChair ? '（主席终审，优先于部长意见）' : '批准后干事即可开始按节点更新进度。'))) break;
        var ar = S.approveOKR(id, isChair ? 'chair' : 'minister');
        if (ar && !ar.ok) { App.toast(ar.msg, 'err'); break; }
        App.toast(isChair ? '已批准（主席终审）' : '已批准', 'ok');
        renderView();
        break;
      }
      case 'reject': {
        var reason = App.promptBox('驳回原因（请明确修改方向，保证 KR 量化可落地）：');
        if (reason === null) break;
        if (!reason.trim()) { App.toast('请填写驳回原因', 'err'); break; }
        var rr = S.rejectOKR(id, reason.trim(), App.user.role === 'chair' ? 'chair' : 'minister');
        if (rr && !rr.ok) { App.toast(rr.msg, 'err'); break; }
        App.toast('已驳回：' + reason.trim());
        renderView();
        break;
      }

      /* 点评 */
      case 'review-staff': App._reviewStaff = id; renderView(); break;
      case 'review-add': {
        var text = $('rvText').value;
        var score = parseFloat($('rvScore').value) || 0;
        var r = S.addReview(el.getAttribute('data-staff'), App.user.id, text, score);
        if (!r.ok) { App.toast(r.msg, 'err'); break; }
        App.toast('点评已提交', 'ok'); renderView();
        break;
      }
      case 'review-del':
        if (App.confirmBox('删除这条点评？')) { S.delReview(id); renderView(); }
        break;

      /* 日历 */
      case 'cal-prev':
        App._cal = { y: App._cal.y, m: App._cal.m - 1, sel: App._cal.sel };
        if (App._cal.m < 0) { App._cal.m = 11; App._cal.y--; }
        renderView(); break;
      case 'cal-next':
        App._cal = { y: App._cal.y, m: App._cal.m + 1, sel: App._cal.sel };
        if (App._cal.m > 11) { App._cal.m = 0; App._cal.y++; }
        renderView(); break;
      case 'cal-today': {
        var t = new Date();
        App._cal = { y: t.getFullYear(), m: t.getMonth(), sel: S.today() };
        renderView(); break;
      }
      case 'cal-day': App._cal.sel = el.getAttribute('data-date'); renderView(); break;
      case 'mil-add': {
        var date = $('milDate').value, title = $('milTitle').value;
        var r = S.addMilestone(title, date);
        if (!r.ok) { App.toast(r.msg, 'err'); break; }
        App.toast('里程碑已添加', 'ok'); renderView();
        break;
      }
      case 'mil-del':
        if (App.confirmBox('删除该关键节点？')) { S.delMilestone(id); renderView(); }
        break;

      /* 组织管理 */
      case 'dept-add': {
        var n = App.promptBox('新部门名称：', '');
        if (n === null) break;
        if (!n.trim()) { App.toast('名称不能为空', 'err'); break; }
        S.addDept(n); App.toast('部门已添加', 'ok'); renderView();
        break;
      }
      case 'dept-rename': {
        var d = S.getDept(id);
        if (!d) break;
        var nn = App.promptBox('重命名部门：', d.name);
        if (nn === null || !nn.trim()) break;
        S.renameDept(id, nn); App.toast('已重命名', 'ok'); renderView();
        break;
      }
      case 'dept-del':
        if (App.confirmBox('删除该部门？其成员将变为"未分配"（OKR 数据保留）。')) { S.delDept(id); App.toast('部门已删除'); renderView(); }
        break;
      case 'dept-move': S.moveDept(id, parseInt(el.getAttribute('data-dir'), 10)); renderView(); break;
      case 'user-add': App.openUserModal(null); break;
      case 'user-edit': App.openUserModal(id); break;
      case 'user-del':
        if (App.confirmBox('删除该成员？其 OKR 数据将保留但显示为"成员已移除"。')) {
          var rr = S.delUser(id);
          if (!rr.ok) { App.toast(rr.msg, 'err'); break; }
          App.toast('成员已删除'); renderView();
        }
        break;
      case 'user-save': {
        var name = $('umName').value;
        var sid = $('umSid').value;
        var roleEl = $('umRole');
        var role = roleEl.disabled ? 'chair' : roleEl.value;
        var deptId = $('umDept').value || null;
        var res = id ? S.updateUser(id, { name: name, studentId: sid, role: role, deptId: deptId }) : S.addUser({ name: name, studentId: sid, role: role, deptId: deptId });
        if (!res.ok) { App.toast(res.msg, 'err'); break; }
        App.toast('成员信息已保存', 'ok'); closeModal(); renderAll();
        break;
      }

      /* 管线 */
      case 'pipe-save': {
        var map = {};
        document.querySelectorAll('[data-pipe-min]').forEach(function (c) {
          if (c.checked) {
            var m = c.getAttribute('data-pipe-min');
            (map[m] = map[m] || []).push(c.getAttribute('data-pipe-staff'));
          }
        });
        S.pipelineSave(map);
        App.toast('管线配置已保存', 'ok');
        renderView();
        break;
      }

      /* 分析 */
      case 'ana-run':
        App._ana = { from: $('anaFrom').value, to: $('anaTo').value };
        if (!App._ana.from || !App._ana.to) { App.toast('请选择完整区间', 'err'); break; }
        renderView(); break;
      case 'ana-month': {
        var t1 = S.today();
        App._ana = { from: t1.slice(0, 8) + '01', to: t1 };
        renderView(); break;
      }
      case 'ana-sem': {
        var y = new Date().getFullYear();
        var m = new Date().getMonth() + 1;
        App._ana = m >= 8 ? { from: y + '-08-01', to: (y + 1) + '-01-31' } : { from: y + '-02-01', to: y + '-07-31' };
        renderView(); break;
      }

      /* 推进视窗 */
      case 'win-run':
        App._win = { from: $('winFrom').value, to: $('winTo').value };
        if (!App._win.from || !App._win.to) { App.toast('请选择完整区间', 'err'); break; }
        renderView(); break;
      case 'win-week': {
        var tw = S.today();
        var dw = (S.parse(tw).getDay() + 6) % 7;
        var mw = S.addDays(tw, -dw);
        App._win = { from: mw, to: S.addDays(mw, 6) };
        renderView(); break;
      }
      case 'win-month': {
        var tm = S.today();
        App._win = { from: tm.slice(0, 8) + '01', to: tm };
        renderView(); break;
      }

      /* 导出 */
      case 'export-excel': doExportExcel(); break;
      case 'export-pdf': doExportPdf(); break;
    }
  });

  /* 编辑器实时校验 */
  document.addEventListener('input', function (e) {
    if (App._modalKind === 'okr' && e.target.closest('#oeKrs, #oeO, #oePeriod, #oeStart, #oeEnd')) {
      oeValidate();
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches && t.matches('[data-act="board-dept"]')) { App._boardDept = t.value; renderView(); return; }
    if (t.matches && t.matches('[data-act="board-status"]')) { App._boardStatus = t.value; renderView(); return; }
    if (App._modalKind === 'okr' && (t.id === 'oeAckO' || t.id === 'oeAckK')) {
      oeValidate();
    }
    if (App._modalKind === 'okr' && t.closest('#oeKrs')) {
      oeValidate();
    }
  });

  /* ---------------- 实时同步 ---------------- */
  var syncFlashTimer = null;
  function flashSync() {
    var el = $('syncStatus');
    if (!el) return;
    el.classList.add('flash');
    clearTimeout(syncFlashTimer);
    syncFlashTimer = setTimeout(function () { el.classList.remove('flash'); }, 900);
  }
  // 在线状态变化（共享服务器连接/断开/人数变化）
  function onSyncStatus(st) {
    var el = $('syncStatus');
    if (!el) return;
    if (st.online) {
      el.className = 'sync-status online';
      el.innerHTML = st.mode === 'cloud' ? '● 云端在线 · 实时同步' : ('● 共享服务器在线 · ' + st.count + ' 人在线');
    } else {
      el.className = 'sync-status offline';
      el.innerHTML = '⚠ 单机模式' + (st.msg ? '（' + st.msg + '）' : '');
    }
  }
  // 他人更改已同步到本地
  function onRemoteSync() {
    var u = App.user;
    if (u && !S.getUser(u.id)) {
      App.user = null; // 当前账号已被主席删除
      openLogin();
      return;
    }
    if (!u) {
      if (!$('loginOverlay').classList.contains('hidden') && $('loginList')) {
        renderLoginList(loginState.role); // 刷新登录人员列表
      }
      return;
    }
    if (App._modalKind) { flashSync(); return; } // 弹窗编辑中：数据已应用，不打断操作
    renderAll();
    flashSync();
  }

  /* ---------------- 初始化 ---------------- */
  function boot() {
    S.setRemoteListener(onRemoteSync);
    S.setStatusListener(onSyncStatus);
    S.init().then(function () {
      renderFilterBar();
      openLogin();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
