import test from 'node:test';
import assert from 'node:assert/strict';
import { familiesFromRegistry, normalizeFamilies } from '../scripts/system-fonts.mjs';

test('system fonts: registry names become families', () => {
  const text = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    '    Microsoft YaHei & Microsoft YaHei UI (TrueType)    REG_SZ    msyh.ttc',
    '    SimHei (TrueType)    REG_SZ    simhei.ttf',
    '    Arial Bold (TrueType)    REG_SZ    arialbd.ttf',
    '    Courier 10,12,15    REG_SZ    COURE.FON',
    '    思源黑体 CN Regular (OpenType)    REG_SZ    C:\\Users\\a\\AppData\\Local\\Microsoft\\Windows\\Fonts\\x.otf',
  ].join('\r\n');
  assert.deepEqual(familiesFromRegistry(text), ['Microsoft YaHei', 'Microsoft YaHei UI', 'SimHei', 'Arial', 'Courier 10,12,15', '思源黑体 CN']);
});

test('system fonts: normalized, unique, sorted, CSS-safe', () => {
  const out = normalizeFamilies(['SimHei', 'simhei', '@SimHei', ' ', 'a"b', '微软雅黑', 'Arial']);
  assert.deepEqual([...out].sort(), ['Arial', 'SimHei', '微软雅黑']);
  assert.deepEqual(normalizeFamilies([...out].reverse()), out, 'order is deterministic');
});
