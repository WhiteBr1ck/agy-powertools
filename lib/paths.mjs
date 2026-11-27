import { homedir } from 'node:os';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, parse, win32, posix } from 'node:path';
import { isWslEnvironment, resolveWslWindowsAppData } from './wsl.mjs';

export function antigravityUserDataDir({ platform=process.platform, env=process.env, home=homedir(), wsl, resolveWslAppData=resolveWslWindowsAppData }={}) {
  if(env.ANTIGRAVITY_USER_DATA_DIR)return env.ANTIGRAVITY_USER_DATA_DIR;
  const path=platform==='win32'?win32:posix;
  if(platform==='win32')return path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'Antigravity');
  if(platform==='darwin')return path.join(home,'Library','Application Support','Antigravity');
  const inWsl=typeof wsl==='boolean'?wsl:isWslEnvironment({platform,env});
  if(inWsl){
    const winAppData=resolveWslAppData({env});
    if(winAppData)return posix.join(winAppData,'Antigravity');
  }
  return path.join(env.XDG_CONFIG_HOME||path.join(home,'.config'),'Antigravity');
}

export function devToolsPortFile(options={}) {
  const env=options.env||process.env;
  return options.portFile||env.ANTIGRAVITY_CDP_PORT_FILE||env.AGY_BROWSER_ACTIVE_PORT_FILE||
    (options.platform==='win32'||!options.platform&&process.platform==='win32'?win32:posix).join(antigravityUserDataDir(options),'DevToolsActivePort');
}

export const pluginDataDir=()=>join(homedir(),'.gemini','antigravity','plugin_data','agy-powertools');

// A switch may remove a file in this directory. Pin an existing local profile,
// never a relative path, volume root, UNC/device path, or unresolved directory.
export function verifiedSwitchProfileDir(path) {
  const isLocal = p => typeof p === 'string' && isAbsolute(p) && !/^[\\/]{2}|[\x00-\x1f\x7f]/.test(p) &&
    (process.platform !== 'win32' || /^[A-Za-z]:[\\/]/.test(p)) && !p.split(/[\\/]/).includes('..');
  if (isLocal(path)) {
    const dir = realpathSync.native(path);
    if (isLocal(dir) && dir !== parse(dir).root && statSync(dir).isDirectory()) return dir;
  }
  throw new Error('无法确认账号切换的用户数据目录');
}
