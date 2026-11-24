(() => {
  const version = '2.15.0';
  if (globalThis.__agyPowertools?.version === version) return;
  globalThis.__agyPowertools?.dispose();
  if (!document.head || !document.body || !globalThis.ReactDOM?.createRoot || typeof HC !== 'function') {
    if (!globalThis.__agyPowertoolsPending) {
      globalThis.__agyPowertoolsPending = true;
      const retry = () => { delete globalThis.__agyPowertoolsPending; initialize(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true });
      else setTimeout(retry, 200);
    }
    return;
  }
  initialize();

  function initialize() {
    if (globalThis.__agyPowertools) return;
    if (!document.body || !globalThis.ReactDOM?.createRoot || typeof HC !== 'function') return;
    const R = globalThis.React;
    const h = R.createElement;
    const adapter = globalThis.__agyNativeAdapter;
    if (!adapter) return;
    const roots = new Map(), pending = new Map(), changedLabels = new Map(), haloKeys = new WeakMap();
    let sequence = 0, state = null, lastId = '', busy = false, disposed = false;
    let notify = null;
    const defaults = { enabled: true, sshCommandPaste: true, compact: true, userBubbleTint: false, userBubblePreset: 'accent', userBubbleColor: '#2F75C3', userBubbleStrength: 20, contextRing: true, speedStats: true, timing: true, toolDetails: true, responseBranch: true, messageEdit: true, fileContextMenu: true, sessionSearch: true, progress: true, overviewQuota: false, composerQuotaHalo: false, composerQuotaHaloWindow: 'auto', subagentTelemetry: true, keepTurnOutline:true, keepOverviewOpen:true, taskbarBadge:true, multiAccount:false, accountSwitcher:true, accountViewMode:'list', accountQuotaWindow:'5h', autoSwitchAccount:false, proxyEnabled:false, proxyUrl:'', proxyBypass:'localhost,127.0.0.1,::1', proxyForceHttp1:false, stageUpdates:true, efficientIO:false, language: 'zh-CN', overviewRange: 'weeklyQuota', contextLimit: 0, sidebarProjectLimit: 0 };
    const userBubblePresets = { accent: 'var(--primary)', slate: '#52647A', ocean: '#2F6FB8', sage: '#3D7A64', sand: '#9A6B3C', plum: '#6F5A8E' };
    const bubbleFgFor = (tint, strength) => {
      if (strength < 60) return '';
      if (tint === 'var(--primary)') return 'var(--primary-foreground,#ffffff)';
      const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(String(tint || ''));
      if (!m) return '';
      const lum = 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16);
      return lum < 150 ? '#ffffff' : '#111827';
    };
    let options = { ...defaults,...globalThis.__agyInitialSettings }, settingsLoaded = false;
    const t = text => globalThis.__agyI18n?.t(text, options.language) || text;
    const toTw = value => options.language === 'zh-TW' && typeof globalThis.__agyToZhTw === 'function' ? globalThis.__agyToZhTw(value) : value;
    const uiText = (zh, en) => options.language === 'en' ? en : toTw(zh);
    const localizer = globalThis.__agyLocalization;
    const listeners = new Set(); let revision = 0, dashboard = null, account = null, accountFetchedAt = 0, estimates = [], lastConversation = null, lastAccountAt = 0, lastForceAccountAt = 0, lastAccountFailAt = 0, accountReqSeq = 0, loadingDashboard = null, loadingDashboardForce = false, dashboardReqSeq = 0, pageInstalled = false;
    let accountsState = null, loadingAccounts = null, requestedTab = '';
    let proxyStatus = null, loadingProxyStatus = null, proxyBannerCleanup = null, dismissedProxyBannerKey = '', proxyBannerKey = '', proxyBannerMode = 'prompt', proxyBannerMessage = '';
    let subagentList = [], subagentStats = new Map(), lastSubagentKey = '', loadingSubagents = null;
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    const useRevision = () => R.useSyncExternalStore ? R.useSyncExternalStore(subscribe, () => revision) : revision;
    const emit = () => { revision++; for (const listener of listeners) listener(); };
    let renderError='';
    const Boundary=R.Component?class extends R.Component{
      constructor(props){super(props);this.state={failed:false};}
      static getDerivedStateFromError(){return{failed:true};}
      componentDidCatch(error){renderError=error.message;}
      render(){return this.state.failed?(this.props.page?h('div',{role:'alert',className:'p-6 text-muted-foreground'},options.language==='en'?'Powertools needs an update':'Powertools 需要更新'):null):this.props.children;}
    }:null;
    const signalController = new AbortController();
    if (typeof installSshCommandPaste === 'function') installSshCommandPaste(document, { enabled: () => options.enabled && options.sshCommandPaste, text: uiText, signal: signalController.signal });
    const densityStyle = document.createElement('style');
    densityStyle.dataset.agyDensityStyle = '';
    densityStyle.textContent = `
      html[data-agy-keep-outline] [data-testid="overview-panel-host"][style*="--overview-panel-reserve: 336px"],
      html[data-agy-keep-outline] [data-testid="overview-panel-host"][style*="--overview-panel-reserve:336px"]{--conversation-nav-reserve:3.5rem}
      html[data-agy-account-switcher] [data-testid="settings-button"]{display:none!important}
      html[data-agy-user-bubble] [data-testid="user-input-step"] .agy-user-bubble-frame{background:color-mix(in srgb,var(--agy-bubble-tint,var(--primary)) var(--agy-bubble-border,36%),var(--border))!important}
      html[data-agy-user-bubble] [data-testid="user-input-step"] [data-testid="user-message-bubble"]{background:color-mix(in srgb,var(--agy-bubble-tint,var(--primary)) var(--agy-bubble-bg,20%),var(--card))!important}
      html[data-agy-user-bubble][data-agy-bubble-fg] [data-testid="user-input-step"] [data-testid="user-message-bubble"]{color:var(--agy-bubble-fg)!important}
      html[data-agy-user-bubble][data-agy-bubble-fg] [data-testid="user-input-step"] [data-testid="user-message-bubble"] :is(p,div,li,a):not([data-lexical-decorator]){color:inherit!important}
      html[data-agy-compact] [data-testid="agent-response"]{line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is([data-markdown-root],p,li,pre,code,button,.text-base){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is(.text-sm,.text-compact){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is([data-testid="worked-for-collapsible"],[data-testid="agy-completion-tools-toggle"],[data-testid="tool-group-collapsible"],div.group.min-h-8){min-height:24px;padding-block:2px}
      html[data-agy-compact] [data-testid="agent-response"] [data-testid="cascade-system-message-toolbar"]{gap:4px}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"]{line-height:1.4;gap:4px}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"] :is([data-markdown-root],p,pre,code,button,.text-base){line-height:1.4}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"] :is(p,ul,ol){margin-block:.35em}
      html[data-agy-compact] [data-testid="user-input-step"],html[data-agy-compact] [data-testid="user-input-step"] .text-base{line-height:1.4}
      /* Native markdown is a flex column. Keep one source of block spacing,
         including the host's important heading and divider margins. */
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root]{line-height:1.4;gap:0}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(p,ul,ol,blockquote){margin-block:0}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :not(style) + :not(style){margin-block-start:8px}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(h1,h2,h3,h4,h5,h6){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] li{margin-block:2px}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(li,blockquote) > :not(style) + :not(style){margin-block-start:6px}
      /* Important native utilities live in a cascade layer. An earlier host
         layer is required to override them, regardless of specificity. */
      @layer theme {
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(h1,h2,h3,h4,h5,h6){margin-block:12px 0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] blockquote > :first-child{margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] hr{margin-block:12px!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] hr + :not(style){margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :first-child,html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > style + :not(style){margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :last-child{margin-block-end:0!important}
      }
      html[data-agy-compact] [data-testid="user-input-step"]{padding-top:.75rem}
      html[data-agy-compact] [data-agy-powertools-root="completion"]{margin-block:.125rem}
      [data-testid="user-input-step"][data-agy-editing-target]{align-items:stretch!important}
      [data-testid="user-input-step"][data-agy-editing-target] > :not([data-agy-editor-slot]){display:none!important}
      [data-agy-editor-slot]{width:100%}
      @keyframes agy-soft-in{from{opacity:0}to{opacity:1}}
      .agy-quota-halo-root{position:absolute;inset:0;pointer-events:none;z-index:2;border-radius:inherit}
      .agy-quota-halo-svg{position:absolute;inset:-5px;width:calc(100% + 10px);height:calc(100% + 10px);pointer-events:none;overflow:visible}
      .agy-quota-halo-glow{opacity:.22;filter:blur(2.8px);transition:stroke-dasharray 460ms cubic-bezier(.22,1,.36,1),stroke-dashoffset 460ms cubic-bezier(.22,1,.36,1),opacity 260ms ease}
      .dark .agy-quota-halo-glow{opacity:.4}
      .agy-quota-halo-stroke{opacity:.82;transition:stroke-dasharray 460ms cubic-bezier(.22,1,.36,1),stroke-dashoffset 460ms cubic-bezier(.22,1,.36,1),opacity 260ms ease}
      .dark .agy-quota-halo-stroke{opacity:.92}
      [data-agy-powertools-root="ring"],[data-agy-powertools-root="progress"],[data-agy-powertools-root="overview-quota"]{animation:agy-soft-in 140ms ease-out both}
      .agy-composer-footer:has([data-agy-powertools-root="ring"]) > :first-child{overflow:hidden}
      @container input-footer (max-width: 500px){
        [data-testid="agy-speed-stats-trigger"],[data-testid="agy-subagent-speed-stats-trigger"]{width:28px;min-width:28px;padding-inline:0;gap:0;justify-content:center}
        [data-testid="agy-speed-stats-trigger"] .agy-composer-label,[data-testid="agy-subagent-speed-stats-trigger"] .agy-composer-label{display:none}
      }
      @container input-footer (max-width: 400px){
        [data-testid="agy-context-ring-trigger"],[data-testid="agy-subagent-context-ring-trigger"]{width:28px;min-width:28px;padding-inline:0;gap:0;justify-content:center}
        [data-testid="agy-context-ring-trigger"] .agy-composer-label,[data-testid="agy-subagent-context-ring-trigger"] .agy-composer-label{display:none}
      }
      @container input-footer (max-width: 300px){
        [data-testid="agy-subagent-model-chip"]{display:none}
      }
      @container input-footer (max-width: 240px){
        [data-testid="agy-speed-stats-trigger"],[data-testid="agy-subagent-speed-stats-trigger"]{display:none}
      }
    `;
    document.head.append(densityStyle);
    const request = (method, payload) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('连接中断'))); }, method === 'pricing.refresh' ? 18000 : 10000);
      pending.set(id, { resolve, reject, timer });
      globalThis.__agyPowertoolsHost(JSON.stringify({ id, method, ...payload }));
    });
    globalThis.__agyPowertoolsReceive = (id, reply) => {
      const entry = pending.get(id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(id);
      reply.error ? entry.reject(new Error(reply.error)) : entry.resolve(reply);
    };
    let settingsError = '';
    const applyOptions=()=>{if(!options.enabled||!options.messageEdit){if(adapter.pendingEdit)adapter.cancelEdit?.();adapter.clearSuspendedEdits?.();}if(!options.enabled||!options.fileContextMenu)closeFileContextMenu();adapter.setEnabled?.(options.enabled);adapter.setStageUpdates?.(options.stageUpdates);adapter.setEfficientIO?.(options.efficientIO);adapter.setContextLimit?.(options.contextLimit);adapter.setSidebarProjectLimit?.(options.sidebarProjectLimit);};
    const changeSettings = async patch => {
      try {
        const wasMulti = Boolean(options.multiAccount);
        const proxyPatch = patch && typeof patch === 'object' && ('proxyEnabled' in patch || 'proxyUrl' in patch || 'proxyBypass' in patch || 'proxyForceHttp1' in patch);
        options = {...defaults,...await request('settings.set', { settings: patch })};
        applyOptions(); settingsError=''; mount();
        if (!wasMulti && options.multiAccount) {
          void loadAccounts().catch(() => {});
          void refreshAccount(true).catch(() => {});
        }
        if (proxyPatch) {
          dismissedProxyBannerKey = '';
          void loadProxyStatus().catch(() => {});
        } else if (patch && ('enabled' in patch || 'language' in patch)) {
          syncProxyBanner();
        }
      }
      catch(error){settingsError=error.message;}
      emit();
    };
    let autoSwitchTimer = null, autoSwitchTarget = null, deferredAutoSwitchGroup = '', autoSwitchBannerCleanup = null;
    function cancelAutoSwitch() {
      if (autoSwitchTimer) { clearTimeout(autoSwitchTimer); autoSwitchTimer = null; }
      autoSwitchTarget = null;
      deferredAutoSwitchGroup = '';
      autoSwitchBannerCleanup?.();
      autoSwitchBannerCleanup = null;
    }
    function showAutoSwitchBanner(candidate, seconds = 6) {
      autoSwitchBannerCleanup?.();
      if (typeof document?.createElement !== 'function' || !document.body) return;
      const host = document.createElement('div');
      host.dataset.agyPowertoolsRoot = 'autoswitch-banner';
      host.dataset.testid = 'agy-autoswitch-banner';
      host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9200;max-width:340px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--foreground);box-shadow:0 10px 28px rgba(0,0,0,.22);display:flex;align-items:center;gap:12px;font-size:12px';
      const textWrap = document.createElement('div');
      textWrap.style.cssText = 'flex:1;min-width:0;line-height:1.45';
      const name = candidate.alias || candidate.name || candidate.email;
      textWrap.textContent = uiText(`当前账号额度已耗尽，${seconds} 秒后自动切换至 ${name}…`, `Quota depleted. Switching to ${name} in ${seconds}s...`);
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = t('取消');
      cancelBtn.style.cssText = 'flex-shrink:0;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);cursor:pointer;font:inherit';
      cancelBtn.addEventListener('click', () => cancelAutoSwitch());
      host.append(textWrap, cancelBtn);
      document.body.append(host);
      autoSwitchBannerCleanup = () => { host.remove(); };
    }
    function scheduleAutoSwitch(candidate) {
      if (!candidate || autoSwitchTarget?.id === candidate.id || disposed || switchingInProgress) return;
      hideProxyBanner();
      cancelAutoSwitch();
      autoSwitchTarget = candidate;
      showAutoSwitchBanner(candidate, 6);
      autoSwitchTimer = setTimeout(() => {
        autoSwitchTimer = null;
        const target = autoSwitchTarget;
        autoSwitchTarget = null;
        autoSwitchBannerCleanup?.();
        autoSwitchBannerCleanup = null;
        if (!target || disposed || switchingInProgress || !options.enabled || !options.multiAccount || !options.autoSwitchAccount) return;
        if (isTurnRunning()) { deferredAutoSwitchGroup = 'pending'; return; }
        switchingInProgress = true;
        void request('accounts.switch', { accountId: target.id, auto: true, relaunch: true }).catch(() => { switchingInProgress = false; });
      }, 6000);
    }
    async function maybeAutoSwitch(depletedGroupKey) {
      if (switchingInProgress || !options.enabled || !options.multiAccount || !options.autoSwitchAccount || !accountsState?.accounts || accountsState.accounts.length < 2) return;
      if (isTurnRunning()) { deferredAutoSwitchGroup = depletedGroupKey; return; }
      try {
        const res = await request('accounts.autoSwitchCandidate', { depletedGroupKey });
        if (switchingInProgress || disposed || !options.enabled || !options.multiAccount || !options.autoSwitchAccount) return;
        if (res?.candidate && res.cooldownRemainingMs <= 0) scheduleAutoSwitch(res.candidate);
      } catch {}
    }
    let loadingAccount = null, switchingInProgress = false;
    const ACCOUNT_POLL_MS = 60000;
    const ACCOUNT_FORCE_POLL_MS = 150000;
    const ACCOUNT_FAIL_BACKOFF_MS = 10000;
    const TURN_FINISH_FORCE_MIN_GAP_MS = 15000;
    const toResetMs = ts => ts && ts.seconds != null ? Number(ts.seconds) * 1000 + Math.floor((Number(ts.nanos) || 0) / 1e6) : null;
    const applyAccountsSnapshot = res => {
      if (!res?.accounts) return;
      accountsState = {
        activeId: res.activeId,
        accounts: res.accounts,
        vaultSupported: res.vaultSupported,
        ...(res.vaultReason ? { vaultReason: res.vaultReason } : {}),
        lastAutoSwitchAtMs: res.lastAutoSwitchAtMs
      };
    };
    function serializeQuotaGroups(rawGroups) {
      return (Array.isArray(rawGroups) ? rawGroups : [])
        .filter(g => g && typeof g === 'object')
        .map(g => ({
          displayName: typeof g.displayName === 'string' ? g.displayName : '',
          buckets: (Array.isArray(g.buckets) ? g.buckets : [])
            .filter(b => b && b.disabled !== true)
            .map(b => {
              const rawFrac = b.remaining?.case === 'remainingFraction' ? b.remaining.value : b.remainingFraction;
              const remainingFraction = typeof rawFrac === 'number' && Number.isFinite(rawFrac)
                ? Math.max(0, Math.min(1, rawFrac))
                : null;
              const rawResetMs = toResetMs(b.resetTime) ?? (Number.isFinite(b.resetTimeMs) ? b.resetTimeMs : null);
              const resetTimeMs = (remainingFraction != null && remainingFraction >= 1 && b.description === '') ? null : rawResetMs;
              return {
                bucketId: String(b.bucketId || ''),
                window: b.window === 'weekly' || /weekly/i.test(b.bucketId || '') ? 'weekly' : '5h',
                remainingFraction,
                resetTimeMs
              };
            })
        }));
    }
    function refreshAccount(force = false, { allowAutoSwitch = true } = {}){
      if(switchingInProgress || typeof adapter.service !== 'function')return Promise.resolve({ ok: false, skipped: true, synced: false, credentialMismatch: false });
      const isForce = Boolean(force);
      if(loadingAccount && !isForce)return loadingAccount;
      const seq = ++accountReqSeq;
      const reqPromise = Promise.resolve()
        .then(() => adapter.service().retrieveUserQuotaSummary(isForce ? { forceRefresh: true } : {}))
        .then(async reply => {
          if (seq !== accountReqSeq || switchingInProgress || disposed) {
            return { ok: false, stale: true, synced: false, credentialMismatch: false };
          }
          const fetchedAt = Date.now();
          account = reply?.response || null;
          accountFetchedAt = fetchedAt;
          lastAccountAt = fetchedAt;
          lastAccountFailAt = 0;
          if (isForce || !lastForceAccountAt) lastForceAccountAt = fetchedAt;
          emit();
          const cap = adapter.capabilities?.() || {};
          const groups = serializeQuotaGroups(account?.groups);
          let credentialMismatch = false;
          let credentialMismatchInfo = null;
          let synced = false;
          let syncError = '';
          if (options.multiAccount && cap.email && !switchingInProgress) {
            try {
              const next = await request('accounts.syncActive', {
                snapshot: {
                  email: cap.email,
                  name: cap.name || '',
                  avatarUrl: cap.avatarUrl || '',
                  tier: { id: cap.planId || '', name: cap.plan || '' },
                  groups
                }
              });
              if (seq !== accountReqSeq || switchingInProgress || disposed) {
                return { ok: false, stale: true, synced: false, credentialMismatch: false };
              }
              if (next?.credentialMismatch) {
                credentialMismatch = true;
                credentialMismatchInfo = next.credentialMismatch;
              } else if (next?.accounts) {
                synced = true;
              }
              if (next?.accounts && !switchingInProgress) {
                accountsState = next;
                emit();
              }
            } catch (err) {
              syncError = err?.message || uiText('同步账号额度失败', 'Failed to sync account quota');
            }
          } else {
            synced = true;
          }
          if (credentialMismatch) {
            return { ok: false, synced: false, credentialMismatch: true, credentialMismatchInfo, estimates };
          }
          if (allowAutoSwitch && options.enabled && options.multiAccount && options.autoSwitchAccount && !switchingInProgress && seq === accountReqSeq) {
            const depletedGroup = groups.find(g => g.buckets.some(b => b.remainingFraction != null && b.remainingFraction <= 0));
            if (depletedGroup) {
              const meta = globalThis.__agyAccounts?.quotaGroupMeta?.(depletedGroup);
              const key = meta?.key || (/gemini/i.test(depletedGroup.displayName) ? 'gemini' : 'claude');
              void maybeAutoSwitch(key);
            }
          }
          const obsReply = await request('quota.observe', { groups, accountKey: cap.email || '' }).catch(() => null);
          if (seq !== accountReqSeq || switchingInProgress || disposed) {
            return { ok: false, stale: true, synced, credentialMismatch: false };
          }
          if (obsReply?.estimates) {
            estimates = obsReply.estimates;
            emit();
          }
          return { ok: synced, synced, syncError, credentialMismatch: false, estimates };
        })
        .catch(err => {
          if (seq === accountReqSeq) lastAccountFailAt = Date.now();
          throw err;
        })
        .finally(() => {
          if (loadingAccount === reqPromise) loadingAccount = null;
        });
      loadingAccount = reqPromise;
      return reqPromise;
    }
    function loadAccounts(){
      if(loadingAccounts)return loadingAccounts;
      loadingAccounts=request('accounts.list').then(next=>{accountsState=next;emit();return next;}).finally(()=>{loadingAccounts=null;});
      return loadingAccounts;
    }
    async function switchAccount(accountId){
      hideProxyBanner();
      cancelAutoSwitch();
      switchingInProgress = true;
      try {
        const res=await request('accounts.switch',{accountId,relaunch:true});
        applyAccountsSnapshot(res);
        mount();emit();
        const acctLabel=res.account?.name?`${res.account.name} (${res.account.email})`:(res.account?.email||'');
        notify?.({
          title:t('切换账号'),
          message:res.manualRestartRequired
            ?uiText(`凭据已切换至 ${acctLabel}，请手动重启 Antigravity 生效`,`Credentials switched to ${acctLabel}. Please restart Antigravity manually.`)
            :acctLabel,
          tag:'agy-account-switch'
        });
        if (!res.relaunching) switchingInProgress = false;
        return res;
      } catch (error) {
        switchingInProgress = false;
        throw error;
      }
    }
    async function startAddAccount(pendingAlias=''){
      cancelAutoSwitch();
      const prevEmail = String(adapter.capabilities?.()?.email || '').trim().toLowerCase();
      const prep = await request('accounts.prepareAdd',{pendingAlias});
      const prevCredHash = typeof prep?.prevCredHash === 'string' ? prep.prevCredHash : '';
      if(!adapter.startAccountLogin)throw new Error('当前客户端不支持发起登录');
      await adapter.startAccountLogin();
      // Wait briefly for Redux userStatus to reflect the newly authenticated Google account before forcing a fresh quota fetch.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const nextEmail = String(adapter.capabilities?.()?.email || '').trim().toLowerCase();
        if (nextEmail && nextEmail !== prevEmail) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      await refreshAccount(true, { allowAutoSwitch: false }).catch(()=>{});
      const cap = adapter.capabilities?.() || {};
      const nextEmail = String(cap.email || '').trim().toLowerCase();
      const activeSynced = accountsState?.accounts?.find(a => a.id === accountsState.activeId);
      if (options.multiAccount && nextEmail && (!activeSynced || activeSynced.email.toLowerCase() !== nextEmail || !activeSynced.hasCredential)) {
        const synced = await request('accounts.syncActive', {
          snapshot: { email: cap.email, name: cap.name || '', avatarUrl: cap.avatarUrl || '', tier: { id: cap.planId || '', name: cap.plan || '' }, groups: [] }
        }).catch(() => null);
        if (synced?.accounts) { accountsState = synced; emit(); }
      }
      hideProxyBanner();
      cancelAutoSwitch();
      switchingInProgress = true;
      try {
        const res = await request('accounts.completeAdd', {
          email: cap.email || '',
          prevEmail,
          prevCredHash,
          relaunch: true
        });
        if (res?.accounts) {
          applyAccountsSnapshot(res);
        } else {
          await loadAccounts().catch(()=>{});
        }
        mount();emit();
        if (res?.relaunching || res?.manualRestartRequired) {
          const acctLabel = res.account?.name ? `${res.account.name} (${res.account.email})` : (res.account?.email || cap.email || '');
          notify?.({
            title: t('添加账号'),
            message: res.manualRestartRequired
              ? uiText(`已保存 ${acctLabel}，请手动重启 Antigravity 以避免旧账号后台刷新导致回退`, `Saved ${acctLabel}. Please restart Antigravity manually to prevent reverting to the previous account`)
              : uiText(`已保存 ${acctLabel}，正在重启 Antigravity 生效`, `Saved ${acctLabel}. Restarting Antigravity to apply`),
            tag: 'agy-account-add'
          });
        }
        if (!res?.relaunching) switchingInProgress = false;
        return res || { ok: true };
      } catch (error) {
        switchingInProgress = false;
        throw error;
      }
    }
    async function renameAccount(accountId,alias){
      const res=await request('accounts.rename',{accountId,alias});
      applyAccountsSnapshot(res);
      mount();emit();return res;
    }
    async function setAccountDisabled(accountId,disabled){
      const res=await request('accounts.setDisabled',{accountId,disabled});
      applyAccountsSnapshot(res);
      mount();emit();return res;
    }
    async function reorderAccounts(orderedIds){
      const res=await request('accounts.reorder',{orderedIds});
      applyAccountsSnapshot(res);
      mount();emit();return res;
    }
    async function removeAccount(accountId){
      const res=await request('accounts.remove',{accountId});
      applyAccountsSnapshot(res);
      mount();emit();return res;
    }
    async function refreshAccountQuotas(accountId=''){
      const hasKnownAccount = Boolean(accountId && accountsState?.accounts?.some(a => a.id === accountId));
      const isGlobal = !accountId;
      const isActiveTarget = isGlobal || accountId === 'live-current' || accountId === accountsState?.activeId || !hasKnownAccount;
      let syncRes = null;
      if (isActiveTarget) syncRes = await refreshAccount(true);
      const localTargetId = isActiveTarget ? '' : accountId;
      const res = await request('accounts.refreshLocalQuotas', { accountId: localTargetId });
      applyAccountsSnapshot(res);
      mount();emit();
      if (isActiveTarget && syncRes?.credentialMismatch) {
        notify?.({
          title: t('刷新额度'),
          message: uiText('检测到系统凭据与当前显示账号不一致，已跳过同步以保护本地凭据', 'Credential mismatch detected; skipped sync to protect local credentials'),
          tag: 'agy-account-quota-refresh'
        });
        return { ...(res || {}), ok: false, synced: false, credentialMismatch: syncRes.credentialMismatchInfo || true };
      }
      if (isActiveTarget && syncRes && syncRes.synced === false && !syncRes.stale) {
        if (syncRes.syncError) throw new Error(syncRes.syncError);
        return { ...(res || {}), ok: false, synced: false };
      }
      if (!isActiveTarget || !syncRes?.stale) {
        notify?.({
          title: t('刷新额度'),
          message: isGlobal
            ? uiText('已刷新当前账号实时额度，并更新其他账号重置状态', 'Active account quota refreshed and reset windows updated')
            : isActiveTarget
              ? uiText('当前账号实时额度已刷新', 'Active account quota refreshed')
              : uiText('已按重置时间更新该账号状态，实时额度将在切入后同步', 'Reset window status updated; live quota syncs after switching to this account'),
          tag: 'agy-account-quota-refresh'
        });
      }
      return res;
    }
    async function refreshAccountCredentials(accountId=''){
      const res=await request('accounts.refreshCredentials',{accountId});
      applyAccountsSnapshot(res);
      mount();emit();
      const msg=accountId
        ?(res.account?.hasCredential?uiText('系统凭据校验有效','Credential verified'):uiText('未检测到有效凭据，请点击添加账号重新登录','Credential missing or duplicate; please sign in again'))
        :(res.invalid>0
          ?uiText(`已校验 ${res.checked} 个账号：${res.valid} 个有效，${res.invalid} 个需重新登录`,`Checked ${res.checked} accounts: ${res.valid} valid, ${res.invalid} need re-login`)
          :uiText(`全部 ${res.valid} 个账号的系统凭据均有效`,`All ${res.valid} account credentials verified`));
      notify?.({title:t('刷新凭证'),message:msg,tag:'agy-account-cred-refresh'});
      return res;
    }
    let pendingTurnJump = null;
    const openNativeSettings=()=>{document.querySelector('[data-testid="settings-button"]')?.click();};
    const openManagementTab=tabName=>{requestedTab=tabName;emit();void adapter.router?.()?.navigate?.({to:'/powertools'});};
    const consumeRequestedTab=()=>{const next=requestedTab;requestedTab='';return next;};
    const tryFlushPendingTurnJump=()=>{
      if(!pendingTurnJump)return false;
      if(Date.now()>pendingTurnJump.expiresAt){pendingTurnJump=null;return false;}
      if(currentId()===pendingTurnJump.conversationId&&adapter.navigateTurn?.({stepIndexStart:pendingTurnJump.stepIndexStart})){
        pendingTurnJump=null;
        return true;
      }
      return false;
    };
    const jumpToSearchHit=hit=>{
      if(!hit?.conversationId)return;
      if(Number.isInteger(hit.stepIndexStart)&&hit.stepIndexStart>=0){
        pendingTurnJump={conversationId:hit.conversationId,stepIndexStart:hit.stepIndexStart,expiresAt:Date.now()+8000};
      }
      void navigateToConversation(hit.conversationId,hit.projectId||'').then(()=>{
        if(!tryFlushPendingTurnJump()&&pendingTurnJump){
          setTimeout(()=>{if(!disposed)tryFlushPendingTurnJump();},150);
          setTimeout(()=>{if(!disposed)tryFlushPendingTurnJump();},450);
        }
      });
    };
    const isExecActive=ex=>Boolean(ex&&(ex.status===2||ex.status===4||(ex.status===1&&ex.terminationReason!==2&&![1,3,6,11].includes(ex.terminationReason)&&(ex.notFullyIdle||ex.activeSubagents?.length))));
    const isTurnRunning=()=>isExecActive(adapter.executionState?.(currentId()));
    function proxyBannerIdentity(status) {
      if (!status) return '';
      return `${status.reason || ''}:${status.configuredUrl || status.activeUrl || ''}:${status.configuredForceHttp1 ? '1' : '0'}`;
    }
    function hideProxyBanner() {
      proxyBannerCleanup?.();
      proxyBannerCleanup = null;
      proxyBannerKey = '';
      proxyBannerMode = 'prompt';
      proxyBannerMessage = '';
    }
    function dismissProxyBanner() {
      if (proxyStatus) dismissedProxyBannerKey = proxyBannerIdentity(proxyStatus);
      hideProxyBanner();
    }
    async function testProxy(proxyUrl) {
      return request('proxy.test', { proxyUrl });
    }
    async function relaunchWithProxy({ force = false } = {}) {
      const res = await request('proxy.relaunch', { force: force === true });
      if (res?.ok && res?.relaunching) {
        switchingInProgress = true;
        cancelAutoSwitch();
        hideProxyBanner();
      }
      return res;
    }
    function syncProxyBanner() {
      if (disposed || !options.enabled || !proxyStatus || !proxyStatus.mismatch || proxyStatus.canRelaunch === false || switchingInProgress || autoSwitchTarget || proxyStatus.relaunching) {
        hideProxyBanner();
        return;
      }
      const key = proxyBannerIdentity(proxyStatus);
      if (dismissedProxyBannerKey === key) {
        hideProxyBanner();
        return;
      }
      if (typeof document?.createElement !== 'function' || !document.body) return;
      if (proxyBannerKey !== key) {
        proxyBannerMode = 'prompt';
        proxyBannerMessage = '';
      }
      proxyBannerCleanup?.();
      proxyBannerCleanup = null;
      proxyBannerKey = key;

      const en = options.language === 'en';
      const urlText = proxyStatus.configuredDisplayUrl || proxyStatus.activeDisplayUrl || '';
      const host = document.createElement('div');
      host.dataset.agyPowertoolsRoot = 'proxy-prompt-banner';
      host.dataset.testid = 'agy-proxy-prompt-banner';
      host.setAttribute('role', 'status');
      host.setAttribute('style', 'position:fixed;right:18px;bottom:18px;z-index:9150;max-width:380px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--foreground);box-shadow:0 10px 28px rgba(0,0,0,.22);display:flex;flex-direction:column;gap:10px;font-size:12px');

      const msgEl = document.createElement('div');
      msgEl.setAttribute('style', 'line-height:1.5;word-break:break-word');
      if (proxyBannerMode === 'relaunching') {
        msgEl.textContent = uiText('正在重启 Antigravity…', 'Relaunching Antigravity...');
      } else if (proxyBannerMode === 'confirm-running') {
        msgEl.textContent = uiText('当前会话仍有任务正在运行，现在重启会中断本轮生成。', 'A conversation turn is still running. Relaunching now will interrupt generation.');
      } else if (proxyBannerMode === 'unreachable' || proxyBannerMode === 'error') {
        msgEl.textContent = proxyBannerMessage || uiText('代理端口尚未监听，请先启动代理软件。', 'Proxy port is not listening. Start your proxy app first.');
      } else if (proxyStatus.reason === 'needs-disable') {
        msgEl.textContent = uiText('已关闭独立代理，当前窗口仍在使用旧代理，是否重启恢复直连？', 'Proxy was disabled, but this window is still using it. Relaunch to restore direct connection?');
      } else if (proxyStatus.reason === 'config-changed') {
        msgEl.textContent = uiText(`代理配置已变更（${urlText}），是否重启 Antigravity 生效？`, `Proxy settings changed (${urlText}). Relaunch Antigravity to apply?`);
      } else {
        msgEl.textContent = uiText(`已配置独立代理（${urlText}），当前窗口尚未开启，是否重启开启？`, `Proxy (${urlText}) is configured but not active in this window. Relaunch to enable?`);
      }

      const actions = document.createElement('div');
      actions.setAttribute('style', 'display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap');
      const makeBtn = (label, primary, testId, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.dataset.testid = testId;
        btn.setAttribute('style', primary
          ? 'padding:5px 11px;border-radius:7px;border:1px solid transparent;background:var(--primary);color:var(--primary-foreground,#fff);cursor:pointer;font:inherit;font-weight:500'
          : 'padding:5px 10px;border-radius:7px;border:1px solid var(--border);background:var(--secondary);color:var(--foreground);cursor:pointer;font:inherit');
        btn.addEventListener('click', onClick);
        return btn;
      };

      const runRestart = async (force = false) => {
        if (!force && proxyBannerMode === 'prompt' && isTurnRunning()) {
          proxyBannerMode = 'confirm-running';
          syncProxyBanner();
          return;
        }
        proxyBannerMode = 'relaunching';
        syncProxyBanner();
        try {
          const res = await relaunchWithProxy({ force });
          if (res?.portUnreachable) {
            proxyBannerMode = 'unreachable';
            proxyBannerMessage = res.message || res.error || uiText('代理端口未监听，请先启动代理软件。', 'Proxy port is not listening.');
            syncProxyBanner();
          } else if (!res?.ok) {
            proxyBannerMode = 'error';
            proxyBannerMessage = res?.message || res?.error || uiText('重启失败，请稍后重试。', 'Failed to relaunch.');
            syncProxyBanner();
          }
        } catch (error) {
          proxyBannerMode = 'error';
          proxyBannerMessage = error?.message || uiText('重启失败，请稍后重试。', 'Failed to relaunch.');
          syncProxyBanner();
        }
      };

      if (proxyBannerMode === 'prompt') {
        const primaryLabel = proxyStatus.reason === 'needs-disable'
          ? uiText('立即重启恢复', 'Relaunch now')
          : proxyStatus.reason === 'config-changed'
            ? uiText('立即重启生效', 'Relaunch to apply')
            : uiText('立即重启开启', 'Relaunch to enable');
        actions.append(
          makeBtn(uiText('本次忽略', 'Ignore for now'), false, 'agy-proxy-banner-dismiss', () => dismissProxyBanner()),
          makeBtn(primaryLabel, true, 'agy-proxy-banner-relaunch', () => { void runRestart(false); })
        );
      } else if (proxyBannerMode === 'confirm-running') {
        actions.append(
          makeBtn(uiText('取消', 'Cancel'), false, 'agy-proxy-banner-cancel', () => { proxyBannerMode = 'prompt'; syncProxyBanner(); }),
          makeBtn(uiText('仍要重启', 'Relaunch anyway'), true, 'agy-proxy-banner-force', () => { void runRestart(false); })
        );
      } else if (proxyBannerMode === 'unreachable') {
        actions.append(
          makeBtn(uiText('忽略', 'Ignore'), false, 'agy-proxy-banner-dismiss', () => dismissProxyBanner()),
          makeBtn(uiText('重试', 'Retry'), false, 'agy-proxy-banner-retry', () => { void runRestart(false); }),
          makeBtn(uiText('仍要重启', 'Relaunch anyway'), true, 'agy-proxy-banner-force', () => { void runRestart(true); })
        );
      } else if (proxyBannerMode === 'error') {
        actions.append(
          makeBtn(uiText('忽略', 'Ignore'), false, 'agy-proxy-banner-dismiss', () => dismissProxyBanner()),
          makeBtn(uiText('重试', 'Retry'), true, 'agy-proxy-banner-retry', () => { void runRestart(false); })
        );
      }

      host.append(msgEl);
      if (proxyBannerMode !== 'relaunching') host.append(actions);
      document.body.append(host);
      proxyBannerCleanup = () => { host.remove(); };
    }
    function loadProxyStatus() {
      if (loadingProxyStatus) return loadingProxyStatus;
      loadingProxyStatus = request('proxy.status').then(next => {
        if (next && typeof next === 'object') {
          proxyStatus = next;
          syncProxyBanner();
          emit();
        }
        return next;
      }).finally(() => { loadingProxyStatus = null; });
      return loadingProxyStatus;
    }
    const DASHBOARD_QUOTA_STALE_MS = 15000;
    const loadDashboard = (force = false) => {
      const isForce = Boolean(force);
      if (loadingDashboard && (!isForce || loadingDashboardForce)) return loadingDashboard;
      const seq = ++dashboardReqSeq;
      const nowMs = Date.now();
      const cap = adapter.capabilities?.() || {};
      const isVisible = typeof document?.visibilityState !== 'string' || document.visibilityState !== 'hidden';
      const shouldForceQuota = Boolean(isForce || (isVisible && lastAccountAt > 0 && nowMs - lastForceAccountAt >= ACCOUNT_FORCE_POLL_MS));
      const shouldRefreshQuota = Boolean(isForce || !account || nowMs - lastAccountAt > DASHBOARD_QUOTA_STALE_MS);
      const quotaPromise = shouldRefreshQuota && typeof adapter.service === 'function'
        ? Promise.resolve().then(() => refreshAccount(shouldForceQuota)).catch(() => null)
        : null;
      const reqPromise = Promise.all([
        request('dashboard', { force: isForce, accountKey: cap.email || '' }),
        quotaPromise
      ]).then(([data]) => {
        if (seq === dashboardReqSeq) {
          dashboard = data;
          emit();
        }
        return data;
      }).finally(() => {
        if (loadingDashboard === reqPromise) {
          loadingDashboard = null;
          loadingDashboardForce = false;
        }
      });
      loadingDashboard = reqPromise;
      loadingDashboardForce = isForce;
      return reqPromise;
    };
    const panels = globalThis.__agyPanels?.({ adapter, t, version, defaults, project:globalThis.__agyProject, state:()=>state||lastConversation, options:()=>options, account:()=>account, accountFetchedAt:()=>accountFetchedAt||null, accounts:()=>accountsState, proxyStatus:()=>proxyStatus,
      currentState:()=>state?.conversationId===currentId()?state:null,
      dashboard:()=>dashboard, estimates:()=>estimates, capabilities:()=>adapter.capabilities?.(), settingsError:()=>settingsError, change:changeSettings, request, loadDashboard, loadAccounts, switchAccount, startAddAccount, renameAccount, setAccountDisabled, reorderAccounts, removeAccount, refreshAccountQuotas, refreshAccountCredentials, loadProxyStatus, testProxy, relaunchWithProxy, dismissProxyBanner, openNativeSettings, cancelAutoSwitch, openManagementTab, consumeRequestedTab, jumpToSearchHit, isTurnRunning, navigateTurn:turn=>adapter.navigateTurn?.(turn),
      subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}, revision:()=>revision });
    const currentId = () => location.pathname.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    const stateCache = new Map();
    const rememberState = (id, value) => {
      if (!id || !value) return;
      stateCache.delete(id);
      stateCache.set(id, value);
      if (stateCache.size > 32) stateCache.delete(stateCache.keys().next().value);
    };
    const composerConversationId = (model, card) =>
      adapter.composerCascadeId?.(model) || adapter.composerCascadeId?.(card) || currentId();
    const stateForConversation = cid =>
      !cid ? null : (cid === currentId() ? (state?.conversationId === cid ? state : (stateCache.get(cid) || null)) : (stateCache.get(cid) || null));
    const prefetching = new Set();
    const prefetchConversation = id => {
      if (!id || disposed || !options.enabled || prefetching.has(id) || stateCache.has(id)) return;
      prefetching.add(id);
      void request('state', { conversationId: id, execution: adapter.executionState?.(id) })
        .then(reply => {
          rememberState(id, reply);
          if (id === currentId() && state?.conversationId !== id) {
            state = reply; lastConversation = reply;
          }
          mount(); emit();
        })
        .catch(() => {})
        .finally(() => prefetching.delete(id));
    };
    let overviewSnapshot=null, overviewNavigation=null, mountedConversationId='';
    const rememberOverview = event => {
      const link=event.target.closest?.('a[href^="/c/"]');
      if(!link||!options.enabled)return;
      const nextId=link.getAttribute('href')?.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1];
      if(nextId&&event.type==='pointerdown')prefetchConversation(nextId);
      if(!options.keepOverviewOpen)return;
      const panel=adapter.overview?.();
      if(nextId&&nextId!==currentId()&&panel?.cascadeId===currentId()){
        // Capture before the native outside-click handler dismisses an overlay.
        // Preserve the pointerdown snapshot through the following click event.
        if(overviewNavigation?.id!==nextId)overviewNavigation={id:nextId,open:panel.isPanelVisible,at:Date.now()};
      }
    };
    document.addEventListener('pointerdown',rememberOverview,{capture:true,signal:signalController.signal});
    document.addEventListener('click',rememberOverview,{capture:true,signal:signalController.signal});
    let resumeEditTimer = null, resumeEditTargetId = '';
    const clearResumeEditTimer = () => { if (resumeEditTimer) { clearTimeout(resumeEditTimer); resumeEditTimer = null; } resumeEditTargetId = ''; };
    const stopOverviewNavigation=adapter.router?.()?.subscribe?.('onBeforeNavigate',event=>{
      clearResumeEditTimer();
      if(adapter.pendingEdit)adapter.suspendEdit?.();
      const id=event.toLocation?.pathname?.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1];
      if(id)prefetchConversation(id);
      if(!options.enabled||!options.keepOverviewOpen)return;
      const panel=adapter.overview?.();
      if(id&&panel&&panel.cascadeId!==id&&!(overviewNavigation?.id===id&&Date.now()-overviewNavigation.at<5000)){
        overviewNavigation={id,open:panel.isPanelVisible,at:Date.now()};
      }
    });
    const stopResolvedNavigation=adapter.router?.()?.subscribe?.('onResolved',()=>{
      const id=currentId();
      if(id&&stateCache.has(id)){state=stateCache.get(id);lastId=id;}
      mount();
      void refresh();
    });
    function followOverview(){
      const id=currentId(),panel=adapter.overview?.();
      if(!id||panel?.cascadeId!==id)return;
      if(!options.enabled||!options.keepOverviewOpen){overviewNavigation=null;overviewSnapshot={id,open:panel.isPanelVisible};return;}
      if((overviewNavigation?.id===id||overviewSnapshot&&overviewSnapshot.id!==id)&&options.keepOverviewOpen){
        const carry=overviewNavigation?.id===id&&Date.now()-overviewNavigation.at<5000?overviewNavigation.open:overviewSnapshot?.open;
        overviewNavigation=null;
        if(carry&&!panel.isPanelVisible){
          if(panel.presentation==='dropdown')panel.setDropdownOpen(true);
          else if(panel.breakpoint==='small')panel.setOverlayOpen(true);
          else panel.togglePanel();
        }
      }
      overviewSnapshot={id,open:panel.isPanelVisible};
    }
    const tokens = n => n == null ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const duration = ms => ms == null ? '-' : options.language==='en' ? ms>=60000?`${Math.floor(ms/60000)}m ${Math.floor(ms%60000/1000)}s`:`${Math.max(0,Math.round(ms/1000))}s` : ms >= 60000 ? `${Math.floor(ms / 60000)}分${Math.floor(ms % 60000 / 1000)}秒` : `${Math.max(0, Math.round(ms / 1000))}秒`;
    const completed = iso => `${uiText('完成于','Completed at')} ${new Date(iso).toLocaleString(options.language, { hour12: false })}`;
    const row = (label, value, key) => h('div', { key, className: 'flex items-center justify-between gap-3 px-2 py-1 text-compact tabular-nums' },
      h('span', { className: 'text-muted-foreground' }, t(label)), h('span', { className: 'text-foreground whitespace-nowrap' }, value));
    function CacheObservation({data}){
      const [now,setNow]=R.useState(Date.now);
      R.useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
      const cache=globalThis.__agyDashboard.cacheObservation(data.requests,now);
      if(!cache)return null;
      const seconds=Math.ceil((cache.remainingMs||0)/1000),value=cache.remainingMs>0?`≈ ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:uiText('待确认','Unconfirmed');
      const tip=uiText(`按最近请求开始时间计算的五分钟观察窗口，不代表服务端实际到期。最近请求缓存命中 ${cache.hitPercent}%。`,`Five-minute observation window from the last request start, not a server expiry. Last request cache hits: ${cache.hitPercent}%.`);
      return h('div',{title:tip,'data-testid':'agy-cache-observation','data-estimated':'true'},row(uiText('缓存观察','Cache window'),value,'cache-window'));
    }
    const separator = key => h('div', { key, className: 'h-px bg-border my-2 -mx-1' });
    const contextPalette = {
      'Chat Messages': '#2563eb',
      'System Prompt': '#ea580c',
      'Tools': '#0d9488',
      'MCP Tools': '#64748b',
      'MCP tools': '#64748b',
      'Skills': '#78716c',
      'Subagents': '#6366f1',
      'Plugins': '#8b5cf6',
      'Rules': '#94a3b8',
      'Memories': '#a1a1aa',
      'Memory files': '#a1a1aa',
      'Unspecified': '#9ca3af',
      '输入上下文': '#2563eb'
    };
    const fallbackSwatches = ['#64748b', '#78716c', '#94a3b8', '#a1a1aa'];
    const contextCategoryName = (raw, en) => {
      const map = en
        ? { 'Chat Messages': 'Messages', 'System Prompt': 'System prompt', 'Tools': 'System tools', 'MCP Tools': 'MCP tools', 'MCP tools': 'MCP tools', 'Skills': 'Skills', 'Subagents': 'Subagents', 'Plugins': 'Plugins', 'Rules': 'Rules', 'Memories': 'Memory files', 'Memory files': 'Memory files', 'Unspecified': 'Other', '输入上下文': 'Input context', '剩余空间': 'Free space' }
        : { 'Chat Messages': '消息', 'System Prompt': '系统提示', 'Tools': '系统工具', 'MCP Tools': 'MCP 工具', 'MCP tools': 'MCP 工具', 'Skills': '技能', 'Subagents': '子智能体', 'Plugins': '插件', 'Rules': '规则', 'Memories': '记忆文件', 'Memory files': '记忆文件', 'Unspecified': '其他开销', '输入上下文': '输入上下文', '剩余空间': '剩余空间' };
      const label = map[raw] || (en ? raw : t(raw));
      return en ? label : toTw(label);
    };
    const categoryRank = label => {
      if (label === 'Chat Messages' || label === '输入上下文') return 0;
      if (label === 'System Prompt') return 1;
      if (label === 'Tools') return 2;
      if (label === '剩余空间') return 99;
      return 10;
    };

    function Ring({ percent, size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 18 18', className: 'shrink-0 -rotate-90', 'aria-hidden': true },
        h('circle', { cx: 9, cy: 9, r: 6.5, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.2, strokeWidth: 2 }),
        h('circle', { cx: 9, cy: 9, r: 6.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeDasharray: 40.84,
          strokeDashoffset: 40.84 * (1 - Math.min(100, Math.max(0, percent || 0)) / 100) }));
    }

    const moneyText = value => value == null ? '-' : `$${Number(value).toFixed(value !== 0 && value < 0.01 ? 4 : 2)}`;
    function SubagentSectionHeader({ label, count, testId }) {
      return h('div', { className: 'flex items-center gap-1.5 text-compact text-muted-foreground leading-none', style: { height: 18 }, 'data-testid': testId },
        typeof dq === 'function' ? h('span', { className: 'inline-flex items-center justify-center shrink-0 opacity-85 leading-none', style: { transform: 'translateY(-1px)' } }, h(dq, { name: 'smart_toy', size: 14 })) : null,
        h('span', { className: 'font-medium leading-none' }, label),
        count > 0 && h('span', {
          className: 'inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-secondary text-secondary-foreground tabular-nums leading-none',
          style: { fontSize: 10.5 }
        }, String(count)));
    }
    function syncSubagents(conversationId) {
      if (disposed || !options.enabled || !options.subagentTelemetry) {
        if (subagentList.length) { subagentList = []; lastSubagentKey = ''; emit(); }
        return;
      }
      const fromStore = conversationId ? (adapter.subagents?.(conversationId) || []) : [];
      const seen = new Map(fromStore.map(item => [item.id, item]));
      const extraFetchIds = new Set();
      for (const node of document.querySelectorAll('[data-testid="subagent-node"][data-cascade-id]')) {
        const subId = node.dataset?.cascadeId;
        if (subId && subId !== conversationId && !seen.has(subId)) {
          seen.set(subId, { id: subId, parentId: conversationId, depth: 1, typeName: '', role: '', title: (node.textContent || '').trim().slice(0, 48) || 'Subagent', status: 'done', stepCount: 0, createdAtMs: null, lastModifiedAtMs: null });
        }
      }
      for (const card of document.querySelectorAll('.surface-composer-card')) {
        if (card.querySelector('[data-testid="model-selector-trigger"]')) continue;
        const subId = adapter.composerCascadeId?.(card);
        if (subId) extraFetchIds.add(subId);
      }
      const list = [...seen.values()];
      const listChanged = list.length !== subagentList.length || list.some((s, i) => s.id !== subagentList[i]?.id || s.status !== subagentList[i]?.status || s.stepCount !== subagentList[i]?.stepCount);
      subagentList = list;
      if (listChanged) emit();
      const allIds = [...new Set([...list.map(s => s.id), ...extraFetchIds])].slice(0, 32);
      if (!allIds.length) { lastSubagentKey = ''; return; }
      const key = `${conversationId}|${list.map(s => `${s.id}:${s.status}:${s.stepCount}`).join(',')}|${[...extraFetchIds].sort().join(',')}`;
      const hasRunning = list.some(s => s.status === 'running') || extraFetchIds.size > 0;
      const missingAny = allIds.some(id => !subagentStats.has(id));
      if (loadingSubagents || (!hasRunning && !missingAny && key === lastSubagentKey)) return;
      lastSubagentKey = key;
      loadingSubagents = request('subagents.stats', { conversationIds: allIds }).then(res => {
        if (disposed || !res?.items) return;
        let updated = false;
        for (const [id, item] of Object.entries(res.items)) {
          subagentStats.set(id, item);
          updated = true;
        }
        if (updated) emit();
      }).catch(() => {}).finally(() => { loadingSubagents = null; });
    }

    function SubagentStatsBody({ stats }) {
      const en = options.language === 'en';
      const tel = stats?.telemetry || {};
      return h(R.Fragment, null,
        row('累计 Token', tokens(tel.totalTokens), 'sub-tokens'),
        stats.costUsd != null && row('API 参考费用', moneyText(stats.costUsd), 'sub-cost'),
        row('输入', tokens(tel.inputTokens), 'sub-in'),
        row('缓存读取', tokens(tel.cacheReadTokens), 'sub-cache-read'),
        row('输出', tokens(tel.outputTokens), 'sub-out'),
        row('缓存命中', tel.cacheHitPercent == null ? tokens(null) : `${tel.cacheHitPercent}%`, 'sub-cache-hit'),
        tel.thinkingTokens > 0 && row('思考 Token', tokens(tel.thinkingTokens), 'sub-think'),
        row('请求次数', `${tel.requestCount || 0}${tel.errorCount > 0 ? ` (${tel.errorCount} ${t('错误')})` : ''}`, 'sub-reqs'),
        row('工具调用', String(tel.toolCount || 0), 'sub-tools'),
        row('平均速度', tel.tps == null ? tokens(null) : `${tel.tps} tok/s`, 'sub-tps'),
        tel.peakTps != null && row('峰值速度', `${tel.peakTps} tok/s`, 'sub-peak'),
        row('首 Token 延迟', duration(tel.avgTtftMs), 'sub-ttft'),
        row('模型用时', duration(tel.modelTimeMs), 'sub-model-time'),
        tel.toolTimeMs != null && row('工具用时', duration(tel.toolTimeMs), 'sub-tool-time'));
    }

    function SubagentPopoverDetails({ meta, stats, showOpenButton = true }) {
      const statusText = meta?.status === 'running' ? uiText('运行中', 'Running') : meta?.status === 'killed' ? uiText('已中止', 'Stopped') : uiText('已完成', 'Done');
      return h('div', { className: 'flex flex-col pb-0.5', 'data-testid': 'agy-subagent-details' },
        h('div', { className: 'px-2 pt-1.5 pb-1 flex items-center justify-between gap-2' },
          h('div', { className: 'min-w-0 flex-1' },
            h('div', { className: 'text-sm font-medium text-foreground truncate', title: meta?.title || stats.conversationId }, meta?.title || stats.conversationId),
            h('div', { className: 'text-compact text-muted-foreground truncate', title: stats.modelName }, `${meta?.typeName ? `${meta.typeName} / ` : ''}${stats.modelName || t('未知模型')}`)),
          h('span', {
            style: { fontSize: 11, padding: '1px 7px', borderRadius: 9999, flexShrink: 0, background: meta?.status === 'running' ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'var(--secondary)', color: meta?.status === 'running' ? 'var(--primary)' : 'var(--muted-foreground)' }
          }, statusText)),
        separator('sub-ctx-sep'),
        h(ContextDetails, { data: stats, isSubagent: true }),
        separator('sub-stats-sep'),
        h('div', { className: 'px-2 pt-1 pb-0.5 text-compact font-medium text-muted-foreground' }, uiText('子智能体统计', 'Subagent telemetry')),
        h(SubagentStatsBody, { stats }),
        showOpenButton && h('div', { className: 'px-2 pt-2 pb-1 flex justify-end' },
          h(Uy, { variant: 'secondary', size: 'sm', type: 'button', 'data-testid': 'agy-subagent-open-btn', onClick: () => { adapter.openSubagent?.(stats.conversationId); } }, uiText('查看子智能体', 'Open subagent'))));
    }

    function SubagentNodeBadge({ subId }) {
      useRevision();
      if (!options.enabled || !options.subagentTelemetry) return null;
      const stats = subagentStats.get(subId);
      if (!stats) return null;
      const meta = subagentList.find(s => s.id === subId) || { id: subId, title: 'Subagent', status: 'done' };
      const cw = stats.contextWindow || {};
      const pctText = cw.usedPercent != null ? `${cw.usedPercent}%` : (cw.usedTokens > 0 ? tokens(cw.usedTokens) : '');
      const ringColor = cw.usedPercent >= 95 ? 'var(--error)' : cw.usedPercent >= 80 ? 'var(--warning)' : 'var(--primary)';
      const tip = `${stats.modelName || ''}${cw.maxTokens ? ` (${tokens(cw.usedTokens)} / ${tokens(cw.maxTokens)})` : ''}`;
      return h('div', {
        className: 'inline-flex items-center shrink-0',
        onClick: e => e.stopPropagation(),
        onMouseDown: e => e.stopPropagation()
      },
        h(HC, { placement: 'left-start', disableMobileSheet: false },
          h(IC, { asChild: true },
            h('button', {
              type: 'button',
              'data-testid': 'agy-subagent-badge',
              'data-subagent-id': subId,
              title: tip || uiText('查看子智能体上下文与统计', 'View subagent context & telemetry'),
              className: 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors cursor-pointer tabular-nums whitespace-nowrap'
            },
              h('span', { className: 'inline-flex items-center gap-1 font-medium', style: { color: ringColor } },
                h(Ring, { percent: cw.usedPercent, size: 13 }),
                pctText && h('span', null, pctText)),
              stats.shortModel && h('span', { className: 'px-1 rounded bg-secondary text-secondary-foreground' }, stats.shortModel))),
          h(JC, { className: '!w-80 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-subagent-popover', 'aria-label': uiText('子智能体详情', 'Subagent details'), role: 'dialog' },
            h(SubagentPopoverDetails, { meta, stats }))));
    }

    function SubagentComposerEntry({ subId }) {
      useRevision();
      if (!options.enabled || !options.subagentTelemetry || (!options.contextRing && !options.speedStats)) return null;
      const stats = subagentStats.get(subId);
      if (!stats) return null;
      const cw = stats.contextWindow || {}, tel = stats.telemetry || {};
      const ringText = cw.usedPercent == null
        ? ((cw.usedTokens || 0) > 0 ? tokens(cw.usedTokens) : '')
        : (cw.usedPercent > 0 ? `${cw.usedPercent}%` : '');
      const liveSpeed = tel.tps ?? tel.latestTps ?? null;
      const speedColor = liveSpeed == null ? undefined : liveSpeed >= 60 ? 'var(--success)' : liveSpeed < 25 ? 'var(--warning)' : undefined;
      return h('span', { className: 'inline-flex items-center gap-0.5 ml-0.5' },
        stats.shortModel && h('span', {
          'data-testid': 'agy-subagent-model-chip',
          title: stats.modelName || stats.shortModel,
          className: 'text-xs px-1.5 py-0.5 rounded-md bg-secondary text-secondary-foreground whitespace-nowrap shrink-0'
        }, stats.shortModel),
        options.contextRing && h(HC, { placement: 'top-end', disableMobileSheet: false },
          h(IC, { asChild: true }, h(Uy, {
            variant: 'ghost', size: ringText ? 'sm' : 'icon', type: 'button',
            'aria-label': t('上下文窗口'), 'data-testid': 'agy-subagent-context-ring-trigger',
            title: ringText ? `${t('上下文窗口')} ${ringText}` : t('上下文窗口'),
            className: `${ringText ? 'gap-1.5 ' : ''}text-muted-foreground`,
            style: { color: cw.usedPercent >= 95 ? 'var(--error)' : cw.usedPercent >= 80 ? 'var(--warning)' : undefined }
          }, h(Ring, { percent: cw.usedPercent }), ringText ? h('span', { className: 'text-sm tabular-nums agy-composer-label' }, ringText) : null)),
          h(JC, { className: '!w-80 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-subagent-popover', 'aria-label': t('上下文窗口'), role: 'dialog' },
            h(ContextDetails, { data: stats, isSubagent: true }))),
        options.speedStats && h(HC, { placement: 'top-end', disableMobileSheet: false },
          h(IC, { asChild: true }, h(Uy, {
            variant: 'ghost', size: liveSpeed == null ? 'icon' : 'sm', type: 'button',
            'aria-label': uiText('子智能体统计', 'Subagent telemetry'), 'data-testid': 'agy-subagent-speed-stats-trigger',
            title: liveSpeed == null ? uiText('子智能体统计', 'Subagent telemetry') : `${uiText('子智能体统计', 'Subagent telemetry')} ${liveSpeed} tok/s`,
            className: `${liveSpeed == null ? '' : 'gap-1.5 '}text-muted-foreground`
          }, h('span', { style: { color: speedColor, display: 'inline-flex', alignItems: 'center' } }, h(SpeedIcon, { tps: liveSpeed })),
            liveSpeed != null && h('span', { className: 'text-sm tabular-nums agy-composer-label', style: { color: speedColor } }, `${liveSpeed} tok/s`))),
          h(JC, { className: '!w-72 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-subagent-popover', 'aria-label': uiText('子智能体统计', 'Subagent telemetry'), role: 'dialog' },
            h('div', { className: 'flex flex-col pb-0.5' },
              h('div', { className: 'px-2 pt-1.5 pb-1 text-compact font-medium text-muted-foreground truncate', title: stats.modelName }, `${uiText('子智能体统计', 'Subagent telemetry')}${stats.shortModel ? ` (${stats.shortModel})` : ''}`),
              h(SubagentStatsBody, { stats })))));
    }

    function ContextDetails({ data, isSubagent = false }) {
      useRevision();
      const cw = data.contextWindow, stats = data.telemetry, en = options.language === 'en';
      const categories = [...cw.categories].sort((a, b) => {
        const ra = categoryRank(a.label), rb = categoryRank(b.label);
        if (ra !== rb) return ra - rb;
        return (b.tokens || 0) - (a.tokens || 0);
      });
      const colorFor = (c, idx) => c.key === 'free' ? 'var(--secondary)' : (contextPalette[c.label] || fallbackSwatches[idx % fallbackSwatches.length]);
      const usedHeadline = cw.usedPercent == null
        ? tokens(cw.usedTokens)
        : uiText(`已使用 ${cw.usedPercent}%`, `${cw.usedPercent}% used`);
      const capacityRight = cw.maxTokens == null
        ? tokens(cw.usedTokens)
        : `${tokens(cw.usedTokens)} / ${tokens(cw.maxTokens)}`;
      const sectionTip = uiText('总用量来自最近一次模型请求，各分类占比按客户端估算折算。', 'Total usage comes from the latest model request; category shares follow client-side estimation.');
      const stepTotalIn = (cw.cacheReadTokens || 0) + (cw.inputTokens || 0);
      const stepCachePct = stepTotalIn > 0 ? `${(cw.cacheReadTokens / stepTotalIn * 100).toFixed(1)}%` : null;
      const stepNewPct = stepTotalIn > 0 ? `${(cw.inputTokens / stepTotalIn * 100).toFixed(1)}%` : null;
      const multiModels = Array.isArray(cw.models) ? cw.models : [];
      const showOrchestrator = Boolean(cw.hasOrchestrator) && multiModels.length > 1;
      const subEntries = !isSubagent && options.subagentTelemetry && data?.conversationId === currentId()
        ? subagentList.map(meta => ({ meta, stats: subagentStats.get(meta.id) })).filter(item => item.stats)
        : [];
      return h(R.Fragment, null,
        h('div', { className: 'flex flex-col px-2 pt-1.5 pb-1', 'data-testid': 'agy-context-breakdown' },
          h('div', { className: 'flex items-center justify-between gap-2 mb-1.5', title: sectionTip },
            h('span', { className: 'text-compact text-muted-foreground' }, uiText('上下文窗口', 'Context')),
            cw.compactions > 0 && h('span', {
              style: { fontSize: 11, padding: '1px 6px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)' }
            }, uiText(`已压缩 ${cw.compactions} 次`, `Compacted ${cw.compactions}x`))),
          h('div', { className: 'flex items-baseline justify-between gap-3 mb-2 tabular-nums', title: sectionTip },
            h('span', { className: 'text-sm font-semibold text-foreground' }, usedHeadline),
            h('span', { className: 'text-compact text-muted-foreground whitespace-nowrap' }, capacityRight)),
          h('div', {
            style: { display: 'flex', height: 6, gap: 1, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)', marginBottom: 10 },
            role: cw.usedPercent == null ? 'img' : 'meter',
            'aria-label': t('上下文用量'),
            'aria-valuenow': cw.usedPercent ?? undefined,
            'aria-valuemin': 0,
            'aria-valuemax': 100
          },
            categories.filter(c => c.key !== 'free' && (c.percent || 0) > 0).map((c, i) => h('span', {
              key: c.key,
              style: { width: `${Math.max(0.4, c.percent || 0)}%`, background: colorFor(c, i), height: '100%' }
            }))),
          h('div', { className: 'flex flex-col gap-0.5' },
            ...categories.map((c, i) => h('div', {
              key: c.key,
              className: 'flex items-center gap-2.5 py-1 text-compact tabular-nums'
            },
              h('span', {
                style: {
                  width: 10,
                  height: 10,
                  borderRadius: 2.5,
                  flexShrink: 0,
                  background: colorFor(c, i),
                  boxShadow: c.key === 'free' ? 'inset 0 0 0 1px var(--border)' : 'none'
                }
              }),
              h('span', { className: 'flex-1 min-w-0 truncate text-secondary-foreground' }, contextCategoryName(c.label, en)),
              h('span', { className: 'text-muted-foreground text-right whitespace-nowrap' }, tokens(c.tokens)),
              h('span', { className: 'text-foreground font-medium text-right whitespace-nowrap', style: { minWidth: '3.4em' } }, c.percent == null ? '-' : `${Number(c.percent).toFixed(1)}%`)))),
          stepTotalIn > 0 && h('div', { className: 'flex flex-col gap-0.5 mt-2 pt-2 border-t border-border', 'data-testid': 'agy-step-cache-breakdown' },
            h('div', { className: 'flex items-center gap-2.5 py-0.5 text-compact tabular-nums', title: uiText('最近一次请求中命中服务端缓存直接复用的上下文 Token', 'Prompt tokens served from server cache in the latest request') },
              h('span', { style: { width: 8, height: 8, borderRadius: 9999, flexShrink: 0, background: '#2563eb' } }),
              h('span', { className: 'flex-1 min-w-0 truncate text-secondary-foreground' }, uiText('缓存复用上下文', 'Cached context')),
              h('span', { className: 'text-muted-foreground text-right whitespace-nowrap' }, tokens(cw.cacheReadTokens)),
              h('span', { className: 'text-foreground font-medium text-right whitespace-nowrap', style: { minWidth: '3.4em' } }, stepCachePct)),
            h('div', { className: 'flex items-center gap-2.5 py-0.5 text-compact tabular-nums', title: uiText('最近一次请求中新发送或未命中缓存的输入 Token', 'Fresh non-cached input tokens sent in the latest request') },
              h('span', { style: { width: 8, height: 8, borderRadius: 9999, flexShrink: 0, background: '#38bdf8' } }),
              h('span', { className: 'flex-1 min-w-0 truncate text-secondary-foreground' }, uiText('本步新增输入', 'New input')),
              h('span', { className: 'text-muted-foreground text-right whitespace-nowrap' }, tokens(cw.inputTokens)),
              h('span', { className: 'text-foreground font-medium text-right whitespace-nowrap', style: { minWidth: '3.4em' } }, stepNewPct)))),
        showOrchestrator && h(R.Fragment, null,
          separator('models-separator'),
          h('div', { className: 'flex flex-col px-2 pt-1 pb-1.5 gap-2', 'data-testid': 'agy-model-contexts' },
            h('div', { className: 'text-compact text-muted-foreground' }, uiText('Orchestrator 上下文', 'Orchestrator context')),
            ...multiModels.map(entry => {
              const roleText = entry.role === 'execution' ? uiText('执行', 'Exec') : entry.role === 'planner' ? uiText('规划', 'Plan') : '';
              const barPct = Math.min(100, Math.max(0, entry.usedPercent ?? 0));
              const barColor = entry.usedPercent >= 95 ? 'var(--error)' : entry.usedPercent >= 80 ? 'var(--warning)' : entry.isCurrent ? '#2563eb' : '#60a5fa';
              return h('div', { key: entry.key, className: 'flex flex-col gap-1', title: entry.fullName },
                h('div', { className: 'flex items-center justify-between gap-2 text-compact tabular-nums' },
                  h('div', { className: 'flex items-center gap-1.5 min-w-0' },
                    h('span', {
                      style: {
                        width: 7,
                        height: 7,
                        borderRadius: 9999,
                        flexShrink: 0,
                        background: entry.isCurrent ? '#2563eb' : 'transparent',
                        border: entry.isCurrent ? 'none' : '1.5px solid var(--muted-foreground)'
                      }
                    }),
                    roleText && h('span', {
                      style: { fontSize: 11, padding: '0 4px', borderRadius: 4, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 }
                    }, roleText),
                    h('span', { className: `truncate ${entry.isCurrent ? 'font-medium text-foreground' : 'text-secondary-foreground'}` }, entry.shortName),
                    entry.isCurrent && h('span', {
                      style: { fontSize: 10, padding: '0 5px', borderRadius: 4, background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)', flexShrink: 0 }
                    }, uiText('当前', 'Active')),
                    entry.compactions > 0 && h('span', {
                      style: { fontSize: 10, padding: '0 4px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 },
                      title: uiText(`已压缩 ${entry.compactions} 次`, `Compacted ${entry.compactions} time(s)`)
                    }, `${entry.compactions}`)),
                  h('div', { className: 'flex items-center gap-1.5 whitespace-nowrap shrink-0' },
                    entry.usedPercent != null && h('span', { className: 'font-medium text-foreground' }, `${entry.usedPercent.toFixed(1)}%`))),
                h('div', { className: 'flex items-center gap-2 tabular-nums' },
                  h('div', { style: { flex: 1, height: 4, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
                    h('div', { style: { width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 9999 } })),
                  h('span', { style: { fontSize: 11 }, className: 'text-muted-foreground whitespace-nowrap shrink-0' }, entry.maxTokens ? `${tokens(entry.usedTokens)} / ${tokens(entry.maxTokens)}` : tokens(entry.usedTokens))));
            }))),
        subEntries.length > 0 && h(R.Fragment, null,
          separator('subagents-separator'),
          h('div', { className: 'flex flex-col px-2 pt-1 pb-1.5 gap-2', 'data-testid': 'agy-subagent-contexts' },
            h(SubagentSectionHeader, { label: uiText('子智能体上下文', 'Subagents'), count: subEntries.length }),
            h('div', { className: 'flex flex-col gap-2 max-h-48 overflow-y-auto' },
              ...subEntries.map(({ meta, stats: s }) => {
                const scw = s.contextWindow || {}, stel = s.telemetry || {};
                const pct = Math.min(100, Math.max(0, scw.usedPercent ?? 0));
                const barColor = scw.usedPercent >= 95 ? 'var(--error)' : scw.usedPercent >= 80 ? 'var(--warning)' : '#2563eb';
                const dotColor = meta.status === 'running' ? '#2563eb' : meta.status === 'killed' ? 'var(--muted-foreground)' : 'var(--success)';
                return h('button', {
                  key: meta.id, type: 'button',
                  'data-testid': `agy-subagent-ctx-${meta.id}`,
                  onClick: () => { adapter.openSubagent?.(meta.id); },
                  title: `${meta.title} (${s.modelName || ''})`,
                  className: 'flex flex-col gap-1 w-full text-left rounded-md px-1.5 py-1 hover:bg-secondary/70 transition-colors cursor-pointer'
                },
                  h('div', { className: 'flex items-center justify-between gap-2 text-compact tabular-nums' },
                    h('div', { className: 'flex items-center gap-1.5 min-w-0' },
                      h('span', { style: { width: 6, height: 6, borderRadius: 9999, flexShrink: 0, background: dotColor } }),
                      h('span', { className: 'truncate font-medium text-foreground' }, meta.title),
                      s.shortModel && h('span', { style: { fontSize: 10, padding: '0 4px', borderRadius: 4, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 } }, s.shortModel),
                      scw.compactions > 0 && h('span', { style: { fontSize: 10, padding: '0 4px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 }, title: uiText(`已压缩 ${scw.compactions} 次`, `Compacted ${scw.compactions}x`) }, `${scw.compactions}`)),
                    scw.usedPercent != null && h('span', { className: 'font-medium text-foreground whitespace-nowrap shrink-0' }, `${scw.usedPercent}%`)),
                  h('div', { className: 'flex items-center gap-2 tabular-nums' },
                    h('div', { style: { flex: 1, height: 4, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
                      h('div', { style: { width: `${pct}%`, height: '100%', background: barColor, borderRadius: 9999 } })),
                    h('span', { style: { fontSize: 11 }, className: 'text-muted-foreground whitespace-nowrap shrink-0' }, scw.maxTokens ? `${tokens(scw.usedTokens)} / ${tokens(scw.maxTokens)}` : tokens(scw.usedTokens))),
                  h('div', { className: 'flex items-center flex-wrap gap-x-2.5 gap-y-0.5 tabular-nums text-muted-foreground', style: { fontSize: 11 } },
                    stel.totalTokens > 0 && h('span', null, `${uiText('总 ', 'Total ')}${tokens(stel.totalTokens)}`),
                    stel.cacheHitPercent != null && h('span', null, `${uiText('缓存 ', 'Cache ')}${stel.cacheHitPercent}%`),
                    stel.tps != null && h('span', null, `${stel.tps} tok/s`),
                    s.costUsd != null && s.costUsd > 0 && h('span', null, moneyText(s.costUsd))));
              })))));
    }

    function SessionStatsDetails({ data }) {
      useRevision();
      const stats = data.telemetry;
      const subItems = options.subagentTelemetry && data?.conversationId === currentId()
        ? subagentList.map(meta => subagentStats.get(meta.id)).filter(Boolean)
        : [];
      let subTokens = 0, subIn = 0, subCache = 0, subReqs = 0, subTools = 0, subCost = 0, subPriced = 0;
      for (const s of subItems) {
        const st = s.telemetry || {};
        subTokens += st.totalTokens || 0;
        subIn += st.inputTokens || 0;
        subCache += st.cacheReadTokens || 0;
        subReqs += st.requestCount || 0;
        subTools += st.toolCount || 0;
        if (typeof s.costUsd === 'number' && Number.isFinite(s.costUsd)) { subCost += s.costUsd; subPriced++; }
      }
      const subCachePct = subIn + subCache > 0 ? Number((subCache / (subIn + subCache) * 100).toFixed(1)) : null;
      return h('div', { className: 'flex flex-col pb-0.5', 'data-testid': 'agy-session-stats' },
        h('div', { className: 'px-2 pt-1.5 pb-1 text-compact font-medium text-muted-foreground' }, t('会话统计')),
        row('轮次 / 步数', `${stats.turnCount} / ${stats.stepCount}`, 'turns'),
        row('累计 Token', tokens(stats.totalTokens), 'tokens'),
        data.costUsd != null && row('API 参考费用', moneyText(data.costUsd), 'cost'),
        row('平均速度', stats.tps == null ? tokens(null) : `${stats.tps} tok/s`, 'speed'),
        h('div',{title:t('峰值为单次请求的最高平均速度。')},row('峰值速度', stats.peakTps == null ? tokens(null) : `${stats.peakTps} tok/s`, 'peak')),
        row('最近速度', stats.latestTps == null ? tokens(null) : `${stats.latestTps} tok/s`, 'latest'),
        row('缓存命中', stats.cacheHitPercent == null ? tokens(null) : `${stats.cacheHitPercent}%`, 'cache'),
        h(CacheObservation,{data}),
        h(k0,{trigger:uiText('更多统计','More statistics'),defaultExpanded:false},
          row('输入',tokens(stats.inputTokens),'input'),row('缓存读取',tokens(stats.cacheReadTokens),'cache-tokens'),row('输出',tokens(stats.outputTokens),'output'),
          row('思考 Token',tokens(stats.thinkingTokens),'thinking'),row('请求次数',String(stats.requestCount),'requests'),row('错误次数',String(stats.errorCount),'errors'),row('工具调用',String(stats.toolCount),'tool-count')),
        separator('time-separator'),
        row('模型用时', duration(stats.modelTimeMs), 'model'), row('工具用时', duration(stats.toolTimeMs), 'tools'),
        row('首 Token 延迟', duration(stats.avgTtftMs), 'ttft'),
        subItems.length > 0 && h(R.Fragment, null,
          separator('subagent-stats-separator'),
          h('div', { className: 'px-2 pt-1 pb-0.5' }, h(SubagentSectionHeader, { label: uiText('子智能体汇总', 'Subagents'), count: subItems.length, testId: 'agy-subagent-stats-summary' })),
          row(uiText('子智能体 Token', 'Subagent tokens'), tokens(subTokens), 'sub-total-tokens'),
          row(uiText('含子智能体总计', 'Combined total'), tokens((stats.totalTokens || 0) + subTokens), 'combined-tokens'),
          row(uiText('请求 / 工具调用', 'Requests / tools'), `${subReqs} / ${subTools}`, 'sub-reqs-tools'),
          subCachePct != null && row(uiText('子智能体缓存命中', 'Subagent cache'), `${subCachePct}%`, 'sub-cache-pct'),
          subPriced > 0 && row(uiText('子智能体参考费用', 'Subagent est. cost'), moneyText(subCost), 'sub-cost-total'),
          subPriced > 0 && data.costUsd != null && row(uiText('含子智能体总费用', 'Combined est. cost'), moneyText(data.costUsd + subCost), 'combined-cost')));
    }

    function SpeedIcon({ tps }) {
      // Circular dashboard dial inspired by Remix Icon dashboard-2-line, matched 1:1 to Ring (16x16 circle).
      const deg = tps == null ? -80 : Math.round(Math.max(-105, Math.min(105, (tps - 45) * 2.2)));
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', className: 'shrink-0', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9.1, strokeWidth: 2.15 }),
        h('path', { d: 'M7.7 16.3a6.1 6.1 0 1 1 8.6 0', strokeWidth: 1.55, strokeOpacity: 0.35 }),
        h('line', { x1: 12, y1: 12.2, x2: 12, y2: 6.4, strokeWidth: 2, style: { transformOrigin: '12px 12.2px', transform: `rotate(${deg}deg)`, transition: 'transform 220ms ease-out' } }),
        h('circle', { cx: 12, cy: 12.2, r: 1.5, fill: 'currentColor', stroke: 'none' }));
    }

    function NativeEntry({ data }) {
      // Use the exact same providers, components, portals and motion as Antigravity.
      const toast = typeof um === 'function' ? um() : null;
      R.useEffect(() => { notify = toast; }, [toast]);
      if (!data?.conversationId || (!options.contextRing && !options.speedStats)) return null;
      const cw = data.contextWindow, stats = data.telemetry;
      const ringText = cw.usedPercent == null
        ? ((cw.usedTokens || 0) > 0 ? tokens(cw.usedTokens) : '')
        : (cw.usedPercent > 0 ? `${cw.usedPercent}%` : '');
      const liveSpeed = stats?.latestTps ?? stats?.tps ?? null;
      const speedColor = liveSpeed == null ? undefined : liveSpeed >= 60 ? 'var(--success)' : liveSpeed < 25 ? 'var(--warning)' : undefined;
      return h('span', { className: 'inline-flex items-center gap-0.5' },
        options.contextRing && h(HC, { placement: 'top-end', disableMobileSheet: false },
          h(IC, { asChild: true }, h(Uy, {
            variant: 'ghost', size: ringText ? 'sm' : 'icon', type: 'button',
            'aria-label': t('上下文窗口'), 'data-testid': 'agy-context-ring-trigger',
            title: ringText ? `${t('上下文窗口')} ${ringText}` : t('上下文窗口'),
            className: `${ringText ? 'gap-1.5 ' : ''}text-muted-foreground`,
            style: { color: cw.usedPercent >= 95 ? 'var(--error)' : cw.usedPercent >= 80 ? 'var(--warning)' : undefined }
          }, h(Ring, { percent: cw.usedPercent }), ringText ? h('span', { className: 'text-sm tabular-nums agy-composer-label' }, ringText) : null)),
          h(JC, { className: '!w-80 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-context-popup', 'aria-label': t('上下文窗口'), role: 'dialog' }, h(ContextDetails, { data }))),
        options.speedStats && h(HC, { placement: 'top-end', disableMobileSheet: false },
          h(IC, { asChild: true }, h(Uy, {
            variant: 'ghost', size: liveSpeed != null ? 'sm' : 'icon', type: 'button',
            'aria-label': t('会话统计'), 'data-testid': 'agy-speed-stats-trigger',
            title: liveSpeed != null ? `${t('会话统计')} ${liveSpeed} tok/s` : t('会话统计'),
            className: `${liveSpeed != null ? 'gap-1 ' : ''}text-muted-foreground`,
            style: { color: speedColor }
          }, h(SpeedIcon, { tps: liveSpeed }), liveSpeed != null ? h('span', { className: 'text-sm tabular-nums agy-composer-label' }, `${liveSpeed} tok/s`) : null)),
          h(JC, { className: '!w-72 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-stats-popup', 'aria-label': t('会话统计'), role: 'dialog' }, h(SessionStatsDetails, { data }))));
    }

    function ToolDetails({ turn }) {
      return h('div', { className: 'flex flex-col pl-3', 'data-testid': 'agy-tool-details' }, ...turn.toolGroups.map(group =>
        h(k0, { key: group.groupKey, trigger: `${group.groupLabel} (${group.items.length})`, defaultExpanded: true },
          ...group.items.map(item => h(k0, { key: item.id, trigger: h('span', { className: 'truncate text-sm' }, item.itemLabel) },
            h('div', { className: 'px-2 py-1 text-sm text-muted-foreground' },
              h('pre', { className: 'whitespace-pre-wrap break-words rounded-md bg-secondary p-2 overflow-auto max-h-52' }, item.detailTitle),
              item.outputPreview && h('pre', { className: 'whitespace-pre-wrap break-words rounded-md bg-secondary p-2 overflow-auto max-h-52' }, item.outputPreview)))))));
    }

    function Completion({ turn, tooltipOnly, tooltipId }) {
      return h(R.Fragment, null,
        !tooltipOnly && (options.toolDetails && turn.toolCalls.length ? h(k0, {
          trigger: h('span', { className: 'text-sm text-muted-foreground', 'data-tooltip-id': tooltipId }, `${uiText('用时','Worked for')} ${duration(turn.durationMs)}`),
          defaultExpanded: false, dataTestId: 'agy-completion-tools-toggle'
        }, h(ToolDetails, { turn })) : h('span', { className: 'inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums px-2 py-1', tabIndex: 0, 'data-tooltip-id': tooltipId, 'data-testid': 'agy-completion-time' }, `${uiText('用时','Worked for')} ${duration(turn.durationMs)}`)),
        h(Sy, { id: tooltipId, place: 'right' }, completed(turn.completedAtIso)));
    }

    function ResponseActions({ turn, conversationId }) {
      return h(HC, { placement: 'top-end' },
        h(IC, { asChild: true }, h(Uy, { variant: 'ghost', size: 'icon', 'aria-label': t('回答操作'), 'data-testid': 'agy-response-actions' }, h(dq, { name: 'more_horiz', size: 16 }))),
        h(JC, { className: '!w-52', arrowNavigable: true },
          h(KC, { asChild: true }, h(GC, { icon: h(dq, { name: 'fork_left', size: 16 }), 'data-testid': 'agy-fork-response', onClick: () => { void branchAndNavigate(conversationId, turn.stepIndexEnd); } }, t('分支到新聊天')))));
    }

    function MessageEdit({ user }) {
      const message = adapter.userMessage(user);
      R.useEffect(() => () => { if (adapter.pendingEdit?.element === user) adapter.suspendEdit?.(); }, [user]);
      if (!message) return null;
      const viewOnly = adapter.providers(user).find(p => p.value?.stepHandler)?.value?.stepHandler?.isViewOnlyMode?.();
      if (viewOnly || message.status === I.CortexStepStatus.CLEARED) return null;
      return h(Uy, {
        variant: 'ghost', size: 'icon',
        tooltip: t('编辑消息'),
        'aria-label': t('编辑消息'),
        'data-testid': 'agy-edit-message',
        onClick: async event => {
          event.stopPropagation();
          try {
            await adapter.beginEdit(user, {
              label: uiText('正在编辑此条消息（发送后将从此处重新生成）', 'Editing message (sending will regenerate from this turn)'),
              cancelLabel: t('取消')
            });
          } catch (failure) { notify?.({ title: t('消息发送失败'), message: failure.message, tag: 'agy-edit-error' }); }
        }
      }, h(dq, { name: 'edit', size: 16 }));
    }

    function resolveComposerQuota(modelLabel) {
      const groups = account?.groups;
      if (!Array.isArray(groups) || !groups.length) return null;
      const label = String(modelLabel || adapter.capabilities?.()?.model || '');
      const hasArgon = groups.some(g => /argon/i.test(g?.displayName || '') || (g?.buckets || []).some(b => /argon/i.test(b?.bucketId || '')));
      const wantKey = /claude|gpt/i.test(label) ? 'claude' : (hasArgon && /argon/i.test(label)) ? 'argon' : 'gemini';
      const matchGroup = groups.find(g => {
        const text = `${g?.displayName || ''} ${(g?.buckets || []).map(b => b?.bucketId || '').join(' ')}`;
        if (wantKey === 'claude') return /claude|gpt|\b3p\b/i.test(text);
        if (wantKey === 'argon') return /argon/i.test(text);
        return /gemini/i.test(text);
      }) || groups[0];
      if (!matchGroup) return null;
      const readFrac = b => {
        const raw = b?.remaining?.case === 'remainingFraction' ? b.remaining.value : b?.remainingFraction;
        return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null;
      };
      const buckets = (Array.isArray(matchGroup.buckets) ? matchGroup.buckets : []).filter(b => b && b.disabled !== true).map(b => ({
        window: b?.window === 'weekly' || /weekly/i.test(b?.bucketId || '') ? 'weekly' : '5h',
        fraction: readFrac(b)
      })).filter(b => b.fraction != null);
      if (!buckets.length) return null;
      const fiveH = buckets.find(b => b.window === '5h') || null;
      const weekly = buckets.find(b => b.window === 'weekly') || null;
      const mode = options.composerQuotaHaloWindow || 'auto';
      const active = mode === 'weekly'
        ? (weekly || fiveH)
        : mode === '5h'
          ? (fiveH || weekly)
          : (fiveH && weekly) ? (weekly.fraction < fiveH.fraction ? weekly : fiveH) : (fiveH || weekly);
      return active ? { fraction: active.fraction, window: active.window, groupName: matchGroup.displayName || '' } : null;
    }

    function ComposerQuotaHalo({ frame, modelLabel }) {
      useRevision();
      const gradId = R.useId ? `agy-halo-${R.useId().replace(/[^a-zA-Z0-9_-]/g, '')}` : 'agy-halo-grad';
      const [box, setBox] = R.useState(() => ({ w: 0, h: 0, r: 20 }));
      R.useEffect(() => {
        if (!frame) return;
        const measure = () => {
          const rect = frame.getBoundingClientRect?.();
          if (!rect || rect.width < 20 || rect.height < 20) return;
          const radius = parseFloat(getComputedStyle(frame).borderRadius) || 20;
          setBox(prev => (Math.abs(prev.w - rect.width) < 0.5 && Math.abs(prev.h - rect.height) < 0.5 && Math.abs(prev.r - radius) < 0.5)
            ? prev
            : { w: rect.width, h: rect.height, r: radius });
        };
        measure();
        if (typeof ResizeObserver === 'function') {
          const ro = new ResizeObserver(measure);
          ro.observe(frame);
          return () => ro.disconnect();
        }
      }, [frame]);
      const quotaInfo = resolveComposerQuota(modelLabel);
      if (!options.composerQuotaHalo || !quotaInfo || box.w < 20 || box.h < 20) return null;
      const pad = 5;
      const w = box.w, hPx = box.h;
      const inset = 0.5;
      const r = Math.max(4, Math.min(box.r, (w - inset * 2) / 2, (hPx - inset * 2) / 2));
      const left = pad + inset, top = pad + inset, right = pad + w - inset, bottom = pad + hPx - inset;
      const openPath = `M ${left + r} ${top} H ${right - r} A ${r} ${r} 0 0 1 ${right} ${top + r} V ${bottom - r} A ${r} ${r} 0 0 1 ${right - r} ${bottom} H ${left + r} A ${r} ${r} 0 0 1 ${left} ${bottom - r} V ${top + r} A ${r} ${r} 0 0 1 ${left + r} ${top}`;
      const pct = Math.max(0, Math.min(100, quotaInfo.fraction * 100));
      const full = pct >= 99.8, empty = pct <= 0.4;
      const d = full || empty ? `${openPath} Z` : openPath;
      const tone = pct < 20 ? 'critical' : pct < 50 ? 'warning' : 'ok';
      const stops = tone === 'critical'
        ? ['#DC2626', '#EF4444', '#F87171']
        : tone === 'warning'
          ? ['#D97706', '#F59E0B', '#FBBF24']
          : ['#0D9488', '#10B981', '#34D399'];
      const dash = full ? undefined : empty ? '0.01 100' : `${pct.toFixed(2)} 100`;
      const dashOffset = full || empty ? undefined : -(100 - pct);
      return h('svg', {
        className: 'agy-quota-halo-svg',
        'data-testid': 'agy-composer-quota-halo',
        'data-tone': tone,
        'data-window': quotaInfo.window,
        'data-percent': String(Math.round(pct)),
        viewBox: `0 0 ${(w + pad * 2).toFixed(1)} ${(hPx + pad * 2).toFixed(1)}`,
        fill: 'none',
        'aria-hidden': true
      },
        h('defs', null,
          h('linearGradient', { id: gradId, x1: '0%', y1: '0%', x2: '100%', y2: '100%' },
            h('stop', { offset: '0%', stopColor: stops[0] }),
            h('stop', { offset: '55%', stopColor: stops[1] }),
            h('stop', { offset: '100%', stopColor: stops[2] }))),
        !empty && h('path', {
          className: 'agy-quota-halo-glow',
          d, pathLength: 100, stroke: `url(#${gradId})`, strokeWidth: 4.2, strokeLinecap: 'round', strokeDasharray: dash, strokeDashoffset: dashOffset
        }),
        h('path', {
          className: 'agy-quota-halo-stroke',
          d, pathLength: 100, stroke: `url(#${gradId})`, strokeWidth: 1.65, strokeLinecap: 'round',
          strokeDasharray: empty ? '4 4' : dash,
          strokeDashoffset: dashOffset
        }));
    }

    function renderRoot(key, parent, before, source, element, kind) {
      let entry = roots.get(key);
      if (!entry || !entry.mount.isConnected) {
        if (entry) { entry.root.unmount(); entry.mount.remove(); }
        const mount = document.createElement('span');
        mount.dataset.agyPowertoolsRoot = kind;
        mount.className = kind === 'outline' ? 'contents' : kind === 'quota-halo' ? 'agy-quota-halo-root' : kind === 'completion' ? 'block' : kind === 'subagent-badge' ? 'inline-flex items-center shrink-0 ml-auto' : ['progress','overview-quota','native-search'].includes(kind) ? 'block w-full shrink-0' : ['management','account-switcher'].includes(kind) ? 'block w-full' : 'inline-flex items-center shrink-0';
        parent.insertBefore(mount, before || null);
        entry = { root: ReactDOM.createRoot(mount), mount, parent, source, kind };
        roots.set(key, entry);
      } else if (entry.parent !== parent || (before ? (before !== entry.mount && entry.mount.nextSibling !== before) : entry.mount.nextSibling !== null)) {
        parent.insertBefore(entry.mount, before || null);
        entry.parent = parent;
        entry.source = source;
      }
      const tree=adapter.wrap(element, source);
      entry.root.render(Boundary?h(Boundary,null,tree):tree);
    }

    function turnFor(response) {
      for (let f = adapter.fiber(response); f; f = f.return) {
        const steps = f.memoizedProps?.container?.steps;
        if (Array.isArray(steps)) {
          const input = steps.find(s => s.step?.case === 'userInput');
          if (input) return state?.turns.find(t => t.stepIndexStart === HU(input.metadata));
          const index = HU(steps.at(-1)?.metadata);
          const turn = state?.turns.find(t => t.stepIndexStart <= index && t.stepIndexEnd >= index);
          if (turn) return turn;
        }
      }
      return null;
    }

    function mount() {
      if (disposed) return;
      if(adapter.pendingEdit?.element&&adapter.pendingEdit.element.isConnected===false)adapter.suspendEdit?.();
      const activeId = currentId();
      if(mountedConversationId!==activeId){
        clearResumeEditTimer();
        if(adapter.pendingEdit&&adapter.pendingEdit.cascadeId!==activeId)adapter.suspendEdit?.();
        mountedConversationId=activeId;
        if(activeId&&stateCache.has(activeId)){state=stateCache.get(activeId);lastId=activeId;}
        emit();
        if(activeId&&state?.conversationId!==activeId)void refresh();
      }
      tryFlushPendingTurnJump();
      if(options.enabled&&options.messageEdit&&activeId&&!adapter.pendingEdit&&adapter.getSuspendedEdit?.(activeId)&&resumeEditTargetId!==activeId){
        const suspended=adapter.getSuspendedEdit(activeId);
        const matchEl=[...document.querySelectorAll('[data-testid="user-input-step"]')].find(el=>{
          const msg=adapter.userMessage?.(el);
          return msg&&msg.cascadeId===activeId&&typeof HU==='function'&&HU(msg.metadata)===suspended.stepIndex;
        });
        if(matchEl&&matchEl.closest?.('[data-testid="conversation-view"]')?.querySelector?.('[data-testid="agent-input-box"]')){
          resumeEditTargetId=activeId;
          resumeEditTimer=setTimeout(()=>{
            resumeEditTimer=null;
            resumeEditTargetId='';
            if(disposed||!options.enabled||!options.messageEdit||currentId()!==activeId||adapter.pendingEdit||!matchEl.isConnected)return;
            adapter.resumeEdit?.(matchEl);
          },40);
        }
      }
      const switcherActive = Boolean(options.enabled && options.multiAccount && options.accountSwitcher);
      const bubbleActive = Boolean(options.enabled && options.userBubbleTint);
      document.documentElement.toggleAttribute('data-agy-compact', options.enabled&&options.compact);
      document.documentElement.toggleAttribute('data-agy-keep-outline', options.enabled&&options.keepTurnOutline);
      document.documentElement.toggleAttribute('data-agy-account-switcher', switcherActive);
      document.documentElement.toggleAttribute('data-agy-user-bubble', bubbleActive);
      if (bubbleActive) {
        const tint = options.userBubblePreset === 'custom'
          ? (/^#[0-9a-fA-F]{6}$/.test(options.userBubbleColor || '') ? options.userBubbleColor : '#2F75C3')
          : (userBubblePresets[options.userBubblePreset] || 'var(--primary)');
        const strength = Number.isInteger(options.userBubbleStrength) && options.userBubbleStrength >= 10 && options.userBubbleStrength <= 100 ? options.userBubbleStrength : 20;
        const fg = bubbleFgFor(tint, strength);
        document.documentElement.style?.setProperty?.('--agy-bubble-tint', tint);
        document.documentElement.style?.setProperty?.('--agy-bubble-bg', `${strength}%`);
        document.documentElement.style?.setProperty?.('--agy-bubble-border', `${Math.min(100, strength + 16)}%`);
        document.documentElement.toggleAttribute('data-agy-bubble-fg', Boolean(fg));
        if (fg) document.documentElement.style?.setProperty?.('--agy-bubble-fg', fg);
        else document.documentElement.style?.removeProperty?.('--agy-bubble-fg');
      } else {
        document.documentElement.removeAttribute?.('data-agy-bubble-fg');
        document.documentElement.style?.removeProperty?.('--agy-bubble-tint');
        document.documentElement.style?.removeProperty?.('--agy-bubble-bg');
        document.documentElement.style?.removeProperty?.('--agy-bubble-border');
        document.documentElement.style?.removeProperty?.('--agy-bubble-fg');
      }
      followOverview();
      localizer?.apply(options.enabled?options.language:'en',options.enabled);
      for (const [key, entry] of roots) if (!entry.mount.isConnected || !entry.source.isConnected || (entry.kind === 'completion' && !options.timing) || (entry.kind === 'response-actions' && !options.responseBranch) || (entry.kind === 'message-edit' && !options.messageEdit) || (entry.kind === 'progress' && !options.progress) || (entry.kind === 'overview-quota' && !options.overviewQuota) || (entry.kind === 'quota-halo' && !options.composerQuotaHalo) || (entry.kind === 'subagent-badge' && !options.subagentTelemetry) || (entry.kind === 'subagent-composer' && (!options.subagentTelemetry || entry.source.querySelector?.('[data-testid="model-selector-trigger"]') || (entry.subId && adapter.composerCascadeId?.(entry.source) !== entry.subId))) || (entry.kind === 'outline' && !options.keepTurnOutline) || (entry.kind === 'account-switcher' && !switcherActive) || (entry.kind === 'native-search' && !options.sessionSearch)) {
        entry.root.unmount(); entry.mount.remove(); roots.delete(key);
      }
      if (!options.timing) restoreLabels();
      if(!options.enabled){
        restoreLabels();
        for(const [key,entry]of roots)if(entry.kind!=='management'){entry.root.unmount();entry.mount.remove();roots.delete(key);}
      }
      const customizations = document.querySelector('a[href="/customizations"]');
      const navContainer = customizations ? null : document.querySelector('[data-testid="sidebar-navigation-items"]');
      if (!pageInstalled && panels) pageInstalled = adapter.installPage(Boundary?()=>h(Boundary,{page:true},h(panels.Page)):panels.Page);
      if (customizations && panels) renderRoot('management-nav', customizations.parentElement, customizations.nextSibling, customizations, h(panels.Sidebar), 'management');
      else if (navContainer && panels) renderRoot('management-nav', navContainer, null, navContainer, h(panels.Sidebar), 'management');
      if(!options.enabled)return;
      adapter.ensureRequestHook?.();
      const settingsBtn = document.querySelector('[data-testid="settings-button"]');
      if (settingsBtn?.parentElement && panels?.AccountSwitcher && switcherActive) {
        renderRoot(settingsBtn, settingsBtn.parentElement, settingsBtn, settingsBtn, h(panels.AccountSwitcher), 'account-switcher');
      }
      const nativeSearchInput = options.sessionSearch
        ? document.querySelector('input[placeholder="Search for conversations..."], input[data-agy-original-placeholder="Search for conversations..."]')
        : null;
      if (nativeSearchInput) {
        const viewport = nativeSearchInput.closest?.('[data-testid="fast-pick-viewport"]') || null;
        let searchCard = nativeSearchInput.parentElement;
        while (searchCard && searchCard.parentElement && searchCard !== viewport && !searchCard.querySelector?.('[role="listbox"], .overflow-y-auto')) {
          searchCard = searchCard.parentElement;
        }
        if (searchCard && searchCard !== viewport && searchCard !== document.body) {
          renderRoot('native-search', searchCard, null, nativeSearchInput, h(NativeSearchEnhancer, { input: nativeSearchInput }), 'native-search');
        }
      } else {
        const staleSearch = roots.get('native-search');
        if (staleSearch) { staleSearch.root.unmount(); staleSearch.mount.remove(); roots.delete('native-search'); }
      }
      const data = state?.conversationId === currentId() ? state : null;
      for (const model of document.querySelectorAll('[data-testid="model-selector-trigger"]')) {
        const card = model.closest('.surface-composer-card');
        if (!card) continue;
        const cid = composerConversationId(model, card);
        const composerData = stateForConversation(cid);
        if (cid && cid !== activeId && !composerData) prefetchConversation(cid);
        let anchor = model;
        while (anchor.parentElement && getComputedStyle(anchor.parentElement).display !== 'flex') anchor = anchor.parentElement;
        renderRoot(model, anchor.parentElement, anchor.nextSibling, model, h(NativeEntry, { data: composerData, placement: 'composer' }), 'ring');
        if (options.composerQuotaHalo) {
          let haloKey = haloKeys.get(card);
          if (!haloKey) { haloKey = Symbol('halo'); haloKeys.set(card, haloKey); }
          const label = (model.textContent || '').trim();
          renderRoot(haloKey, card, card.firstChild, card, h(ComposerQuotaHalo, { frame: card, modelLabel: label }), 'quota-halo');
        }
      }
      if (options.subagentTelemetry) {
        for (const card of document.querySelectorAll('.surface-composer-card')) {
          if (card.querySelector('[data-testid="model-selector-trigger"]')) {
            const stale = roots.get(card);
            if (stale?.kind === 'subagent-composer') { stale.root.unmount(); stale.mount.remove(); roots.delete(card); }
            continue;
          }
          const subId = adapter.composerCascadeId?.(card);
          const leftRow = card.querySelector('.agy-composer-footer > div:first-child > div:last-child') || card.querySelector('.agy-composer-footer > div:first-child');
          if (subId && leftRow) {
            renderRoot(card, leftRow, null, card, h(SubagentComposerEntry, { subId }), 'subagent-composer');
            const mounted = roots.get(card);
            if (mounted) mounted.subId = subId;
          }
        }
        for (const node of document.querySelectorAll('[data-testid="subagent-node"][data-cascade-id]')) {
          const subId = node.dataset?.cascadeId;
          if (subId) renderRoot(node, node, null, node, h(SubagentNodeBadge, { subId }), 'subagent-badge');
        }
        syncSubagents(activeId);
      }
      if (!data) return;
      const overview = document.querySelector('[data-testid="overview-panel"]');
      if (overview && panels?.OverviewQuota && options.overviewQuota) renderRoot('overview-quota',overview,null,overview,h(panels.OverviewQuota),'overview-quota');
      if (overview && panels && options.progress) {
        const quotaEntry = options.overviewQuota ? roots.get('overview-quota') : null;
        const progressBefore = quotaEntry?.parent === overview && quotaEntry.mount.isConnected ? quotaEntry.mount : null;
        renderRoot(overview,overview,progressBefore,overview,h(panels.Progress),'progress');
      }
      const view = document.querySelector('[data-testid="conversation-view"]');
      const nativeOutline=view?.querySelector('[data-testid="conversation-navigator"]');
      if (overview && view && panels && options.keepTurnOutline && !nativeOutline && data.turns.length>1) renderRoot(view,view,null,view,h(panels.Outline),'outline');
      else if(view){const entry=roots.get(view);if(entry?.kind==='outline'){entry.root.unmount();entry.mount.remove();roots.delete(view);}}
      if (options.messageEdit) for (const user of document.querySelectorAll('[data-testid="user-input-step"]')) {
        const actions = user.querySelector('[data-testid="user-message-actions"]');
        if (actions) renderRoot(actions, actions, null, user, h(MessageEdit, { user }), 'message-edit');
      }
      const WORKED_RE = /^(?:Worked for\b|用时(?:\s|$)|用時(?:\s|$))/;
      const UPDATES_RE = /(?:[\u00b7\u2022]\s*)?(\d+)\s+(?:updates?\b|条进度|條進度)/i;
      const turnScope = response => {
        let scope = response.closest?.('[data-turn-content]') || null;
        if (!scope) {
          for (let parent = response.parentElement; parent && parent.querySelectorAll?.('[data-testid="agent-response"]').length === 1; parent = parent.parentElement) {
            if ([...(parent.querySelectorAll?.('button[aria-label="Copy"]') || [])].some(button => !button.closest?.('[data-testid="user-input-step"]')) ||
                parent.querySelector?.('[data-testid="worked-for-collapsible"]')) { scope = parent; break; }
          }
        }
        return scope;
      };
      const findWorkedCollapsible = (response, scope) => {
        const belongs = el => {
          if (!el || el.closest?.('[data-agy-powertools-root],[data-markdown-root],[data-testid="user-input-step"],[data-testid="planner-response-text"]')) return false;
          const owner = el.closest?.('[data-testid="agent-response"]');
          return !owner || owner === response;
        };
        let trigger = response.querySelector?.('[data-testid="worked-for-collapsible"]') || null;
        if (trigger && !belongs(trigger)) trigger = null;
        if (!trigger && scope) trigger = [...(scope.querySelectorAll?.('[data-testid="worked-for-collapsible"]') || [])].find(belongs) || null;
        if (!trigger) {
          const rootsToSearch = scope && scope !== response ? [response, scope] : [response];
          for (const root of rootsToSearch) {
            trigger = [...(root.querySelectorAll?.('button,[role="button"]') || [])].find(btn => belongs(btn) && WORKED_RE.test(String(btn.textContent || '').trim())) || null;
            if (trigger) break;
          }
        }
        if (!trigger) return null;
        const spans = [...(trigger.querySelectorAll?.('span') || [])];
        const label = spans.find(el => WORKED_RE.test(String(el.textContent || '').trim())) || null;
        const extraUpdateSpans = label
          ? spans.filter(el => el !== label && !label.contains?.(el) && !el.contains?.(label) && UPDATES_RE.test(String(el.textContent || '').trim()))
          : [];
        return { trigger, label, extraUpdateSpans };
      };
      const formatWorkedLabel = (originalText, durationMs) => {
        const m = String(originalText || '').match(UPDATES_RE);
        const count = m ? m[1] : '';
        const base = `${uiText('用时', 'Worked for')} ${duration(durationMs)}`;
        if (!count) return base;
        return options.language === 'en'
          ? `${base} ${count} ${count === '1' ? 'update' : 'updates'}`
          : `${base} ${count} ${uiText('条进度', 'updates')}`;
      };
      for (const response of document.querySelectorAll('[data-testid="agent-response"]')) {
        const turn = turnFor(response);
        if (!turn) continue;
        const scope = turnScope(response);
        if (options.responseBranch && turn.status !== 'running') {
          const feedback = scope?.querySelector('[aria-label="Bad response"]') || scope?.querySelector('[aria-label="Good response"]') || [...(scope?.querySelectorAll('button[aria-label="Copy"]') || [])].find(button => !button.closest('[data-testid="user-input-step"]'));
          const actionRow = feedback?.parentElement;
          if (actionRow) renderRoot(actionRow, actionRow, null, response, h(ResponseActions, { turn, conversationId: data.conversationId }), 'response-actions');
        }
        if (!options.timing || !turn.completedAtIso || turn.durationMs == null || turn.status === 'running') continue;
        const tooltipId = `agy-completed-${data.conversationId}-${turn.turnNumber}`;
        const worked = findWorkedCollapsible(response, scope);
        if (worked) {
          const { trigger: nativeWorked, label, extraUpdateSpans } = worked;
          if (label) {
            if (!changedLabels.has(label)) {
              const combined = [label.textContent, ...extraUpdateSpans.map(s => s.textContent)].filter(Boolean).join(' ');
              changedLabels.set(label, { text: label.textContent, combined, target: nativeWorked, tooltip: nativeWorked.getAttribute?.('data-tooltip-id') ?? null });
            }
            const origRecord = changedLabels.get(label);
            const text = formatWorkedLabel(origRecord.combined || origRecord.text, turn.durationMs);
            if (label.textContent !== text) label.textContent = text;
            for (const extra of extraUpdateSpans) {
              if (!changedLabels.has(extra)) changedLabels.set(extra, { text: extra.textContent, target: extra, tooltip: null, hideExtra: true });
              if (extra.textContent !== '') extra.textContent = '';
            }
          }
          nativeWorked.setAttribute?.('data-tooltip-id', tooltipId);
          renderRoot(response, response, response.firstChild, response, h(Completion, { turn, tooltipOnly: true, tooltipId }), 'completion');
        } else renderRoot(response, response, response.querySelector('[data-testid="planner-response-text"]')?.closest('[data-quotable]') === response ? response.children[1] : response.firstChild, response, h(Completion, { turn, tooltipId }), 'completion');
      }
    }

    function restoreLabels() {
      for (const [label, original] of changedLabels) {
        if (label.isConnected) label.textContent = original.text;
        if (!original.hideExtra && original.target?.isConnected) original.tooltip == null ? original.target.removeAttribute?.('data-tooltip-id') : original.target.setAttribute?.('data-tooltip-id', original.tooltip);
      }
      changedLabels.clear();
    }

    async function navigateToConversation(newId, projectId = '') {
      const r = adapter.router?.();
      if (typeof r?.navigate === 'function') {
        try {
          await r.navigate({
            to: '/c/$cascadeId',
            params: { cascadeId: newId },
            ...(projectId ? { search: { project: projectId } } : {})
          });
          return;
        } catch {}
      }
      location.assign(`/c/${encodeURIComponent(newId)}`);
    }

    async function branchAndNavigate(id, stepIndex = -1) {
      try {
        const result = await adapter.fork(id, stepIndex, { autoRename: false });
        if (result?.warnings?.length) {
          notify?.({ title: t('分支提示'), message: result.warnings.map(w => t(w)).join('\n'), tag: 'agy-branch-warning' });
        }
        if (result?.conversationId) {
          void adapter.renameForkedConversation?.(id, result.conversationId, state?.conversationId === id ? state?.turns?.[0]?.promptTitle : '');
          await navigateToConversation(result.conversationId, result.projectId);
        }
        return result?.conversationId || null;
      } catch (error) {
        notify?.({ title: uiText('无法创建会话分支', 'Unable to branch conversation'), message: t(error.message), tag: 'agy-branch-error' });
      }
    }
    const menuName=globalThis.__agyNativeBindings?.names.menu||'lHc';
    const originalMenu = globalThis[menuName];
    const extendedMenu = function (id, menuOptions) {
      const items = originalMenu(id, menuOptions);
      if (!options.enabled || !options.responseBranch || !id || menuOptions.isArchived || items.some(item => item.id === 'agy-native-fork')) return items;
      const entry = { id: 'agy-native-fork', label: t('分支会话'), icon: h(dq, { name: 'fork_left', size: 16, className: 'shrink-0 text-secondary-foreground' }), testId: 'agy-fork-session-menu-item', onClick: () => { void branchAndNavigate(id); } };
      const index = items.findIndex(item => item.id === 'split');
      return [...items.slice(0, index < 0 ? 3 : index), entry, ...items.slice(index < 0 ? 3 : index)];
    };
    if (typeof originalMenu === 'function') globalThis[menuName] = extendedMenu;
    let activeFileMenuCleanup = null;
    function closeFileContextMenu() {
      activeFileMenuCleanup?.();
      activeFileMenuCleanup = null;
    }
    function OpenWithAppIcon({ icon }) {
      const s = { width: 15, height: 15, flexShrink: 0, display: 'inline-block' };
      if (icon === 'vscode') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M17.5 2.5L9 10.6 4.4 7.1 2.5 8.1v7.8l1.9 1L9 13.4l8.5 8.1 4-1.9V4.4l-4-1.9zm0 4.5v10l-5.6-5 5.6-5z', fill: '#007ACC' }));
      if (icon === 'visualstudio') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M17 2.5L8.6 10.5 4.2 7.2 2.5 8.3v7.4l1.7 1.1 4.4-3.3L17 21.5l4.5-2.1V4.6L17 2.5zm0 4.8v9.4L11.8 12 17 7.3z', fill: '#8661C5' }));
      if (icon === 'cursor') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M12 2L20.5 7v10L12 22 3.5 17V7L12 2z', stroke: 'currentColor', strokeWidth: 1.8, fill: 'color-mix(in srgb,currentColor 12%,transparent)' }),
        h('path', { d: 'M9 8.5l7.5 3.5-4.2 1.2L11 17.5 9 8.5z', fill: 'currentColor' }));
      if (icon === 'antigravity') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M12 3.5L5 19.5c1.5 1.2 3.6-.8 7-3.4 3.4 2.6 5.5 4.6 7 3.4L12 3.5z', fill: '#4285F4' }));
      if (icon === 'windsurf') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M4 17c3.5-8 8.5-11 16-12-2.5 4.5-4 8-4 12-4-.5-8 0-12 0z', fill: '#09B6A2' }));
      if (icon === 'zed') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M5 6h14L5 18h14', stroke: '#3B82F6', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
      if (icon === 'jetbrains') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 3.5, fill: '#27282C', stroke: 'currentColor', strokeWidth: 1.2 }),
        h('line', { x1: 7.5, y1: 16.5, x2: 14.5, y2: 16.5, stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' }));
      if (icon === 'sublime') return h('svg', { viewBox: '0 0 24 24', fill: 'none', style: s, 'aria-hidden': true },
        h('path', { d: 'M18 5L6 9.2v3.6l12-4.2V5zm0 6.2L6 15.4V19l12-4.2v-3.6z', fill: '#FF9800' }));
      if (icon === 'terminal' || icon === 'gitbash' || icon === 'wsl') return h(dq, { name: 'terminal', size: 15, className: 'shrink-0 text-secondary-foreground' });
      if (icon === 'explorer') return h(dq, { name: 'folder_open', size: 15, className: 'shrink-0 text-secondary-foreground' });
      if (icon === 'default') return h(dq, { name: 'open_in_new', size: 15, className: 'shrink-0 text-secondary-foreground' });
      return h(dq, { name: 'code', size: 15, className: 'shrink-0 text-secondary-foreground' });
    }
    let openWithAppsCache = null;
    function FileContextMenu({ x, y, uri, isDirectory = false, source, onClose }) {
      const [open, setOpen] = R.useState(false);
      const [subOpen, setSubOpen] = R.useState(false);
      const [subPos, setSubPos] = R.useState(null);
      const [apps, setApps] = R.useState(() => openWithAppsCache);
      const subTimerRef = R.useRef(null);
      const subHoverRef = R.useRef(false);
      const rowRef = R.useRef(null);
      R.useLayoutEffect(() => { setOpen(true); }, []);
      R.useEffect(() => {
        let alive = true;
        void request('file.openWithList').then(res => {
          if (!alive) return;
          const list = Array.isArray(res?.apps) ? res.apps : [];
          if (!res?.sshUnsupported) openWithAppsCache = list;
          setApps(list);
        }).catch(() => { if (alive && !apps) setApps([]); });
        return () => { alive = false; clearTimeout(subTimerRef.current); };
      }, []);
      const attachToChat = async () => {
        onClose();
        try {
          const res = await request('file.attach', { uri, isDirectory: Boolean(isDirectory) });
          await adapter.attachFileToComposer?.(res, source);
        } catch (error) {
          notify?.({ title: t('引用到输入框失败'), message: error.message, tag: 'agy-file-action-error' });
        }
      };
      const runAction = async (method, errorKey, successKey, extra = {}) => {
        onClose();
        try {
          const res = await request(method, { uri, ...extra });
          if (successKey) notify?.({ title: t(successKey), message: res?.path || '', tag: 'agy-file-action-ok' });
        } catch (error) {
          notify?.({ title: t(errorKey), message: error.message, tag: 'agy-file-action-error' });
        }
      };
      const copyPath = async () => {
        onClose();
        try {
          const res = await request('file.path', { uri });
          await navigator.clipboard.writeText(res.path);
          notify?.({ title: t('已复制文件路径'), message: res.path, tag: 'agy-file-action-ok' });
        } catch (error) {
          notify?.({ title: t('复制路径失败'), message: error.message, tag: 'agy-file-action-error' });
        }
      };
      const appLabel = app => app.id === 'default' ? uiText('默认应用', 'Default app')
        : app.id === 'explorer' ? (app.label === 'Finder' ? uiText('访达', 'Finder') : app.label === 'File Explorer' ? uiText('文件资源管理器', 'File Explorer') : uiText('文件管理器', 'File Manager'))
        : app.id === 'terminal' && app.label === 'Terminal' ? uiText('终端', 'Terminal')
        : app.label;
      const openSubmenu = () => {
        clearTimeout(subTimerRef.current);
        const rect = rowRef.current?.getBoundingClientRect?.();
        if (rect) {
          const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
          const subW = 204;
          const estH = Math.min(340, ((apps?.length || 4) * 32) + 18);
          const left = rect.right + 4 + subW <= vw ? rect.right + 4 : Math.max(8, rect.left - subW - 4);
          const top = Math.max(8, Math.min(rect.top - 4, vh - estH - 8));
          setSubPos({ left, top });
        }
        setSubOpen(true);
      };
      const scheduleCloseSubmenu = () => {
        subHoverRef.current = false;
        clearTimeout(subTimerRef.current);
        subTimerRef.current = setTimeout(() => setSubOpen(false), 160);
      };
      const keepSubmenu = () => { subHoverRef.current = true; clearTimeout(subTimerRef.current); };
      const list = Array.isArray(apps) ? apps : [];
      const editors = list.filter(a => a.kind === 'editor');
      const others = list.filter(a => a.kind !== 'editor');
      const renderAppBtn = app => h('button', {
        key: app.id,
        type: 'button',
        role: 'menuitem',
        'data-testid': `agy-file-open-with-${app.id}`,
        style: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '6px 10px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--foreground)', font: 'inherit', fontSize: 13, lineHeight: '18px', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap' },
        onMouseEnter: e => { e.currentTarget.style.background = 'var(--secondary)'; },
        onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; },
        onClick: () => { subHoverRef.current = false; void runAction('file.openWith', '打开文件失败', '', { appId: app.id }); }
      }, h(OpenWithAppIcon, { icon: app.icon }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, appLabel(app)));
      return h(R.Fragment, null,
        h(HC, {
          open,
          onOpenChange: next => { if (!next && !subHoverRef.current) onClose(); },
          placement: 'bottom-start',
          disableMobileSheet: true
        },
          h(IC, { asChild: true }, h('span', {
            'aria-hidden': true,
            style: { position: 'fixed', left: x, top: y, width: 1, height: 1, pointerEvents: 'none' }
          })),
          h(JC, { className: '!w-52', arrowNavigable: true, 'data-testid': 'agy-file-context-menu', role: 'menu' },
            h(KC, { asChild: true }, h(GC, {
              icon: h(dq, { name: 'attach_file', size: 16, className: 'shrink-0 text-secondary-foreground' }),
              'data-testid': 'agy-file-attach-chat',
              onClick: () => { void attachToChat(); }
            }, t('引用到输入框'))),
            h('div', {
              ref: rowRef,
              onMouseEnter: openSubmenu,
              onMouseLeave: scheduleCloseSubmenu
            }, h(GC, {
              icon: h(dq, { name: 'open_in_new', size: 16, className: 'shrink-0 text-secondary-foreground' }),
              'data-testid': 'agy-file-open-with',
              onClick: e => { e?.preventDefault?.(); e?.stopPropagation?.(); openSubmenu(); }
            }, h('span', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 } },
              h('span', null, uiText('打开方式', 'Open with')),
              h(dq, { name: 'chevron_right', size: 15, className: 'shrink-0 text-muted-foreground' })))),
            h(KC, { asChild: true }, h(GC, {
              icon: h(dq, { name: 'folder_open', size: 16, className: 'shrink-0 text-secondary-foreground' }),
              'data-testid': 'agy-file-open-folder',
              onClick: () => { void runAction('file.reveal', '打开文件夹失败'); }
            }, t('打开所在文件夹'))),
            h(KC, { asChild: true }, h(GC, {
              icon: h(dq, { name: 'file_copy', size: 16, className: 'shrink-0 text-secondary-foreground' }),
              'data-testid': 'agy-file-copy-file',
              onClick: () => { void runAction('file.copy', '复制文件失败', '已复制文件'); }
            }, t('复制文件'))),
            h(KC, { asChild: true }, h(GC, {
              icon: h(dq, { name: 'link', size: 16, className: 'shrink-0 text-secondary-foreground' }),
              'data-testid': 'agy-file-copy-path',
              onClick: () => { void copyPath(); }
            }, t('复制路径'))))),
        subOpen && subPos && h('div', {
          role: 'menu',
          'data-testid': 'agy-file-open-with-submenu',
          'data-agy-powertools-root': 'file-menu-sub',
          onMouseEnter: keepSubmenu,
          onPointerEnter: keepSubmenu,
          onPointerDown: keepSubmenu,
          onMouseLeave: scheduleCloseSubmenu,
          onMouseDown: e => { keepSubmenu(); e.stopPropagation(); },
          style: {
            position: 'fixed', left: subPos.left, top: subPos.top, zIndex: 6200,
            minWidth: 188, maxWidth: 240, maxHeight: 340, overflowY: 'auto',
            padding: 4, borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--card)', color: 'var(--foreground)',
            boxShadow: '0 10px 28px rgba(0,0,0,.22)',
            display: 'flex', flexDirection: 'column', gap: 1
          }
        },
          apps === null
            ? h('div', { style: { padding: '6px 10px', fontSize: 12, color: 'var(--muted-foreground)' } }, uiText('正在探测本机应用…', 'Detecting installed apps…'))
            : !list.length
              ? h('div', { style: { padding: '6px 10px', fontSize: 12, color: 'var(--muted-foreground)' } }, uiText('当前窗口不支持本地打开', 'Local open unavailable'))
              : [
                  ...editors.map(renderAppBtn),
                  editors.length > 0 && others.length > 0 && h('div', { key: 'sep', style: { height: 1, margin: '4px 6px', background: 'var(--border)' } }),
                  ...others.map(renderAppBtn)
                ]));
    }
    function showFileContextMenu({ x, y, uri, isDirectory = false, source }) {
      closeFileContextMenu();
      const host = document.createElement('div');
      host.dataset.agyPowertoolsRoot = 'file-menu';
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host);
      const menuController = new AbortController();
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        menuController.abort();
        if (activeFileMenuCleanup === cleanup) activeFileMenuCleanup = null;
        setTimeout(() => { root.unmount(); host.remove(); }, 0);
      };
      activeFileMenuCleanup = cleanup;
      document.addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(); }, { capture: true, signal: menuController.signal });
      document.addEventListener('scroll', e => { if (!e.target?.closest?.('[data-testid="agy-file-context-menu"],[data-testid="agy-file-open-with-submenu"]')) cleanup(); }, { capture: true, signal: menuController.signal });
      window.addEventListener('resize', cleanup, { signal: menuController.signal });
      window.addEventListener('blur', cleanup, { signal: menuController.signal });
      const menu = h(FileContextMenu, { x, y, uri, isDirectory, source, onClose: cleanup });
      const sourceEl = source || document.querySelector('[data-testid="conversation-view"],a[href="/customizations"]') || document.body.firstElementChild;
      const tree = sourceEl ? adapter.wrap(menu, sourceEl) : menu;
      root.render(Boundary ? h(Boundary, null, tree) : tree);
    }
    function NativeSearchEnhancer({ input }) {
      const [query, setQuery] = R.useState(() => String(input?.value || ''));
      const [scope, setScope] = R.useState('all');
      const [results, setResults] = R.useState([]);
      const [scanned, setScanned] = R.useState(0);
      const [searching, setSearching] = R.useState(false);
      const [err, setErr] = R.useState('');
      const [copiedKey, setCopiedKey] = R.useState('');
      const seqRef = R.useRef(0);
      R.useEffect(() => {
        if (!input) return;
        const sync = () => { const v = String(input.value || ''); setQuery(prev => prev === v ? prev : v); };
        sync();
        input.addEventListener?.('input', sync);
        const poll = setInterval(sync, 120);
        return () => { input.removeEventListener?.('input', sync); clearInterval(poll); };
      }, [input]);
      const qTrim = query.trim();
      const ready = Boolean(qTrim && (/[^\x00-\x7f]/.test(qTrim) || qTrim.length >= 2));
      R.useEffect(() => {
        if (!ready) {
          seqRef.current++;
          setResults([]); setScanned(0); setSearching(false); setErr('');
          return;
        }
        const seq = ++seqRef.current;
        setSearching(true);
        const timer = setTimeout(async () => {
          try {
            const dir = adapter.conversationDirectory?.() || { byId: {}, subagentIds: [] };
            const excludeIds = (dir.subagentIds || []).slice(0, 500);
            const res = await request('sessions.search', { query: qTrim, scope, excludeIds, maxResults: 24 });
            if (seq !== seqRef.current) return;
            setResults(Array.isArray(res?.results) ? res.results : []);
            setScanned(Number(res?.scannedConversations || 0));
            setErr('');
          } catch (e) {
            if (seq === seqRef.current) setErr(e?.message || uiText('检索失败', 'Search failed'));
          } finally {
            if (seq === seqRef.current) setSearching(false);
          }
        }, 160);
        return () => clearTimeout(timer);
      }, [qTrim, scope, ready]);
      if (!ready) return null;
      const dir = adapter.conversationDirectory?.() || { byId: {} };
      const kindLabel = k => k === 'prompt' ? uiText('提问', 'Prompt')
        : k === 'response' ? uiText('回复', 'Reply')
        : k === 'code' ? uiText('代码', 'Code')
        : k === 'command' ? uiText('命令', 'Cmd')
        : uiText('输出', 'Output');
      const renderSnippet = hit => {
        const s = String(hit.snippet || '');
        const idx = Number(hit.matchIndex), len = Number(hit.matchLength);
        if (!Number.isInteger(idx) || idx < 0 || !Number.isInteger(len) || len <= 0 || idx + len > s.length) return s;
        return h(R.Fragment, null, s.slice(0, idx), h('mark', { style: { background: 'color-mix(in srgb,var(--warning) 34%,transparent)', color: 'var(--foreground)', borderRadius: 3, padding: '0 2px', fontWeight: 600 } }, s.slice(idx, idx + len)), s.slice(idx + len));
      };
      const closeModal = () => {
        try {
          const closer = adapter.providers?.(input)?.find(p => typeof p.value?.events?.selectOrClose === 'function')?.value?.events?.selectOrClose;
          if (typeof closer === 'function') { closer(); return; }
        } catch {}
        try { input?.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } catch {}
      };
      const scopeItems = [['all', uiText('全部', 'All')], ['text', uiText('正文', 'Text')], ['code', uiText('代码与命令', 'Code')]];
      return h('div', {
        'data-testid': 'agy-native-search-panel',
        onMouseDown: e => { e.stopPropagation(); },
        style: { borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'transparent', borderBottomLeftRadius: 11, borderBottomRightRadius: 11, overflow: 'hidden' }
      },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 12px 5px', fontSize: 12, color: 'var(--muted-foreground)' } },
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
            h('span', { style: { fontWeight: 500 } }, uiText('对话内容匹配', 'Message & code matches')),
            searching
              ? h(dq, { name: 'progress_activity', size: 13, className: 'animate-spin shrink-0 text-muted-foreground', 'data-testid': 'agy-native-search-spinner' })
              : h('span', {
                  'data-testid': 'agy-native-search-count',
                  style: {
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 18, height: 17, padding: '0 5px', borderRadius: 9999,
                    background: 'color-mix(in srgb,var(--foreground) 7%,transparent)',
                    color: 'var(--muted-foreground)', fontSize: 10.5, fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums', lineHeight: 1
                  }
                }, String(results.length))),
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
            ...scopeItems.map(([key, label]) => h('button', {
              key, type: 'button',
              'data-testid': `agy-native-search-scope-${key}`,
              onClick: e => { e.preventDefault(); e.stopPropagation(); setScope(key); },
              style: {
                height: 21, padding: '0 8px', borderRadius: 6, border: '1px solid ' + (scope === key ? 'color-mix(in srgb,var(--primary) 40%,var(--border))' : 'transparent'),
                background: scope === key ? 'color-mix(in srgb,var(--primary) 12%,transparent)' : 'transparent',
                color: scope === key ? 'var(--foreground)' : 'var(--muted-foreground)',
                font: 'inherit', fontSize: 11, fontWeight: scope === key ? 500 : 400, cursor: 'pointer'
              }
            }, label)))),
        err
          ? h('div', { style: { padding: '6px 12px 10px', fontSize: 12, color: 'var(--error)' } }, err)
          : !searching && !results.length
            ? h('div', { 'data-testid': 'agy-native-search-empty', style: { padding: '8px 12px 11px', fontSize: 12, color: 'var(--muted-foreground)' } }, uiText(`已扫描 ${scanned} 个会话，正文与代码中无匹配`, `No body/code matches across ${scanned} chats`))
            : h('div', { 'data-testid': 'agy-native-search-results', style: { maxHeight: 220, overflowY: 'auto', padding: '2px 6px 7px', display: 'flex', flexDirection: 'column', gap: 2 } },
                ...results.map((hit, idx) => {
                  const meta = dir.byId?.[hit.conversationId];
                  const title = meta?.title || hit.fallbackTitle || hit.conversationId;
                  const proj = meta?.projectName || '';
                  const key = `${hit.conversationId}:${hit.stepIndex}:${idx}`;
                  const mono = hit.kind === 'code' || hit.kind === 'command' || hit.kind === 'output';
                  return h('div', {
                    key, role: 'button', tabIndex: 0,
                    'data-testid': 'agy-native-search-hit',
                    'data-conversation-id': hit.conversationId,
                    style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', transition: 'background 100ms ease' },
                    onMouseEnter: e => { e.currentTarget.style.background = 'var(--secondary)'; },
                    onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; },
                    onClick: e => {
                      e.preventDefault(); e.stopPropagation();
                      closeModal();
                      jumpToSearchHit({ ...hit, projectId: meta?.projectId || '' });
                    }
                  },
                    h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12 } },
                        proj && h('span', { style: { padding: '0 5px', height: 17, lineHeight: '17px', borderRadius: 4, fontSize: 10.5, background: 'var(--secondary)', color: 'var(--secondary-foreground)', flexShrink: 0 } }, proj),
                        h('span', { style: { fontWeight: 500, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title }, title),
                        h('span', { style: { padding: '0 5px', height: 17, lineHeight: '17px', borderRadius: 4, fontSize: 10.5, flexShrink: 0, background: mono ? 'color-mix(in srgb,var(--primary) 14%,transparent)' : 'var(--secondary)', color: mono ? 'var(--primary)' : 'var(--muted-foreground)' } }, `#${hit.turnNumber} ${kindLabel(hit.kind)}`)),
                      h('div', {
                        style: mono
                          ? { fontFamily: 'var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)', fontSize: 11.5, lineHeight: 1.4, padding: '4px 7px', borderRadius: 6, background: 'color-mix(in srgb,var(--secondary) 65%,transparent)', color: 'var(--foreground)', wordBreak: 'break-word', overflowWrap: 'anywhere' }
                          : { fontSize: 12, lineHeight: 1.45, color: 'var(--muted-foreground)', wordBreak: 'break-word', overflowWrap: 'anywhere' }
                      }, renderSnippet(hit))),
                    hit.copyText && h('button', {
                      type: 'button',
                      'data-testid': 'agy-native-search-copy',
                      style: { flexShrink: 0, height: 22, padding: '0 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--secondary-foreground)', font: 'inherit', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' },
                      onClick: async e => {
                        e.preventDefault(); e.stopPropagation();
                        try {
                          await navigator.clipboard.writeText(hit.copyText);
                          setCopiedKey(key);
                          setTimeout(() => setCopiedKey(cur => cur === key ? '' : cur), 1500);
                        } catch {}
                      }
                    }, copiedKey === key ? t('已复制') : (hit.kind === 'command' ? uiText('复制命令', 'Copy') : uiText('复制代码', 'Copy'))));
                })));
    }
    document.addEventListener('contextmenu', event => {
      if(!options.enabled)return;
      const row = event.target.closest?.('.agy-sidebar-row');
      const link = row?.querySelector('a[href^="/c/"]');
      const button = row?.querySelector('button[aria-label="More options"]');
      if (link && button) {
        event.preventDefault(); event.stopPropagation();
        if (button.getAttribute('aria-expanded') !== 'true') button.click();
        return;
      }
      if (!options.fileContextMenu) return;
      const fileTarget = event.target.closest?.('[data-testid="agent-response"] [data-uri^="file://"], [data-testid="agent-response"] a[href^="file://"], [data-testid="user-input-step"] [data-uri^="file://"], [data-testid="user-input-step"] a[href^="file://"]');
      const fileUri = fileTarget?.getAttribute('data-uri') || fileTarget?.getAttribute('href') || '';
      if (fileUri.startsWith('file://')) {
        event.preventDefault(); event.stopPropagation();
        showFileContextMenu({ x: event.clientX, y: event.clientY, uri: fileUri, source: fileTarget });
        return;
      }
      const treeEntry = adapter.fileTreeEntry?.(event.target);
      if (treeEntry?.uri) {
        event.preventDefault(); event.stopPropagation();
        showFileContextMenu({ x: event.clientX, y: event.clientY, uri: treeEntry.uri, isDirectory: treeEntry.isDirectory, source: event.target });
      }
    }, { capture: true, signal: signalController.signal });

    const unfocusedFinishedIds = new Set();
    let activeRunningId = '', titleSyncing = false;
    const stripTitleBadge = value => String(value || '').replace(/^\(\d+\)\s+/, '');
    function syncTaskbarBadge(execution = null) {
      if (disposed) return;
      const id = currentId();
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      if (focused && id) unfocusedFinishedIds.delete(id);
      const exec = execution || (id ? adapter.executionState?.(id) : null);
      if (exec?.conversationId === id) {
        if (isExecActive(exec)) activeRunningId = id;
        else if (exec.status === 1 && activeRunningId === id) {
          activeRunningId = '';
          if (!focused) unfocusedFinishedIds.add(id);
        }
      }
      const badgeActive = options.enabled && options.taskbarBadge;
      const count = badgeActive ? Math.max(adapter.unreadCount?.(id, focused) || 0, unfocusedFinishedIds.size) : 0;
      if (typeof document.title === 'string' && document.title) {
        const clean = stripTitleBadge(document.title);
        const nextTitle = count > 0 ? `(${count}) ${clean}` : clean;
        if (document.title !== nextTitle) {
          titleSyncing = true;
          try { document.title = nextTitle; } finally { titleSyncing = false; }
        }
      }
    }
    const titleElement = document.querySelector?.('title');
    const titleObserver = titleElement ? new MutationObserver(() => { if (!titleSyncing) syncTaskbarBadge(); }) : null;
    if (titleObserver && titleElement) titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => { const id = currentId(); if (id) unfocusedFinishedIds.delete(id); syncTaskbarBadge(); }, { signal: signalController.signal });
      window.addEventListener('blur', () => syncTaskbarBadge(), { signal: signalController.signal });
    }
    document.addEventListener('visibilitychange', () => syncTaskbarBadge(), { signal: signalController.signal });

    let refreshQueued = false, lastRunningConvId = '';
    async function refresh() {
      if (disposed) return;
      if (busy) { refreshQueued = true; return; }
      busy = true;
      const id = currentId();
      try {
        if (!settingsLoaded) { options = {...defaults,...await request('settings.get')}; settingsLoaded = true; applyOptions(); mount(); syncTaskbarBadge(); emit(); }
        if(!options.enabled){ syncTaskbarBadge(); return; }
        if (id !== lastId) {
          state = id ? (stateCache.get(id) || null) : null;
          lastId = id;
          if (id && typeof document.hasFocus === 'function' && document.hasFocus()) unfocusedFinishedIds.delete(id);
          mount();
        }
        if (options.multiAccount && !accountsState && !loadingAccounts) void loadAccounts().catch(() => {});
        if (!proxyStatus && !loadingProxyStatus) void loadProxyStatus().catch(() => {});
        const execution = id ? adapter.executionState?.(id) : null;
        const isNowRunning = Boolean(id && execution?.conversationId === id && isExecActive(execution));
        const turnJustFinished = Boolean(lastRunningConvId && lastRunningConvId === id && execution?.conversationId === id && !isNowRunning);
        if (isNowRunning) lastRunningConvId = id;
        else if (lastRunningConvId === id) lastRunningConvId = '';
        const nowMs = Date.now();
        const isPageVisible = typeof document?.visibilityState !== 'string' || document.visibilityState !== 'hidden';
        const canRetryFail = !lastAccountFailAt || nowMs - lastAccountFailAt > ACCOUNT_FAIL_BACKOFF_MS;
        if (turnJustFinished && nowMs - lastForceAccountAt > TURN_FINISH_FORCE_MIN_GAP_MS) {
          void refreshAccount(true).catch(() => {});
        } else if (canRetryFail && nowMs - lastAccountAt > ACCOUNT_POLL_MS) {
          const shouldForce = Boolean(isPageVisible && lastAccountAt > 0 && nowMs - lastForceAccountAt >= ACCOUNT_FORCE_POLL_MS);
          void refreshAccount(shouldForce).catch(() => {});
        }
        if (deferredAutoSwitchGroup && !isTurnRunning() && options.enabled && options.multiAccount && options.autoSwitchAccount) {
          const pendingGroup = deferredAutoSwitchGroup === 'pending' ? '' : deferredAutoSwitchGroup;
          deferredAutoSwitchGroup = '';
          void maybeAutoSwitch(pendingGroup);
        }
        syncTaskbarBadge(execution);
        syncSubagents(id);
        const extraIds = [...new Set(
          [...document.querySelectorAll('[data-testid="model-selector-trigger"]')]
            .map(el => {
              const card = el.closest('.surface-composer-card');
              return card ? composerConversationId(el, card) : '';
            })
            .filter(cid => cid && cid !== id)
        )].slice(0, 4);
        if (!id && !extraIds.length) return;
        const [mainReply, ...extraReplies] = await Promise.all([
          id ? request('state', { conversationId: id, execution }) : Promise.resolve(null),
          ...extraIds.map(extraId => request('state', { conversationId: extraId }).then(reply => ({ extraId, reply })).catch(() => null))
        ]);
        let updatedAny = false;
        for (const item of extraReplies) {
          if (item?.reply) { rememberState(item.extraId, item.reply); updatedAny = true; }
        }
        if (id && mainReply) {
          rememberState(id, mainReply);
          if (id === currentId()) { state = mainReply; lastConversation = mainReply; if (mainReply.settings) options = {...defaults,...mainReply.settings}; updatedAny = true; }
        }
        if (updatedAny) { mount(); syncTaskbarBadge(execution); emit(); }
      } catch { /* Keep the last confirmed data during a transient host reconnect. */ }
      finally {
        busy = false;
        if (refreshQueued && !disposed) { refreshQueued = false; void refresh(); }
      }
    }
    let mountTimer;
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target.closest?.('[data-agy-powertools-root],[data-agy-editor-slot],[data-testid="agy-edit-banner"],[data-testid="agy-context-popup"],[data-testid="agy-stats-popup"],[data-testid="agy-subagent-popover"],[data-testid="agy-file-context-menu"],[data-testid="agy-account-popover"],[data-testid="agy-account-switch-dialog"],[data-testid="agy-add-account-dialog"],[data-testid="agy-multi-account-risk-dialog"],[data-testid="agy-autoswitch-banner"],[data-testid="agy-proxy-prompt-banner"],.react-tooltip'))) return;
      clearTimeout(mountTimer); mountTimer = setTimeout(mount, 24);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(refresh, 2000);
    globalThis.__agyPowertools = {
      version,
      get status() {
        const expectedRings = (options.enabled && options.contextRing)
          ? [...document.querySelectorAll('[data-testid="model-selector-trigger"]')].filter(el => {
              const card = el.closest('.surface-composer-card');
              if (!card) return false;
              const cid = composerConversationId(el, card);
              return Boolean(stateForConversation(cid)?.conversationId);
            }).length
          : 0;
        const actualRings = document.querySelectorAll('[data-testid="agy-context-ring-trigger"]').length;
        const managementExpected=document.querySelector('a[href="/customizations"],[data-testid="sidebar-navigation-items"]');
        const healthy=!disposed&&!renderError&&(!expectedRings||actualRings===expectedRings)&&(!managementExpected||!!document.querySelector('[data-testid="agy-management-trigger"]'));
        return {conversationId:state?.conversationId||'',mounted:[...roots.values()].filter(r=>r.kind==='ring'&&r.mount.isConnected).length,healthy,nativeComponents:true,error:renderError||undefined};
      },
      fork: adapter.fork,
      get settings() { return { ...options }; },
      get account() {return account;},
      get accounts() {return accountsState;},
      get proxyStatus() {return proxyStatus;},
      get subagents() { return subagentList.map(meta => ({ ...meta, stats: subagentStats.get(meta.id) || null })); },
      get dashboard(){return dashboard;},
      dispose() {
        disposed = true; clearResumeEditTimer(); hideProxyBanner(); cancelAutoSwitch(); titleObserver?.disconnect(); if (typeof document.title === 'string') document.title = stripTitleBadge(document.title); closeFileContextMenu(); signalController.abort(); stopOverviewNavigation?.(); stopResolvedNavigation?.(); observer.disconnect(); clearInterval(timer); clearTimeout(mountTimer); stateCache.clear(); subagentStats.clear(); subagentList = [];
        if (globalThis[menuName] === extendedMenu) globalThis[menuName] = originalMenu;
        for (const entry of roots.values()) { entry.root.unmount(); entry.mount.remove(); } roots.clear();
        restoreLabels(); localizer?.dispose(); panels?.dispose(); adapter.dispose?.(); densityStyle.remove(); document.documentElement.removeAttribute('data-agy-compact'); document.documentElement.removeAttribute('data-agy-keep-outline'); document.documentElement.removeAttribute('data-agy-account-switcher'); document.documentElement.removeAttribute('data-agy-user-bubble'); document.documentElement.removeAttribute('data-agy-bubble-fg'); document.documentElement.style?.removeProperty?.('--agy-bubble-tint'); document.documentElement.style?.removeProperty?.('--agy-bubble-bg'); document.documentElement.style?.removeProperty?.('--agy-bubble-border'); document.documentElement.style?.removeProperty?.('--agy-bubble-fg'); listeners.clear();
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('已断开')); } pending.clear();
        delete globalThis.__agyPowertools; delete globalThis.__agyPowertoolsReceive;
      }
    };
    mount(); void refresh();
  }
})();
