// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  DEFAULT_FONT_PREFS,
  HARMONYOS_FONT_STYLESHEET_URLS,
  UI_FONT_STACKS,
  fontPrefs,
  formatCustomFontList,
  harmonyFontState,
  parseFontPrefs,
  resolveTerminalFontStack,
  resolveUiFontStack
} from './font';

describe('font preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    fontPrefs.reset();
    document.head.innerHTML = '';
  });

  it('defaults to lightweight system UI font with zero external font links', () => {
    expect(fontPrefs.get()).toEqual(DEFAULT_FONT_PREFS);
    expect(document.documentElement.getAttribute('data-font')).toBe('system');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(UI_FONT_STACKS.system);
    expect(get(harmonyFontState)).toBe('idle');
    expect(document.getElementById('omnyssh-harmonyos-font')).toBeNull();
  });

  it('loads HarmonyOS Sans stylesheet on demand and falls back across CDN mirrors', async () => {
    fontPrefs.update({ ui: 'harmonyos' });
    expect(document.documentElement.getAttribute('data-font')).toBe('harmonyos');
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain("'HarmonyOS Sans'");
    expect(get(harmonyFontState)).toBe('loading');

    const firstLink = document.getElementById('omnyssh-harmonyos-font') as HTMLLinkElement | null;
    expect(firstLink?.href).toBe(HARMONYOS_FONT_STYLESHEET_URLS[0]);

    // First CDN fails -> automatically retries the second mirror.
    firstLink?.dispatchEvent(new Event('error'));
    await new Promise((r) => setTimeout(r, 0));
    const secondLink = document.getElementById('omnyssh-harmonyos-font') as HTMLLinkElement | null;
    expect(secondLink?.href).toBe(HARMONYOS_FONT_STYLESHEET_URLS[1]);

    secondLink?.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 0));
    expect(get(harmonyFontState)).toBe('loaded');

    // Switching back to classic leaves no HarmonyOS loading state active.
    fontPrefs.update({ ui: 'classic' });
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toBe(UI_FONT_STACKS.classic);
    expect(get(harmonyFontState)).toBe('idle');
  });

  it('switches to offline fallback status when all CDN mirrors fail', async () => {
    fontPrefs.update({ ui: 'harmonyos' });
    for (let i = 0; i < HARMONYOS_FONT_STYLESHEET_URLS.length; i++) {
      const link = document.getElementById('omnyssh-harmonyos-font');
      link?.dispatchEvent(new Event('error'));
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(get(harmonyFontState)).toBe('offline');
    expect(document.getElementById('omnyssh-harmonyos-font')).toBeNull();
  });

  it('sanitises custom font names and keeps safe fallbacks', () => {
    expect(formatCustomFontList('MiSans, "LXGW WenKai"; color: red')).toBe("'MiSans', 'LXGW WenKai color: red'");
    expect(formatCustomFontList('   ')).toBe('');

    const customUi = resolveUiFontStack({
      ...DEFAULT_FONT_PREFS,
      ui: 'custom',
      uiCustom: 'MiSans, Inter'
    });
    expect(customUi).toBe(`'MiSans', 'Inter', ${UI_FONT_STACKS.system}`);

    const emptyCustomUi = resolveUiFontStack({
      ...DEFAULT_FONT_PREFS,
      ui: 'custom',
      uiCustom: '   '
    });
    expect(emptyCustomUi).toBe(UI_FONT_STACKS.system);
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
