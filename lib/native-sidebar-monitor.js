(() => {
  const PALETTE_DEFS = {
    gemini: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, rgba(66,133,244,0.22) 18deg, #4285F4 44deg, #9B72CB 74deg, #EB4335 104deg, #FABC05 130deg, #34A853 152deg, rgba(52,168,83,0.18) 172deg, transparent 180deg, rgba(66,133,244,0.22) 198deg, #4285F4 224deg, #9B72CB 254deg, #EB4335 284deg, #FABC05 310deg, #34A853 332deg, rgba(52,168,83,0.18) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, #4285F4, #9B72CB, #EB4335, #FABC05, #34A853)',
      tint: '#4285F4'
    },
    aurora: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, rgba(41,224,158,0.22) 18deg, #29E09E 48deg, #26BDFA 84deg, #7561FA 120deg, #DB70FA 150deg, rgba(219,112,250,0.18) 172deg, transparent 180deg, rgba(41,224,158,0.22) 198deg, #29E09E 228deg, #26BDFA 264deg, #7561FA 300deg, #DB70FA 330deg, rgba(219,112,250,0.18) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, #29E09E, #26BDFA, #7561FA, #DB70FA)',
      tint: '#26BDFA'
    },
    colorful: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, rgba(51,209,112,0.22) 18deg, #33D170 46deg, #2E94F2 78deg, #AD57F2 110deg, #FA57A3 138deg, #FA9E38 156deg, rgba(250,158,56,0.18) 172deg, transparent 180deg, rgba(51,209,112,0.22) 198deg, #33D170 226deg, #2E94F2 258deg, #AD57F2 290deg, #FA57A3 318deg, #FA9E38 336deg, rgba(250,158,56,0.18) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, #33D170, #2E94F2, #AD57F2, #FA57A3, #FA9E38)',
      tint: '#AD57F2'
    },
    neon: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, rgba(0,214,250,0.24) 18deg, #00D6FA 50deg, #4766FF 90deg, #D133FA 126deg, #FA3394 152deg, rgba(250,51,148,0.2) 172deg, transparent 180deg, rgba(0,214,250,0.24) 198deg, #00D6FA 230deg, #4766FF 270deg, #D133FA 306deg, #FA3394 332deg, rgba(250,51,148,0.2) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, #00D6FA, #4766FF, #D133FA, #FA3394)',
      tint: '#00D6FA'
    },
    accent: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--primary, #4285F4) 24%, transparent) 18deg, var(--primary, #4285F4) 68deg, color-mix(in srgb, var(--primary, #4285F4) 62%, #ffffff) 118deg, var(--primary, #4285F4) 152deg, color-mix(in srgb, var(--primary, #4285F4) 20%, transparent) 172deg, transparent 180deg, color-mix(in srgb, var(--primary, #4285F4) 24%, transparent) 198deg, var(--primary, #4285F4) 248deg, color-mix(in srgb, var(--primary, #4285F4) 62%, #ffffff) 298deg, var(--primary, #4285F4) 332deg, color-mix(in srgb, var(--primary, #4285F4) 20%, transparent) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, var(--primary, #4285F4), color-mix(in srgb, var(--primary, #4285F4) 68%, #ffffff))',
      tint: 'var(--primary, #4285F4)'
    },
    quota: {
      gradient: 'conic-gradient(from 0deg, transparent 0deg, rgba(16,185,129,0.22) 18deg, #10B981 54deg, #F59E0B 104deg, #EF4444 148deg, rgba(239,68,68,0.18) 172deg, transparent 180deg, rgba(16,185,129,0.22) 198deg, #10B981 234deg, #F59E0B 284deg, #EF4444 328deg, rgba(239,68,68,0.18) 352deg, transparent 360deg)',
      staticBorder: 'linear-gradient(120deg, #10B981, #F59E0B, #EF4444)',
      tint: '#10B981'
    }
  };
  const WAITING_GRADIENT = 'conic-gradient(from 0deg, transparent 0deg, rgba(245,158,11,0.26) 18deg, #F59E0B 60deg, #FDE047 110deg, #EA580C 150deg, rgba(245,158,11,0.2) 172deg, transparent 180deg, rgba(245,158,11,0.26) 198deg, #F59E0B 240deg, #FDE047 290deg, #EA580C 330deg, rgba(245,158,11,0.2) 352deg, transparent 360deg)';
  const WAITING_STATIC = 'linear-gradient(120deg, #F59E0B, #FDE047, #EA580C)';

  function resolveEffectivePalette(opts = {}) {
    const choice = opts?.sidebarRunningBeamPalette || 'sync';
    if (choice === 'sync') {
      const synced = opts?.composerWorkingBeamPalette || 'gemini';
      return PALETTE_DEFS[synced] ? synced : 'gemini';
    }
    return PALETTE_DEFS[choice] ? choice : 'gemini';
  }

  function buildStylesheet() {
    const paletteRules = Object.entries(PALETTE_DEFS).map(([key, def]) =>
      `html[data-agy-sb-palette="${key}"]{--agy-sb-beam-bg:${def.gradient};--agy-sb-beam-static:${def.staticBorder};--agy-sb-beam-tint:${def.tint}}`
    ).join('\n');
    return `
      ${paletteRules}
      @keyframes agy-sb-beam-spin{
        from{transform:translate(-50%,-50%) rotate(0turn)}
        to{transform:translate(-50%,-50%) rotate(1turn)}
      }
      @keyframes agy-sb-dot-pulse{
        0%,100%{opacity:1;transform:scale(1)}
        50%{opacity:.45;transform:scale(.82)}
      }
      .agy-sidebar-row[data-agy-sb-running="true"],
      .pt-run-item[data-agy-sb-running="true"]{
        position:relative;
        isolation:isolate;
      }
      .agy-sidebar-row[data-agy-sb-running="true"]{
        border-radius:var(--agy-sb-row-radius,8px);
        box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 22%,transparent),inset 0 0 12px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 9%,transparent);
        transition:box-shadow 220ms ease,background-color 180ms ease;
      }
      .dark .agy-sidebar-row[data-agy-sb-running="true"]{
        box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 28%,transparent),inset 0 0 14px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 13%,transparent);
      }
      .agy-sidebar-row[data-agy-sb-state="waiting"],
      .pt-run-item[data-agy-sb-state="waiting"]{
        --agy-sb-beam-bg:${WAITING_GRADIENT};
        --agy-sb-beam-static:${WAITING_STATIC};
        --agy-sb-beam-tint:#F59E0B;
      }
      .agy-sb-beam-layer{
        position:absolute;
        inset:0;
        border-radius:inherit;
        padding:1.5px;
        pointer-events:none;
        overflow:hidden;
        z-index:2;
        box-sizing:border-box;
        -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        -webkit-mask-composite:xor;
        mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
        mask-composite:exclude;
      }
      .agy-sb-beam-layer::before{
        content:"";
        position:absolute;
        left:50%;
        top:50%;
        width:max(340px,180%);
        aspect-ratio:1;
        transform:translate(-50%,-50%);
        background:var(--agy-sb-beam-static,linear-gradient(120deg,#4285F4,#9B72CB,#34A853));
        opacity:.88;
      }
      .dark .agy-sb-beam-layer::before{opacity:.96}
      @media (prefers-reduced-motion: no-preference){
        html:not([data-agy-sb-paused="true"]) .agy-sb-beam-layer::before{
          background:var(--agy-sb-beam-bg,conic-gradient(from 0deg,#4285F4,#9B72CB,#EB4335,#FABC05,#34A853,#4285F4));
          will-change:transform;
          animation:agy-sb-beam-spin 2.8s linear infinite;
        }
        html:not([data-agy-sb-paused="true"]) .pt-run-item[data-agy-sb-state="waiting"] .agy-sb-beam-layer::before,
        html:not([data-agy-sb-paused="true"]) .agy-sidebar-row[data-agy-sb-state="waiting"] .agy-sb-beam-layer::before{
          animation-duration:2.1s;
        }
        html:not([data-agy-sb-paused="true"]) .pt-run-head-dot{
          animation:agy-sb-dot-pulse 1.8s ease-in-out infinite;
        }
      }
      html[data-agy-sb-hide-spinner="true"] .agy-sidebar-row[data-agy-sb-running="true"] [data-agy-sb-native-spinner="true"]{
        display:none!important;
      }
      .pt-run-group{
        display:flex;
        flex-direction:column;
        gap:5px;
        margin:6px 0;
        padding:7px 0 6px;
        border-top:1px solid color-mix(in srgb,var(--border) 75%,transparent);
        border-bottom:1px solid color-mix(in srgb,var(--border) 75%,transparent);
        width:100%;
        min-width:0;
      }
      .pt-run-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
        padding:0 6px;
        min-height:24px;
      }
      .pt-run-toggle{
        display:inline-flex;
        align-items:center;
        gap:5px;
        min-width:0;
        flex:1;
        padding:2px 2px;
        border:0;
        border-radius:6px;
        background:transparent;
        color:var(--muted-foreground);
        font:inherit;
        font-size:11.5px;
        font-weight:600;
        letter-spacing:.01em;
        cursor:pointer;
        text-align:left;
        transition:color 140ms ease;
      }
      .pt-run-toggle:hover{color:var(--foreground)}
      .pt-run-chev{
        flex:none;
        transition:transform 150ms ease;
      }
      .pt-run-toggle[aria-expanded="true"] .pt-run-chev{transform:rotate(90deg)}
      .pt-run-head-dot{
        width:6px;
        height:6px;
        border-radius:9999px;
        flex:none;
        background:var(--agy-sb-beam-tint,var(--primary,#4285F4));
        box-shadow:0 0 0 2px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 22%,transparent);
      }
      .pt-run-count{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:17px;
        height:16px;
        padding:0 5px;
        border-radius:9999px;
        background:color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 14%,transparent);
        color:var(--foreground);
        font-size:10.5px;
        font-weight:600;
        font-variant-numeric:tabular-nums;
        line-height:1;
        flex:none;
      }
      .pt-run-pause-btn{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:20px;
        height:20px;
        padding:0;
        border:0;
        border-radius:5px;
        background:transparent;
        color:var(--muted-foreground);
        cursor:pointer;
        flex:none;
        transition:background-color 140ms ease,color 140ms ease;
      }
      .pt-run-pause-btn:hover{
        background:var(--sidebar-muted,var(--secondary));
        color:var(--foreground);
      }
      .pt-run-list{
        display:flex;
        flex-direction:column;
        gap:4px;
        max-height:212px;
        overflow-y:auto;
        overflow-x:hidden;
        padding:1px 2px 2px;
        scrollbar-width:thin;
      }
      .pt-run-item{
        display:flex;
        flex-direction:column;
        gap:2px;
        width:100%;
        min-width:0;
        padding:6px 9px;
        border-radius:8px;
        text-decoration:none;
        color:var(--foreground);
        background:color-mix(in srgb,var(--card,var(--background)) 70%,transparent);
        box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 22%,var(--border));
        cursor:pointer;
        box-sizing:border-box;
        transition:background-color 140ms ease,box-shadow 180ms ease;
      }
      .pt-run-item:hover{
        background:var(--sidebar-muted,var(--secondary));
      }
      .pt-run-item[aria-current="page"]{
        background:color-mix(in srgb,var(--sidebar-muted,var(--secondary)) 92%,transparent);
      }
      .pt-run-item[data-agy-sb-running="true"]{
        box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 22%,transparent),inset 0 0 12px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 9%,transparent);
      }
      .dark .pt-run-item[data-agy-sb-running="true"]{
        box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 28%,transparent),inset 0 0 14px color-mix(in srgb,var(--agy-sb-beam-tint,var(--primary,#4285F4)) 13%,transparent);
      }
      .pt-run-top{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
        min-width:0;
      }
      .pt-run-title{
        flex:1;
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-size:12.5px;
        font-weight:500;
        line-height:1.3;
        color:var(--foreground);
      }
      .pt-run-badge{
        display:inline-flex;
        align-items:center;
        gap:3px;
        padding:1px 5px;
        border-radius:9999px;
        font-size:10px;
        font-weight:600;
        line-height:1.25;
        flex:none;
        white-space:nowrap;
        background:color-mix(in srgb,var(--primary,#4285F4) 14%,transparent);
        color:var(--primary,#4285F4);
      }
      .pt-run-badge[data-tone="waiting"]{
        background:color-mix(in srgb,#F59E0B 18%,transparent);
        color:#D97706;
      }
      .dark .pt-run-badge[data-tone="waiting"]{
        background:color-mix(in srgb,#F59E0B 24%,transparent);
        color:#FBBF24;
      }
      .pt-run-badge[data-tone="stopping"]{
        background:var(--secondary);
        color:var(--muted-foreground);
      }
      .pt-run-badge[data-tone="preview"]{
        background:color-mix(in srgb,var(--foreground) 8%,transparent);
        color:var(--muted-foreground);
      }
      .pt-run-meta{
        display:flex;
        align-items:center;
        gap:6px;
        min-width:0;
        font-size:11px;
        line-height:1.25;
        color:var(--muted-foreground);
      }
      .pt-run-proj{
        display:inline-flex;
        align-items:center;
        gap:3px;
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .pt-run-steps{
        flex:none;
        font-variant-numeric:tabular-nums;
        opacity:.85;
      }
    `;
  }

  function extractConversationIdFromHref(href) {
    if (typeof href !== 'string' || !href) return '';
    const match = href.match(/^\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : '';
  }

  function isInteractiveEl(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (el.getAttribute?.('role') === 'button') return true;
    return Boolean(el.closest?.('button,[role="button"]'));
  }

  function findNativeSpinner(row) {
    if (!row || typeof row.querySelectorAll !== 'function') return null;
    const candidates = [...row.querySelectorAll('*')];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const el = candidates[i];
      if (!el || el === row) continue;
      if (el.closest?.('[data-agy-powertools-root]')) continue;
      if (isInteractiveEl(el)) continue;
      const tag = String(el.tagName || '').toUpperCase();
      if (tag === 'A' || tag === 'PATH' || tag === 'CIRCLE' || tag === 'RECT' || tag === 'G' || tag === 'DEFS') continue;
      if (el.querySelector?.('button,[role="button"],a[href]')) continue;
      const text = String(el.textContent || '').trim();
      if (text) continue;

      // Case 1: SVG with 4+ dot primitives (2x2 dot spinner)
      if (tag === 'SVG') {
        const dots = el.querySelectorAll?.('circle,rect,ellipse') || [];
        if (dots.length >= 4) {
          const rect = el.getBoundingClientRect?.();
          if (!rect || (rect.width <= 32 && rect.height <= 32)) return el;
        }
        continue;
      }

      // Case 2: 2x2 HTML dot grid container (4 empty dot children, small footprint)
      const kids = el.children ? [...el.children] : [];
      if (kids.length === 4 && kids.every(k => !String(k.textContent || '').trim() && !isInteractiveEl(k))) {
        const rect = el.getBoundingClientRect?.();
        if (!rect || (rect.width <= 32 && rect.height <= 32)) return el;
      }

      // Case 3: Explicit spinner/running/loading testid or aria-label with empty text
      const marker = `${el.getAttribute?.('data-testid') || ''} ${el.getAttribute?.('aria-label') || ''} ${typeof el.className === 'string' ? el.className : ''}`;
      if (/(?:dot[-_ ]?spinner|loading[-_ ]?dots|running[-_ ]?indicator|status[-_ ]?spinner|four[-_ ]?dots)/i.test(marker)) {
        return el;
      }
    }
    return null;
  }

  function createSidebarMonitor(env) {
    const R = globalThis.React;
    const h = R?.createElement;
    const doc = env.document || globalThis.document;
    const style = doc?.createElement?.('style') || null;
    if (style) {
      style.dataset.agySidebarMonitorStyle = '';
      style.textContent = buildStylesheet();
      doc.head?.append?.(style);
    }

    let paused = false;
    let collapsed = false;
    let disposed = false;
    let storeUnsub = null;
    let storeTimer = null;
    let lastRowSyncKey = '';
    let lastDocAttrKey = '';
    const listeners = new Set();
    let monitorRev = 0;
    const emitMonitor = () => {
      monitorRev++;
      for (const fn of listeners) {
        try { fn(); } catch {}
      }
    };
    const subscribe = fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };

    const uiText = (zh, en) => {
      const lang = env.options?.()?.language || 'zh-CN';
      if (lang === 'en') return en;
      return lang === 'zh-TW' && typeof globalThis.__agyToZhTw === 'function' ? globalThis.__agyToZhTw(zh) : zh;
    };

    function getRunningItems() {
      const opts = env.options?.() || {};
      if (!opts.enabled) return [];
      const raw = typeof env.adapter?.runningConversations === 'function'
        ? env.adapter.runningConversations()
        : [];
      const items = Array.isArray(raw) ? raw.slice() : [];
      if (env.sidebarBeamPreview?.() && items.length === 0) {
        const activeId = env.currentId?.() || '';
        const dir = env.adapter?.conversationDirectory?.() || { byId: {} };
        const meta = activeId ? dir.byId?.[activeId] : null;
        items.push({
          id: activeId || '__preview__',
          title: meta?.title || uiText('预览：进行中的会话', 'Preview: Active conversation'),
          projectId: meta?.projectId || '',
          projectName: meta?.projectName || uiText('流光预览', 'Beam preview'),
          status: 'running',
          activeSubagents: 0,
          stepCount: 0,
          updatedAtMs: Date.now(),
          isCurrent: Boolean(activeId),
          preview: true
        });
      }
      return items;
    }

    function syncDocAttributes() {
      if (disposed || !doc?.documentElement) return;
      const opts = env.options?.() || {};
      const active = Boolean(opts.enabled);
      const beamOn = Boolean(active && opts.sidebarRunningBeam);
      const palette = resolveEffectivePalette(opts);
      const hideSpinner = Boolean(beamOn && opts.sidebarHideNativeSpinner);
      const key = `${beamOn ? palette : ''}|${hideSpinner ? 1 : 0}|${paused ? 1 : 0}`;
      if (key === lastDocAttrKey) return;
      lastDocAttrKey = key;
      if (beamOn) doc.documentElement.setAttribute?.('data-agy-sb-palette', palette);
      else doc.documentElement.removeAttribute?.('data-agy-sb-palette');
      if (hideSpinner) doc.documentElement.setAttribute?.('data-agy-sb-hide-spinner', 'true');
      else doc.documentElement.removeAttribute?.('data-agy-sb-hide-spinner');
      if (paused) doc.documentElement.setAttribute?.('data-agy-sb-paused', 'true');
      else doc.documentElement.removeAttribute?.('data-agy-sb-paused');
    }

    function clearRowDecoration(row) {
      if (!row) return;
      if (row.dataset?.agySbRunning) delete row.dataset.agySbRunning;
      row.removeAttribute?.('data-agy-sb-running');
      if (row.dataset?.agySbState) delete row.dataset.agySbState;
      row.removeAttribute?.('data-agy-sb-state');
      const layers = row.querySelectorAll?.('[data-agy-powertools-root="sidebar-beam"]') || [];
      for (const layer of layers) layer.remove?.();
      const hidden = row.querySelectorAll?.('[data-agy-sb-native-spinner]') || [];
      for (const el of hidden) {
        if (el.dataset?.agySbNativeSpinner) delete el.dataset.agySbNativeSpinner;
        el.removeAttribute?.('data-agy-sb-native-spinner');
      }
    }

    function applyRowDecoration(row, status, hideSpinner) {
      if (!row) return;
      if (row.dataset) {
        row.dataset.agySbRunning = 'true';
        row.dataset.agySbState = status || 'running';
      }
      row.setAttribute?.('data-agy-sb-running', 'true');
      row.setAttribute?.('data-agy-sb-state', status || 'running');
      let layer = row.querySelector?.('[data-agy-powertools-root="sidebar-beam"]') || null;
      if (!layer && typeof doc?.createElement === 'function') {
        layer = doc.createElement('span');
        layer.className = 'agy-sb-beam-layer';
        layer.dataset.agyPowertoolsRoot = 'sidebar-beam';
        layer.setAttribute?.('aria-hidden', 'true');
        if (typeof row.insertBefore === 'function') row.insertBefore(layer, row.firstChild || null);
        else row.append?.(layer);
      }
      if (hideSpinner) {
        const existing = row.querySelector?.('[data-agy-sb-native-spinner="true"]');
        if (!existing) {
          const spinner = findNativeSpinner(row);
          if (spinner) {
            if (spinner.dataset) spinner.dataset.agySbNativeSpinner = 'true';
            spinner.setAttribute?.('data-agy-sb-native-spinner', 'true');
          }
        }
      } else {
        const hidden = row.querySelectorAll?.('[data-agy-sb-native-spinner]') || [];
        for (const el of hidden) {
          if (el.dataset?.agySbNativeSpinner) delete el.dataset.agySbNativeSpinner;
          el.removeAttribute?.('data-agy-sb-native-spinner');
        }
      }
    }

    function sync(force = false) {
      if (disposed || !doc) return;
      ensureStoreSubscription();
      syncDocAttributes();
      const opts = env.options?.() || {};
      const enabled = Boolean(opts.enabled);
      const beamOn = Boolean(enabled && opts.sidebarRunningBeam);
      const hideSpinner = Boolean(beamOn && opts.sidebarHideNativeSpinner);
      const previewOn = Boolean(enabled && env.sidebarBeamPreview?.());
      const items = enabled ? getRunningItems() : [];
      const runningMap = new Map();
      for (const item of items) {
        if (item?.id && item.id !== '__preview__') runningMap.set(item.id, item);
      }
      const rows = typeof doc.querySelectorAll === 'function' ? [...doc.querySelectorAll('.agy-sidebar-row')] : [];
      const activeId = env.currentId?.() || '';
      const sig = [
        enabled ? 1 : 0,
        beamOn ? 1 : 0,
        hideSpinner ? 1 : 0,
        opts.sidebarRunningGroup ? 1 : 0,
        resolveEffectivePalette(opts),
        opts.language || 'zh-CN',
        previewOn ? 1 : 0,
        paused ? 1 : 0,
        activeId,
        rows.length,
        items.map(it => `${it.id}:${it.status}:${it.activeSubagents || 0}:${it.stepCount || 0}:${it.title}:${it.projectName}`).join(',')
      ].join('|');

      let previewFallbackRow = null;
      if (beamOn && previewOn && runningMap.size === 0 && rows.length > 0) {
        previewFallbackRow = rows.find(r => {
          const cid = extractConversationIdFromHref(r.querySelector?.('a[href^="/c/"]')?.getAttribute?.('href'));
          return activeId && cid === activeId;
        }) || rows[0];
      }

      for (const row of rows) {
        if (!beamOn) {
          if (row.dataset?.agySbRunning || row.querySelector?.('[data-agy-powertools-root="sidebar-beam"]')) {
            clearRowDecoration(row);
          }
          continue;
        }
        const href = row.querySelector?.('a[href^="/c/"]')?.getAttribute?.('href') || '';
        const cid = extractConversationIdFromHref(href);
        const info = (cid && runningMap.get(cid)) || (row === previewFallbackRow ? { status: 'running' } : null);
        if (info) applyRowDecoration(row, info.status, hideSpinner);
        else if (row.dataset?.agySbRunning || row.querySelector?.('[data-agy-powertools-root="sidebar-beam"]')) {
          clearRowDecoration(row);
        }
      }

      if (force || sig !== lastRowSyncKey) {
        lastRowSyncKey = sig;
        emitMonitor();
      }
    }

    function ensureStoreSubscription() {
      if (disposed || storeUnsub || typeof env.adapter?.subscribeStore !== 'function') return;
      try {
        const unsub = env.adapter.subscribeStore(() => {
          if (disposed || storeTimer) return;
          storeTimer = setTimeout(() => {
            storeTimer = null;
            if (!disposed) sync();
          }, 120);
        });
        if (typeof unsub === 'function') storeUnsub = unsub;
      } catch {}
    }

    function togglePaused() {
      paused = !paused;
      syncDocAttributes();
      emitMonitor();
    }

    function RunningGroup() {
      if (R?.useSyncExternalStore) R.useSyncExternalStore(subscribe, () => monitorRev);
      const [isCollapsed, setIsCollapsed] = R?.useState ? R.useState(() => collapsed) : [collapsed, () => {}];
      const opts = env.options?.() || {};
      if (!opts.enabled || !opts.sidebarRunningGroup) return null;
      const items = getRunningItems();
      if (!items.length) return null;
      const beamOn = Boolean(opts.sidebarRunningBeam);
      const activeId = env.currentId?.() || '';
      const toggleCollapse = () => {
        collapsed = !isCollapsed;
        setIsCollapsed(collapsed);
      };
      const iconEl = (name, size, extra) => {
        if (typeof env.icon === 'function') return env.icon(name, size, extra);
        return h('span', { 'aria-hidden': true, ...(extra || {}) }, name === 'chevron_right' ? '›' : name === 'pause' ? '⏸' : name === 'play_arrow' ? '▶' : '');
      };
      const statusBadge = item => {
        if (item.preview) return h('span', { className: 'pt-run-badge', 'data-tone': 'preview', 'data-testid': 'agy-run-badge-preview' }, uiText('预览', 'Preview'));
        if (item.status === 'waiting') return h('span', { className: 'pt-run-badge', 'data-tone': 'waiting', 'data-testid': 'agy-run-badge-waiting' }, uiText('待确认', 'Waiting'));
        if (item.status === 'stopping') return h('span', { className: 'pt-run-badge', 'data-tone': 'stopping', 'data-testid': 'agy-run-badge-stopping' }, uiText('停止中', 'Stopping'));
        if (item.activeSubagents > 0) {
          return h('span', { className: 'pt-run-badge', 'data-tone': 'subagent', 'data-testid': 'agy-run-badge-subagents' },
            uiText(`${item.activeSubagents} 子任务`, `${item.activeSubagents} sub`));
        }
        return null;
      };
      return h('section', {
        className: 'pt-run-group',
        'data-testid': 'agy-sidebar-running-group',
        'aria-label': uiText('进行中会话监控', 'Running conversations')
      },
        h('div', { className: 'pt-run-head' },
          h('button', {
            type: 'button',
            className: 'pt-run-toggle',
            'aria-expanded': String(!isCollapsed),
            'data-testid': 'agy-sidebar-running-toggle',
            onClick: toggleCollapse
          },
            iconEl('chevron_right', 14, { className: 'pt-run-chev', 'aria-hidden': true }),
            h('span', { className: 'pt-run-head-dot', 'aria-hidden': true }),
            h('span', { className: 'truncate' }, uiText('进行中', 'Running')),
            h('span', { className: 'pt-run-count', 'data-testid': 'agy-sidebar-running-count' }, String(items.length))),
          beamOn && h('button', {
            type: 'button',
            className: 'pt-run-pause-btn',
            'aria-label': paused ? uiText('恢复流光动画', 'Resume border beam animation') : uiText('暂停流光动画', 'Pause border beam animation'),
            'data-pt-tip': paused ? uiText('恢复流光动画', 'Resume border beam animation') : uiText('暂停流光动画', 'Pause border beam animation'),
            'data-testid': 'agy-sidebar-beam-pause',
            onClick: event => {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              togglePaused();
            }
          }, iconEl(paused ? 'play_arrow' : 'pause', 13, { 'aria-hidden': true }))),
        !isCollapsed && h('div', { className: 'pt-run-list', role: 'list', 'data-testid': 'agy-sidebar-running-list' },
          ...items.map(item => {
            const isCurrent = Boolean(!item.preview && activeId && item.id === activeId);
            const href = item.preview ? undefined : `/c/${encodeURIComponent(item.id)}`;
            const badge = statusBadge(item);
            const tipParts = [item.title];
            if (item.projectName) tipParts.push(uiText(`项目：${item.projectName}`, `Project: ${item.projectName}`));
            if (item.status === 'waiting') tipParts.push(uiText('状态：等待确认', 'Status: Waiting for confirmation'));
            else if (item.status === 'stopping') tipParts.push(uiText('状态：正在停止', 'Status: Stopping'));
            else if (!item.preview) tipParts.push(uiText('状态：进行中', 'Status: Running'));
            return h(item.preview ? 'div' : 'a', {
              key: item.id,
              role: 'listitem',
              href,
              className: 'pt-run-item',
              'aria-current': isCurrent ? 'page' : undefined,
              'data-testid': 'agy-sidebar-running-item',
              'data-conversation-id': item.id,
              'data-agy-sb-running': beamOn ? 'true' : undefined,
              'data-agy-sb-state': beamOn ? (item.status || 'running') : undefined,
              'data-pt-tip': tipParts.join('\n'),
              onClick: item.preview ? undefined : event => {
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
                  event.preventDefault?.();
                  void env.navigateToConversation?.(item.id, item.projectId || '');
                }
              }
            },
              beamOn && h('span', { className: 'agy-sb-beam-layer', 'data-agy-powertools-root': 'sidebar-beam', 'aria-hidden': true }),
              h('div', { className: 'pt-run-top' },
                h('span', { className: 'pt-run-title' }, item.title || item.id),
                badge),
              (item.projectName || item.stepCount > 0) && h('div', { className: 'pt-run-meta' },
                item.projectName && h('span', { className: 'pt-run-proj' },
                  iconEl('folder', 11, { 'aria-hidden': true }),
                  h('span', { className: 'truncate' }, item.projectName)),
                item.stepCount > 0 && h('span', { className: 'pt-run-steps' },
                  uiText(`${item.stepCount} 步`, `${item.stepCount} steps`))));
          })));
    }

    function dispose() {
      disposed = true;
      if (storeTimer) { clearTimeout(storeTimer); storeTimer = null; }
      if (storeUnsub) { try { storeUnsub(); } catch {} storeUnsub = null; }
      if (doc?.querySelectorAll) {
        for (const row of doc.querySelectorAll('.agy-sidebar-row')) clearRowDecoration(row);
      }
      doc?.documentElement?.removeAttribute?.('data-agy-sb-palette');
      doc?.documentElement?.removeAttribute?.('data-agy-sb-hide-spinner');
      doc?.documentElement?.removeAttribute?.('data-agy-sb-paused');
      style?.remove?.();
      listeners.clear();
    }

    ensureStoreSubscription();

    return {
      sync,
      RunningGroup,
      dispose,
      get paused() { return paused; },
      togglePaused,
      getRunningItems
    };
  }

  globalThis.__agySidebarMonitor = createSidebarMonitor;
  globalThis.__agySidebarMonitorHelpers = {
    PALETTE_DEFS,
    resolveEffectivePalette,
    extractConversationIdFromHref,
    findNativeSpinner,
    buildStylesheet
  };
})();
