(() => {
  const PALETTE_DEFS = {
    gemini:['#4285F4','#9B72CB','#EB4335','#FA8C33','#FABC05','#34A853'],
    aurora:['#29E09E','#26BDFA','#7561FA','#DB70FA'],
    colorful:['#33D170','#2E94F2','#AD57F2','#FA57A3','#FA9E38'],
    neon:['#00D6FA','#4766FF','#D133FA','#FA3394'],
    accent:['var(--primary,#4285F4)','color-mix(in srgb,var(--primary,#4285F4) 72%,white)','var(--primary,#4285F4)'],
    quota:['#0D9488','#10B981','#34D399','#34D399','#10B981','#0D9488']
  };

  const QUOTA_TONE_DEFS = {
    ok:['#0D9488','#10B981','#34D399','#34D399','#10B981','#0D9488'],
    warning:['#D97706','#F59E0B','#FBBF24','#FBBF24','#F59E0B','#D97706'],
    critical:['#DC2626','#EF4444','#F87171','#F87171','#EF4444','#DC2626']
  };

  function expandPaletteStops(colors) {
    const list = Array.isArray(colors) && colors.length ? colors : PALETTE_DEFS.gemini;
    if (list.length === 1) return Array.from({ length: 6 }, () => list[0]);
    return Array.from({ length: 6 }, (_, i) => {
      const pos = (i * (list.length - 1)) / 5;
      const lo = Math.floor(pos);
      const hi = Math.min(list.length - 1, lo + 1);
      const frac = pos - lo;
      if (lo === hi || frac < 0.001) return list[lo];
      if (frac > 0.999) return list[hi];
      const hiPct = Math.round(frac * 100);
      return `color-mix(in srgb,${list[lo]} ${100 - hiPct}%,${list[hi]} ${hiPct}%)`;
    });
  }

  function formatStopVars(colors) {
    return expandPaletteStops(colors).map((c, i) => `--agy-stop-${i}:${c}`).join(';');
  }

  function resolveEffectivePalette(opts = {}) {
    const choice = opts?.sidebarRunningBeamPalette || 'sync';
    if (choice === 'sync') {
      const synced = opts?.composerWorkingBeamPalette || 'gemini';
      return PALETTE_DEFS[synced] ? synced : 'gemini';
    }
    return PALETTE_DEFS[choice] ? choice : 'gemini';
  }

  function buildStylesheet() {
    const paletteRules = Object.entries(PALETTE_DEFS).map(([key, colors]) =>
      `html[data-agy-sb-palette="${key}"]{${formatStopVars(colors)}}`
    ).join('\n');
    const quotaToneRules = Object.entries(QUOTA_TONE_DEFS).map(([tone, colors]) =>
      `html[data-agy-sb-palette="quota"][data-agy-sb-quota-tone="${tone}"]{${formatStopVars(colors)}}`
    ).join('\n');
    return `
      ${paletteRules}
      ${quotaToneRules}
      @keyframes agy-sb-sweep{
        0%{transform:translate3d(-56%,0,0);opacity:0}
        10%{opacity:1}
        90%{opacity:1}
        100%{transform:translate3d(104%,0,0);opacity:0}
      }
      [data-agy-sb-running="true"]{position:relative;isolation:isolate;border-radius:8px}
      [data-agy-sb-state="waiting"]{--agy-stop-0:#D97706;--agy-stop-1:#F59E0B;--agy-stop-2:#FCD34D;--agy-stop-3:#FCD34D;--agy-stop-4:#F59E0B;--agy-stop-5:#D97706}
      .agy-sb-beam-layer{position:absolute;inset:0;border-radius:inherit;pointer-events:none;overflow:hidden;z-index:20}
      .agy-sb-beam-glow{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none}
      .agy-sb-beam-border{
        position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;overflow:hidden;
        background:transparent;
        -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
        -webkit-mask-composite:xor;
        mask-composite:exclude;
      }
      .agy-sb-fade{
        position:absolute;inset:0;pointer-events:none;
        -webkit-mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.42) 5%,#000 13%,#000 87%,rgba(0,0,0,.42) 95%,transparent 100%);
        mask-image:linear-gradient(90deg,transparent 0%,rgba(0,0,0,.42) 5%,#000 13%,#000 87%,rgba(0,0,0,.42) 95%,transparent 100%);
      }
      .agy-sb-slide{
        position:absolute;inset:0;pointer-events:none;
        transform:translate3d(22%,0,0);
        opacity:.88;
        will-change:transform,opacity;
      }
      .agy-sb-plume,.agy-sb-edge{
        position:absolute;left:0;
        background:linear-gradient(90deg,transparent 0%,var(--agy-stop-0) 12%,var(--agy-stop-1) 28%,var(--agy-stop-2) 44%,var(--agy-stop-3) 60%,var(--agy-stop-4) 76%,var(--agy-stop-5) 88%,transparent 100%);
      }
      .agy-sb-plume{bottom:-9px;width:52%;min-width:96px;max-width:152px;height:18px;filter:blur(9px);opacity:.26}
      .agy-sb-edge{bottom:-1.5px;width:56%;min-width:104px;max-width:160px;height:4px;filter:blur(.45px);opacity:.92}
      .dark .agy-sb-plume{opacity:.48}
      .dark .agy-sb-edge{opacity:.98}
      .pt-run-group .agy-sb-plume{opacity:.24}
      .dark .pt-run-group .agy-sb-plume{opacity:.44}
      @media (prefers-reduced-motion: no-preference){
        .agy-sb-slide{animation:agy-sb-sweep 2.8s linear infinite}
      }
      html[data-agy-sb-hide-spinner="true"] .agy-sidebar-row[data-agy-sb-running="true"] [data-agy-sb-native-spinner="true"]{
        display:none!important;
      }
      .pt-run-group{
        display:flex;
        flex-direction:column;
        gap:3px;
        margin:4px 0;
        padding:6px 0;
        border-top:1px solid color-mix(in srgb,var(--border) 52%,transparent);
        border-bottom:1px solid color-mix(in srgb,var(--border) 52%,transparent);
        width:100%;
        min-width:0;
      }
      .pt-run-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:6px;
        padding:0;
        min-height:26px;
      }
      .pt-run-toggle{
        display:inline-flex;
        align-items:center;
        gap:6px;
        min-width:0;
        flex:1;
        padding:4px 8px;
        border:0;
        border-radius:8px;
        background:transparent;
        color:var(--muted-foreground);
        font:inherit;
        font-size:12px;
        font-weight:500;
        letter-spacing:.01em;
        cursor:pointer;
        text-align:left;
        transition:color 140ms ease,background-color 140ms ease;
      }
      .pt-run-toggle:hover{color:var(--foreground);background:color-mix(in srgb,var(--sidebar-muted,var(--secondary)) 55%,transparent)}
      .pt-run-toggle:focus-visible{outline:2px solid var(--primary);outline-offset:-2px}
      .pt-run-chev{
        flex:none;
        transition:transform 150ms ease;
      }
      .pt-run-toggle[aria-expanded="true"] .pt-run-chev{transform:rotate(90deg)}
      .pt-run-count{
        margin-inline-start:auto;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:18px;
        height:16px;
        padding:0 5px;
        border-radius:9999px;
        background:color-mix(in srgb,var(--foreground) 7%,transparent);
        color:var(--muted-foreground);
        font-size:10.5px;
        line-height:1;
        font-variant-numeric:tabular-nums;
        font-weight:500;
      }
      .pt-run-list{
        display:flex;
        flex-direction:column;
        gap:2px;
        max-height:212px;
        overflow-y:auto;
        overflow-x:hidden;
        padding:1px 0 2px;
        scrollbar-width:thin;
      }
      .pt-run-item{
        display:flex;
        flex-direction:column;
        gap:2px;
        width:100%;
        min-width:0;
        padding:6px 8px;
        border-radius:8px;
        text-decoration:none;
        color:var(--foreground);
        background:transparent;
        cursor:pointer;
        box-sizing:border-box;
        transition:background-color 140ms ease;
      }
      .pt-run-item:hover{
        background:var(--sidebar-muted,var(--secondary));
      }
      .pt-run-item:focus-visible{
        outline:2px solid var(--primary);
        outline-offset:-2px;
      }
      .pt-run-item[aria-current="page"]{
        background:color-mix(in srgb,var(--sidebar-muted,var(--secondary)) 92%,transparent);
      }
      .pt-run-item[aria-current="page"] .pt-run-title{
        font-weight:500;
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
        font-weight:400;
        line-height:1.3;
        color:var(--foreground);
      }
      .pt-run-badge{
        flex:none;
        display:inline-flex;
        align-items:center;
        height:16px;
        padding:0 6px;
        border-radius:9999px;
        font-size:10px;
        line-height:1;
        font-weight:500;
        white-space:nowrap;
        background:color-mix(in srgb,var(--foreground) 7%,transparent);
        color:var(--secondary-foreground);
      }
      .pt-run-badge[data-tone="subagent"],.pt-run-badge[data-tone="preview"]{
        background:color-mix(in srgb,var(--primary) 14%,transparent);
        color:var(--primary);
      }
      .pt-run-badge[data-tone="waiting"]{
        background:color-mix(in srgb,#F59E0B 16%,transparent);
        color:#925D06;
      }
      .dark .pt-run-badge[data-tone="waiting"]{
        background:color-mix(in srgb,#FBBF24 18%,transparent);
        color:#FBBF24;
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
      .pt-run-steps{margin-inline-start:auto;
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
    let style = null;

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
      if (globalThis.__agyI18n?.uiText) return globalThis.__agyI18n.uiText(zh,en,lang);
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
      const rawTone = beamOn && palette === 'quota' ? String(env.quotaTone?.() || '') : '';
      const quotaTone = QUOTA_TONE_DEFS[rawTone] ? rawTone : '';
      const hideSpinner = Boolean(beamOn && opts.sidebarHideNativeSpinner);
      const key = `${beamOn ? palette : ''}|${quotaTone}|${hideSpinner ? 1 : 0}`;
      if (key === lastDocAttrKey) return;
      lastDocAttrKey = key;
      if (beamOn) doc.documentElement.setAttribute?.('data-agy-sb-palette', palette);
      else doc.documentElement.removeAttribute?.('data-agy-sb-palette');
      if (quotaTone) doc.documentElement.setAttribute?.('data-agy-sb-quota-tone', quotaTone);
      else doc.documentElement.removeAttribute?.('data-agy-sb-quota-tone');
      if (hideSpinner) doc.documentElement.setAttribute?.('data-agy-sb-hide-spinner', 'true');
      else doc.documentElement.removeAttribute?.('data-agy-sb-hide-spinner');
    }

    function mountBeam(layer) {
      if (!layer || layer.firstChild || typeof doc?.createElement !== 'function') return;
      const build = (wrapClass, innerClass) => {
        const wrap = doc.createElement('span');
        wrap.className = wrapClass;
        const fade = doc.createElement('span');
        fade.className = 'agy-sb-fade';
        const slide = doc.createElement('span');
        slide.className = 'agy-sb-slide';
        const inner = doc.createElement('span');
        inner.className = innerClass;
        slide.append(inner);
        fade.append(slide);
        wrap.append(fade);
        return wrap;
      };
      layer.append(build('agy-sb-beam-glow', 'agy-sb-plume'));
      layer.append(build('agy-sb-beam-border', 'agy-sb-edge'));
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
        mountBeam(layer);
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

    let monitorActive = false;
    function sync(force = false) {
      if (disposed || !doc) return;
      const settings = env.options?.() || {};
      const active = Boolean(settings.enabled && (settings.sidebarRunningBeam || settings.sidebarRunningGroup));
      if (!active && !monitorActive) return;
      monitorActive = active;
      if (active) {
        if (!style && doc.createElement) {
          style = doc.createElement('style');
          style.dataset.agySidebarMonitorStyle = '';
          style.textContent = buildStylesheet();
          doc.head?.append?.(style);
        }
        ensureStoreSubscription();
      } else {
        style?.remove?.(); style = null;
        storeUnsub?.(); storeUnsub = null;
        clearTimeout(storeTimer); storeTimer = null;
      }
      syncDocAttributes();
      const opts = env.options?.() || {};
      const enabled = Boolean(opts.enabled);
      const beamOn = Boolean(enabled && opts.sidebarRunningBeam);
      const hideSpinner = Boolean(beamOn && opts.sidebarHideNativeSpinner);
      const previewOn = Boolean(enabled && env.sidebarBeamPreview?.());
      const items = active ? getRunningItems() : [];
      const runningMap = new Map();
      for (const item of items) {
        if (item?.id && item.id !== '__preview__') runningMap.set(item.id, item);
      }
      const rows = typeof doc.querySelectorAll === 'function' ? [...doc.querySelectorAll('.agy-sidebar-row')] : [];
      const activeId = env.currentId?.() || '';
      const effPalette = resolveEffectivePalette(opts);
      const effQuotaTone = beamOn && effPalette === 'quota' ? String(env.quotaTone?.() || '') : '';
      const sig = [
        enabled ? 1 : 0,
        beamOn ? 1 : 0,
        hideSpinner ? 1 : 0,
        opts.sidebarRunningGroup ? 1 : 0,
        effPalette,
        effQuotaTone,
        opts.language || 'zh-CN',
        previewOn ? 1 : 0,
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
        return h('span', { 'aria-hidden': true, ...(extra || {}) }, name === 'chevron_right' ? '›' : '');
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
            h('span', { className: 'truncate' }, uiText('进行中', 'Running')),
            h('span', { className: 'pt-run-count', 'data-testid': 'agy-sidebar-running-count' }, String(items.length)))),
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
              beamOn && h('span', { className: 'agy-sb-beam-layer', 'data-agy-powertools-root': 'sidebar-beam', 'aria-hidden': true },
                h('span', { className: 'agy-sb-beam-glow' }, h('span', { className: 'agy-sb-fade' }, h('span', { className: 'agy-sb-slide' }, h('span', { className: 'agy-sb-plume' })))),
                h('span', { className: 'agy-sb-beam-border' }, h('span', { className: 'agy-sb-fade' }, h('span', { className: 'agy-sb-slide' }, h('span', { className: 'agy-sb-edge' }))))),
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
      doc?.documentElement?.removeAttribute?.('data-agy-sb-quota-tone');
      doc?.documentElement?.removeAttribute?.('data-agy-sb-hide-spinner');
      style?.remove?.();
      listeners.clear();
    }

    return {
      sync,
      RunningGroup,
      dispose,
      getRunningItems
    };
  }

  globalThis.__agySidebarMonitor = createSidebarMonitor;
  globalThis.__agySidebarMonitorHelpers = {
    PALETTE_DEFS,
    QUOTA_TONE_DEFS,
    expandPaletteStops,
    resolveEffectivePalette,
    extractConversationIdFromHref,
    findNativeSpinner,
    buildStylesheet
  };
})();
