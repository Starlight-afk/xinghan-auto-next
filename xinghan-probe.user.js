// ==UserScript==
// @name         星瀚金建 · 视频播完自动切下一节（单页顺序连播）
// @namespace    local.xinghan.auto-next
// @version      1.0.2
// @description  播完当前小节后，等待 10~20 秒，只点目录里紧挨着的下一节链接。默认原速静音、不拖进度、不多窗口、不伪造任何学时请求。不承诺规避平台反作弊统计，使用风险自负。
// @author       local
// @match        https://cumtyc.xinghanjjkj.com/user/node*
// @match        https://*.xinghanjjkj.com/user/node*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * 适配依据（2026-11-23 真机采集 + 站点公开 JS 源码核对）
 *
 * 【页面结构】
 *  - 目录：.detmain-navlist .list .item > a[href="/user/node?nodeId=NNN"]
 *          当前项 class="on"；nodeId 800~816 连续。整页跳转，不是 SPA。
 *          注意页面里还有「视频播放」tab 和讨论区「点赞」也带 class="on"，
 *          所以必须把目录限定在 .detmain-navlist .list .item 内，否则会乱跳。
 *  - 播放器：ckplayer（/ckplayer/ckplayer.js），容器 #videoContent，
 *            <video id="随机"> 直接挂在里面，没有 iframe。
 *            播放按钮 = [data-title="点击播放"]（class 带随机后缀，只能用属性选择器）。
 *
 * 【学时机制，来自 /static/user/js/video.js】
 *  - playState === 'playing' 时每秒 totalTime++，每 10s（支持 sendBeacon 时 30s）
 *    POST /user/node/study {nodeId, studyId, studyTime: totalTime}。
 *  - 播放开始 / 暂停 / ended 时各补报一次；页面 unload 时 sendBeacon 兜底。
 *  - 结论：平台算的是「真实处于播放状态的秒数」，不是视频 currentTime。
 *    倍速播完只会累计一半秒数，学时反而可能不足；拖进度条也没用
 *    （ckplayer 还设了 timeScheduleAdjust 限制拖动）。
 *    因此本脚本默认 1.0 原速、绝不 seek、绝不改 currentTime。
 *  - 播放必须走 ckplayer 自己的 UI 按钮：直接对 <video> 调 play() 有可能
 *    不触发 ckplayer 的 addListener('play')，导致 playState 不变、totalTime 不涨、
 *    学时为 0。自动播放策略被拦时，脚本会停下来请本人点一下播放按钮。
 *
 * 【平台的多窗口检测（来自 video.js）】
 *  - 每 567ms 写 localStorage['node_play_'+schoolId+userId]，每秒比对，
 *    检测到别的章节页面同时打开会 Yee.alert 并 videoPause()。
 *  - 页面明示「请不要使用任何方式包括多窗口打开并行播放进行刷课」，
 *    console 里也声明会统计浏览器头、播放器记录、鼠标轨迹等用于评估真实性。
 *  - 源码里另有 need_code == 1/2 的验证码分支，但真机实测该课程从未触发；
 *    v1.0.2 起脚本不再检测验证码，也不再因任何页面弹窗文本停摆。
 *
 * 【本脚本的边界，刻意不做的事】
 *  - 不 hook XHR/fetch，不伪造 /user/node/study，不改 totalTime / playState。
 *  - 不 seek、不跳进度、不默认倍速、不多标签页并行、不清理平台自己的 localStorage 键。
 *  - 平台或本人中途暂停后，脚本不会强行恢复播放：起播只在「本页还没播放过」时尝试，
 *    因此即使平台让视频暂停，脚本也不会绕过它继续播或强行切节。
 *  - 只做三件事：点播放器播放按钮、监听 ended、点目录里紧邻的下一节。
 *  - 不承诺「防检测」。平台是否认账、学时是否记满，脚本无法保证。
 *
 * 【v1.0.2 变更（真机反馈「平台根本没有验证码，把验证码取消掉」）】
 *  - 彻底删除 blockingReason()：不再检测 #video-captcha、验证码输入框、
 *    layer/弹层文本，也不再用 document.body.innerText 做任何全局匹配。
 *    v1.0.0 用全局文本匹配误判隐藏模板，导致 tick() 每轮早退、脚本完全不动；
 *    v1.0.1 虽收窄为强信号判定，但真机确认该平台并未弹验证码，再保留这套判定
 *    只剩误伤风险，故整段移除。
 *  - 移除后的行为：脚本不因弹窗停摆；若平台真让视频暂停，因 armed 机制脚本不会
 *    强行恢复播放，也不会触发 ended，因此不会切到下一节（自然停住，需本人处理）。
 *  - 保留：跨标签心跳互斥、落点校验、目录稳定期、原速、日志与面板。
 *
 * 【v1.0.1 起播加固（保留）】
 *  - 优先点播放按钮里的 canvas（事件可冒泡到外层 div，兼容两种绑定方式），
 *    首次 click 无效时改用 mousedown/mouseup/click 完整序列重试，仍无效才提示本人手动点。
 *
 * 【仍建议你实测复核的两点】
 *  1. 播完那一刻是否触发原生 ended 事件、ckplayer 是否把 currentTime 归零；
 *     用 xinghan-probe.user.js 在「刚播完」再采一份 JSON 贴过来即可复核。
 *  2. 切到下一节后首个页面能否自动起播（Chrome 自动播放策略因账号而异）。
 */

(function () {
  'use strict';

  // ==================== 常量与配置 ====================
  const TAG = '[星瀚·连播]';
  const LS = {
    cfg:   'xh_an_cfg_v1',
    logs:  'xh_an_logs_v1',
    nav:   'xh_an_pending_nav_v1',
    hb:    'xh_an_hb_'            // 每个标签页一个心跳键
  };
  const TAB_ID = String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);

  const DEFAULT_CFG = {
    enabled:        true,
    muted:          true,    // 静音只为让浏览器允许自动起播，不影响学时（学时按秒数算）
    playbackRate:   1.0,     // 默认原速！倍速会让累计秒数少于视频时长
    waitMinSec:     10,
    waitMaxSec:     20,
    skipCompleted:  false,   // 已进入页面就是「已完成」时，是否直接切下一节
    lastAction:     'stop',  // stop | back
    requireVisible: true     // 页面在后台时不切，避免后台播放被浏览器节流
  };

  let cfg = Object.assign({}, DEFAULT_CFG, readJSON(localStorage.getItem(LS.cfg)) || {});
  function saveCfg() {
    try { localStorage.setItem(LS.cfg, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  // ==================== 小工具 ====================
  function readJSON(s, fb) {
    try { return s ? JSON.parse(s) : (fb === undefined ? null : fb); }
    catch (e) { return fb === undefined ? null : fb; }
  }
  function readJSONArray(s) { const v = readJSON(s, []); return Array.isArray(v) ? v : []; }
  function randInt(a, b) { a = Math.max(0, Number(a) || 0); b = Math.max(a, Number(b) || a); return a + Math.floor(Math.random() * (b - a + 1)); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function nodeIdFrom(href) {
    const m = /[?&]nodeId=(\d+)/.exec(String(href || ''));
    return m ? m[1] : null;
  }
  function isVisible(el) {
    if (!el) return false;
    try { return el.offsetParent !== null || el.getClientRects().length > 0; } catch (e) { return false; }
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  // ==================== 跨页日志 ====================
  function log(level, msg, extra) {
    const arr = readJSONArray(localStorage.getItem(LS.logs));
    arr.push({ t: Date.now(), level: level, page: nodeIdFrom(location.href), tab: TAB_ID.slice(-6), msg: msg, extra: extra || null });
    while (arr.length > 300) arr.shift();
    try { localStorage.setItem(LS.logs, JSON.stringify(arr)); } catch (e) { /* ignore */ }
    try { console.log(TAG, '[' + level + ']', msg, extra || ''); } catch (e) { /* ignore */ }
    renderLog();
  }
  function clearLogs() {
    localStorage.removeItem(LS.logs);
    log('info', '日志已清空');
  }
  function exportLogs() {
    const arr = readJSONArray(localStorage.getItem(LS.logs));
    const text = arr.map(function (r) {
      return new Date(r.t).toLocaleString('zh-CN') + '  [' + r.level + ']  node=' + r.page + '  ' + r.msg +
        (r.extra ? '  ' + JSON.stringify(r.extra) : '');
    }).join('\n');
    const blob = new Blob([text || '(空)'], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xinghan-auto-next-log-' + Date.now() + '.txt';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }

  // ==================== 目录：严格只认「紧挨着的下一节」 ====================
  function catalogItems() {
    const scope = $('.detmain-navlist');
    if (!scope) return [];
    // 只取 .list .item 下的直系 <a>，天然排除大章节标题（.group > .name > a，href=javascript:void(0)）
    // 也排除 detmain-tabs 的「视频播放」和讨论区「点赞」等同样带 class="on" 的元素
    return $$('.list .item > a[href]', scope)
      .filter(function (a) { return /\/user\/node\?nodeId=\d+/.test(a.getAttribute('href') || ''); });
  }
  function currentIndex(items) {
    const cur = nodeIdFrom(location.href);
    let idx = items.findIndex(function (a) { return nodeIdFrom(a.getAttribute('href')) === cur; });
    if (idx < 0) idx = items.findIndex(function (a) { return a.classList.contains('on'); });
    return idx;
  }
  function nextAnchor(items, idx) {
    if (idx < 0 || idx + 1 >= items.length) return null;
    const cur = items[idx], next = items[idx + 1];
    // 必须是同一份 .list 里紧邻的 .item，绝不跨组、绝不跳大章节
    if (!cur.closest('.list') || cur.closest('.list') !== next.closest('.list')) return null;
    const a = Number(nodeIdFrom(cur.getAttribute('href')));
    const b = Number(nodeIdFrom(next.getAttribute('href')));
    if (!a || !b || b <= a) return null;          // 绝不回跳
    if (b - a > 10) return null;                   // 防乱跳：nodeId 跨度异常（静默，render 每秒会调用）
    return next;
  }

  // 目录稳定期：连续两次采样一致才允许动作
  let lastSig = '', stableHits = 0;
  function catalogStable(items) {
    const sig = items.map(function (a) { return a.getAttribute('href'); }).join('|');
    if (sig && sig === lastSig) stableHits++;
    else { lastSig = sig; stableHits = 1; }
    return stableHits >= 2 && items.length >= 2;
  }

  // 说明：v1.0.2 起不再有任何「验证码 / 平台弹窗」检测。
  // 真机实测该平台不弹验证码，而这类文本匹配曾导致脚本整体停摆，已整段移除。
  // 若平台让视频暂停，armed 机制会阻止脚本强行恢复播放，自然就不会切节。

  // ==================== 多标签页互斥（避免触发平台的多窗口检测） ====================
  let standby = false, standbyReason = '';
  function heartbeat() {
    const key = LS.hb + TAB_ID;
    try {
      localStorage.setItem(key, JSON.stringify({ t: Date.now(), node: nodeIdFrom(location.href), url: location.href }));
      const others = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === key || k.indexOf(LS.hb) !== 0) continue;
        const v = readJSON(localStorage.getItem(k));
        if (!v) continue;
        if (Date.now() - v.t > 15000) { localStorage.removeItem(k); continue; } // 清理过期心跳
        others.push({ id: k.slice(LS.hb.length), v: v });
      }
      // 先开的标签页优先；后开的自动待命
      const earlier = others.filter(function (o) { return o.id < TAB_ID; });
      standby = earlier.length > 0;
      standbyReason = standby ? ('检测到另一个视频页已在运行（node=' + earlier[0].v.node + '），本页待命') : '';
    } catch (e) { standby = false; }
  }
  window.addEventListener('beforeunload', function () {
    try { localStorage.removeItem(LS.hb + TAB_ID); } catch (e) { /* ignore */ }
  });
  window.addEventListener('pagehide', function () {
    try { localStorage.removeItem(LS.hb + TAB_ID); } catch (e) { /* ignore */ }
  });

  // ==================== 落点校验（跨页） ====================
  let landingFailed = false;
  function verifyLanding() {
    let pending = null;
    try { pending = readJSON(sessionStorage.getItem(LS.nav)); } catch (e) { /* ignore */ }
    if (!pending) return;
    try { sessionStorage.removeItem(LS.nav); } catch (e) { /* ignore */ }

    if (Date.now() - pending.ts > 60000) { log('warn', '上次的切换意图已超时，忽略', pending); return; }
    const cur = nodeIdFrom(location.href);
    if (String(cur) !== String(pending.to)) {
      landingFailed = true;
      log('error', '落点校验失败：预期 node=' + pending.to + '，实际 node=' + cur + '，已停用自动切换', pending);
      return;
    }
    const items = catalogItems(), idx = currentIndex(items);
    const onNodes = items.filter(function (a) { return a.classList.contains('on'); })
      .map(function (a) { return nodeIdFrom(a.getAttribute('href')); });
    if (idx < 0 || onNodes.indexOf(cur) < 0) {
      landingFailed = true;
      log('error', '落点校验失败：目录当前项未指向 node=' + cur + '，已停用自动切换', { idx: idx, onNodes: onNodes });
      return;
    }
    log('ok', '切换成功：node ' + pending.from + ' → ' + pending.to + '（' + (pending.title || '') + '）');
  }

  // ==================== 视频与播放 ====================
  let video = null;
  const bound = new WeakSet();
  let armed = false;                 // 本页确实观测到播放，才允许触发切换（防加载即误切）
  let endedFired = false;
  let videoError = false;            // 视频加载失败是软阻塞，恢复后自动继续（不永久停用）
  let playStart = 0, playedMs = 0;  // 本页累计真实播放毫秒（仅用于日志/风险提示）
  let autoPlayTries = 0;
  let needUserGesture = false;
  let lastAutoPlayAt = 0;

  function attachVideo(v) {
    if (bound.has(v)) return;
    bound.add(v);
    const on = function (type, fn) { try { v.addEventListener(type, fn, true); } catch (e) { /* ignore */ } };
    on('play', function () {
      armed = true; needUserGesture = false; playStart = Date.now();
      if (cfg.playbackRate > 1 && Math.abs(v.playbackRate - cfg.playbackRate) > 0.05) {
        try { v.playbackRate = cfg.playbackRate; } catch (e) { /* ignore */ }
      }
      log('info', '开始播放（走播放器自身状态）', { duration: Math.round(v.duration || 0), rate: v.playbackRate, muted: v.muted });
    });
    on('pause', function () {
      if (playStart) { playedMs += Date.now() - playStart; playStart = 0; }
      log('info', '暂停', { at: Math.round(v.currentTime || 0) });
    });
    on('ended', function () {
      if (playStart) { playedMs += Date.now() - playStart; playStart = 0; }
      log('ok', '视频 ended（原生事件）', { duration: Math.round(v.duration || 0) });
      onEnded();
    });
    on('error', function () {
      videoError = true;
      log('error', '视频加载失败，暂停自动切换（视频恢复后自动继续）', { code: v.error && v.error.code });
    });
    ['loadedmetadata', 'canplay', 'playing'].forEach(function (t) {
      on(t, function () { if (videoError) { videoError = false; log('info', '视频已恢复加载，解除阻塞'); } });
    });
    log('info', '已绑定 video', { id: v.id, duration: Math.round(v.duration || 0) });
  }

  function findVideo() {
    const v = $('#videoContent video') || $('video');
    if (v && v !== video) { video = v; attachVideo(v); }
    return video;
  }

  // 派发完整鼠标序列，兼容只监听 mousedown/mouseup 而不监听 click 的播放器实现
  function fireMouseSequence(el) {
    ['mousedown', 'mouseup', 'click'].forEach(function (t) {
      try {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
      } catch (e) { /* ignore */ }
    });
  }

  // 只点 ckplayer 自己的播放按钮，绝不直接 video.play()：
  // 直接调 play() 可能不触发 ckplayer 的 play 监听 → playState 不变 → 学时为 0。
  // 起播只在「本页从未播放过」时尝试；播放过之后再暂停，绝不强行恢复
  // （本人暂停、平台暂停都算，避免干扰任何人工/平台介入）。
  function tryAutoPlay() {
    if (!cfg.enabled || standby || landingFailed) return;
    if (!video || !video.paused || video.ended || armed) return;
    if (needUserGesture || autoPlayTries >= 3) return;
    if (Date.now() - lastAutoPlayAt < 4000) return;
    lastAutoPlayAt = Date.now();
    autoPlayTries++;

    if (cfg.muted && !video.muted) { try { video.muted = true; } catch (e) { /* ignore */ } }
    const btn = $$('[data-title="点击播放"]').filter(isVisible)[0];
    if (!btn) {
      log('warn', '找不到播放器「点击播放」按钮，不擅自直接调用 video.play()（否则学时可能不计）');
      needUserGesture = true;
      return;
    }
    // 优先点内部 canvas：事件会冒泡到外层 div，兼容「绑定在 div」和「绑定在 canvas」两种实现
    const target = btn.querySelector('canvas') || btn;
    if (autoPlayTries === 1) {
      try { target.click(); } catch (e) { log('error', '点击播放按钮失败：' + e.message); }
      log('info', '已点击播放器播放按钮（第 1 次：click）');
    } else {
      fireMouseSequence(target);
      log('info', '已点击播放器播放按钮（第 ' + autoPlayTries + ' 次：mousedown/mouseup/click 完整序列）');
    }

    setTimeout(function () {
      if (!video) return;
      if (!video.paused || armed) { log('ok', '起播成功'); return; }
      if (autoPlayTries >= 3) {
        needUserGesture = true;
        log('warn', '自动起播 3 次都未生效：请本人手动点一下播放器上的播放按钮，脚本随后自动接管');
      } else {
        log('warn', '第 ' + autoPlayTries + ' 次起播未生效，' +
          (autoPlayTries === 1 ? '接下来会改用 mousedown/mouseup/click 完整序列重试' : '继续重试'));
      }
    }, 3000);
  }

  // ==================== 切换状态机 ====================
  let navState = 'idle';   // idle | waiting | navigating
  let waitUntil = 0;
  let plannedTo = null;
  let plannedHref = null;

  function preflight(manual) {
    if (!cfg.enabled) return { ok: false, reason: '脚本已停用' };
    if (landingFailed) return { ok: false, reason: '落点校验失败，已停用' };
    if (videoError) return { ok: false, reason: '视频加载失败，等待恢复' };
    if (standby) return { ok: false, reason: standbyReason };
    if (cfg.requireVisible && document.visibilityState !== 'visible') return { ok: false, reason: '页面在后台，暂不切换' };
    if (!manual && !armed) return { ok: false, reason: '本页尚未观测到播放，不切换（防加载即误跳）' };
    const items = catalogItems();
    if (!catalogStable(items)) return { ok: false, reason: '目录尚未稳定' };
    const idx = currentIndex(items);
    if (idx < 0) return { ok: false, reason: '目录里找不到当前节' };
    const next = nextAnchor(items, idx);
    if (!next) return { ok: false, reason: '没有合法的紧邻下一节（已到末尾或目录异常）' };
    return { ok: true, items: items, idx: idx, next: next };
  }

  function onEnded(manual) {
    if (endedFired || navState !== 'idle') return;
    const pf = preflight(!!manual);
    if (!pf.ok) {
      // 已到目录最后一节：按面板设置处理一次，不反复刷日志
      if (/没有合法的紧邻下一节/.test(pf.reason)) {
        const all = catalogItems(), at = currentIndex(all);
        if (all.length > 0 && at === all.length - 1) { lastSectionAction(); return; }
      }
      log('warn', '不切换：' + pf.reason, { manual: !!manual });
      return;
    }
    const href = pf.next.getAttribute('href');
    const to = nodeIdFrom(href);
    const title = (pf.next.innerText || pf.next.getAttribute('title') || '').trim();
    const sec = manual ? 0 : randInt(cfg.waitMinSec, cfg.waitMaxSec);

    endedFired = true;
    plannedTo = to; plannedHref = href;
    navState = 'waiting';
    waitUntil = Date.now() + sec * 1000;

    const realSec = Math.round((playedMs + (playStart ? Date.now() - playStart : 0)) / 1000);
    const durSec = video ? Math.round(video.duration || 0) : 0;
    log('ok', (manual ? '手动' : '播完') + ' → 计划切到 node=' + to + '「' + title + '」，' + (sec ? '等待 ' + sec + ' 秒' : '立即切换'), {
      from: nodeIdFrom(location.href), to: to, waitSec: sec,
      realPlaySec: realSec, videoDurationSec: durSec,
      rate: video ? video.playbackRate : null
    });
    if (durSec > 0 && realSec < durSec * 0.9) {
      log('warn', '本节累计真实播放 ' + realSec + 's < 视频时长 ' + durSec + 's，平台按真实秒数计学时，学时可能不足', { rate: video && video.playbackRate });
    }
    if (!sec) doNavigate();
  }

  function cancelWait(reason) {
    log('warn', '取消切换：' + reason);
    navState = 'idle'; waitUntil = 0; plannedTo = null; plannedHref = null;
    // 允许本页后续重新触发（例如用户手动重播）
    endedFired = false;
  }

  function doNavigate() {
    if (navState !== 'waiting') return;
    // 再次校验：目录没变、目标仍是紧邻下一节、没有其他标签页
    // 用 manual=true 跳过 armed 检查：能走到这里说明本页已确认过播放（或本人手动触发）
    const pf = preflight(true);
    if (!pf.ok) { cancelWait(pf.reason); return; }
    const href = pf.next.getAttribute('href');
    const to = nodeIdFrom(href);
    if (String(to) !== String(plannedTo) || href !== plannedHref) {
      cancelWait('等待期间目录/目标发生变化，拒绝跳转'); return;
    }
    const from = nodeIdFrom(location.href);
    navState = 'navigating';
    try {
      sessionStorage.setItem(LS.nav, JSON.stringify({
        from: from, to: to, href: href,
        title: (pf.next.innerText || '').trim(), ts: Date.now(), tab: TAB_ID
      }));
    } catch (e) { /* ignore */ }
    log('ok', '执行跳转：node ' + from + ' → ' + to + '（' + href + '）');
    // 整页跳转；平台会在 unload 时用 sendBeacon 补报一次学时
    try { location.href = href; }
    catch (e) { log('error', '跳转失败：' + e.message); navState = 'idle'; }
  }

  function lastSectionAction() {
    endedFired = true;
    log('ok', '已到目录最后一节，按设置执行：' + (cfg.lastAction === 'back' ? '返回课程页' : '原地停止'));
    if (cfg.lastAction === 'back') {
      const a = $('a[href*="/user/course?courseId="]');
      if (a) { try { location.href = a.getAttribute('href'); } catch (e) { /* ignore */ } }
    }
  }

  // ==================== 主循环 ====================
  let tickCount = 0;
  function tick() {
    tickCount++;
    findVideo();
    if (tickCount % 2 === 0) heartbeat();   // 每 2 秒

    if (standby) { render(); return; }

    // 页面一进来就是「已完成」且用户允许跳过
    if (cfg.enabled && cfg.skipCompleted && !armed && !endedFired && navState === 'idle') {
      const st = $('#study-state');
      if (st && parseInt(st.value || '0', 10) === 2 && catalogStable(catalogItems())) {
        log('info', '本节状态为已完成，按设置直接切下一节');
        armed = true;
        onEnded(true);
      }
    }

    // ended 兜底：有些播放器只改界面不派发原生 ended
    if (cfg.enabled && armed && !endedFired && navState === 'idle' && video && video.duration > 10) {
      if (video.ended || video.currentTime >= video.duration - 1.2) {
        log('info', 'ended 兜底判定命中', { ended: video.ended, at: Math.round(video.currentTime), duration: Math.round(video.duration) });
        onEnded();
      }
    }

    if (navState === 'waiting') {
      if (video && !video.paused && !video.ended) { cancelWait('视频被重新播放（可能是本人操作）'); }
      else if (Date.now() >= waitUntil) { doNavigate(); }
    }

    if (cfg.enabled && video && video.paused && !video.ended && !armed && !endedFired && navState === 'idle') {
      tryAutoPlay();
    }

    render();
  }

  // ==================== 面板 ====================
  const PANEL_ID = 'xh-an-panel';
  let panelEl = null;

  const CSS = `
    #${PANEL_ID}{position:fixed;right:14px;bottom:14px;z-index:2147483647;width:352px;max-height:78vh;
      background:#fff;border:1px solid #d8dee4;border-radius:10px;box-shadow:0 6px 28px rgba(27,31,36,.18);
      font:13px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#24292f;
      display:flex;flex-direction:column;overflow:hidden}
    #${PANEL_ID}.collapsed{width:auto;max-height:none}
    #${PANEL_ID} .hd{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#f6f8fa;border-bottom:1px solid #d8dee4;cursor:default}
    #${PANEL_ID} .hd b{font-size:13px;flex:1}
    #${PANEL_ID} .dot{width:9px;height:9px;border-radius:50%;background:#2da44e;flex:none}
    #${PANEL_ID} .dot.off{background:#8c959f}#${PANEL_ID} .dot.warn{background:#bf8700}#${PANEL_ID} .dot.err{background:#cf222e}
    #${PANEL_ID} .mini{padding:2px 7px;border:1px solid #d0d7de;background:#fff;border-radius:5px;cursor:pointer;color:#24292f;font-size:12px}
    #${PANEL_ID} .body{padding:10px 11px;overflow:auto;flex:1}
    #${PANEL_ID} .risk{background:#fff8e6;border:1px solid #f0d399;color:#7d4e00;border-radius:6px;padding:7px 9px;font-size:11.5px;margin-bottom:9px}
    #${PANEL_ID} .status{background:#f6f8fa;border:1px solid #eaeef2;border-radius:6px;padding:8px 9px;margin-bottom:9px;white-space:pre-wrap;font-size:12px}
    #${PANEL_ID} .row{display:flex;align-items:center;gap:6px;margin:6px 0;flex-wrap:wrap;font-size:12px}
    #${PANEL_ID} .row label{display:flex;align-items:center;gap:4px;cursor:pointer}
    #${PANEL_ID} input[type=number]{width:52px;padding:2px 4px;border:1px solid #d0d7de;border-radius:4px;font-size:12px}
    #${PANEL_ID} select{padding:2px 4px;border:1px solid #d0d7de;border-radius:4px;font-size:12px;background:#fff;color:#24292f}
    #${PANEL_ID} .warn{color:#cf222e;font-size:11.5px;line-height:1.4}
    #${PANEL_ID} .btns{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}
    #${PANEL_ID} hr{border:0;border-top:1px solid #eaeef2;margin:10px 0}
    #${PANEL_ID} pre{margin:0;max-height:190px;overflow:auto;background:#fbfcfd;border:1px solid #eaeef2;border-radius:6px;
      padding:7px;font:11px/1.5 Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-all;color:#57606a}
    #${PANEL_ID} .foot{padding:6px 11px;border-top:1px solid #eaeef2;font-size:11px;color:#8c959f;background:#fafbfc}
  `;

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.innerHTML =
      '<div class="hd"><span class="dot" id="xh-an-dot"></span><b>星瀚金建 · 顺序连播</b>' +
        '<button class="mini" id="xh-an-toggle">收起</button></div>' +
      '<div class="body" id="xh-an-body">' +
        '<div class="risk">本站明示禁止多窗口/并行刷课，并有反作弊统计。本脚本只做单页顺序连播：不伪造学时、不拖进度、不默认倍速。<b>不承诺防检测，使用风险自负。</b></div>' +
        '<div class="status" id="xh-an-status">初始化…</div>' +
        '<div class="row"><label><input type="checkbox" id="xh-an-enabled"> 启用自动切换</label>' +
          '<label><input type="checkbox" id="xh-an-muted"> 静音</label>' +
          '<label><input type="checkbox" id="xh-an-visible"> 后台不切</label></div>' +
        '<div class="row"><label>倍速 <select id="xh-an-rate">' +
          '<option value="1">1.0 原速（推荐）</option><option value="1.25">1.25</option>' +
          '<option value="1.5">1.5</option><option value="2">2.0</option></select></label>' +
          '<label>播完等 <input type="number" id="xh-an-min" min="0" max="600"> ~ ' +
          '<input type="number" id="xh-an-max" min="0" max="600"> 秒</label></div>' +
        '<div class="warn" id="xh-an-rate-warn" style="display:none">⚠ 平台按「真实播放秒数」计学时，倍速会让本节累计秒数少于视频时长，可能导致学时不足。</div>' +
        '<div class="row"><label><input type="checkbox" id="xh-an-skip"> 跳过已完成节</label>' +
          '<label>末节 <select id="xh-an-last"><option value="stop">原地停止</option>' +
          '<option value="back">返回课程页</option></select></label></div>' +
        '<div class="btns">' +
          '<button class="mini" id="xh-an-next">立即切下一节</button>' +
          '<button class="mini" id="xh-an-export">导出日志</button>' +
          '<button class="mini" id="xh-an-clear">清空日志</button>' +
          '<button class="mini" id="xh-an-reset">恢复默认</button></div>' +
        '<hr><div style="font-size:12px;margin-bottom:5px">运行日志（跨页保留，最多 300 条）</div>' +
        '<pre id="xh-an-log"></pre>' +
      '</div>' +
      '<div class="foot">v1.0.2 · 只切目录里紧挨着的 1 节 · 原速 · 单页顺序连播</div>';
    document.body.appendChild(panelEl);

    const bind = function (id, ev, fn) { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    const syncInputs = function () {
      document.getElementById('xh-an-enabled').checked = cfg.enabled;
      document.getElementById('xh-an-muted').checked = cfg.muted;
      document.getElementById('xh-an-visible').checked = cfg.requireVisible;
      document.getElementById('xh-an-rate').value = String(cfg.playbackRate);
      document.getElementById('xh-an-min').value = cfg.waitMinSec;
      document.getElementById('xh-an-max').value = cfg.waitMaxSec;
      document.getElementById('xh-an-skip').checked = cfg.skipCompleted;
      document.getElementById('xh-an-last').value = cfg.lastAction;
      document.getElementById('xh-an-rate-warn').style.display = Number(cfg.playbackRate) > 1 ? 'block' : 'none';
    };
    syncInputs();

    bind('xh-an-enabled', 'change', function (e) { cfg.enabled = e.target.checked; saveCfg(); log('info', '自动切换：' + (cfg.enabled ? '启用' : '停用')); });
    bind('xh-an-muted', 'change', function (e) {
      cfg.muted = e.target.checked; saveCfg();
      if (video) { try { video.muted = cfg.muted; } catch (err) { /* ignore */ } }
      log('info', '静音：' + cfg.muted + '（静音只影响声音，不影响学时）');
    });
    bind('xh-an-visible', 'change', function (e) { cfg.requireVisible = e.target.checked; saveCfg(); });
    bind('xh-an-rate', 'change', function (e) {
      cfg.playbackRate = Number(e.target.value); saveCfg();
      document.getElementById('xh-an-rate-warn').style.display = cfg.playbackRate > 1 ? 'block' : 'none';
      if (video && !video.paused) { try { video.playbackRate = cfg.playbackRate; } catch (err) { /* ignore */ } }
      log('warn', '倍速设为 ' + cfg.playbackRate + '：平台按真实播放秒数计学时，学时可能不足');
    });
    bind('xh-an-min', 'change', function (e) { cfg.waitMinSec = Math.max(0, Number(e.target.value) || 0); saveCfg(); });
    bind('xh-an-max', 'change', function (e) { cfg.waitMaxSec = Math.max(cfg.waitMinSec, Number(e.target.value) || 0); saveCfg(); });
    bind('xh-an-skip', 'change', function (e) { cfg.skipCompleted = e.target.checked; saveCfg(); });
    bind('xh-an-last', 'change', function (e) { cfg.lastAction = e.target.value; saveCfg(); });
    bind('xh-an-next', 'click', function () {
      log('info', '手动触发「立即切下一节」');
      navState = 'idle'; endedFired = false;
      onEnded(true);
    });
    bind('xh-an-export', 'click', exportLogs);
    bind('xh-an-clear', 'click', clearLogs);
    bind('xh-an-reset', 'click', function () { cfg = Object.assign({}, DEFAULT_CFG); saveCfg(); syncInputs(); log('info', '已恢复默认设置'); });
    bind('xh-an-toggle', 'click', function () {
      const c = panelEl.classList.toggle('collapsed');
      document.getElementById('xh-an-body').style.display = c ? 'none' : '';
      document.getElementById('xh-an-toggle').textContent = c ? '展开' : '收起';
    });
  }

  function renderLog() {
    const pre = document.getElementById('xh-an-log');
    if (!pre) return;
    const arr = readJSONArray(localStorage.getItem(LS.logs)).slice(-60);
    pre.textContent = arr.map(function (r) {
      return new Date(r.t).toLocaleTimeString('zh-CN', { hour12: false }) + ' [' + r.level + '] n' + (r.page || '?') + ' ' + r.msg;
    }).join('\n') || '(暂无日志)';
    pre.scrollTop = pre.scrollHeight;
  }

  function render() {
    if (!panelEl) return;
    const dot = document.getElementById('xh-an-dot');
    const st = document.getElementById('xh-an-status');
    if (!dot || !st) return;

    const items = catalogItems(), idx = currentIndex(items), next = nextAnchor(items, idx);
    const v = video;
    const realSec = Math.round((playedMs + (playStart ? Date.now() - playStart : 0)) / 1000);
    const lines = [];
    lines.push('当前节：node ' + (nodeIdFrom(location.href) || '?') + '　目录第 ' + (idx + 1) + '/' + items.length + ' 节');
    lines.push('视频：' + (v ? fmt(v.currentTime) + ' / ' + fmt(v.duration) + (v.paused ? '（暂停）' : '（播放中）') : '未找到 video 元素'));
    lines.push('本节累计真实播放：' + fmt(realSec) + '　倍速：' + (v ? v.playbackRate : cfg.playbackRate));
    lines.push('下一节：' + (next ? 'node ' + nodeIdFrom(next.getAttribute('href')) + ' ' + (next.innerText || '').trim() : '无（已到最后一节）'));
    if (navState === 'waiting') lines.push('⏳ 切换倒计时：' + Math.max(0, Math.ceil((waitUntil - Date.now()) / 1000)) + ' 秒');
    if (needUserGesture) lines.push('⚠ 请本人手动点一下播放器左下角播放按钮（只需一次）');
    if (standby) lines.push('⏸ 待命：' + standbyReason);
    if (landingFailed) lines.push('⛔ 落点校验失败，已停用自动切换（查看日志）');
    if (videoError) lines.push('⏸ 视频加载失败，等待恢复');
    if (!cfg.enabled) lines.push('（脚本已停用）');
    st.textContent = lines.join('\n');

    dot.className = 'dot' + (!cfg.enabled || standby ? ' off' : (landingFailed ? ' err' : (needUserGesture ? ' warn' : '')));
  }

  // ==================== 启动 ====================
  function boot() {
    if (location.pathname.indexOf('/user/node') !== 0) return;
    verifyLanding();
    buildPanel();
    findVideo();
    heartbeat();
    log('info', '脚本启动 · node=' + nodeIdFrom(location.href) + ' · 只切紧邻下一节 · 默认原速', {
      ua: navigator.userAgent.slice(0, 60), rate: cfg.playbackRate, muted: cfg.muted
    });
    const items = catalogItems();
    if (!items.length) log('warn', '未找到课程目录（.detmain-navlist .list .item），脚本不会切换');
    if (!$('#videoContent')) log('warn', '未找到 #videoContent，可能不是视频播放页');
    renderLog();
    render();
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () {
      log('info', '页面可见性：' + document.visibilityState);
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
