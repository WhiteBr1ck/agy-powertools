import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,writeFileSync,mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import vm from'node:vm';
import{toZhTw}from'../lib/zh-tw.mjs';
import{renderAuxPaneHtml}from'../lib/sidecar-ui.mjs';
import{formatRelativeTime,formatResetCountdown}from'../lib/account-helpers.mjs';
import{createSettingsStore}from'../lib/settings.mjs';
import{loadCustomI18n}from'../lib/native-host.mjs';
test('native settings translations preserve product names and English input terminology',()=>{
 const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
 const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}}});
 vm.runInContext(readFileSync('lib/native-i18n.js','utf8'),context);const t=context.__agyI18n.t;
 assert.equal(t('Interface Layout','zh-CN'),'界面布局');assert.equal(t('Queued Messages','zh-CN'),'后续消息');assert.equal(t('输入','en'),'Input');
 assert.equal(t('Google AI Ultra','zh-CN'),'Google AI Ultra');assert.equal(t('Google Sans','zh-CN'),'Google Sans');assert.equal(t('Ctrl','zh-CN'),'Ctrl');
 assert.equal(t('Your Plan: Google AI Ultra','zh-CN'),'当前套餐：Google AI Ultra');
 assert.equal(t('You have used some of your weekly limit, it will fully refresh in 3 days, 11 hours.','zh-CN'),'周额度将在 3 天 11 小时后重置。');
 assert.equal(t('Quote','zh-CN'),'引用');assert.equal(t('Ask /btw','zh-CN'),'顺便问 /btw');
 assert.equal(t('Local Permissions','zh-CN'),'本地权限');assert.equal(t('Every command requires approval.','zh-CN'),'每条命令均需批准。');
 assert.equal(t('Ask before sensitive operations.','zh-CN'),'执行敏感操作前询问。');assert.equal(t('Run all commands without restrictions.','zh-CN'),'无限制运行所有命令。');
 assert.equal(t('Background Tasks','zh-CN'),'后台任务');assert.equal(t('See all (6)','zh-CN'),'查看全部 (6)');
 assert.equal(t('See all','zh-CN'),'查看全部');assert.equal(t('Conversation Name','zh-CN'),'会话名称');assert.equal(t('Conversation ID','zh-CN'),'会话 ID');assert.equal(t('Project Name','zh-CN'),'项目名称');
 assert.equal(t('Split Right','zh-CN'),'向右拆分');assert.equal(t('Split Down','zh-CN'),'向下拆分');assert.equal(t('Replace with New','zh-CN'),'替换为新会话');
 assert.equal(t('Search or enter a URL','zh-CN'),'搜索或输入网址');assert.equal(t('Open File','zh-CN'),'打开文件');
 assert.equal(t('Side Question','zh-CN'),'侧边对话');assert.equal(t('New Side Question','zh-CN'),'新建侧边对话');
 assert.equal(t('Ask a side question without interrupting the main conversation','zh-CN'),'发起侧边对话，不打断主对话');
 assert.equal(t('12 files changed','zh-CN'),'12 个文件已更改');assert.equal(t('1 file changed','zh-CN'),'1 个文件已更改');
 assert.equal(t('5h limit','zh-CN'),'5 小时限额');assert.equal(t('55% left','zh-CN'),'剩余 55%');assert.equal(t('100% left','zh-CN'),'剩余 100%');
 assert.equal(t('Resets in 5d 1h','zh-CN'),'5 天 1 小时后重置');assert.equal(t('Resets in 3h 33m','zh-CN'),'3 小时 33 分钟后重置');
 assert.equal(t('Pull Requests','zh-CN'),'Pull Requests');assert.equal(t('14m ago','zh-CN'),'14m ago');
 assert.equal(t('Turbo','zh-CN'),'Turbo');assert.equal(t('当前会话','en'),'Current conversation');
});

test('Traditional Chinese (zh-TW) uses Taiwan IT terminology, converts UI strings cleanly, and persists in settings',()=>{
  const document={nodeType:9,createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[]};
  const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){} disconnect(){}},__agyToZhTw:toZhTw});
  vm.runInContext(readFileSync('lib/native-i18n.js','utf8'),context);
  const t=context.__agyI18n.t;
  assert.equal(t('Settings','zh-TW'),'設定');
  assert.equal(t('概览','zh-TW'),'概覽');
  assert.equal(t('请求事件','zh-TW'),'請求事件');
  assert.equal(t('错误事件','zh-TW'),'錯誤事件');
  assert.equal(t('价格','zh-TW'),'價格');
  assert.equal(t('设置','zh-TW'),'設定');
  assert.equal(t('Context window','zh-TW'),'上下文視窗');
  assert.equal(t('Cache hit','zh-TW'),'快取命中');
  assert.equal(t('Open File','zh-TW'),'開啟檔案');
  assert.equal(t('Restore defaults','zh-TW'),'恢復預設設定');
  assert.equal(t('Every command requires approval.','zh-TW'),'每條命令均需批准。');
  assert.equal(t('Background Tasks','zh-TW'),'背景任務');
  assert.equal(t('Your Plan: Google AI Ultra','zh-TW'),'目前方案：Google AI Ultra');
  assert.equal(t('Resets in 3h 33m','zh-TW'),'3 小時 33 分鐘後重置');
  assert.equal(t('Thinking effort','zh-CN'),'思考深度');
  assert.equal(t('Thinking effort','zh-TW'),'思考深度');
  assert.equal(t('View Usage','zh-CN'),'查看用量');
  assert.equal(t('Promote to Conversation','zh-CN'),'提升为正式会话');
  assert.equal(t('Promote to Conversation','zh-TW'),'提升為正式會話');
  assert.equal(t('Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.','zh-TW'),'負責執行計畫，包括檢索、編輯、構建與測試，建議選擇更快、更省的模型。');
  assert.equal(t('Delete Conversation','zh-CN'),'删除会话');
  assert.equal(t('Delete Conversation','zh-TW'),'刪除會話');
  assert.equal(t('Are you sure you want to delete this conversation? This action cannot be undone.','zh-TW'),'確定要刪除此會話嗎？此操作無法撤銷。');
  assert.equal(t('Minimize','zh-TW'),'最小化');
  assert.equal(t('Maximize','zh-TW'),'最大化');
  assert.equal(t('Create Project','zh-TW'),'建立專案');
  assert.equal(t('Command Palette','zh-TW'),'命令面板');
  assert.equal(t('This computer','zh-TW'),'本機');
  assert.equal(t('Input Box','zh-TW'),'輸入框');
  assert.equal(t('Queued messages','zh-TW'),'後續訊息');
  assert.equal(t('Choose which key sends a message in the chat composer.','zh-TW'),'選擇在聊天輸入框中傳送訊息的按鍵。');
  assert.equal(t('Controls how much time and quota the model spends reasoning before responding. Higher effort improves accuracy on hard problems, at the cost of slower responses and higher quota use.','zh-CN'),'控制模型在回复前投入多少时间与额度进行推理。更高的思考深度可提升复杂问题的准确度，但会增加响应耗时与额度消耗。');
  assert.equal(toZhTw('复制文件并恢复默认设置，助手回复缓存异常'), '複製檔案並恢復預設設定，助手回覆快取異常');
  assert.equal(toZhTw('按实际规划 / 执行模型计价'), '按實際規劃 / 執行模型計價');
  assert.equal(formatRelativeTime(0, 30000, 'zh-TW'), '剛剛');
  assert.equal(formatRelativeTime(0, 120000, 'zh-TW'), '2 分鐘前');
  assert.equal(formatResetCountdown(7200000, 0, 'zh-TW'), '2 小時後重置');
  const html=renderAuxPaneHtml({version:'2.13.1',language:'zh-TW'});
  assert.match(html,/<html lang="zh-TW">/);
  assert.ok(html.includes('需要重啟 Antigravity 以啟用 Powertools 外掛'));
  assert.ok(html.includes('檢查外掛更新'));
  // Ensure settings store accepts zh-TW
  const dir=mkdtempSync(join(tmpdir(),'agy-lang-tw-'));
  try{
    const store=createSettingsStore(dir);
    assert.equal(store.set({language:'zh-TW'}).language,'zh-TW');
    assert.equal(store.get().language,'zh-TW');
  }finally{rmSync(dir,{recursive:true,force:true});}
  // Ensure no common simplified-only glyphs remain across UI source files after toZhTw
  assert.equal(toZhTw('智能体每次运行时应执行什么任务？'), '智能體每次執行時應執行什麼任務？');
  assert.equal(toZhTw('内发光脉冲'), '內發光脈衝');
  assert.equal(toZhTw('外光晕脉冲'), '外光暈脈衝');
  assert.equal(toZhTw('无缝切换渐变红色动画，悬停查看，通过拖拽置顶'), '無縫切換漸變紅色動畫，懸停查看，透過拖曳置頂');
  assert.equal(toZhTw('21小时53分18秒'), '21小時53分18秒');
  assert.equal(toZhTw('Token 计数单位：K / M / B（国际通用）或 万 / 亿（中文计数）'), 'Token 計數單位：K / M / B（國際通用）或 萬 / 億（中文計數）');
  assert.equal(toZhTw('费用显示币种：人民币 (¥) / 美元 ($)'), '費用顯示幣種：人民幣 (¥) / 美元 ($)');
  assert.equal(toZhTw('选择语义彩色或低干扰静谧单色额度光环。'), '選擇語義彩色或低干擾靜謐單色額度光環。');
  assert.equal(toZhTw('窄窗口固定概览面板'), '窄視窗固定概覽面板');
  assert.equal(toZhTw('固定概览面板（窄窗口不自动隐藏）'), '固定概覽面板（窄視窗不自動隱藏）');
  assert.equal(toZhTw('取消固定概览面板'), '取消固定概覽面板');
  assert.equal(toZhTw('默认关闭。开启后在窗口缩窄时保持右侧概览侧停不自动隐藏，也可点概览右上角图钉快速切换。'), '預設關閉。開啟後在視窗縮窄時保持右側概覽側停不自動隱藏，也可點概覽右上角圖釘快速切換。');
  assert.equal(toZhTw('动效与侧栏'), '動效與側欄');
  assert.equal(toZhTw('思维过程翻译与双语对照，按 Tab 采纳，已存系统凭据库'), '思維過程翻譯與雙語對照，按 Tab 採納，已存系統憑證庫');
  assert.equal(toZhTw('高级功能：自定义供应商与粘贴 API 密钥'), '進階功能：自訂供應商與貼上 API 密鑰');
  assert.equal(toZhTw('默认关闭。空闲且输入框为空时在行内显示续写建议，按 Tab 采纳；需在下方配置自定义 AI 模型。'), '預設關閉。空閒且輸入框為空時在行內顯示續寫建議，按 Tab 採納；需在下方配置自訂 AI 模型。');
  assert.doesNotMatch(readFileSync('lib/zh-tw.mjs', 'utf8'), /'仍'\s*:\s*'仍'/);
  const simplifiedOnly=/[万亿币种国与个为义于产仅从仓们价优会传体余侧关内写准减凑凭击划则刚创删务动区协单占却历压参发变号后听启周响唤围图圆场声处备头夹实审对导将尝尽层带帮并广库应开异强归当录径忆态总战执扩扬抢护报担拦择挂换据数断无旧时昵显暂机权条来栏树样档检汇没洁浅测浏滚满点热状独环现电监盘码确碍离积称稳筛签简类紧级线组细织终结给络绝统继续缓编缩网联脑范营补装观规视览触计订认让议记许设访证识诊试话询该详语误说请读调败账费资转轮软载较辅辑输边过运这进远违连迟适选遥邮采钟钥钮链销错键钉长闭问闲间阅队阶际险随隐静页顶项顺顿预频题额风馈驻验骤麦标彻么释谈极扫经齐绪购买维铺迁滞册办学杠盖纯纲胶脚觉脉晕译双纳飞]/;
  for(const file of ['lib/native-i18n.js','lib/native-panels.js','lib/native-sidebar-monitor.js','lib/native-sidebar-drop.mjs','lib/native-ui.js','lib/native-beta-ai.js','lib/sidecar-ui.mjs']){
    const converted=toZhTw(readFileSync(file,'utf8')).replace(/简体中文|批准/g,'');
    const leftover=converted.match(simplifiedOnly);
    assert.equal(leftover,null,`Unexpected simplified glyph ${leftover?.[0]} in ${file}`);
  }
});

test('Swarm UI strings translate cleanly in zh-CN and zh-TW without middle dots and protect post bodies', () => {
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;
  assert.equal(t('Board', 'zh-CN'), '讨论板');
  assert.equal(t('Board', 'zh-TW'), '討論板');
  assert.equal(t('Members', 'zh-CN'), '成员');
  assert.equal(t('Members', 'zh-TW'), '成員');
  assert.equal(t('Graph', 'zh-CN'), '关系图');
  assert.equal(t('Graph', 'zh-TW'), '關係圖');
  assert.equal(t('From anyone', 'zh-CN'), '来自任意成员');
  assert.equal(t('To anyone', 'zh-TW'), '提及任意成員');
  assert.equal(t('Hide inactive', 'zh-CN'), '隐藏非活跃');
  assert.equal(t('Export GIF', 'zh-TW'), '匯出 GIF'.replace('匯', '導'));
  assert.equal(t('No swarm in this conversation', 'zh-CN'), '当前会话暂无蜂群');
  assert.equal(t('Copy to clipboard', 'zh-TW'), '複製到剪貼簿');
  assert.equal(t('Attach to chat', 'zh-CN'), '引用到输入框');
  assert.equal(t('Attach to chat', 'zh-TW'), '引用到輸入框');
  assert.equal(t('Pinned Conversations', 'zh-CN'), '置顶会话');
  assert.equal(t('Pinned Conversations', 'zh-TW'), '置頂會話');
  assert.equal(t('Copy Image', 'zh-CN'), '复制图片');
  assert.equal(t('Save Image', 'zh-CN'), '保存图片');
  assert.equal(t('Save Image', 'zh-TW'), '儲存圖片');
  const ovLabel = t(`overview \u00b7 from the narrator\u2019s notes`, 'zh-CN');
  assert.equal(ovLabel, '概览 - 来自旁白笔记');
  assert.equal(ovLabel.includes('\u00b7'), false);
  assert.equal(t(`overview \u00b7 from the narrator's notes`, 'zh-TW'), '概覽 - 來自旁白筆記');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-CN'), '适用于深度推理与复杂问题');
  assert.equal(t('For most deep reasoning and complex problems', 'zh-TW'), '適用於深度推理與複雜問題');
  assert.equal(t('Notice', 'zh-CN'), '提示');
  assert.equal(t('Offloads routine steps to a faster executor. Same quality, fewer tokens used.', 'zh-CN'), '将常规步骤分流给更快的执行模型，保持同等质量同时减少 Token 消耗。');
  assert.equal(t('Copy Project Name', 'zh-CN'), '复制项目名称');
  assert.equal(t('Project Settings', 'zh-TW'), '專案設定');
  assert.equal(t('Reveal in Finder', 'zh-CN'), '在访达中显示');
  assert.equal(t('Reveal in Finder', 'zh-TW'), '在Finder中顯示');
  assert.equal(t('Show in File Explorer', 'zh-TW'), '在檔案總管中顯示');
  assert.equal(t('Delete Project', 'zh-CN'), '删除项目');
  assert.equal(t('Yes, allow this time', 'zh-CN'), '是，仅本次允许');
  assert.equal(t('Yes, and always allow in this conversation', 'zh-TW'), '是，並在本會話中始終允許');
  assert.equal(t('Yes, save rule globally', 'zh-CN'), '是，全局保存此规则');
  assert.equal(t('(tell the agent what to do instead)', 'zh-CN'), '（告诉智能体改用什么方式处理）');
  assert.equal(t('Yes, always allow downloads from github.com', 'zh-CN'), '是，始终允许从 github.com 下载');
  assert.equal(t('Yes, and always allow \'npm test\' in this conversation', 'zh-CN'), '是，并在本会话中始终允许 \'npm test\'');
  assert.equal(t('Thought for 14s', 'zh-CN'), '思考了 14 秒');
  assert.equal(t('Thought for 14s', 'zh-TW'), '思考了 14 秒');
  assert.equal(t('Step 2 of 5', 'zh-CN'), '第 2 / 5 步');
  assert.equal(t('Chat Layout', 'zh-TW'), '聊天佈局'.replace('佈', '布'));
  assert.equal(t('Tool Permissions', 'zh-TW'), '工具權限');
  assert.equal(t('Confirm Undo', 'zh-CN'), '确认撤回');
  assert.equal(t('Available AI Credits: 250', 'zh-CN'), '可用 AI 积分：250');
  assert.equal(t('12 tools', 'zh-TW'), '12 個工具');
  assert.equal(t('Show more (4)', 'zh-CN'), '显示更多 (4)');
  assert.equal(t('Swarm', 'zh-CN'), 'Swarm');
  assert.equal(t('Open this pane from a conversation to see its swarm. Swarms started there appear here automatically; start one with', 'zh-CN'), '请在具体会话中打开此面板以查看蜂群。该会话中启动的蜂群会自动显示在这里；输入');
  assert.equal(t('12 posts', 'zh-CN'), '12 条动态');
  assert.equal(t('4 members', 'zh-TW'), '4 名成員');
  assert.equal(t('3 of 5 tasks done', 'zh-CN'), '已完成 3 / 5 项任务');
  assert.equal(t('Waiting on @coordinator', 'zh-CN'), '等待 @coordinator');
  assert.equal(t('Working for @lead', 'zh-CN'), '正为 @lead 处理');
  assert.equal(t('@worker-1 ran out of quota', 'zh-CN'), '@worker-1 额度已耗尽');
  assert.equal(t('@worker-2 looks stuck', 'zh-TW'), '@worker-2 疑似卡住');
  assert.equal(t('Go to #14 on the Board', 'zh-CN'), '在讨论板查看 #14');
  assert.equal(t('Exporting 45%', 'zh-CN'), '正在导出 45%');
  const coordSummary = t(`Coordinator \u00b7 3 of 5 done \u00b7 Needs you`, 'zh-CN');
  assert.equal(coordSummary, '协调者 3 / 5 已完成 需要你处理');
  assert.equal(coordSummary.includes('\u00b7'), false);
  const readSummary = t(`read #12 \u00b7 updated 2m ago`, 'zh-CN');
  assert.equal(readSummary, '已读至 #12 更新于 2m ago');
  assert.equal(readSummary.includes('\u00b7'), false);
  assert.equal(t('Load older messages', 'zh-CN'), '加载更早的消息');
  assert.equal(t('Prevent sleep', 'zh-CN'), '防止休眠');
  assert.equal(t('Context and quota indicator', 'zh-TW'), '上下文與額度指示器');
  assert.equal(t('Delete Permanently', 'zh-TW'), '永久刪除');
  const workedSingle = t('Worked for 5m', 'zh-CN');
  assert.equal(workedSingle, '用时 5分');
  const workedUpdates = t(`Worked for 8m 28s \u00b7 4 updates`, 'zh-CN');
  assert.equal(workedUpdates, '用时 8分28秒 4 条进度');
  assert.equal(workedUpdates.includes('\u00b7'), false);
  assert.equal(t(`Worked for 8m 28s \u00b7 4 updates`, 'zh-TW'), '用時 8分28秒 4 條進度');
  assert.equal(t(`\u00b7 3 updates`, 'zh-CN'), '3 条进度');
  const i18nSrc = readFileSync('lib/native-i18n.js', 'utf8');
  assert.ok(i18nSrc.includes('.post-body') && i18nSrc.includes('#ov-frame'));
});

test('localizer skips English text inside code editors, diff viewers, and monospace code surfaces (Issue #55)', () => {
  const makeNode = (value, matchedSelectors = []) => ({
    nodeValue: value,
    parentElement: {
      closest: sel => matchedSelectors.some(m => sel.includes(m)) ? {} : null
    }
  });
  const nodes = [
    makeNode('Settings', ['.monaco-editor']),
    makeNode('Delete', ['.monaco-diff-editor']),
    makeNode('Copy', ['[data-testid*="diff"]']),
    makeNode('Review', ['.code-block']),
    makeNode('Open File', ['.view-lines']),
    makeNode('Settings', [])
  ];
  let idx = 0;
  const document = {
    nodeType: 9,
    body: { nodeType: 1, getAttribute: () => null, closest: () => null, querySelectorAll: () => [] },
    createTreeWalker: () => {
      let i = 0;
      return { nextNode: () => nodes[i++] || null };
    },
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const loc = context.__agyI18n.localizer();
  loc.apply('zh-CN', true);
  assert.equal(nodes[0].nodeValue, 'Settings');
  assert.equal(nodes[1].nodeValue, 'Delete');
  assert.equal(nodes[2].nodeValue, 'Copy');
  assert.equal(nodes[3].nodeValue, 'Review');
  assert.equal(nodes[4].nodeValue, 'Open File');
  assert.equal(nodes[5].nodeValue, '设置');
  loc.dispose();
});

test('Skills and Customizations UI strings translate accurately in zh-CN and zh-TW (Issue #60)', () => {
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;
  assert.equal(t('Skills & Rules', 'zh-CN'), '技能与规则');
  assert.equal(t('Skills & Rules', 'zh-TW'), '技能與規則');
  assert.equal(t('Active Skills', 'zh-CN'), '已启用技能');
  assert.equal(t('Enable Recommended Skills', 'zh-TW'), '啟用推薦技能');
  assert.equal(t('Browse the Marketplace', 'zh-CN'), '浏览插件市场');
  assert.equal(t('No skills or rules yet.', 'zh-TW'), '暫無技能或規則。');
  assert.equal(t('Delete Skill', 'zh-CN'), '删除技能');
  assert.equal(t('Copy Config File Path', 'zh-TW'), '複製設定檔路徑');
});

test('custom-i18n.json loads additive user translations safely and slash command descriptions translate cleanly (Issue #68)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-custom-i18n-'));
  try {
    assert.deepEqual(loadCustomI18n(dir), []);
    writeFileSync(join(dir, 'custom-i18n.json'), '{bad json');
    assert.deepEqual(loadCustomI18n(dir), []);

    writeFileSync(join(dir, 'custom-i18n.json'), JSON.stringify({
      'Settings': '不应覆盖官方词条',
      'My Custom Skill Description': '我的自定义技能说明'
    }));
    const pairs = loadCustomI18n(dir);
    assert.equal(pairs.length, 2);

    const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
    const context = vm.createContext({
      document,
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class { observe() {} disconnect() {} },
      __agyToZhTw: toZhTw,
      __agyCustomI18n: pairs
    });
    vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
    const t = context.__agyI18n.t;
    // Built-in translation wins over custom override; custom entry fills missing strings and auto-converts to zh-TW
    assert.equal(t('Settings', 'zh-CN'), '设置');
    assert.equal(t('My Custom Skill Description', 'zh-CN'), '我的自定义技能说明');
    assert.equal(t('My Custom Skill Description', 'zh-TW'), '我的自訂技能說明');
    // Built-in slash command descriptions from Issue #68
    assert.equal(t('Ask a quick question without interrupting the main conversation.', 'zh-CN'), '发起侧边对话，不打断主对话。');
    assert.equal(t('Run until the specified goal is completely finished.', 'zh-CN'), '持续执行，直到指定目标完全达成。');
    assert.equal(t('Invoke the Boost multi-agent orchestrator for complex tasks.', 'zh-TW'), '呼叫 Boost 多智能體編排器處理複雜任務。'.replace('呼叫', '調用'));

    // Array-of-pairs format is also supported
    writeFileSync(join(dir, 'custom-i18n.json'), JSON.stringify([['Array Custom Text', '数组词条']]));
    assert.deepEqual(loadCustomI18n(dir), [['Array Custom Text', '数组词条']]);

    // Issue #94: long skill descriptions up to 2000 chars load and translate cleanly; entries > 2000 chars are rejected
    const skillDesc1000 = ('Long skill description for custom-i18n limit verification. '.repeat(20)).slice(0, 1000);
    const skillZh1000 = ('用于验证长技能描述自定义翻译上限的示例文本。'.repeat(50)).slice(0, 1000);
    const exact2000Key = 'K'.repeat(2000);
    const exact2000Val = 'V'.repeat(2000);
    const over2000Key = 'X'.repeat(2001);
    const over2000Val = 'Y'.repeat(2001);
    writeFileSync(join(dir, 'custom-i18n.json'), JSON.stringify({
      [skillDesc1000]: skillZh1000,
      [exact2000Key]: exact2000Val,
      [over2000Key]: '有效值但键超长',
      'valid-key-over-val': over2000Val
    }));
    const longPairs = loadCustomI18n(dir);
    assert.equal(longPairs.length, 2);
    assert.deepEqual(longPairs[0], [skillDesc1000, skillZh1000]);
    assert.deepEqual(longPairs[1], [exact2000Key, exact2000Val]);
    const longCtx = vm.createContext({
      document,
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: class { observe() {} disconnect() {} },
      __agyToZhTw: toZhTw,
      __agyCustomI18n: longPairs
    });
    vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), longCtx);
    assert.equal(longCtx.__agyI18n.t(skillDesc1000, 'zh-CN'), skillZh1000);
    assert.equal(longCtx.__agyI18n.t(skillDesc1000, 'zh-TW'), toZhTw(skillZh1000));
    assert.equal(longCtx.__agyI18n.t(over2000Key, 'zh-CN'), over2000Key);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Settings translations and editable placeholders follow language changes and disposal', () => {
  const fields = ['INPUT', 'TEXTAREA'].map(tagName => {
    const attrs = new Map([['placeholder', 'Search shortcuts...']]);
    return { tagName, isConnected: true, getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value), hasAttribute: key => attrs.has(key), removeAttribute: key => attrs.delete(key) };
  });
  const document = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }),
    querySelectorAll: selector => selector.includes('[placeholder]') ? fields : [] };
  const context = vm.createContext({ document, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe() {} disconnect() {} }, __agyToZhTw: toZhTw });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  for (const [english, simplified, traditional] of [
    ['Search shortcuts...', '搜索快捷键...', '搜尋快速鍵...'],
    ['Settings for conversations outside of projects', '未关联项目的会话设置', '未關聯專案的會話設定'],
    ['Hide breakdown', '隐藏明细', '隱藏明細'],
    ['Notification settings', '通知设置', '通知設定'],
    ['Automatic check for updates', '自动检查更新', '自動檢查更新']
  ]) {
    assert.equal(context.__agyI18n.t(english, 'zh-CN'), simplified);
    assert.equal(context.__agyI18n.t(english, 'zh-TW'), traditional);
  }
  for (const [language, expected] of [['zh-CN', '搜索快捷键...'], ['zh-TW', '搜尋快速鍵...'], ['en', 'Search shortcuts...']]) {
    context.__agyLocalization.apply(language, false);
    for (const field of fields) assert.equal(field.getAttribute('placeholder'), expected);
  }
  context.__agyLocalization.apply('zh-TW', false);
  context.__agyLocalization.dispose();
  for (const field of fields) {
    assert.equal(field.getAttribute('placeholder'), 'Search shortcuts...');
    assert.equal(field.hasAttribute('data-agy-original-placeholder'), false);
  }
});

import { getLocalePack, SUPPORTED_LANGUAGES } from '../lib/locales/index.mjs';
import { nativeSource, swarmI18nSource } from '../lib/native-host.mjs';

const packLanguages = SUPPORTED_LANGUAGES.filter(language => getLocalePack(language));
const menuLabels = ['Sort Conversations','Sort Projects','Auto Pin','Archived Only','Subtitles','Decorations','Project'];

test('every pack covers the native catalog, static UI calls, and sidebar menus', () => {
  const source = readFileSync('lib/native-i18n.js','utf8');
  const native = vm.runInNewContext(source.slice(source.indexOf('const pairs'),source.indexOf('const zh=new Map'))+'pairs');
  const keys = new Set([...native.map(([key])=>key),...menuLabels]);
  for (const file of ['native-panels.js','native-ui.js','native-beta-ai.js','native-sidebar-monitor.js','native-sidebar-drop.mjs','native-ssh-paste.mjs','launcher.mjs']) {
    const script = readFileSync('lib/'+file,'utf8');
    for (const match of script.matchAll(/(?:uiText|text)\(\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*\)/g)) keys.add(vm.runInNewContext(match[1]));
  }
  const nativeKeys = new Set([...native.map(([key])=>key),...menuLabels]);
  const basePatternRegexes = getLocalePack(packLanguages[0]).patterns.map(([pattern]) => pattern);
  const mismatchToastEn = 'Account switch failed: logged in as another account. Please re-login the target account.';
  const mismatchToastZh = '切号未生效：当前登录的仍是其他账号，已标记目标凭据失效，请重新登录目标账号。';
  const WORKED_RE = /^(?:Worked for\b|用时(?:\s|$)|用時(?:\s|$)|Durée\s*:|作業時間(?:\s|$)|작업 시간(?:\s|$)|Bearbeitungszeit(?:\s|$)|Tiempo de trabajo(?:\s|$)|Время работы(?:\s|$)|Đã xử lý(?:\s|$))/;
  const UPDATES_RE = /(?:[\u00b7\u2022\-]\s*)?(\d+)\s+(?:updates?\b|条进度|條進度|étapes?\b|件の更新|개 업데이트|Aktualisierung(?:en)?\b|actualizaci[oó]n(?:es)?\b|обновлени\S*|cập nhật\b)/i;
  for (const lang of packLanguages) {
    const pack = getLocalePack(lang);
    for (const key of nativeKeys) if (key && !/[\u3400-\u9fff]/u.test(key)) assert.ok(Object.hasOwn(pack.entries, key) && pack.entries[key]?.trim(), `${lang} entries parity: ${key}`);
    for (const key of keys) if (key && !/[\u3400-\u9fff]/u.test(key)) assert.ok((pack.entries[key] || pack.uiEntries[key])?.trim(), `${lang}: ${key}`);
    assert.ok(pack.uiEntries[mismatchToastEn]?.trim(), `${lang}: missing Issue #97 mismatch toast`);
    assert.doesNotMatch(pack.uiEntries[mismatchToastEn], /[\u00b7\u2022\u2027\u30fb]/u, `${lang}: forbidden dot in Issue #97 toast`);
    for (const beamKey of ['Inner pulse', 'Outer pulse', 'Choose between bottom sweep, inner pulse, or outer pulse glow.']) {
      assert.ok(pack.uiEntries[beamKey]?.trim(), `${lang}: missing beam style key ${beamKey}`);
      assert.doesNotMatch(pack.uiEntries[beamKey], /[\u00b7\u2022\u2027\u30fb]|Pulse Inner|Pulse Outside/u, `${lang}: invalid beam style translation for ${beamKey}`);
    }
    for (const settingsKey of ['Motion & Sidebar', 'Stats & Chat', 'Accounts & Proxy', 'Search settings…', 'No matching settings', 'Beams & halos', 'Sidebar & layout', 'Config & reset', 'Settings backup & reset', 'Token unit', 'K / M / B (International)', 'Wan / Yi (Chinese)', 'Display currency', 'USD ($)', 'CNY (¥)', 'Price per 1M tokens (CNY)', 'Halo tone', 'Semantic', 'Monochrome', 'Composer indicator style', 'Muted gray', 'Icon only', 'Composer quota indicator', 'Quota window', 'Choose which quota window the composer indicator tracks; Auto uses the lower of 5-hour and weekly limits.', 'View accounts & quota', 'Account quota', 'Remaining quota', 'Pin Overview in narrow windows', 'Unpin Overview panel', 'Disabled by default. Keeps the right Overview panel docked when the window narrows; also toggleable via the pin icon in Overview.', 'Thinking translation', 'Translation engine', 'Google Translate (free)', 'Custom AI model', 'Display mode', 'Translated only', 'Bilingual', 'Trigger mode', 'Auto translate', 'Manual click', 'Clear translation cache', 'Composer intent prediction', 'Disabled by default. Shows an inline continuation suggestion when idle and the composer is empty, accepted via Tab; requires a custom AI model below.', 'Custom providers', 'Custom provider', 'Add provider', 'Edit provider', 'OpenAI-compatible', 'Anthropic-compatible', 'Gemini-compatible', 'API Key', 'Paste API key', 'Show API key', 'Hide API key', 'Select matching', 'Show fetched models', 'Fetch models', 'Default model', 'Thinking translation model', 'Intent prediction model', 'Follow default model', 'Add a provider first', 'Search models or providers…', 'Connection test succeeded', 'Translate thinking', 'Translated', 'Original']) {
      assert.ok(pack.uiEntries[settingsKey]?.trim(), `${lang}: missing Settings category/search key ${settingsKey}`);
      assert.doesNotMatch(pack.uiEntries[settingsKey], /[\u00b7\u2022\u2027\u30fb]/u, `${lang}: forbidden dot in Settings key ${settingsKey}`);
    }
    assert.equal(Object.hasOwn(pack.uiEntries, 'Default Overview range'), false, `${lang}: stale Default Overview range key`);
    assert.equal(Object.hasOwn(pack.uiEntries, 'Default quota window'), false, `${lang}: stale Default quota window key`);
    assert.equal(Object.hasOwn(pack.uiEntries, 'Pulse Inner'), false, `${lang}: stale Pulse Inner key`);
    assert.equal(Object.hasOwn(pack.uiEntries, 'Pulse Outside'), false, `${lang}: stale Pulse Outside key`);
    for (const staleKey of ['Reference rate (USD -> CNY)', 'Display conversion only; local records and official prices stay in USD.', 'Rate must be between 0.1 and 1000', 'Ref. rate', 'Reset 7.2', 'Beams & Sidebar', 'Show quota in sidebar footer', 'Disabled by default. Shows a compact 5-hour and weekly quota strip at the bottom of the left sidebar.', 'View Accounts & Quota', 'Local Ollama', 'Official Gemini', 'Stored in OS keyring', 'Save key', 'Clear key']) {
      assert.equal(Object.hasOwn(pack.uiEntries, staleKey), false, `${lang}: stale ${staleKey} key`);
    }
    assert.deepEqual(pack.patterns.map(([pattern]) => pattern), basePatternRegexes, `${lang}: pattern parity`);
    for (const [pattern] of pack.patterns) assert.doesNotThrow(()=>new RegExp(pattern));
    assert.deepEqual(JSON.parse(JSON.stringify(pack)),pack);
    if (lang !== 'ja') assert.doesNotMatch(readFileSync(`lib/locales/${lang}.mjs`,'utf8'), /[\u4e00-\u9fff]/, `${lang}.mjs should not contain literal CJK`);
    const doc = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
    const ctx = vm.createContext({ document: doc, NodeFilter: { SHOW_TEXT: 4 }, MutationObserver: class { observe(){} disconnect(){} }, __agyLocalePack: pack });
    vm.runInContext(source, ctx);
    const t = ctx.__agyI18n.t;
    assert.equal(ctx.__agyI18n.uiText(mismatchToastZh, mismatchToastEn, lang), pack.uiEntries[mismatchToastEn]);
    for (const sample of ['Subagent running', 'Waiting for approval', 'Retrying', 'Thinking', 'Waiting for model', 'Context just compacted; exact provider tokens will update on your next message.', 'Just compacted; exact usage updates on next message', `Coordinator \u00b7 3 of 5 done`, 'read #12']) {
      assert.doesNotMatch(t(sample, lang), /(?::\s*$|\(\s*\)|#\s*\)|\$[0-9])/, `${lang} dangling template on ${sample}`);
    }
    for (const worked of [`Worked for 8m 28s \u00b7 1 update`, `Worked for 8m 28s \u00b7 4 updates`]) {
      const rendered = t(worked, lang);
      assert.match(rendered, WORKED_RE, `${lang}: ${rendered}`);
      assert.match(rendered, UPDATES_RE, `${lang}: ${rendered}`);
    }
    assert.match(t('Worked for 5m', lang), WORKED_RE);
    if (lang === 'vi') {
      assert.equal(pack.uiEntries['Worked for'], 'Đã xử lý');
      assert.equal(t('Worked for', 'vi'), 'Đã xử lý');
      assert.equal(t('Worked for 8m 28s \u00b7 4 updates', 'vi'), 'Đã xử lý 8p 28s - 4 cập nhật');
      assert.equal(t('Resets in 3h 33m', 'vi'), 'Đặt lại sau 3g 33p');
      assert.match(t('You have used some of your weekly limit, it will fully refresh in 3 days, 11 hours.', 'vi'), /3 ngày 11 giờ/);
      const frPack = getLocalePack('fr');
      for (const bucket of ['entries', 'uiEntries', 'sidecar']) {
        assert.deepEqual(Object.keys(pack[bucket]).sort(), Object.keys(frPack[bucket]).sort(), `vi ${bucket} key parity with fr`);
      }
      assert.equal(pack.months.length, frPack.months.length);
    }
  }
});

test('only the selected language payload appears in desktop and Swarm boot sources', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const settingsObj = {enabled:true,language};
    for (const source of [nativeSource('https://localhost',[],{settingsObj}),swarmI18nSource(settingsObj)]) {
      for (const lang of packLanguages) assert.equal(source.includes(JSON.stringify(getLocalePack(lang))), lang === language);
    }
  }
});

test('switching all languages restores text and leaves project names and code unchanged', () => {
  const node = (text, area) => ({nodeValue:text,isConnected:true,parentElement:{closest:s=>area && s.includes(area)}});
  const nodes=[node('Settings',''),node('Sort Projects','[role="menu"]'),node('Project','[role="menu"]'),node('Project',''),node('Sort Projects',''),node('Sort Projects','code')];
  const document={nodeType:9,createTreeWalker(){let i=0;return {nextNode:()=>nodes[i++]};},querySelectorAll:()=>[]};
  const context=vm.createContext({document,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}disconnect(){}},__agyToZhTw:toZhTw});
  vm.runInContext(readFileSync('lib/native-i18n.js','utf8'),context);
  for (const lang of [...SUPPORTED_LANGUAGES,'en']) {
    context.__agyLocalePack=getLocalePack(lang);
    context.__agyLocalization.apply(lang,false);
    const t=context.__agyI18n.t;
    assert.deepEqual(nodes.map(n=>n.nodeValue),[t('Settings',lang),t('Sort Projects',lang),t('Project',lang),'Project','Sort Projects','Sort Projects']);
    if (context.__agyLocalePack) assert.match(t('Your Plan: Gemini',lang),/Gemini/);
  }
  context.__agyLocalization.dispose();
  assert.equal(nodes[0].nodeValue,'Settings');
  assert.equal(nodes[1].nodeValue,'Sort Projects');
});

test('sidebar menu-only labels translate only inside menu contexts across all 10 languages', () => {
  const matchesSelector = (sel, area) => Boolean(area) && sel.split(',').includes(area);
  const makeNode = (text, area) => {
    const state = { area };
    return {
      nodeValue: text,
      isConnected: true,
      state,
      parentElement: { closest: sel => matchesSelector(sel, state.area) ? {} : null }
    };
  };
  const makeEl = (initialAttrs, area) => {
    const attrs = new Map(Object.entries(initialAttrs));
    return {
      isConnected: true,
      closest: sel => matchesSelector(sel, area) ? {} : null,
      getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value),
      hasAttribute: key => attrs.has(key),
      removeAttribute: key => attrs.delete(key)
    };
  };
  const expectedZhCn = {
    'Sort Conversations': '会话排序',
    'Sort Projects': '项目排序',
    'Auto Pin': '自动置顶',
    'Archived Only': '仅已归档',
    'Subtitles': '副标题',
    'Decorations': '显示项',
    'Project': '项目'
  };
  const expectedFor = (label, lang) => {
    if (lang === 'en') return label;
    const pack = getLocalePack(lang);
    if (pack) return pack.entries[label];
    return lang === 'zh-TW' ? toZhTw(expectedZhCn[label]) : expectedZhCn[label];
  };

  assert.deepEqual(SUPPORTED_LANGUAGES, ['zh-CN', 'zh-TW', 'en', 'fr', 'ja', 'ko', 'de', 'es', 'ru', 'vi']);

  const menuNodes = menuLabels.map(label => makeNode(label, '[role="menu"]'));
  const altMenuNodes = ['[role="menuitem"]', '[role="menuitemradio"]', '[role="listbox"]', 'label'].map(area => makeNode('Sort Projects', area));
  const titleNodes = menuLabels.map(label => makeNode(label, ''));
  const codeNodes = menuLabels.map(label => makeNode(label, 'code'));
  const movingNode = makeNode('Sort Projects', '[role="menu"]');
  const allNodes = [...menuNodes, ...altMenuNodes, ...titleNodes, ...codeNodes, movingNode];

  const menuAttrEls = menuLabels.map(label => makeEl({ title: label }, '[role="menu"]'));
  const outsideAttrEls = menuLabels.map(label => makeEl({ title: label, placeholder: label }, ''));
  const allAttrEls = [...menuAttrEls, ...outsideAttrEls];

  const document = {
    nodeType: 9,
    createTreeWalker() {
      let i = 0;
      return { nextNode: () => allNodes[i++] || null };
    },
    querySelectorAll: selector => selector.includes('[title]') ? allAttrEls : []
  };
  const context = vm.createContext({
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(readFileSync('lib/native-i18n.js', 'utf8'), context);
  const t = context.__agyI18n.t;

  assert.equal(t('项目', 'en'), 'Projects');
  assert.equal(t('项目排序', 'en'), 'Sort Projects');
  assert.equal(t('Pull Requests', 'zh-CN'), 'Pull Requests');

  for (const lang of SUPPORTED_LANGUAGES) {
    context.__agyLocalePack = getLocalePack(lang);
    context.__agyLocalization.apply(lang, false);
    for (let i = 0; i < menuLabels.length; i++) {
      const label = menuLabels[i];
      const expected = expectedFor(label, lang);
      assert.ok(expected, `${lang}: missing expected translation for ${label}`);
      if (lang !== 'en') assert.notEqual(expected, label, `${lang}: expected localized text for ${label}`);
      assert.equal(t(label, lang), expected, `${lang}: t(${label})`);
      assert.equal(menuNodes[i].nodeValue, expected, `${lang}: menu node ${label}`);
      assert.equal(titleNodes[i].nodeValue, label, `${lang}: non-menu title ${label} must stay unchanged`);
      assert.equal(codeNodes[i].nodeValue, label, `${lang}: code block ${label} must stay unchanged`);
      assert.equal(menuAttrEls[i].getAttribute('title'), expected, `${lang}: menu title attr ${label}`);
      assert.equal(outsideAttrEls[i].getAttribute('title'), label, `${lang}: non-menu title attr ${label}`);
      assert.equal(outsideAttrEls[i].getAttribute('placeholder'), label, `${lang}: non-menu placeholder attr ${label}`);
      assert.equal(outsideAttrEls[i].hasAttribute('data-agy-original-title'), false);
      assert.equal(outsideAttrEls[i].hasAttribute('data-agy-original-placeholder'), false);
    }
    for (const node of altMenuNodes) {
      assert.equal(node.nodeValue, expectedFor('Sort Projects', lang), `${lang}: ${node.state.area}`);
    }
  }

  context.__agyLocalePack = null;
  context.__agyLocalization.apply('zh-CN', false);
  assert.equal(movingNode.nodeValue, '项目排序');
  movingNode.state.area = '';
  context.__agyLocalePack = getLocalePack('fr');
  context.__agyLocalization.apply('fr', false);
  assert.equal(movingNode.nodeValue, 'Sort Projects');

  for (let i = 0; i < menuLabels.length; i++) {
    assert.equal(menuNodes[i].nodeValue, expectedFor(menuLabels[i], 'fr'));
    assert.equal(menuAttrEls[i].getAttribute('title'), expectedFor(menuLabels[i], 'fr'));
  }
  context.__agyLocalization.dispose();
  for (let i = 0; i < menuLabels.length; i++) {
    const label = menuLabels[i];
    assert.equal(menuNodes[i].nodeValue, label);
    assert.equal(titleNodes[i].nodeValue, label);
    assert.equal(codeNodes[i].nodeValue, label);
    assert.equal(menuAttrEls[i].getAttribute('title'), label);
    assert.equal(menuAttrEls[i].hasAttribute('data-agy-original-title'), false);
  }
  for (const node of altMenuNodes) {
    assert.equal(node.nodeValue, 'Sort Projects');
  }
});

test('locale data and all localized guides exclude forbidden separators', () => {
  const files=['README.md','README_EN.md',...['ZH_TW','FR','JA','KO','DE','ES','RU','VI'].map(x=>`docs/README_${x}.md`),...['index',...packLanguages].map(x=>`lib/locales/${x}.mjs`)];
  for (const file of files) assert.doesNotMatch(readFileSync(file,'utf8'),/[\u00b7\u2022\u2027\u30fb]/u,file);
});

import {startNativeIntegration} from '../lib/native-host.mjs';

test('disabled integration serves the selected pack and scoped overrides through the host binding',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'agy-pack-rpc-'));
  const portFile=join(dataDir,'port'), origin='https://127.0.0.1:5000';
  const fetchBefore=globalThis.fetch;
  let stop, receiveEvent, reply;
  try {
    writeFileSync(portFile,'12345\n');
    writeFileSync(join(dataDir,'settings.json'),JSON.stringify({enabled:false,language:'fr'}));
    writeFileSync(join(dataDir,'custom-i18n.json'),JSON.stringify({fr:{Example:'Exemple'},ja:{Example:'例'}}));
    globalThis.fetch=async()=>({json:async()=>[{id:'window',type:'page',title:'Antigravity',url:origin+'/c/a',webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/a'}]});
    stop=startNativeIntegration({portFile,dataDir,parseSessionData:()=>({}),onStatus:()=>{},discover:async()=>[],connect:async()=>({
      socket:{addEventListener(){},close(){}},onEvent(callback){receiveEvent=callback;},async send(method,params){
        if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame'}}};
        if(method==='Page.addScriptToEvaluateOnNewDocument')return {identifier:'script'};
        if(params?.expression?.startsWith('globalThis.__agyPowertoolsReceive?.('))vm.runInNewContext(params.expression,{__agyPowertoolsReceive:(id,data)=>{reply=JSON.parse(JSON.stringify(data));}});
        return {result:{value:false}};
      }
    })});
    await stop.ready;
    await receiveEvent({method:'Runtime.executionContextCreated',params:{context:{id:42,origin,auxData:{isDefault:true,frameId:'frame'}}}});
    for(const [language,expected] of [['fr','Exemple'],['ja','例']]){
      await receiveEvent({method:'Runtime.bindingCalled',params:{name:'__agyPowertoolsHost',executionContextId:42,payload:JSON.stringify({id:1,method:'i18n.pack',language})}});
      assert.equal(reply.pack.lang,language);
      assert.deepEqual(reply.custom,[['Example',expected]]);
    }
  } finally {await stop?.();globalThis.fetch=fetchBefore;rmSync(dataDir,{recursive:true,force:true});}
});

test('PR #83 selective absorption protects conversation titles, scopes risky single-word controls, and syncs structured patterns across all 10 languages', () => {
  const source = readFileSync('lib/native-i18n.js', 'utf8');
  // Do NOT include PR #84 premature overlay selectors
  assert.equal(source.includes('data-agy-translate-root'), false);
  assert.equal(source.includes('data-agy-translated'), false);

  const riskyControls = ['Narrow', 'Wide', 'Fill', 'Find', 'Skip', 'Create', 'Ready', 'Unknown', 'Preview', 'Send', 'Fork', 'Folders'];
  const matchesSelector = (sel, area) => {
    if (!area) return false;
    for (const rawPart of sel.split(',')) {
      const part = rawPart.trim();
      if (part === area) return true;
      if (area.startsWith('testid:') && part.startsWith('[data-testid*="terminal"]')) {
        const tid = area.slice('testid:'.length);
        let ok = tid.includes('terminal');
        if (ok && part.includes(':not(')) {
          for (const nm of part.matchAll(/:not\(\[data-testid="([^"]+)"\]\)/g)) {
            if (tid === nm[1]) { ok = false; break; }
          }
        }
        if (ok) return true;
      }
    }
    return false;
  };
  const makeNode = (text, area) => ({
    nodeValue: text,
    isConnected: true,
    parentElement: { closest: sel => matchesSelector(sel, area) ? {} : null }
  });
  const makeEl = (initialAttrs, area) => {
    const attrs = new Map(Object.entries(initialAttrs));
    return {
      isConnected: true,
      closest: sel => matchesSelector(sel, area) ? {} : null,
      getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value),
      hasAttribute: key => attrs.has(key),
      removeAttribute: key => attrs.delete(key)
    };
  };

  const controlBtnNodes = riskyControls.map(label => makeNode(label, 'button'));
  const radioNode = makeNode('Wide', '[role="radio"]');
  const tabNode = makeNode('Preview', '[role="tab"]');
  const plainTitleNodes = riskyControls.map(label => makeNode(label, ''));
  const userConversationTitles = [
    'Updated README',
    'Reading the codebase',
    'Analyzed auth bug',
    'Editing package.json',
    'Listing endpoints',
    'Searching logs',
    'Sort Projects'
  ];
  const userTitleNodes = userConversationTitles.map(title => makeNode(title, ''));
  const termChromeNode = makeNode('Terminal', 'testid:overview-panel-row-terminal');
  const termOutputNode = makeNode('Terminal', 'testid:terminal-output');
  const xtermNode = makeNode('Terminal', '.xterm');
  const allNodes = [...controlBtnNodes, radioNode, tabNode, ...plainTitleNodes, ...userTitleNodes, termChromeNode, termOutputNode, xtermNode];

  const btnAttrEl = makeEl({ title: 'Send' }, 'button');
  const plainAttrEl = makeEl({ title: 'Preview' }, '');
  const allAttrEls = [btnAttrEl, plainAttrEl];

  const document = {
    nodeType: 9,
    createTreeWalker() {
      let i = 0;
      return { nextNode: () => allNodes[i++] || null };
    },
    querySelectorAll: selector => selector.includes('[title]') ? allAttrEls : []
  };
  const ctx = vm.createContext({
    document,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(source, ctx);
  const t = ctx.__agyI18n.t;

  // First-entry-wins reverse zh -> en mappings remain canonical
  assert.equal(t('重试', 'en'), 'Retry');
  assert.equal(t('有帮助', 'en'), 'Good response');
  assert.equal(t('发送消息', 'en'), 'Send message');
  assert.equal(t('已完成', 'en'), 'Completed');
  assert.equal(t('当前会话', 'en'), 'Current conversation');

  // zh-CN & zh-TW checks for absorbed PR #83 strings & 什么 -> 什麼 fix
  assert.equal(t('What should the agent do on each run?', 'zh-CN'), '智能体每次运行时应执行什么任务？');
  assert.equal(t('What should the agent do on each run?', 'zh-TW'), '智能體每次執行時應執行什麼任務？');
  assert.equal(t('Explored files', 'zh-CN'), '探索文件');
  assert.equal(t('Agent Hooks Configuration', 'zh-TW'), '智能體鉤子配置');

  const preserves = ['Pull Requests', '14m ago', 'Turbo', 'Dracula', 'Low', 'Medium', 'High', 'Extra High'];
  const structuredSamples = [
    'Your plan: Google AI Ultra',
    'Thinking for 9s',
    'Thinking for 1m 25s',
    'Thought for 2m 15s',
    'Show 3 earlier steps',
    '5 results',
    'Leaving on Nov 30.',
    'The original Gemini 4 model for advanced workflows. Leaving on Nov 30.',
    'Worked for 49s \u00b7 126 steps',
    'Explored 3 files',
    'Waiting for 2 timers',
    '2 subagents running'
  ];

  for (const lang of SUPPORTED_LANGUAGES) {
    ctx.__agyLocalePack = getLocalePack(lang);
    ctx.__agyLocalization.apply(lang, false);

    // Preserved tokens stay untouched across all 9 languages
    for (const token of preserves) assert.equal(t(token, lang), token, `${lang}: preserve ${token}`);

    // Structured dynamic patterns translate cleanly across all 9 languages with no forbidden dots or placeholders
    for (const sample of structuredSamples) {
      const rendered = t(sample, lang);
      assert.doesNotMatch(rendered, /\$\d/, `${lang}: raw placeholder in ${rendered}`);
      if (lang !== 'en') {
        assert.doesNotMatch(rendered, /[\u00b7\u2022\u2027\u30fb]/u, `${lang}: dot in ${rendered}`);
        assert.notEqual(rendered, sample, `${lang}: untranslated ${sample}`);
      }
    }

    // Risky single-word controls translate inside control contexts and stay untouched in sidebar/title contexts
    for (let i = 0; i < riskyControls.length; i++) {
      const label = riskyControls[i];
      assert.equal(controlBtnNodes[i].nodeValue, t(label, lang), `${lang}: button ${label}`);
      assert.equal(plainTitleNodes[i].nodeValue, label, `${lang}: non-control ${label} must stay unchanged`);
    }
    assert.equal(radioNode.nodeValue, t('Wide', lang), `${lang}: radio Wide`);
    assert.equal(tabNode.nodeValue, t('Preview', lang), `${lang}: tab Preview`);
    assert.equal(btnAttrEl.getAttribute('title'), t('Send', lang), `${lang}: button title Send`);
    assert.equal(plainAttrEl.getAttribute('title'), 'Preview', `${lang}: non-control title Preview`);

    // User conversation titles remain completely untouched
    for (let i = 0; i < userConversationTitles.length; i++) {
      assert.equal(userTitleNodes[i].nodeValue, userConversationTitles[i], `${lang}: title ${userConversationTitles[i]}`);
      if (userConversationTitles[i] !== 'Sort Projects') {
        assert.equal(t(userConversationTitles[i], lang), userConversationTitles[i], `${lang}: t(${userConversationTitles[i]})`);
      }
    }

    // Terminal chrome row translates while terminal output / xterm stay protected
    assert.equal(termChromeNode.nodeValue, t('Terminal', lang), `${lang}: terminal chrome row`);
    assert.equal(termOutputNode.nodeValue, 'Terminal', `${lang}: terminal output protected`);
    assert.equal(xtermNode.nodeValue, 'Terminal', `${lang}: xterm protected`);

    // P2 #5: tAttr respects attrExcluded, menuOnlyLabels, and controlOnlyLabels (protects Overview rows)
    const tAttr = ctx.__agyI18n.tAttr;
    assert.equal(typeof tAttr, 'function');
    const plainOverviewRow = makeEl({}, '');
    for (const protectedName of ['Preview', 'Folders', 'Project', 'Send', 'Ready']) {
      assert.equal(tAttr(plainOverviewRow, protectedName, lang), protectedName, `${lang}: tAttr must protect Overview row ${protectedName}`);
    }
    assert.equal(tAttr(makeEl({}, 'button'), 'Send', lang), t('Send', lang), `${lang}: tAttr translates button Send`);
    assert.equal(tAttr(makeEl({}, '[role="menu"]'), 'Project', lang), t('Project', lang), `${lang}: tAttr translates menu Project`);
    assert.equal(tAttr(makeEl({}, 'code'), 'Modified Files', lang), 'Modified Files', `${lang}: tAttr skips attrExcluded code`);
    assert.equal(tAttr(plainOverviewRow, 'Modified Files', lang), t('Modified Files', lang), `${lang}: tAttr translates normal Overview label`);
  }
  ctx.__agyLocalization.dispose();
});

test('Composer intent prediction loading phrases cover all 10 languages cleanly with zero forbidden dots', () => {
  const phrases = [
    ['大脑飞速旋转中…', '大腦飛速旋轉中…', 'Spinning up the next idea...'],
    ['正在偷看上下文…', '正在偷看上下文…', 'Peeking at the context...'],
    ['顺着思路往下猜…', '順著思路往下猜…', 'Following your train of thought...'],
    ['帮你先起个头…', '幫你先起個頭…', 'Drafting a quick opener...'],
    ['预判你的下一步…', '預判你的下一步…', 'Anticipating your next move...'],
    ['速读刚才的内容…', '速讀剛才的內容…', 'Skimming the last turn...'],
    ['灵感正在路上…', '靈感正在路上…', 'Catching a good follow-up...'],
    ['替你打个草稿…', '替你打個草稿…', 'Sketching your next prompt...'],
    ['从上下文找线索…', '從上下文找線索…', 'Reading between the lines...'],
    ['琢磨接下来问什么…', '琢磨接下來問什麼…', 'Thinking of what comes next...']
  ];
  const forbiddenDot = /[\u00b7\u2022\u2027\u30fb]/u;
  const source = readFileSync('lib/native-i18n.js', 'utf8');
  const doc = { nodeType: 9, createTreeWalker: () => ({ nextNode: () => null }), querySelectorAll: () => [] };
  const ctx = vm.createContext({
    document: doc,
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: class { observe() {} disconnect() {} },
    __agyToZhTw: toZhTw
  });
  vm.runInContext(source, ctx);

  for (const [zh, expectedTw, en] of phrases) {
    assert.equal(toZhTw(zh), expectedTw, `zh-TW conversion mismatch for ${zh}`);
    assert.equal(ctx.__agyI18n.uiText(zh, en, 'zh-CN'), zh);
    assert.equal(ctx.__agyI18n.uiText(zh, en, 'zh-TW'), expectedTw);
    assert.equal(ctx.__agyI18n.uiText(zh, en, 'en'), en);
    assert.doesNotMatch(zh, forbiddenDot);
    assert.doesNotMatch(expectedTw, forbiddenDot);
    assert.doesNotMatch(en, forbiddenDot);
  }

  for (const lang of packLanguages) {
    const pack = getLocalePack(lang);
    ctx.__agyLocalePack = pack;
    for (const [zh, , en] of phrases) {
      assert.ok(Object.hasOwn(pack.uiEntries, en) && pack.uiEntries[en]?.trim(), `${lang}: missing loading phrase ${en}`);
      const translated = pack.uiEntries[en];
      assert.notEqual(translated, en, `${lang}: untranslated loading phrase ${en}`);
      assert.doesNotMatch(translated, forbiddenDot, `${lang}: forbidden dot in ${en}`);
      assert.equal(ctx.__agyI18n.uiText(zh, en, lang), translated, `${lang}: uiText mismatch for ${en}`);
    }
  }
});
