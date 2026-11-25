// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_PREFS,
  UI_FONT_STACKS,
  fontPrefs,
  formatCustomFontList,
  parseFontPrefs,
  resolveTerminalFontStack,
  resolveUiFontStack
} from './font';

describe('font preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    fontPrefs.reset();
  });

  it('defaults to the bundled HarmonyOS Sans UI font and default terminal stack', () => {
    expect(fontPrefs.get()).toEqual(DEFAULT_FONT_PREFS);
    expect(document.documentElement.getAttribute('data-font')).toBe('harmonyos');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain("'HarmonyOS Sans'");
  });

  it('switches UI presets and updates the CSS custom property + localStorage mirror', () => {
    fontPrefs.update({ ui: 'system' });
    expect(document.documentElement.getAttribute('data-font')).toBe('system');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(UI_FONT_STACKS.system);
    expect(JSON.parse(localStorage.getItem('omnyssh-font')!)).toMatchObject({ ui: 'system' });

    fontPrefs.update({ ui: 'classic' });
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(UI_FONT_STACKS.classic);
  });

  it('sanitises custom font names and keeps safe fallbacks', () => {
    expect(formatCustomFontList('MiSans, "LXGW WenKai"; color: red')).toBe("'MiSans', 'LXGW WenKai color: red'");
    expect(formatCustomFontList('   ')).toBe('');

    const customUi = resolveUiFontStack({
      ...DEFAULT_FONT_PREFS,
      ui: 'custom',
      uiCustom: 'MiSans, Inter'
    });
    expect(customUi).toBe(`'MiSans', 'Inter', ${UI_FONT_STACKS.harmonyos}`);

    const emptyCustomUi = resolveUiFontStack({
      ...DEFAULT_FONT_PREFS,
      ui: 'custom',
      uiCustom: '   '
    });
    expect(emptyCustomUi).toBe(UI_FONT_STACKS.harmonyos);
  });

  it('prepends terminal font presets while preserving the base monospace + Nerd Font tail', () => {
    const base = "ui-monospace, Consolas, monospace, 'Symbols Nerd Font Mono'";
    expect(resolveTerminalFontStack(DEFAULT_FONT_PREFS, base)).toBe(base);
    expect(resolveTerminalFontStack({ ...DEFAULT_FONT_PREFS, terminal: 'cascadia' }, base)).toBe(
      `'Cascadia Mono', 'Cascadia Code', ${base}`
    );
    expect(
      resolveTerminalFontStack({ ...DEFAULT_FONT_PREFS, terminal: 'custom', terminalCustom: 'Sarasa Term SC' }, base)
    ).toBe(`'Sarasa Term SC', ${base}`);
  });

  it('ignores malformed persisted values and falls back to defaults', () => {
    expect(parseFontPrefs(null)).toEqual(DEFAULT_FONT_PREFS);
    expect(parseFontPrefs({ ui: 'unknown', terminal: 42, uiCustom: 123 })).toEqual(DEFAULT_FONT_PREFS);
  });
});
