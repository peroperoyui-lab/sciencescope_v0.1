// Installed font families for the interface font setting.
// Windows: the system font collection through PowerShell (UTF-8 output, so
// localized names such as 微软雅黑 survive); if that fails, the registry font
// lists (HKLM and per-user HKCU). Other platforms: fontconfig when present.
// Names are returned as reported; fonts without CJK glyphs may render Chinese
// text with fallback glyphs, which is the user's choice.
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { validFontFamily } from './desktop-preferences.mjs';

const execFile = promisify(execFileCallback);
const TIMEOUT = 20_000;
let cached = null;

const powershell = () => path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

async function windowsCollection() {
  const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name; $_.GetName(2052) }';
  const {stdout} = await execFile(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true, timeout: TIMEOUT, maxBuffer: 8 << 20, encoding: 'utf8'});
  return stdout.split(/\r?\n/);
}

// Registry value names look like "Microsoft YaHei & Microsoft YaHei UI (TrueType)".
export function familiesFromRegistry(text) {
  const names = [];
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s{4}(.+?)\s{4}REG_(?:SZ|EXPAND_SZ)\s/.exec(line);
    if (!match) continue;
    const base = match[1].replace(/\s*\((?:TrueType|OpenType|All res|VGA res|\d+,\d+(?:,\d+)*)\)\s*$/i, '');
    for (const part of base.split(/\s*&\s*/)) names.push(part.replace(/\s+(?:Regular|Bold|Italic|Bold Italic|Light|Semilight|Semibold|Black)$/i, ''));
  }
  return names;
}

async function windowsRegistry() {
  const reg = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/reg.exe');
  const out = [];
  for (const key of ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']) {
    try { const {stdout} = await execFile(reg, ['query', key], {windowsHide: true, timeout: TIMEOUT, maxBuffer: 8 << 20}); out.push(...familiesFromRegistry(stdout)); } catch { /* key may be absent */ }
  }
  return out;
}

async function fontconfig() {
  const {stdout} = await execFile('fc-list', [':', 'family'], {timeout: TIMEOUT, maxBuffer: 8 << 20, encoding: 'utf8'});
  return stdout.split(/\r?\n/).flatMap(line => line.split(','));
}

export function normalizeFamilies(names) {
  const seen = new Set(), out = [];
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!validFontFamily(name) || name.startsWith('@') || seen.has(name.toLowerCase())) continue; // "@..." are vertical CJK variants
    seen.add(name.toLowerCase()); out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** @returns {Promise<{fonts:string[], source:string}>} */
export async function listSystemFonts({refresh = false} = {}) {
  if (cached && !refresh) return cached;
  let names = [], source = 'unavailable';
  if (process.platform === 'win32') {
    try { names = await windowsCollection(); source = 'windows'; } catch { /* fall through */ }
    if (!normalizeFamilies(names).length) { names = await windowsRegistry(); source = names.length ? 'windows-registry' : 'unavailable'; }
  } else {
    try { names = await fontconfig(); source = 'fontconfig'; } catch { names = []; }
  }
  cached = {fonts: normalizeFamilies(names), source};
  return cached;
}
