import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSettingsStore,
  CURRENCIES,
  DEFAULT_SETTINGS,
  detectSystemLanguage,
  exportSettingsPayload,
  NON_PORTABLE_SETTING_KEYS,
  sanitizeImportedSettings,
  SETTINGS_EXPORT_FORMAT,
  SETTINGS_EXPORT_SCHEMA_VERSION,
  SETTINGS_IMPORT_MAX_BYTES,
  SIDEBAR_BEAM_STYLES,
  stripProxyUrlCredentials,
  TOKEN_UNITS
} from '../lib/settings.mjs';
import { startNativeIntegration } from '../lib/native-host.mjs';

test('settings persist, merge safely, and reject unknown options without changing saved data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agy-settings-'));
  try {
    const store = createSettingsStore(directory);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    store.set({ customFont: '  Maple Mono NF CN  ' });
    assert.equal(createSettingsStore(directory).get().customFont, 'Maple Mono NF CN');
    for (const weight of [300,400,500,600,700,0]) {
      store.set({customFontWeight:weight});
      assert.equal(createSettingsStore(directory).get().customFontWeight,weight);
    }
    for (const weight of ['400',200,null,true]) assert.throws(()=>store.set({customFontWeight:weight}));
    const fontBefore = readFileSync(join(directory, 'settings.json'), 'utf8');
    for (const customFont of [null, true, 123, 'x'.repeat(129), 'Maple\nMono', 'Maple\u0000Mono', ...[';', '{', '}', '\\', '<', '>', '\u0085'].map(c => 'Font' + c)]) {
      assert.throws(() => store.set({ customFont }), /设置/);
      assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8'), fontBefore);
    }
    store.set({ customFont: '' });
    assert.equal(store.get().customFont, '');
    store.set({ compact: false, timing: false });
    assert.equal(createSettingsStore(directory).get().compact, false);
    assert.equal(store.get().userBubbleTint, false);
    assert.equal(store.get().userBubblePreset, 'accent');
    assert.equal(store.get().userBubbleColor, '#2F75C3');
    assert.equal(store.get().userBubbleStrength, 20);
    store.set({ userBubbleTint: true, userBubblePreset: 'sage', userBubbleColor: '#3d7a64', userBubbleStrength: 100 });
    assert.equal(store.get().userBubbleTint, true);
    assert.equal(store.get().userBubblePreset, 'sage');
    assert.equal(store.get().userBubbleColor, '#3D7A64');
    assert.equal(store.get().userBubbleStrength, 100);
    store.set({ userBubbleTint: false, userBubblePreset: 'accent', userBubbleColor: '#2F75C3', userBubbleStrength: 20 });
    assert.equal(store.get().overviewQuota, false);
    assert.equal(store.get().titlebarQuickPanel, false);
    store.set({ titlebarQuickPanel: true });
    assert.equal(store.get().titlebarQuickPanel, true);
    store.set({ titlebarQuickPanel: false });
    assert.equal(store.get().composerQuotaHalo, false);
    assert.equal(store.get().composerQuotaHaloWindow, 'auto');
    assert.equal(store.get().composerWorkingBeam, false);
    assert.equal(store.get().composerWorkingBeamPalette, 'gemini');
    store.set({ overviewQuota: true, composerQuotaHalo: true, composerQuotaHaloWindow: 'weekly', composerWorkingBeam: true, composerWorkingBeamPalette: 'aurora' });
    assert.equal(store.get().overviewQuota, true);
    assert.equal(store.get().composerQuotaHalo, true);
    assert.equal(store.get().composerQuotaHaloWindow, 'weekly');
    assert.equal(store.get().composerWorkingBeam, true);
    assert.equal(store.get().composerWorkingBeamPalette, 'aurora');
    store.set({ composerQuotaHaloWindow: '5h', composerWorkingBeamPalette: 'quota' });
    assert.equal(store.get().composerQuotaHaloWindow, '5h');
    assert.equal(store.get().composerWorkingBeamPalette, 'quota');
    store.set({ overviewQuota: false, composerQuotaHalo: false, composerQuotaHaloWindow: 'auto', composerWorkingBeam: false, composerWorkingBeamPalette: 'gemini' });
    assert.equal(store.get().messageEdit, true);
    assert.equal(store.get().fileContextMenu, true);
    assert.equal(store.get().macAutoRelaunch, true);
    store.set({ macAutoRelaunch: false });
    assert.equal(store.get().macAutoRelaunch, false);
    store.set({ macAutoRelaunch: true });
    assert.equal(store.get().sshCommandPaste, true);
    store.set({ sshCommandPaste: false });
    assert.equal(store.get().sshCommandPaste, false);
    store.set({ sshCommandPaste: true });
    assert.equal(store.get().sidebarFolderDrop, true);
    store.set({ sidebarFolderDrop: false });
    assert.equal(store.get().sidebarFolderDrop, false);
    store.set({ sidebarFolderDrop: true });
    assert.equal(store.get().sidebarFolderDropPin, false);
    store.set({ sidebarFolderDropPin: true });
    assert.equal(store.get().sidebarFolderDropPin, true);
    store.set({ sidebarFolderDropPin: false });
    assert.equal(store.get().sessionSearch, true);
    store.set({ sessionSearch: false });
    assert.equal(store.get().sessionSearch, false);
    store.set({ sessionSearch: true });
    assert.equal(store.get().subagentTelemetry, true);
    store.set({ subagentTelemetry: false }); assert.equal(store.get().subagentTelemetry, false);
    store.set({ subagentTelemetry: true }); assert.equal(store.get().subagentTelemetry, true);
    assert.equal(DEFAULT_SETTINGS.turnMeta, false);
    assert.equal(store.get().turnMeta, false);
    store.set({ turnMeta: false }); assert.equal(store.get().turnMeta, false);
    store.set({ turnMeta: true }); assert.equal(store.get().turnMeta, true);
    assert.equal(DEFAULT_SETTINGS.sessionTokens, false);
    assert.equal(store.get().sessionTokens, false);
    store.set({ sessionTokens: true }); assert.equal(store.get().sessionTokens, true);
    store.set({ sessionTokens: false }); assert.equal(store.get().sessionTokens, false);
    assert.equal(store.get().multiAccount, false);
    assert.equal(store.get().accountSwitcher, true);
    assert.equal(store.get().accountViewMode, 'list');
    assert.equal(store.get().accountQuotaWindow, '5h');
    assert.equal(store.get().autoSwitchAccount, false);
    store.set({ multiAccount: true, accountSwitcher: false, accountViewMode: 'card', accountQuotaWindow: 'weekly', autoSwitchAccount: true });
    assert.equal(store.get().multiAccount, true);
    assert.equal(store.get().accountSwitcher, false);
    assert.equal(store.get().accountViewMode, 'card');
    assert.equal(store.get().accountQuotaWindow, 'weekly');
    assert.equal(store.get().autoSwitchAccount, true);
    store.set({ multiAccount: false, accountSwitcher: true, accountViewMode: 'list', accountQuotaWindow: '5h', autoSwitchAccount: false });
    assert.equal(store.get().proxyEnabled, false);
    assert.equal(store.get().proxyUrl, '');
    assert.equal(store.get().proxyBypass, 'localhost,127.0.0.1,::1');
    assert.equal(store.get().proxyForceHttp1, false);
    store.set({ proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897/', proxyBypass: '192.168.0.0/16', proxyForceHttp1: true });
    assert.equal(store.get().proxyEnabled, true);
    assert.equal(store.get().proxyUrl, 'http://127.0.0.1:7897');
    assert.equal(store.get().proxyBypass, 'localhost,127.0.0.1,::1,192.168.0.0/16');
    assert.equal(store.get().proxyForceHttp1, true);
    store.set({ proxyEnabled: false, proxyUrl: '', proxyBypass: 'localhost,127.0.0.1,::1', proxyForceHttp1: false });
    assert.equal(store.get().sidebarProjectLimit, 0);
    store.set({ sidebarProjectLimit: 3 }); assert.equal(store.get().sidebarProjectLimit, 3);
    store.set({ sidebarProjectLimit: -1 }); assert.equal(store.get().sidebarProjectLimit, -1);
    store.set({ sidebarProjectLimit: 0 });
    assert.deepEqual([...SIDEBAR_BEAM_STYLES], ['sweep', 'pulse-inner', 'pulse-outside']);
    assert.equal(store.get().sidebarRunningBeam, false);
    assert.equal(store.get().sidebarRunningBeamPalette, 'sync');
    assert.equal(store.get().sidebarRunningBeamStyle, 'sweep');
    assert.equal(store.get().sidebarHideNativeSpinner, true);
    assert.equal(store.get().sidebarRunningGroup, false);
    store.set({ sidebarRunningBeam: true, sidebarRunningBeamPalette: 'neon', sidebarRunningBeamStyle: 'pulse-inner', sidebarHideNativeSpinner: false, sidebarRunningGroup: true });
    assert.equal(store.get().sidebarRunningBeam, true);
    assert.equal(store.get().sidebarRunningBeamPalette, 'neon');
    assert.equal(store.get().sidebarRunningBeamStyle, 'pulse-inner');
    assert.equal(store.get().sidebarHideNativeSpinner, false);
    assert.equal(store.get().sidebarRunningGroup, true);
    store.set({ sidebarRunningBeamStyle: 'pulse-outside' });
    assert.equal(store.get().sidebarRunningBeamStyle, 'pulse-outside');
    store.set({ sidebarRunningBeam: false, sidebarRunningBeamPalette: 'sync', sidebarRunningBeamStyle: 'sweep', sidebarHideNativeSpinner: true, sidebarRunningGroup: false });
    assert.equal(DEFAULT_SETTINGS.overviewRange, 'weeklyQuota');
    assert.equal(store.get().overviewRange, 'weeklyQuota');
    store.set({ overviewRange: '24h' }); assert.equal(store.get().overviewRange, '24h');
    store.set({ overviewRange: 'today' }); assert.equal(store.get().overviewRange, 'today');
    store.set({ overviewRange: 'weeklyQuota' }); assert.equal(store.get().overviewRange, 'weeklyQuota');
    assert.equal(DEFAULT_SETTINGS.pricingMode, 'standard');
    assert.equal(store.get().pricingMode, 'standard');
    store.set({ pricingMode: 'promo' }); assert.equal(store.get().pricingMode, 'promo');
    store.set({ pricingMode: 'standard' }); assert.equal(store.get().pricingMode, 'standard');
    assert.deepEqual([...TOKEN_UNITS], ['compact', 'zh']);
    assert.deepEqual([...CURRENCIES], ['USD', 'CNY']);
    assert.equal(DEFAULT_SETTINGS.tokenUnit, 'compact');
    assert.equal(DEFAULT_SETTINGS.currency, 'USD');
    assert.equal(Object.hasOwn(DEFAULT_SETTINGS, 'cnyRate'), false);
    store.set({ tokenUnit: 'zh', currency: 'CNY' });
    assert.equal(store.get().tokenUnit, 'zh');
    assert.equal(store.get().currency, 'CNY');
    // Legacy settings.json containing cnyRate loads cleanly without errors and strips unknown key
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ ...store.get(), cnyRate: 7.2 }, null, 2));
    const legacyLoaded = store.get();
    assert.equal(legacyLoaded.currency, 'CNY');
    assert.equal(Object.hasOwn(legacyLoaded, 'cnyRate'), false);
    store.set({ tokenUnit: 'compact', currency: 'USD' });
    store.set({ enabled: false }); assert.equal(store.get().enabled, false);
    assert.equal(DEFAULT_SETTINGS.contextLimit, 0);
    store.set({language:'en',contextLimit:1000000});assert.equal(store.get().contextLimit,1000000);assert.equal(store.get().language,'en');
    store.set({contextLimit:256000});assert.equal(store.get().contextLimit,256000);
    store.set({contextLimit:0});assert.equal(store.get().contextLimit,0);
    const before = readFileSync(join(directory, 'settings.json'), 'utf8');
    for (const value of [{ compact: 'false' }, { turnMeta: 'yes' }, { userBubbleTint: 'yes' }, { userBubblePreset: 'neon' }, { userBubbleColor: 'red' }, { userBubbleColor: '#123;color:red' }, { userBubbleStrength: 5 }, { userBubbleStrength: 105 }, { userBubbleStrength: 20.5 }, { sessionSearch: 'yes' }, { sidebarFolderDrop: 'yes' }, { sidebarFolderDropPin: 'yes' }, { composerQuotaHaloWindow: '1d' }, { sidebarRunningBeam: 'yes' }, { sidebarRunningBeamPalette: 'quota' }, { sidebarRunningBeamStyle: 'pulse' }, { sidebarRunningBeamStyle: 'orbit' }, { sidebarRunningBeamStyle: 123 }, { sidebarHideNativeSpinner: 1 }, { sidebarRunningGroup: 'on' }, { unknown: true }, { toString: false }, {language:'invalid'}, {overviewRange:'custom'}, {overviewRange:'invalid'}, {pricingMode:'batch'}, {pricingMode:true}, {tokenUnit:'metric'}, {tokenUnit:1}, {currency:'EUR'}, {currency:'cny'}, {cnyRate:7.2}, {accountViewMode:'grid'}, {accountQuotaWindow:'1h'}, {proxyUrl:'ftp://127.0.0.1:21'}, {proxyUrl:'http://127.0.0.1:7897;calc'}, {proxyBypass:'localhost"bad'}, {contextLimit:999999}, []]) assert.throws(() => store.set(value), /设置/);
    assert.equal(readFileSync(join(directory, 'settings.json'), 'utf8'), before);
    store.set(DEFAULT_SETTINGS); assert.deepEqual(store.get(), DEFAULT_SETTINGS);
    store.set({ compact: false, language: DEFAULT_SETTINGS.language === 'en' ? 'zh-CN' : 'en' });
    assert.deepEqual(store.reset(), DEFAULT_SETTINGS);
    assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('detectSystemLanguage selects zh-CN, zh-TW, or en across BCP-47 and POSIX underscore locales (Issue #69)', () => {
  assert.equal(detectSystemLanguage({ locale: 'zh-CN', env: {} }), 'zh-CN');
  assert.equal(detectSystemLanguage({ locale: 'zh-Hans-SG', env: {} }), 'zh-CN');
  assert.equal(detectSystemLanguage({ locale: 'zh-TW', env: {} }), 'zh-TW');
  assert.equal(detectSystemLanguage({ locale: 'zh-Hant-HK', env: {} }), 'zh-TW');
  assert.equal(detectSystemLanguage({ locale: 'en-US', env: {} }), 'en');
  assert.equal(detectSystemLanguage({ locale: 'tr-TR', env: {} }), 'en');
  assert.equal(detectSystemLanguage({ locale: '', env: { LANG: 'en_GB.UTF-8' } }), 'en');
  assert.equal(detectSystemLanguage({ locale: '', env: { LC_ALL: 'zh_TW.UTF-8' } }), 'zh-TW');
  assert.equal(detectSystemLanguage({ locale: '', env: { LANG: 'zh_CN.UTF-8' } }), 'zh-CN');
  assert.equal(detectSystemLanguage({ locale: '', env: { LANG: 'zh_SG.UTF-8' } }), 'zh-CN');
  assert.equal(detectSystemLanguage({ locale: '', env: { LC_ALL: 'zh_HK.UTF-8' } }), 'zh-TW');
  assert.equal(detectSystemLanguage({ locale: '', env: { LC_ALL: 'zh_MO.UTF-8' } }), 'zh-TW');
  assert.equal(detectSystemLanguage({ locale: 'C.UTF-8', env: { LANG: 'zh_CN.UTF-8' } }), 'zh-CN');
});

test('all ten locale tags and POSIX locale names persist across settings stores', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-locales-'));
  try {
    const store = createSettingsStore(dir);
    for (const [tag, language] of Object.entries({'zh-CN':'zh-CN','zh-TW':'zh-TW','en-GB':'en','fr-FR':'fr','ja-JP':'ja','ko-KR':'ko','de-DE':'de','es-ES':'es','ru-RU':'ru','vi-VN':'vi'})) {
      assert.equal(detectSystemLanguage({locale:tag}), language);
      assert.equal(detectSystemLanguage({env:{LC_MESSAGES:tag.replace('-', '_')+'.UTF-8'}}), language);
      store.set({language});
      assert.equal(createSettingsStore(dir).get().language, language);
    }
    assert.equal(detectSystemLanguage({locale:'it_IT.UTF-8'}), 'en');
  } finally { rmSync(dir, {recursive:true, force:true}); }
});

test('stripProxyUrlCredentials and exportSettingsPayload strip proxy auth and exclude non-portable keys (Issue #88)', () => {
  assert.deepEqual(stripProxyUrlCredentials('http://user:pass@127.0.0.1:7897'), { url: 'http://127.0.0.1:7897', stripped: true });
  assert.deepEqual(stripProxyUrlCredentials('socks5://alice:s3cr3t@[::1]:1080'), { url: 'socks5://[::1]:1080', stripped: true });
  assert.deepEqual(stripProxyUrlCredentials('http://onlyuser@127.0.0.1:7890/'), { url: 'http://127.0.0.1:7890', stripped: true });
  assert.deepEqual(stripProxyUrlCredentials('http://:onlypass@127.0.0.1:7890'), { url: 'http://127.0.0.1:7890', stripped: true });
  assert.deepEqual(stripProxyUrlCredentials('http://127.0.0.1:7897'), { url: 'http://127.0.0.1:7897', stripped: false });
  assert.deepEqual(stripProxyUrlCredentials(''), { url: '', stripped: false });
  assert.deepEqual(stripProxyUrlCredentials('not a url'), { url: 'not a url', stripped: false });
  assert.deepEqual(stripProxyUrlCredentials(null), { url: null, stripped: false });

  const exported = exportSettingsPayload({
    ...DEFAULT_SETTINGS,
    enabled: false,
    multiAccount: true,
    autoSwitchAccount: true,
    compact: false,
    customFont: '  Maple Mono NF CN  ',
    userBubbleColor: '#3d7a64',
    proxyEnabled: true,
    proxyUrl: 'http://user:secret@127.0.0.1:7897/',
    proxyBypass: '10.0.0.0/8'
  }, { pluginVersion: '2.17.0' });

  assert.equal(exported.format, SETTINGS_EXPORT_FORMAT);
  assert.equal(exported.schemaVersion, SETTINGS_EXPORT_SCHEMA_VERSION);
  assert.equal(exported.pluginVersion, '2.17.0');
  assert.ok(!Number.isNaN(Date.parse(exported.exportedAt)));
  assert.equal(exported.strippedProxyAuth, true);
  assert.equal(exported.settings.proxyUrl, 'http://127.0.0.1:7897');
  assert.equal(exported.settings.proxyBypass, 'localhost,127.0.0.1,::1,10.0.0.0/8');
  assert.equal(exported.settings.compact, false);
  assert.equal(exported.settings.customFont, 'Maple Mono NF CN');
  assert.equal(exported.settings.userBubbleColor, '#3D7A64');
  for (const key of NON_PORTABLE_SETTING_KEYS) {
    assert.equal(Object.hasOwn(exported.settings, key), false, `exported settings must exclude ${key}`);
  }
  assert.equal(
    Object.keys(exported.settings).length,
    Object.keys(DEFAULT_SETTINGS).length - NON_PORTABLE_SETTING_KEYS.size
  );

  // Without proxy credentials, strippedProxyAuth is false
  const cleanExport = exportSettingsPayload({ ...DEFAULT_SETTINGS, proxyUrl: 'http://127.0.0.1:7897', sidebarRunningBeamStyle: 'pulse-outside', tokenUnit: 'zh', currency: 'CNY' });
  assert.equal(cleanExport.strippedProxyAuth, false);
  assert.equal(cleanExport.settings.proxyUrl, 'http://127.0.0.1:7897');
  assert.equal(cleanExport.settings.sidebarRunningBeamStyle, 'pulse-outside');
  assert.equal(cleanExport.settings.tokenUnit, 'zh');
  assert.equal(cleanExport.settings.currency, 'CNY');
  assert.equal(Object.hasOwn(cleanExport.settings, 'cnyRate'), false);

  // Roundtrip sidebarRunningBeamStyle + tokenUnit/currency through sanitizeImportedSettings; legacy cnyRate is cleanly skipped
  const beamRoundtrip = sanitizeImportedSettings(JSON.stringify({ ...cleanExport, settings: { ...cleanExport.settings, cnyRate: 7.2 } }));
  assert.equal(beamRoundtrip.patch.sidebarRunningBeamStyle, 'pulse-outside');
  assert.equal(beamRoundtrip.patch.tokenUnit, 'zh');
  assert.equal(beamRoundtrip.patch.currency, 'CNY');
  assert.equal(Object.hasOwn(beamRoundtrip.patch, 'cnyRate'), false);
  assert.ok(beamRoundtrip.skippedKeys.includes('cnyRate'));
  const beamInnerImport = sanitizeImportedSettings({
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: 1,
    settings: { sidebarRunningBeamStyle: 'pulse-inner' }
  });
  assert.deepEqual(beamInnerImport.patch, { sidebarRunningBeamStyle: 'pulse-inner' });
  const beamBadImport = sanitizeImportedSettings({
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: 1,
    settings: { sidebarRunningBeam: true, sidebarRunningBeamStyle: 'invalid-style', tokenUnit: 'invalid', currency: 'EUR', cnyRate: 7.2 }
  });
  assert.deepEqual(beamBadImport.patch, { sidebarRunningBeam: true });
  assert.deepEqual(beamBadImport.skippedKeys.sort(), ['cnyRate', 'currency', 'sidebarRunningBeamStyle', 'tokenUnit']);
});

test('sanitizeImportedSettings validates envelope, strips proxy credentials, skips non-portable/unknown/invalid keys, and rejects bad payloads (Issue #88)', () => {
  // 1. Valid JSON string with mixed valid, non-portable, unknown future, and invalid entries + proxy auth
  const rawJson = JSON.stringify({
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: 1,
    pluginVersion: '2.99.0',
    settings: {
      enabled: false,
      multiAccount: true,
      autoSwitchAccount: true,
      compact: false,
      language: 'ja',
      customFont: '  Fira Code  ',
      userBubbleColor: '#1a2b3c',
      proxyUrl: 'socks5://bob:hunter2@127.0.0.1:1080',
      proxyBypass: '192.168.1.0/24',
      futureSettingV99: 'hello',
      compactInvalidType: 123,
      customFontWeight: 999,
      userBubbleStrength: 500
    }
  });
  const res = sanitizeImportedSettings(rawJson);
  assert.equal(res.strippedProxyAuth, true);
  assert.equal(res.appliedCount, 6);
  assert.deepEqual(res.importedKeys.sort(), ['compact', 'customFont', 'language', 'proxyBypass', 'proxyUrl', 'userBubbleColor']);
  assert.deepEqual(res.patch, {
    compact: false,
    language: 'ja',
    customFont: 'Fira Code',
    userBubbleColor: '#1A2B3C',
    proxyUrl: 'socks5://127.0.0.1:1080',
    proxyBypass: 'localhost,127.0.0.1,::1,192.168.1.0/24'
  });
  assert.deepEqual(res.skippedKeys.sort(), [
    'autoSwitchAccount',
    'compactInvalidType',
    'customFontWeight',
    'enabled',
    'futureSettingV99',
    'multiAccount',
    'userBubbleStrength'
  ]);

  // 2. Plain object input also accepted; invalid proxyUrl with creds is skipped and does not falsely set strippedProxyAuth
  const objRes = sanitizeImportedSettings({
    format: SETTINGS_EXPORT_FORMAT,
    schemaVersion: 1,
    settings: {
      timing: false,
      proxyUrl: 'ftp://user:pass@127.0.0.1:21'
    }
  });
  assert.deepEqual(objRes.patch, { timing: false });
  assert.equal(objRes.appliedCount, 1);
  assert.deepEqual(objRes.importedKeys, ['timing']);
  assert.deepEqual(objRes.skippedKeys, ['proxyUrl']);
  assert.equal(objRes.strippedProxyAuth, false);

  // 3. Reject malformed, wrong format, unsupported schemaVersion, missing settings, empty/non-applicable settings, arrays, and oversized payloads with structured error codes
  for (const [bad, expectedCode] of [
    ['', 'invalid-json'],
    ['{bad json', 'invalid-json'],
    ['[]', 'invalid-data'],
    [null, 'invalid-data'],
    [undefined, 'invalid-data'],
    [42, 'invalid-data'],
    [[], 'invalid-data'],
    [{}, 'invalid-format'],
    [{ format: 'wrong-format', schemaVersion: 1, settings: {} }, 'invalid-format'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 0, settings: {} }, 'unsupported-version'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 2, settings: {} }, 'unsupported-version'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: '1', settings: {} }, 'unsupported-version'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1 }, 'missing-settings'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: null }, 'missing-settings'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: [] }, 'missing-settings'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: {} }, 'no-applicable-settings'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: { enabled: false, multiAccount: true, autoSwitchAccount: true } }, 'no-applicable-settings'],
    [{ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: { futureUnknownKey: true, customFontWeight: 999 } }, 'no-applicable-settings'],
    ['x'.repeat(SETTINGS_IMPORT_MAX_BYTES + 1), 'too-large'],
    [JSON.stringify({
      format: SETTINGS_EXPORT_FORMAT,
      schemaVersion: 1,
      settings: { padding: 'a'.repeat(SETTINGS_IMPORT_MAX_BYTES) }
    }), 'too-large']
  ]) {
    assert.throws(
      () => sanitizeImportedSettings(bad),
      err => err instanceof Error && err.code === expectedCode,
      `expected rejection with code ${expectedCode} for payload: ${String(bad).slice(0, 60)}`
    );
  }
});

test('native-host settings.export and settings.import RPCs strip proxy credentials, protect local-only keys, and persist atomically (Issue #88)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-settings-rpc-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const portFile = join(dir, 'DevToolsActivePort');
  writeFileSync(portFile, '12349\n/devtools/browser/test\n');
  const originalFetch = globalThis.fetch;
  const target = { id: 'settings-rpc-win', type: 'page', title: 'Local - Antigravity', url: 'https://127.0.0.1:5015/c/conv-settings', webSocketDebuggerUrl: 'ws://127.0.0.1:12349/devtools/page/settings-rpc-win' };
  globalThis.fetch = async () => ({ ok: true, json: async () => [target] });

  let capturedClient = null;
  let stop;
  try {
    const store = createSettingsStore(dataDir);
    store.set({
      enabled: true,
      multiAccount: true,
      autoSwitchAccount: true,
      compact: false,
      customFont: 'JetBrains Mono',
      proxyEnabled: true,
      proxyUrl: 'http://alice:topsecret@127.0.0.1:7897',
      language: 'en'
    });

    stop = startNativeIntegration({
      portFile,
      dataDir,
      wsl: false,
      onStatus() {},
      parseSessionData: () => ({}),
      discover: async () => ['sampleNativeName'],
      connect: async () => {
        const listeners = new Set();
        const replies = [];
        const client = {
          listeners,
          replies,
          onEvent(fn) { listeners.add(fn); },
          emit(event) { return Promise.all([...listeners].map(fn => fn(event))); },
          socket: { addEventListener() {}, close() {} },
          async send(method, params = {}) {
            if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
            if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-1' };
            if (method === 'Runtime.evaluate') {
              const expr = String(params.expression || '');
              if (expr.includes('navigator.userAgent')) return { result: { value: { ua: 'Antigravity/2.35.2', sshKind: '', sshHost: '', title: target.title } } };
              if (expr.includes('globalThis.__agyPowertoolsReceive')) {
                const match = expr.match(/globalThis\.__agyPowertoolsReceive\?\.\((\d+),([\s\S]+)\)$/);
                if (match) replies.push({ id: Number(match[1]), payload: JSON.parse(match[2]) });
                return { result: { value: true } };
              }
              return { result: { value: false } };
            }
            return {};
          }
        };
        capturedClient = client;
        return client;
      }
    });

    await stop.ready;
    await capturedClient.emit({ method: 'Runtime.executionContextCreated', params: { context: { id: 10, origin: 'https://127.0.0.1:5015', auxData: { isDefault: true, frameId: 'main-frame' } } } });
    const rpc = async (id, body) => {
      await capturedClient.emit({
        method: 'Runtime.bindingCalled',
        params: { name: '__agyPowertoolsHost', executionContextId: 10, payload: JSON.stringify({ id, ...body }) }
      });
      return capturedClient.replies.find(r => r.id === id)?.payload;
    };

    // 1. settings.export returns clean envelope without secrets or non-portable keys
    const exported = await rpc(1, { method: 'settings.export' });
    assert.equal(exported.format, SETTINGS_EXPORT_FORMAT);
    assert.equal(exported.schemaVersion, SETTINGS_EXPORT_SCHEMA_VERSION);
    assert.ok(typeof exported.pluginVersion === 'string' && exported.pluginVersion.length > 0);
    assert.equal(exported.strippedProxyAuth, true);
    assert.equal(exported.settings.proxyUrl, 'http://127.0.0.1:7897');
    assert.equal(exported.settings.customFont, 'JetBrains Mono');
    assert.equal(Object.hasOwn(exported.settings, 'enabled'), false);
    assert.equal(Object.hasOwn(exported.settings, 'multiAccount'), false);
    assert.equal(Object.hasOwn(exported.settings, 'autoSwitchAccount'), false);

    // 2. settings.import applies portable keys atomically, strips proxy auth, preserves local enabled/multiAccount/autoSwitchAccount
    const imported = await rpc(2, {
      method: 'settings.import',
      payload: JSON.stringify({
        format: SETTINGS_EXPORT_FORMAT,
        schemaVersion: 1,
        settings: {
          enabled: false,
          multiAccount: false,
          autoSwitchAccount: false,
          compact: true,
          customFont: 'Maple Mono',
          language: 'fr',
          proxyUrl: 'http://bob:pw@127.0.0.1:8888',
          unknownFutureFlag: true
        }
      })
    });
    assert.equal(imported.error, undefined);
    assert.equal(imported.appliedCount, 4);
    assert.deepEqual(imported.importedKeys.sort(), ['compact', 'customFont', 'language', 'proxyUrl']);
    assert.equal(imported.strippedProxyAuth, true);
    assert.deepEqual(imported.skippedKeys.sort(), ['autoSwitchAccount', 'enabled', 'multiAccount', 'unknownFutureFlag']);
    assert.equal(imported.settings.enabled, true);
    assert.equal(imported.settings.multiAccount, true);
    assert.equal(imported.settings.autoSwitchAccount, true);
    assert.equal(imported.settings.compact, true);
    assert.equal(imported.settings.customFont, 'Maple Mono');
    assert.equal(imported.settings.language, 'fr');
    assert.equal(imported.settings.proxyUrl, 'http://127.0.0.1:8888');

    // Verify atomic persistence on disk
    const persisted = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
    assert.equal(persisted.customFont, 'Maple Mono');
    assert.equal(persisted.language, 'fr');
    assert.equal(persisted.proxyUrl, 'http://127.0.0.1:8888');
    assert.equal(persisted.multiAccount, true);

    // 3. Invalid import payload and zero-applicable-settings payload return structured errorCode and leave disk untouched
    const beforeDisk = readFileSync(join(dataDir, 'settings.json'), 'utf8');
    const badImport = await rpc(3, {
      method: 'settings.import',
      payload: JSON.stringify({ format: 'wrong', schemaVersion: 1, settings: { compact: false } })
    });
    assert.ok(typeof badImport.error === 'string' && badImport.error.length > 0);
    assert.equal(badImport.errorCode, 'invalid-format');
    assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), beforeDisk);

    const emptySettingsImport = await rpc(4, {
      method: 'settings.import',
      payload: JSON.stringify({ format: SETTINGS_EXPORT_FORMAT, schemaVersion: 1, settings: { enabled: false, unknownOnly: 1 } })
    });
    assert.ok(typeof emptySettingsImport.error === 'string' && emptySettingsImport.error.length > 0);
    assert.equal(emptySettingsImport.errorCode, 'no-applicable-settings');
    assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), beforeDisk);

    // 4. Outer host payload guard (> 256 KB, <= 512 KB) does not silently drop double-JSON-encoded oversized import payloads
    const oversizedEscaped = '\n'.repeat(132000);
    const outerLen = JSON.stringify({ id: 5, method: 'settings.import', payload: oversizedEscaped }).length;
    assert.ok(outerLen > 262144 && outerLen < 524288, `expected outer payload between 256KB and 512KB, got ${outerLen}`);
    const bigImport = await rpc(5, { method: 'settings.import', payload: oversizedEscaped });
    assert.ok(bigImport, 'outer 512 KB guard must reply instead of silently dropping');
    assert.equal(bigImport.errorCode, 'too-large');
    assert.equal(readFileSync(join(dataDir, 'settings.json'), 'utf8'), beforeDisk);
  } finally {
    await stop?.();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
