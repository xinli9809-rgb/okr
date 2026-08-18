/* ============================================================
 * 科创OKR管理机制 —— 数据层（store.js）
 * 职责：
 *   1) 种子数据（竞赛部组织架构 + 空 OKR，密码字段）
 *   2) 共享服务器同步：在线模式通过 /api/* 与 SSE 实时同步；
 *      离线模式回退 localStorage / 内存（单机使用）。
 *   3) 部门/人员/管线管理、OKR 增删改查、红灯预警、
 *      评分徽章、导出数据生成。
 * 依赖：无（可独立在 Node 中做逻辑测试）。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'kc_okr_db_v1';
  var mem = {}; // Node 环境下的内存后备存储
  var S = {};

  /* ---------------- 基础工具 ---------------- */
  S.uid = function (p) {
    return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };
  S.pad = function (n) { return String(n).padStart(2, '0'); };
  S.fmt = function (d) {
    var x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + S.pad(x.getMonth() + 1) + '-' + S.pad(x.getDate());
  };
  S.today = function () { return S.fmt(new Date()); };
  S.parse = function (s) {
    var p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  S.addDays = function (dateStr, n) {
    var d = S.parse(dateStr);
    d.setDate(d.getDate() + n);
    return S.fmt(d);
  };
  S.diffDays = function (a, b) { return Math.round((S.parse(b) - S.parse(a)) / 86400000); };
  S.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  S.weeksBetween = function (a, b) { return Math.max(1, Math.ceil(S.diffDays(a, b) / 7)); };
  S.round1 = function (v) { return Math.round(v * 10) / 10; };
  S.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  S.roleName = function (r) {
    return { chair: '主席', minister: '部长', staff: '干事' }[r] || r;
  };
  S.statusName = function (st) {
    return { draft: '草稿', pending: '待审批', approved: '已批准', rejected: '已驳回', settled: '已结算' }[st] || st;
  };

  /* ---------------- SHA-256（纯JS实现，浏览器/Node通用） ---------------- */
  // 云端模式密码以哈希存储，不保存明文；localStorage 离线模式仍用明文（仅本机）
  S.sha256 = function (ascii) {
    function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var result = '';
    var words = [];
    var i, j;
    var asciiBitLength = ascii.length * 8;
    var hash = S.sha256.h = S.sha256.h || [];
    var k = S.sha256.k = S.sha256.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return ''; // 仅支持 ASCII（中文请先 unescape(encodeURIComponent())）
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  };
  S.hashPass = function (pass) { return S.sha256(unescape(encodeURIComponent(String(pass == null ? '' : pass)))); };

  /* ---------------- 种子数据（竞赛部组织架构，OKR 为空） ---------------- */
  function mkUser(id, name, studentId, role, deptId, pass) {
    return { id: id, name: name, studentId: studentId, role: role, deptId: deptId, pass: pass, passHash: pass ? S.hashPass(pass) : '', passSet: !!pass };
  }
  function seed() {
    var t = S.today();
    var start = S.addDays(t, -12);   // 供里程碑示例使用
    var db = {
      version: 2,
      departments: [{ id: 'dept_js', name: '竞赛部' }],
      users: [
        mkUser('u_chair', '王主席', '20210001', 'chair', 'dept_js', '070223'),
        mkUser('u_li', '李部长', '20210002', 'minister', 'dept_js', '123456'),
        mkUser('u_chen', '陈部长', '20210003', 'minister', 'dept_js', '123456'),
        mkUser('u_lin', '小林', '20230001', 'staff', 'dept_js', '123456'),
        mkUser('u_zhang', '小张', '20230002', 'staff', 'dept_js', '123456'),
        mkUser('u_liu', '小刘', '20230003', 'staff', 'dept_js', '123456'),
        mkUser('u_zhou', '小周', '20230004', 'staff', 'dept_js', '123456')
      ],
      pipeline: { u_li: ['u_lin', 'u_zhang'], u_chen: ['u_liu', 'u_zhou'] },
      milestones: [
        { id: 'ms1', title: '创青春·校内材料收集截止', date: S.addDays(start, 7) },
        { id: 'ms2', title: '创青春·市级材料报送', date: S.addDays(start, 9) },
        { id: 'ms3', title: '创青春·官网报名截止', date: S.addDays(start, 19) },
        { id: 'ms4', title: '校级选拔赛', date: S.addDays(start, 44) }
      ],
      okrs: [],      // ★ 按需求：当前所有 OKR 为空，由各部门/干事自行创建
      reviews: []    // 点评记录为空
    };
    return db;
  }

  /* ---------------- 本地存取（离线回退） ---------------- */
  function loadLocal() {
    try {
      var raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KEY) : mem[KEY];
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function persistLocal() {
    try {
      var raw = JSON.stringify(S.db);
      if (typeof localStorage !== 'undefined') { localStorage.setItem(KEY, raw); } else { mem[KEY] = raw; }
    } catch (e) { /* 静默：无权限存储时仅内存运行 */ }
  }

  /* ---------------- 同步层（三种模式自动切换） ----------------
   * cloud : 配置了 firebase-config.js（window.__OKR_FIREBASE__）→ 直连 Firebase 实时数据库，
   *         数据在云端，任何成员电脑开关机互不影响；
   * server: 本机 node server.js → /api/* + SSE；
   * local : 浏览器 localStorage（单机离线兜底）。
   * ---------------------------------------------------------- */
  S._online = false;
  S._mode = 'local';   // 'cloud' | 'server' | 'local'
  S._sse = null;
  S._streamCtrl = null;
  S._remoteCb = null;   // 收到远端数据库更新
  S._statusCb = null;   // 在线状态/人数变化

  function cloudURL() {
    if (typeof window !== 'undefined' && window.__OKR_FIREBASE__ && window.__OKR_FIREBASE__.databaseURL) {
      return String(window.__OKR_FIREBASE__.databaseURL).replace(/\/+$/, '');
    }
    return null;
  }
  function serverMode() {
    return typeof window !== 'undefined' && window.location && window.location.protocol !== 'file:';
  }
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms || 8000);
      promise.then(function (v) { if (!done) { done = true; clearTimeout(t); resolve(v); } }, function (e) { if (!done) { done = true; clearTimeout(t); reject(e); } });
    });
  }
  // 云端数据库脱敏：不保存明文密码，仅保存哈希
  function toCloudDB(d) {
    var users = (d.users || []).map(function (u) {
      var copy = {};
      Object.keys(u).forEach(function (k) { if (k !== 'pass') copy[k] = u[k]; });
      if (!copy.passHash && u.pass) copy.passHash = S.hashPass(u.pass);
      copy.passSet = !!copy.passHash;
      return copy;
    });
    return Object.assign({}, d, { users: users });
  }
  // 兼容处理：若数据被意外包了一层 {db:...}，自动解开（自愈）
  function unwrapDB(data) {
    if (data && data.db && !Array.isArray(data.users) && Array.isArray(data.db.users)) {
      return data.db;
    }
    return data;
  }
  // 数据规范化：Firebase 会剥离空数组/空对象字段，这里补齐默认值，防止缺字段崩溃
  function normalizeDB() {
    if (!S.db) return;
    S.db.departments = Array.isArray(S.db.departments) ? S.db.departments : [];
    S.db.users = Array.isArray(S.db.users) ? S.db.users : [];
    S.db.pipeline = S.db.pipeline || {};
    S.db.milestones = Array.isArray(S.db.milestones) ? S.db.milestones : [];
    S.db.okrs = Array.isArray(S.db.okrs) ? S.db.okrs : [];
    S.db.reviews = Array.isArray(S.db.reviews) ? S.db.reviews : [];
  }

  S.setRemoteListener = function (cb) { S._remoteCb = cb; };
  S.setStatusListener = function (cb) { S._statusCb = cb; };
  S.isOnline = function () { return S._online; };

  S.init = function (reset) {
    return new Promise(function (resolve) {
      if (reset) { S.db = seed(); S.finalize(); resolve(S.db); return; }
      var cu = cloudURL();
      if (cu) {
        // ---------- 云端模式（Firebase 实时数据库） ----------
        withTimeout(fetch(cu + '/db.json', { method: 'GET' }), 12000).then(function (r) { return r.json(); }).then(function (data) {
          S._mode = 'cloud'; // 先切换模式，随后的 save() 才会写云端
          data = unwrapDB(data);
          if (data && Array.isArray(data.users) && data.users.length) {
            S.db = data;
          } else {
            S.db = seed();
            S.save(); // 云端为空 → 初始化种子数据
          }
          normalizeDB();
          S._online = true;
          if (S.finalize()) S.save();
          if (S._statusCb) S._statusCb({ online: true, count: 1, mode: 'cloud' });
          S._connectCloudStream();
          resolve(S.db);
        }).catch(function () { fallbackInit(resolve, '云端连接失败，已切换单机模式'); });
      } else if (serverMode()) {
        // ---------- 本机服务器模式 ----------
        withTimeout(fetch('/api/db', { method: 'GET' }), 6000).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.db && Array.isArray(res.db.users)) {
            S.db = res.db;
            normalizeDB();
            S._online = true;
            S._mode = 'server';
            if (S.finalize()) S.save();
            S._connectSSE();
            resolve(S.db);
            return;
          }
          fallbackInit(resolve, '');
        }).catch(function () { fallbackInit(resolve, ''); });
      } else {
        fallbackInit(resolve, '');
      }
    });
  };
  function fallbackInit(resolve, msg) {
    var db = loadLocal();
    if (!db || !Array.isArray(db.users) || !db.users.length) { db = seed(); }
    S.db = db;
    normalizeDB();
    S.finalize();
    persistLocal();
    if (msg && S._statusCb) S._statusCb({ online: false, count: 0, msg: msg });
    resolve(S.db);
  }
  // 重置为初始种子数据（可用于演示初始化）
  S.reset = function () {
    S.db = seed();
    S.finalize();
    S.save();
    return S.db;
  };

  S.save = function () {
    if (S._mode === 'cloud') {
      var cu = cloudURL();
      if (!cu) { persistLocal(); return; }
      try {
        fetch(cu + '/db.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toCloudDB(S.db))
        }).then(function (r) {
          if (!r.ok) goOffline('云端保存失败，已切换单机模式');
        }).catch(function () { goOffline('云端连接中断，已切换单机模式'); });
      } catch (e) { goOffline('云端同步异常，已切换单机模式'); }
    } else if (S._mode === 'server') {
      try {
        fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ db: S.db })
        }).then(function (r) {
          if (!r.ok) goOffline('服务器同步失败，已切换单机模式');
        }).catch(function () { goOffline('服务器连接中断，已切换单机模式'); });
      } catch (e) { goOffline('同步异常，已切换单机模式'); }
    } else {
      persistLocal();
    }
  };
  function goOffline(msg) {
    if (!S._online) return;
    S._online = false;
    try { if (S._sse) S._sse.close(); } catch (e) {}
    S._sse = null;
    try { if (S._streamCtrl) S._streamCtrl.abort(); } catch (e) {}
    S._streamCtrl = null;
    persistLocal();
    if (S._statusCb) S._statusCb({ online: false, count: 0, msg: msg });
  }

  /* ---------- 云端实时流（Firebase REST 流式推送） ---------- */
  S._connectCloudStream = function () {
    var cu = cloudURL();
    if (!cu || typeof fetch === 'undefined' || !fetch) return;
    if (S._streamCtrl) return;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    S._streamCtrl = ctrl;
    var closed = false;
    function onEnd() {
      if (closed) return;
      closed = true;
      S._streamCtrl = null;
      if (S._mode === 'cloud' && S._online) {
        setTimeout(function () { S._connectCloudStream(); }, 5000); // 断流自动重连
      }
    }
    fetch(cu + '/db.json', { headers: { 'Accept': 'text/event-stream' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok || !res.body) { onEnd(); return; }
        var reader = res.body.getReader();
        var decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
        var buf = '';
        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) { onEnd(); return; }
            if (decoder) {
              buf += decoder.decode(chunk.value, { stream: true });
              var parts = buf.split('\n\n');
              buf = parts.pop();
              parts.forEach(handleSSEBlock);
            } else {
              // 无 TextDecoder 环境：一次性读取
              return res.text().then(function (t) { t.split('\n\n').forEach(handleSSEBlock); onEnd(); });
            }
            return pump();
          }, function () { onEnd(); });
        }
        return pump();
      })
      .catch(function () { onEnd(); });
    function handleSSEBlock(block) {
      var dataLine = null;
      block.split('\n').forEach(function (line) {
        if (line.indexOf('data:') === 0) dataLine = line.slice(5).trim();
      });
      if (!dataLine) return;
      try {
        var msg = JSON.parse(dataLine);
        if (msg && msg.data && msg.path === '/') {
          S.db = unwrapDB(msg.data); // 兼容 {db:...} 包装，自愈
          normalizeDB();
          S._online = true;
          if (S._statusCb) S._statusCb({ online: true, count: 1, mode: 'cloud' });
          if (S._remoteCb) S._remoteCb({ type: 'db', mode: 'cloud' });
        }
      } catch (e) { /* 忽略坏消息 */ }
    }
  };

  /* ---------- 本机服务器实时流（SSE） ---------- */
  S._connectSSE = function () {
    if (typeof EventSource === 'undefined') return;
    try {
      var es = new EventSource('/api/events');
      S._sse = es;
      es.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'hello') {
            if (msg.db) S.db = msg.db;
            S._online = true;
            if (S._statusCb) S._statusCb({ online: true, count: msg.online || 0, mode: 'server' });
            if (S._remoteCb && msg.db) S._remoteCb({ type: 'db', mode: 'server' });
          } else if (msg.type === 'db') {
            S.db = msg.db;
            if (S._statusCb) S._statusCb({ online: true, count: msg.online || 0, mode: 'server' });
            if (S._remoteCb) S._remoteCb({ type: 'db', mode: 'server', online: msg.online });
          } else if (msg.type === 'online') {
            if (S._statusCb) S._statusCb({ online: true, count: msg.online || 0, mode: 'server' });
          }
        } catch (e) { /* 忽略坏消息 */ }
      };
      es.onerror = function () { goOffline('与共享服务器断开，已切换单机模式'); };
    } catch (e) { goOffline('无法建立实时连接'); }
  };

  /* ---------------- 密码（按模式：云端=哈希 / 服务器=服务端校验 / 单机=明文） ---------------- */
  S.login = function (id, pass) {
    return new Promise(function (resolve) {
      pass = String(pass == null ? '' : pass);
      if (S._mode === 'cloud') {
        var cu = S.getUser(id);
        if (!cu) { resolve({ ok: false, msg: '成员不存在' }); return; }
        if (cu.passHash) {
          resolve(S.hashPass(pass) === cu.passHash ? { ok: true, user: cu } : { ok: false, msg: '密码错误' });
        } else {
          resolve({ ok: false, msg: '该成员尚未设置密码，请联系主席设置' });
        }
      } else if (S._mode === 'server' && S._online) {
        fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, pass: pass })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) {
            var u = S.getUser(id);
            resolve({ ok: true, user: u });
          } else {
            resolve({ ok: false, msg: (res && res.msg) || '密码错误' });
          }
        }).catch(function () { resolve({ ok: false, msg: '无法连接共享服务器' }); });
      } else {
        var u = S.getUser(id);
        if (u && u.pass && u.pass === pass) resolve({ ok: true, user: u });
        else if (u && !u.pass) resolve({ ok: false, msg: '该成员尚未设置密码，请联系主席设置' });
        else resolve({ ok: false, msg: '密码错误' });
      }
    });
  };
  // 设置/重置密码（仅主席可操作；云端模式保存哈希，不存明文）
  S.setPass = function (id, newPass) {
    return new Promise(function (resolve) {
      newPass = String(newPass == null ? '' : newPass).trim();
      if (newPass.length < 4) { resolve({ ok: false, msg: '密码至少 4 位' }); return; }
      if (newPass.length > 32) { resolve({ ok: false, msg: '密码最长 32 位' }); return; }
      var app = (typeof App !== 'undefined') ? App : null;
      var me = app && app.user ? S.getUser(app.user.id) : null;
      if (!me || me.role !== 'chair') { resolve({ ok: false, msg: '仅主席可设置密码' }); return; }
      if (S._mode === 'cloud') {
        var u = S.getUser(id);
        if (!u) { resolve({ ok: false, msg: '成员不存在' }); return; }
        u.passHash = S.hashPass(newPass);
        u.passSet = true;
        S.save();
        if (app && app.user.id === id) app._pass = newPass;
        resolve({ ok: true });
      } else if (S._mode === 'server' && S._online) {
        fetch('/api/setpass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asId: app && app.user ? app.user.id : null,
            asPass: app ? (app._pass || '') : '',
            id: id,
            newPass: newPass
          })
        }).then(function (r) { return r.json(); }).then(function (res) {
          if (res && res.ok) {
            if (res.db) S.db = res.db;
            if (app && app.user && app.user.id === id) app._pass = newPass;
            resolve({ ok: true });
          } else resolve({ ok: false, msg: (res && res.msg) || '操作失败（请以主席身份登录）' });
        }).catch(function () { resolve({ ok: false, msg: '无法连接共享服务器' }); });
      } else {
        var u2 = S.getUser(id);
        if (!u2) { resolve({ ok: false, msg: '成员不存在' }); return; }
        u2.pass = newPass;
        S.save();
        if (app && app.user.id === id) app._pass = newPass;
        resolve({ ok: true });
      }
    });
  };
  S.userPassSet = function (u) {
    if (S._mode === 'cloud') return !!u.passSet;
    if (S._online) return !!u.passSet;
    return !!(u.pass && String(u.pass).length);
  };
  S.passStatus = function (u) { return S.userPassSet(u) ? '已设置' : '未设置'; };

  /* ---------------- 部门 ---------------- */
  S.getDept = function (id) {
    for (var i = 0; i < S.db.departments.length; i++) { if (S.db.departments[i].id === id) return S.db.departments[i]; }
    return null;
  };
  S.deptName = function (id) { var d = S.getDept(id); return d ? d.name : '（未分配）'; };
  S.addDept = function (name) {
    if (!name || !name.trim()) return null;
    var d = { id: S.uid('dept'), name: name.trim() };
    S.db.departments.push(d);
    S.save();
    return d;
  };
  S.renameDept = function (id, name) {
    var d = S.getDept(id);
    if (d && name && name.trim()) { d.name = name.trim(); S.save(); }
  };
  S.delDept = function (id) {
    S.db.departments = S.db.departments.filter(function (d) { return d.id !== id; });
    S.db.users.forEach(function (u) { if (u.deptId === id) u.deptId = null; });
    S.save();
  };
  S.moveDept = function (id, dir) {
    var arr = S.db.departments, i = arr.findIndex(function (d) { return d.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    S.save();
  };

  /* ---------------- 人员 ---------------- */
  S.getUser = function (id) {
    for (var i = 0; i < S.db.users.length; i++) { if (S.db.users[i].id === id) return S.db.users[i]; }
    return null;
  };
  S.usersByRole = function (role) {
    return S.db.users.filter(function (u) { return !role || u.role === role; });
  };
  S.chair = function () { return S.db.users.find(function (u) { return u.role === 'chair'; }) || null; };
  S.hasChair = function () { return !!S.chair(); };
  S.addUser = function (info) {
    if (!info.name || !info.name.trim()) return { ok: false, msg: '姓名不能为空' };
    if (info.role === 'chair' && S.hasChair()) return { ok: false, msg: '主席仅限1人（系统锁定），无法重复添加' };
    var u = { id: S.uid('u'), name: info.name.trim(), studentId: (info.studentId || '').trim(), role: info.role || 'staff', deptId: info.deptId || null, pass: '', passHash: '', passSet: false };
    S.db.users.push(u);
    S.save();
    return { ok: true, user: u };
  };
  S.updateUser = function (id, patch) {
    var u = S.getUser(id);
    if (!u) return { ok: false, msg: '成员不存在' };
    if (u.role === 'chair' && patch.role && patch.role !== 'chair') return { ok: false, msg: '主席角色系统锁定，不可变更' };
    if (patch.role === 'chair' && u.role !== 'chair' && S.hasChair()) return { ok: false, msg: '主席仅限1人（系统锁定）' };
    if (patch.name != null) u.name = patch.name.trim() || u.name;
    if (patch.studentId != null) u.studentId = patch.studentId.trim();
    if (patch.deptId !== undefined) u.deptId = patch.deptId;
    if (patch.role && patch.role !== u.role) {
      var old = u.role;
      u.role = patch.role;
      if (old === 'minister') {
        Object.keys(S.db.pipeline).forEach(function (k) {
          S.db.pipeline[k] = (S.db.pipeline[k] || []).filter(function (sid) { return sid !== id; });
          if (!S.db.pipeline[k].length) delete S.db.pipeline[k];
        });
        delete S.db.pipeline[id];
      }
      if (old === 'staff') {
        Object.keys(S.db.pipeline).forEach(function (k) {
          S.db.pipeline[k] = (S.db.pipeline[k] || []).filter(function (sid) { return sid !== id; });
        });
      }
    }
    S.save();
    return { ok: true, user: u };
  };
  S.delUser = function (id) {
    var u = S.getUser(id);
    if (!u) return { ok: false, msg: '成员不存在' };
    if (u.role === 'chair') return { ok: false, msg: '主席不可删除（系统锁定）' };
    S.db.users = S.db.users.filter(function (x) { return x.id !== id; });
    Object.keys(S.db.pipeline).forEach(function (k) {
      S.db.pipeline[k] = (S.db.pipeline[k] || []).filter(function (sid) { return sid !== id; });
      if (!S.db.pipeline[k].length) delete S.db.pipeline[k];
    });
    delete S.db.pipeline[id];
    S.save();
    return { ok: true };
  };

  /* ---------------- 管线 ---------------- */
  S.staffOf = function (ministerId) { return S.db.pipeline[ministerId] || []; };
  S.ministerOf = function (staffId) {
    for (var k in S.db.pipeline) {
      if (S.db.pipeline[k].indexOf(staffId) >= 0) return k;
    }
    return null;
  };
  S.pipelineSave = function (map) {
    S.db.pipeline = map || {};
    S.save();
  };

  /* ---------------- 里程碑 ---------------- */
  S.addMilestone = function (title, date) {
    if (!title || !title.trim() || !date) return { ok: false, msg: '标题与日期必填' };
    S.db.milestones.push({ id: S.uid('ms'), title: title.trim(), date: date });
    S.save();
    return { ok: true };
  };
  S.delMilestone = function (id) {
    S.db.milestones = S.db.milestones.filter(function (m) { return m.id !== id; });
    S.save();
  };

  /* ---------------- OKR ---------------- */
  S.getOKR = function (id) {
    for (var i = 0; i < S.db.okrs.length; i++) { if (S.db.okrs[i].id === id) return S.db.okrs[i]; }
    return null;
  };
  S.okrsOf = function (ownerId) {
    return S.db.okrs.filter(function (o) { return o.ownerId === ownerId; });
  };
  S.saveOKR = function (okr) {
    var old = okr.id ? S.getOKR(okr.id) : null;
    if (old) { Object.assign(old, okr); } else { S.db.okrs.push(okr); }
    S.save();
    return okr;
  };
  S.delOKR = function (id) {
    S.db.okrs = S.db.okrs.filter(function (o) { return o.id !== id; });
    S.save();
  };
  S.submitOKR = function (id) {
    var o = S.getOKR(id);
    if (!o) return { ok: false, msg: 'OKR不存在' };
    if (o.status === 'rejected') { o.status = 'pending'; o.rejectReason = ''; o.chairReviewed = false; }
    else if (o.status === 'draft') { o.status = 'pending'; }
    else return { ok: false, msg: '当前状态不可提交' };
    S.save();
    return { ok: true };
  };
  // 审批（by: 'chair' 主席 / 'minister' 部长）
  // 规则：主席审批为主——主席一旦处理（批准/驳回），部长对该 OKR 的操作不再生效；
  //       干事重新提交后回到待审批，主席与部长可再次审批。
  S.approveOKR = function (id, by) {
    var o = S.getOKR(id);
    if (!o) return { ok: false, msg: 'OKR不存在' };
    by = by || 'minister';
    if (o.type === 'dept' && by !== 'chair') return { ok: false, msg: '部门OKR需主席审批' };
    if (by === 'minister' && o.chairReviewed) return { ok: false, msg: '主席已处理该OKR，以主席审批为主' };
    o.status = 'approved'; o.rejectReason = '';
    o.approvedBy = by;
    o.chairReviewed = o.chairReviewed || by === 'chair';
    o.actions = o.actions || [];
    o.actions.push({ by: by, action: 'approve', date: S.today() });
    S.save();
    return { ok: true };
  };
  S.rejectOKR = function (id, reason, by) {
    var o = S.getOKR(id);
    if (!o) return { ok: false, msg: 'OKR不存在' };
    by = by || 'minister';
    if (by === 'minister' && o.chairReviewed) return { ok: false, msg: '主席已处理该OKR，以主席审批为主' };
    o.status = 'rejected'; o.rejectReason = reason || '';
    o.approvedBy = null;
    o.chairReviewed = o.chairReviewed || by === 'chair';
    o.actions = o.actions || [];
    o.actions.push({ by: by, action: 'reject', date: S.today() });
    S.save();
    return { ok: true };
  };
  S.addUpdate = function (okrId, krId, progress, note) {
    var o = S.getOKR(okrId);
    if (!o) return;
    var kr = o.krs.find(function (k) { return k.id === krId; });
    if (!kr) return;
    kr.progress = S.clamp(Number(progress) || 0, 0, 100);
    kr.updates.push({ date: S.today(), progress: kr.progress, note: note || '' });
    S.save();
  };
  S.addReview = function (staffId, ministerId, text, score) {
    if (!text || !text.trim()) return { ok: false, msg: '点评内容不能为空' };
    S.db.reviews.push({ id: S.uid('rv'), staffId: staffId, ministerId: ministerId, date: S.today(), text: text.trim(), score: S.clamp(Number(score) || 0, 0, 100) });
    S.save();
    return { ok: true };
  };
  S.delReview = function (id) {
    S.db.reviews = S.db.reviews.filter(function (r) { return r.id !== id; });
    S.save();
  };
  S.reviewsOf = function (staffId) {
    return S.db.reviews.filter(function (r) { return r.staffId === staffId; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  };
  S.reviewsAvg = function (staffId) {
    var rs = S.reviewsOf(staffId);
    if (!rs.length) return 0;
    var sum = rs.reduce(function (s, r) { return s + r.score; }, 0);
    return sum / rs.length;
  };

  /* ---------------- 红灯预警 / 进度 ---------------- */
  S.krExpected = function (kr, period) {
    var t = S.today();
    if (t < period.start) return 0;
    if (t > kr.deadline) return 1;
    return S.clamp(S.diffDays(period.start, t) / Math.max(1, S.diffDays(period.start, kr.deadline)), 0, 1);
  };
  // 红灯判定：实际进度（0-100）< 预设时间进度（百分比）× 55%
  S.krRed = function (kr, period) {
    var exp = S.krExpected(kr, period);
    if (exp <= 0.02) return { red: false, expected: exp, threshold: 0 };
    var threshold = exp * 55;
    return { red: (kr.progress || 0) < threshold, expected: exp, threshold: threshold };
  };
  S.okrWeighted = function (o) {
    var wSum = o.krs.reduce(function (s, k) { return s + (Number(k.weight) || 0); }, 0);
    if (wSum <= 0) return 0;
    var v = o.krs.reduce(function (s, k) { return s + (Number(k.weight) || 0) * (Number(k.progress) || 0); }, 0);
    return v / wSum;
  };
  S.okrRedKRs = function (o) {
    var out = [];
    o.krs.forEach(function (k) {
      var r = S.krRed(k, o.period);
      if (r.red) out.push({ kr: k, expected: r.expected, threshold: r.threshold });
    });
    return out;
  };
  S.okrUpdateCount = function (o) {
    return o.krs.reduce(function (s, k) { return s + (k.updates ? k.updates.length : 0); }, 0);
  };
  S.okrRetention = function (o) {
    var weeks = S.weeksBetween(o.period.start, o.period.end);
    var got = S.okrUpdateCount(o);
    return S.clamp(got / weeks, 0, 1);
  };

  /* ---------------- 评分与徽章 ---------------- */
  S.computeScore = function (o) {
    var weighted = S.round1(S.okrWeighted(o));
    var reviewAvg = S.round1(S.reviewsAvg(o.ownerId));
    var retention = S.round1(S.okrRetention(o) * 100);
    var score = Math.round(weighted * 0.6 + reviewAvg * 0.25 + retention * 0.15);
    var badge = score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : 'C';
    return { score: score, weighted: weighted, reviewAvg: reviewAvg, retention: retention, badge: badge };
  };
  S.badgeName = function (b) {
    return { S: 'S级·卓越', A: 'A级·优秀', B: 'B级·良好', C: 'C级·待提升' }[b] || b;
  };
  // 周期到期自动结算；返回是否有变化
  S.finalize = function () {
    var t = S.today();
    var changed = false;
    S.db.okrs.forEach(function (o) {
      if (o.period && o.period.end < t && o.status !== 'settled' && o.status !== 'draft') {
        var r = S.computeScore(o);
        o.settled = { score: r.score, weighted: r.weighted, reviewAvg: r.reviewAvg, retention: r.retention, badge: r.badge, date: o.period.end };
        o.status = 'settled';
        changed = true;
      }
    });
    return changed;
  };

  /* ---------------- 筛选 ---------------- */
  S.activeOKRs = function (range) {
    var from = range && range.from, to = range && range.to;
    return S.db.okrs.filter(function (o) {
      if (!o.period) return true;
      if (!from && !to) return true;
      var a = o.period.start, b = o.period.end;
      if (from && to) return a <= to && b >= from;
      if (from) return b >= from;
      return a <= to;
    });
  };
  S.userOKRs = function (userId, range) {
    return S.activeOKRs(range).filter(function (o) { return o.ownerId === userId; });
  };

  /* ---------------- 导出（Excel / 打印 PDF） ---------------- */
  function collectRows(okrs) {
    var rows = [];
    okrs.forEach(function (o) {
      var owner = S.getUser(o.ownerId);
      var mn = S.ministerOf(o.ownerId);
      o.krs.forEach(function (k) {
        var lastUp = k.updates.length ? k.updates[k.updates.length - 1] : null;
        rows.push({
          dept: o.deptId ? S.deptName(o.deptId) : '主席团',
          owner: owner ? owner.name : '（成员已移除）', role: owner ? S.roleName(owner.role) : '',
          minister: mn ? (S.getUser(mn) || {}).name : (o.type === 'dept' ? '—' : '未分配'),
          period: o.period.name, start: o.period.start, end: o.period.end,
          objective: o.objective, kr: k.text, weight: k.weight, deadline: k.deadline,
          progress: k.progress, status: S.statusName(o.status),
          note: lastUp ? lastUp.note : '', updateDate: lastUp ? lastUp.date : '',
          score: o.settled ? o.settled.score : '', badge: o.settled ? o.settled.badge : ''
        });
      });
    });
    return rows;
  }

  S.exportExcel = function (filter) {
    var okrs = S.pickForExport(filter);
    var rows = collectRows(okrs);
    var h = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>OKR档案</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>';
    h += '<table border="1" cellpadding="4" style="border-collapse:collapse">';
    h += '<tr style="background:#1e3a8a;color:#fff"><th>部门</th><th>成员</th><th>角色</th><th>所属部长</th><th>周期</th><th>起</th><th>止</th><th>目标O</th><th>关键结果KR</th><th>权重%</th><th>截止</th><th>进度%</th><th>状态</th><th>最近备注</th><th>更新日期</th><th>综合得分</th><th>徽章</th></tr>';
    rows.forEach(function (r) {
      h += '<tr><td>' + S.esc(r.dept) + '</td><td>' + S.esc(r.owner) + '</td><td>' + S.esc(r.role) + '</td><td>' + S.esc(r.minister) + '</td><td>' + S.esc(r.period) + '</td><td>' + S.esc(r.start) + '</td><td>' + S.esc(r.end) + '</td><td>' + S.esc(r.objective) + '</td><td>' + S.esc(r.kr) + '</td><td>' + S.esc(r.weight) + '</td><td>' + S.esc(r.deadline) + '</td><td>' + S.esc(r.progress) + '</td><td>' + S.esc(r.status) + '</td><td>' + S.esc(r.note) + '</td><td>' + S.esc(r.updateDate) + '</td><td>' + S.esc(r.score) + '</td><td>' + S.esc(r.badge) + '</td></tr>';
    });
    h += '</table></body></html>';
    return '\ufeff' + h;
  };

  S.exportPrintHTML = function (filter) {
    var okrs = S.pickForExport(filter);
    var h = '<div class="print-report"><h1>科创OKR管理档案</h1>';
    h += '<p class="print-meta">导出时间：' + S.today() + '　筛选：' + (filter.deptId ? '部门=' + S.deptName(filter.deptId) : '全部部门') + '　区间：' + ((filter.from || '不限') + ' ~ ' + (filter.to || '不限')) + '　OKR数：' + okrs.length + '</p>';
    okrs.forEach(function (o) {
      var owner = S.getUser(o.ownerId);
      var mn = S.ministerOf(o.ownerId);
      h += '<div class="print-okr"><h2>【' + (owner ? owner.name : '成员已移除') + '】' + S.statusName(o.status) + (o.settled ? ' · 得分' + o.settled.score + ' · ' + o.settled.badge + '级' : '') + '</h2>';
      h += '<p class="print-period">周期：' + o.period.name + '（' + o.period.start + ' ~ ' + o.period.end + '）　所属部长：' + (mn ? ((S.getUser(mn) || {}).name || '') : '—') + '</p>';
      h += '<p class="print-o"><b>O：</b>' + S.esc(o.objective) + '</p>';
      o.krs.forEach(function (k) {
        h += '<div class="print-kr"><b>KR' + (o.krs.indexOf(k) + 1) + '（' + k.weight + '%）：</b>' + S.esc(k.text) + '<br>截止 ' + k.deadline + '　当前进度 ' + k.progress + '%';
        if (k.updates.length) {
          h += '<ul>';
          k.updates.forEach(function (u) { h += '<li>' + u.date + '　进度' + u.progress + '%　' + S.esc(u.note) + '</li>'; });
          h += '</ul>';
        }
        h += '</div>';
      });
      var rvs = S.reviewsOf(o.ownerId);
      if (rvs.length) {
        h += '<p class="print-rv"><b>部长点评：</b></p><ul>';
        rvs.forEach(function (r) { h += '<li>' + r.date + '（' + r.score + '分）：' + S.esc(r.text) + '</li>'; });
        h += '</ul>';
      }
      h += '</div>';
    });
    h += '</div>';
    return h;
  };

  S.pickForExport = function (filter) {
    var okrs = S.db.okrs.slice();
    if (filter && filter.deptId) {
      okrs = okrs.filter(function (o) {
        if (o.type === 'global') return false;
        return o.deptId === filter.deptId;
      });
    }
    if (filter && (filter.from || filter.to)) {
      okrs = okrs.filter(function (o) {
        if (!o.period) return true;
        var a = o.period.start, b = o.period.end;
        if (filter.from && filter.to) return a <= filter.to && b >= filter.from;
        if (filter.from) return b >= filter.from;
        return a <= filter.to;
      });
    }
    return okrs;
  };

  S.exportFilename = function (filter) {
    var d = filter && filter.deptId ? S.deptName(filter.deptId) : '全部部门';
    return '科创OKR档案_' + d + '_' + S.today().replace(/-/g, '');
  };

  /* ---------------- 导出为 CommonJS（Node 服务器/测试用） ---------------- */
  if (typeof module !== 'undefined' && module.exports) { module.exports = S; }
  global.Store = S;
})(typeof window !== 'undefined' ? window : globalThis);
