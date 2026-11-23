// ==UserScript==
// @name         星瀚金建 · 页面结构采集器（只读，不操作）
// @namespace    local.xinghan.probe
// @version      1.0.0
// @description  一键采集课程页/播放页的 DOM、video、iframe、目录、按钮与播放事件，输出 JSON 供离线分析。不点击、不播放、不发送任何网络请求。
// @author       local
// @match        https://cumtyc.xinghanjjkj.com/*
// @match        https://*.xinghanjjkj.com/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

/*
 * 用途：把登录后的真实页面结构导出来，交给脚本作者离线分析。
 * 只读：不点击任何元素、不调用 play()、不改 video 状态、不发网络请求（剪贴板/下载均为本地）。
 *
 * 用法：
 *   1. 装进篡改猴，打开课程页。
 *   2. 页面右上角出现「采集本页结构」按钮，点一下 → 自动生成 JSON 并复制到剪贴板，同时弹出文本框。
 *   3. 请把这 3 个时机各采一次，把三份 JSON 都贴过来：
 *      ① 课程目录页（node?nodeId=802，还没点开视频）
 *      ② 视频播放中（播放到一半）
 *      ③ 视频刚播完那一刻（还没手动点下一节）
 *   4. 若视频在跨域 iframe 里且下方 frames 里没有它的回包，请临时加一条「匹配所有
 *      http/https 域名」的 @match 通配规则（Tampermonkey 的全站匹配写法），
 *      重新加载后再采一次（脚本在其他站点只做监听，不会操作页面）。
 *
 * 采集内容不够细时，改下面的 CONFIG 里的截断上限即可。
 */
(function () {
  'use strict';

  const CONFIG = {
    catalogHtmlLimit: 8000,   // 目录容器 outerHTML 上限
    catalogItemLimit: 60,     // 目录条目数
    itemHtmlLimit: 260,
    videoHtmlLimit: 1200,
    playerHtmlLimit: 2500,
    bodyTextLimit: 3000,
    eventLimit: 80,
    waitFrameMs: 900
  };

  const REQ = '__XH_PROBE_REQ__';
  const RES = '__XH_PROBE_RES__';
  const isTop = (function () { try { return window.top === window; } catch (e) { return false; } })();
  const frameLabel = location.href + (isTop ? '  [top]' : '  [iframe]');

  /* ---------------- 工具 ---------------- */
  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + ' …[截断 +' + (s.length - n) + ' 字符]' : s;
  }
  function safe(fn, fb) {
    try { return fn(); } catch (e) { return fb === undefined ? 'ERR: ' + (e && e.message) : fb; }
  }
  function cls(el) { return typeof el.className === 'string' ? el.className.trim() : ''; }
  function dataAttrs(el) {
    const o = {};
    safe(function () { for (const k in el.dataset) o[k] = clip(el.dataset[k], 120); });
    return o;
  }
  function outer(el, n) { return clip(safe(function () { return el.outerHTML; }, ''), n); }
  function parentChain(el) {
    const parts = [];
    let p = el.parentElement, d = 0;
    while (p && d < 6) {
      const c = cls(p) ? '.' + cls(p).split(/\s+/).slice(0, 3).join('.') : '';
      parts.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + c);
      p = p.parentElement; d++;
    }
    return parts.join(' < ');
  }
  function now() { return new Date().toISOString(); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------------- 播放事件日志（每帧自己记） ---------------- */
  const eventLog = [];
  const domLog = [];
  const boundVideos = new WeakSet();
  let lastTimeupdate = 0;

  function logEvent(type, v, extra) {
    if (eventLog.length >= CONFIG.eventLimit) eventLog.shift();
    eventLog.push({
      t: Date.now(), type: type,
      time: safe(function () { return Math.round(v.currentTime * 10) / 10; }, null),
      duration: safe(function () { return Math.round(v.duration * 10) / 10; }, null),
      paused: safe(function () { return v.paused; }, null),
      rate: safe(function () { return v.playbackRate; }, null),
      extra: extra || null
    });
  }

  function bindVideo(v) {
    if (boundVideos.has(v)) return;
    boundVideos.add(v);
    ['play', 'pause', 'ended', 'waiting', 'playing', 'seeked', 'ratechange', 'volumechange', 'emptied', 'error', 'loadstart', 'loadedmetadata'].forEach(function (t) {
      v.addEventListener(t, function () { logEvent(t, v); }, true);
    });
    v.addEventListener('timeupdate', function () {
      const ts = Date.now();
      if (ts - lastTimeupdate < 5000) return;
      lastTimeupdate = ts;
      logEvent('timeupdate(5s)', v);
    }, true);
    logEvent('found-video', v, { outer: outer(v, CONFIG.videoHtmlLimit) });
  }

  function scanVideos() {
    try {
      document.querySelectorAll('video').forEach(bindVideo);
      document.querySelectorAll('*').forEach(function (el) {
        if (el.shadowRoot) el.shadowRoot.querySelectorAll('video').forEach(bindVideo);
      });
    } catch (e) { /* ignore */ }
  }
  scanVideos();
  setInterval(scanVideos, 2000);

  // 记录后加进来的弹窗 / 播放器节点，用于判断播完后平台弹了什么
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        (m.addedNodes || []).forEach(function (n) {
          if (n.nodeType !== 1) return;
          const key = (n.id || '') + ' ' + cls(n);
          if (!/modal|dialog|popup|layer|mask|alert|confirm|verify|captcha|code|player|toast|tip|message|mask/i.test(key)) return;
          if (domLog.length >= 40) domLog.shift();
          domLog.push({ t: Date.now(), tag: n.tagName, id: n.id, cls: cls(n), text: clip((n.innerText || '').trim(), 120) });
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* ignore */ }

  /* ---------------- 单帧采集 ---------------- */
  function videoInfo(v) {
    return {
      outerHTML: outer(v, CONFIG.videoHtmlLimit),
      id: v.id, className: cls(v), parentChain: parentChain(v),
      src: v.getAttribute('src'), currentSrc: safe(function () { return v.currentSrc; }, null),
      duration: safe(function () { return v.duration; }, null),
      currentTime: safe(function () { return v.currentTime; }, null),
      paused: safe(function () { return v.paused; }, null),
      ended: safe(function () { return v.ended; }, null),
      muted: safe(function () { return v.muted; }, null),
      playbackRate: safe(function () { return v.playbackRate; }, null),
      readyState: safe(function () { return v.readyState; }, null),
      networkState: safe(function () { return v.networkState; }, null),
      autoplay: v.autoplay, controls: v.controls, loop: v.loop,
      inShadowDOM: !!v.getRootNode().host
    };
  }

  function collectFrame() {
    const out = { frame: frameLabel, collectedAt: now() };

    out.meta = {
      url: location.href, title: document.title, readyState: document.readyState,
      ua: navigator.userAgent, isTop: isTop,
      jquery: safe(function () { return window.jQuery && window.jQuery.fn.jquery; }, null),
      bodyText: clip(safe(function () { return document.body.innerText; }, ''), CONFIG.bodyTextLimit)
    };

    // 1) video（含 shadow DOM）
    out.videos = [];
    try {
      document.querySelectorAll('video').forEach(function (v) { out.videos.push(videoInfo(v)); });
      document.querySelectorAll('*').forEach(function (el) {
        if (el.shadowRoot) el.shadowRoot.querySelectorAll('video').forEach(function (v) { out.videos.push(videoInfo(v)); });
      });
    } catch (e) { out.videosError = String(e); }

    // 2) iframe：src、同源可达性、内部 video 数
    out.iframes = Array.from(document.querySelectorAll('iframe')).map(function (f) {
      let accessible = false, innerVideos = null, innerText = null, err = null;
      try {
        const d = f.contentDocument;
        accessible = !!d;
        if (d) {
          innerVideos = d.querySelectorAll('video').length;
          innerText = clip(d.body ? d.body.innerText : '', 400);
        }
      } catch (e) { err = String(e && e.message); }
      return {
        outerHTML: outer(f, 600), src: f.getAttribute('src'), id: f.id, name: f.name,
        className: cls(f), accessible: accessible, innerVideos: innerVideos,
        innerText: innerText, crossOriginError: err
      };
    });

    // 3) 播放器容器（自定义播放器常见 class/id）
    const PLAYER_RE = /ckplayer|dplayer|prism|video-js|vjs-|jwplayer|aliplayer|ali-player|xgplayer|tcplayer|polyv|plyr|flowplayer|h5player|player|play-box|video-box/i;
    out.playerContainers = Array.from(document.querySelectorAll('div,section,video,object,embed'))
      .filter(function (el) {
        return PLAYER_RE.test((el.id || '') + ' ' + cls(el)) &&
          (el.tagName === 'VIDEO' || el.tagName === 'OBJECT' || el.tagName === 'EMBED' || el.querySelector('video,object,embed,canvas'));
      })
      .slice(0, 8)
      .map(function (el) {
        return { tag: el.tagName, id: el.id, className: cls(el), outerHTML: outer(el, CONFIG.playerHtmlLimit) };
      });

    // 4) 目录：找「包含最多课程链接」的祖先容器
    out.catalog = [];
    try {
      const links = Array.from(document.querySelectorAll('a[href]')).filter(function (a) {
        return /node|course|lesson|chapter|video|play|learn|study|class|section/i.test(a.getAttribute('href') || '');
      });
      const scores = new Map();
      links.forEach(function (a) {
        let p = a.parentElement, d = 0;
        while (p && d < 7) { scores.set(p, (scores.get(p) || 0) + 1); p = p.parentElement; d++; }
      });
      const tops = Array.from(scores.entries())
        .filter(function (e) { return e[0] !== document.body && e[0] !== document.documentElement; })
        .sort(function (a, b) { return b[1] - a[1]; })
        .slice(0, 2);
      out.catalog = tops.map(function (entry) {
        const el = entry[0];
        return {
          matchedLinks: entry[1], tag: el.tagName, id: el.id, className: cls(el),
          outerHTML: outer(el, CONFIG.catalogHtmlLimit),
          items: Array.from(el.querySelectorAll('a,li')).slice(0, CONFIG.catalogItemLimit).map(function (it) {
            return {
              tag: it.tagName, text: clip((it.innerText || '').trim(), 70),
              href: it.getAttribute('href'), id: it.id, className: cls(it),
              data: dataAttrs(it), html: outer(it, CONFIG.itemHtmlLimit)
            };
          })
        };
      });
      out.courseLinkCount = links.length;
      out.allCourseLinks = links.slice(0, 40).map(function (a) {
        return { text: clip((a.innerText || '').trim(), 60), href: a.getAttribute('href'), className: cls(a), data: dataAttrs(a) };
      });
    } catch (e) { out.catalogError = String(e); }

    // 5) 当前播放项 / 已完成项的标记 class
    const ACTIVE_RE = /(^|[\s_-])(active|current|cur|playing|now|selected|on|doing|learning|finish|finished|complete|completed|done|watched|study)([\s_-]|$)/i;
    out.stateMarkedItems = Array.from(document.querySelectorAll('[class]'))
      .filter(function (el) { return ACTIVE_RE.test(cls(el)) && (el.innerText || '').trim().length < 90; })
      .slice(0, 25)
      .map(function (el) {
        return { tag: el.tagName, text: clip((el.innerText || '').trim(), 60), className: cls(el), data: dataAttrs(el), html: outer(el, 400) };
      });

    // 6) 下一节 / 继续学习 按钮
    const NEXT_RE = /下一节|下一章|下一单元|下一个|下一讲|下一课|下节|继续学习|继续观看|继续播放|next\s*(lesson|video|chapter)?/i;
    out.nextButtons = Array.from(document.querySelectorAll('a,button,input[type=submit],span,div,li,p,[onclick]'))
      .filter(function (el) {
        const t = (el.innerText || el.value || '').trim();
        return t && t.length < 40 && NEXT_RE.test(t);
      })
      .slice(0, 20)
      .map(function (el) {
        return {
          tag: el.tagName, text: clip((el.innerText || el.value || '').trim(), 60),
          href: el.getAttribute('href'), onclick: clip(el.getAttribute('onclick') || '', 200),
          className: cls(el), id: el.id, html: outer(el, 600)
        };
      });

    // 7) 弹窗 / 验证码 / 遮罩
    out.popups = Array.from(document.querySelectorAll('[class],[id]'))
      .filter(function (el) {
        return /modal|dialog|popup|layer|mask|alert|confirm|verify|captcha|code|toast/i.test((el.id || '') + ' ' + cls(el)) &&
          el.getBoundingClientRect().width > 0;
      })
      .slice(0, 15)
      .map(function (el) {
        return { tag: el.tagName, id: el.id, className: cls(el), text: clip((el.innerText || '').trim(), 150), html: outer(el, 600) };
      });

    // 8) 脚本 / 播放器全局对象 / 常用 class 统计
    out.scripts = Array.from(document.scripts).slice(0, 50).map(function (s) {
      return s.src || ('inline: ' + clip(s.textContent, 150));
    });
    out.playerGlobals = {};
    ['ckplayer', 'CKobject', 'jwplayer', 'videojs', 'DPlayer', 'AliPlayer', 'prismplayer', 'PrismPlayer',
      'flvjs', 'Hls', 'XGPlayer', 'TCPlayer', 'polyvPlayer', 'player', 'myPlayer', 'videoPlayer', 'yee'].forEach(function (k) {
      if (typeof window[k] !== 'undefined') out.playerGlobals[k] = typeof window[k];
    });
    const classFreq = {};
    Array.from(document.querySelectorAll('[class]')).forEach(function (el) {
      cls(el).split(/\s+/).forEach(function (c) {
        if (!c || !/video|play|chapter|lesson|node|catalog|course|item|list|menu|section|progress|time|tree|unit|active|current/i.test(c)) return;
        classFreq[c] = (classFreq[c] || 0) + 1;
      });
    });
    out.classFreq = Object.entries(classFreq).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 60);

    out.eventLog = eventLog.slice();
    out.domLog = domLog.slice();
    return out;
  }

  /* ---------------- 跨 frame 汇总（只 top 出 UI） ---------------- */
  if (!isTop) {
    window.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.__type !== REQ) return;
      let payload;
      try { payload = collectFrame(); } catch (e) { payload = { frame: frameLabel, error: String(e) }; }
      try {
        (ev.source || window.parent).postMessage({ __type: RES, requestId: ev.data.requestId, payload: payload }, '*');
      } catch (e) { /* ignore */ }
    });
    return;
  }

  let collectedFrames = [];
  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.__type !== RES) return;
    collectedFrames.push(ev.data.payload);
  });

  /* ---------------- UI ---------------- */
  function addStyle(css) {
    if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }
  addStyle(`
    #xh-probe-btn{position:fixed;top:12px;right:12px;z-index:2147483647;padding:8px 14px;background:#1f6feb;color:#fff;
      border:0;border-radius:6px;font:14px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25)}
    #xh-probe-btn:hover{background:#1158c7}
    #xh-probe-panel{position:fixed;top:56px;right:12px;width:min(760px,92vw);height:min(70vh,620px);z-index:2147483647;
      background:#fff;border:1px solid #d0d7de;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.28);display:none;flex-direction:column;padding:10px;box-sizing:border-box}
    #xh-probe-panel textarea{flex:1;width:100%;box-sizing:border-box;font:12px/1.4 Menlo,Consolas,monospace;border:1px solid #d0d7de;border-radius:4px;padding:8px;resize:none;color:#24292f;background:#fafbfc}
    #xh-probe-bar{display:flex;gap:8px;align-items:center;margin-bottom:8px;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#24292f;flex-wrap:wrap}
    #xh-probe-bar button{padding:5px 10px;border:1px solid #d0d7de;background:#f6f8fa;border-radius:5px;cursor:pointer;color:#24292f}
    #xh-probe-status{color:#57606a;font-size:12px}
  `);

  const btn = document.createElement('button');
  btn.id = 'xh-probe-btn'; btn.textContent = '采集本页结构';
  const panel = document.createElement('div'); panel.id = 'xh-probe-panel';
  const bar = document.createElement('div'); bar.id = 'xh-probe-bar';
  const status = document.createElement('span'); status.id = 'xh-probe-status';
  status.textContent = '请在 ①目录页 ②播放中 ③刚播完 各采一次';
  const copyBtn = document.createElement('button'); copyBtn.textContent = '复制 JSON';
  const dlBtn = document.createElement('button'); dlBtn.textContent = '下载 .json';
  const closeBtn = document.createElement('button'); closeBtn.textContent = '关闭';
  const ta = document.createElement('textarea'); ta.readOnly = true; ta.spellcheck = false;
  bar.append(status, copyBtn, dlBtn, closeBtn); panel.append(bar, ta);
  document.body.append(btn, panel);

  let lastJson = '';
  function copy(text) {
    if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return true; }
    ta.value = text; ta.select();
    try { return document.execCommand('copy'); } catch (e) { return false; }
  }
  btn.addEventListener('click', function () { panel.style.display = 'flex'; runCollect(); });
  closeBtn.addEventListener('click', function () { panel.style.display = 'none'; });
  copyBtn.addEventListener('click', function () {
    status.textContent = copy(lastJson) ? '已复制到剪贴板 ✓' : '请手动全选文本框复制';
  });
  dlBtn.addEventListener('click', function () {
    if (!lastJson) return;
    const blob = new Blob([lastJson], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xinghan-probe-' + Date.now() + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  });

  async function runCollect() {
    status.textContent = '采集中…（等各 iframe 回包）';
    ta.value = '';
    collectedFrames = [];
    const requestId = String(Date.now());
    try {
      for (let i = 0; i < window.frames.length; i++) {
        try { window.frames[i].postMessage({ __type: REQ, requestId: requestId }, '*'); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    await wait(CONFIG.waitFrameMs);

    const own = collectFrame();
    const payload = {
      generatedAt: now(), page: location.href,
      note: '只读采集：未点击、未播放、未改 video、未发网络请求。frames 里每条对应一个 frame。',
      frameCount: 1 + collectedFrames.length,
      frames: [own].concat(collectedFrames)
    };
    lastJson = JSON.stringify(payload, null, 2);
    ta.value = lastJson;
    const ok = copy(lastJson);
    status.textContent = (ok ? '已复制到剪贴板 ✓ ' : '请手动全选复制 ') +
      '· ' + payload.frameCount + ' 帧 · ' + (lastJson.length / 1024).toFixed(1) + ' KB';
  }
})();
