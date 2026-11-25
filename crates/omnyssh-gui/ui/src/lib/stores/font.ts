import { writable } from 'svelte/store';

// UI and terminal font preferences. Persisted canonically in `tauri-plugin-store`
// with a synchronous `localStorage` mirror read by `app.html` before first paint
// so there is no font flash on launch.
//
// Defaults to `system` so the distributed binary stays lightweight (~5 MB, no
// embedded 14 MB font files) and makes zero external network requests. When the
// user selects `harmonyos`, we first check for a locally installed HarmonyOS Sans
// font and otherwise load its Unicode-range WOFF2 CSS on demand from CDN.

export type UiFontPreset = 'system' | 'harmonyos' | 'classic' | 'custom';
export type TerminalFontPreset = 'default' | 'cascadia' | 'jetbrains' | 'fira' | 'custom';
export type HarmonyFontState = 'idle' | 'local' | 'loading' | 'loaded' | 'offline';

export interface FontPrefs {
  ui: UiFontPreset;
  uiCustom: string;
  terminal: TerminalFontPreset;
  terminalCustom: string;
}

export const UI_FONT_PRESETS: readonly UiFontPreset[] = ['system', 'harmonyos', 'classic', 'custom'];
export const TERMINAL_FONT_PRESETS: readonly TerminalFontPreset[] = [
  'default',
  'cascadia',
  'jetbrains',
  'fira',
  'custom'
];

export const DEFAULT_FONT_PREFS: FontPrefs = {
  ui: 'system',
  uiCustom: '',
  terminal: 'default',
  terminalCustom: ''
};

export const UI_FONT_STACKS: Record<Exclude<UiFontPreset, 'custom'>, string> = {
  system:
    "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif",
  harmonyos:
    "'HarmonyOS Sans', 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  classic: "'Helvetica Neue', Helvetica, Arial, sans-serif"
};

export const HARMONYOS_FONT_STYLESHEET_URLS: readonly string[] = [
  'https://cdn.jsdelivr.net/npm/@luzixu/harmonyos-sans@0.1.2/index.css',
  'https://fastly.jsdelivr.net/npm/@luzixu/harmonyos-sans@0.1.2/index.css',
  'https://unpkg.com/@luzixu/harmonyos-sans@0.1.2/index.css'
];

const HARMONY_LINK_ID = 'omnyssh-harmonyos-font';
const HARMONY_LOAD_TIMEOUT_MS = 10_000;

const TERMINAL_FONT_PREFIXES: Record<Exclude<TerminalFontPreset, 'custom'>, string> = {
  default: '',
  cascadia: "'Cascadia Mono', 'Cascadia Code'",
  jetbrains: "'JetBrains Mono'",
  fira: "'Fira Code'"
};

const LOCAL_KEY = 'omnyssh-font';
const STORE_FILE = 'settings.json';
const STORE_KEY = 'fontPrefs';

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded'
]);

/** Sanitise and quote a user-typed font family list (comma-separated). Drops control
 *  characters and CSS delimiters so untrusted text can never break out of a declaration. */
export function formatCustomFontList(raw: string): string {
  return raw
    .split(',')
    .map((part) =>
      part
        .replace(/[\x00-\x1f\x7f"'\\;{}]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .map((name) => {
      const lower = name.toLowerCase();
      if (GENERIC_FAMILIES.has(lower)) return lower;
      return `'${name}'`;
    })
    .join(', ');
}

export function resolveUiFontStack(prefs: FontPrefs): string {
  if (prefs.ui === 'custom') {
    const custom = formatCustomFontList(prefs.uiCustom);
    return custom ? `${custom}, ${UI_FONT_STACKS.system}` : UI_FONT_STACKS.system;
  }
  return UI_FONT_STACKS[prefs.ui];
}

export function resolveTerminalFontStack(prefs: FontPrefs, baseMono: string): string {
  if (prefs.terminal === 'custom') {
    const custom = formatCustomFontList(prefs.terminalCustom);
    return custom ? `${custom}, ${baseMono}` : baseMono;
  }
  const prefix = TERMINAL_FONT_PREFIXES[prefs.terminal];
  return prefix ? `${prefix}, ${baseMono}` : baseMono;
}

function isUiPreset(v: unknown): v is UiFontPreset {
  return v === 'system' || v === 'harmonyos' || v === 'classic' || v === 'custom';
}

function isTerminalPreset(v: unknown): v is TerminalFontPreset {
  return v === 'default' || v === 'cascadia' || v === 'jetbrains' || v === 'fira' || v === 'custom';
}

export function parseFontPrefs(raw: unknown): FontPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_FONT_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    ui: isUiPreset(r.ui) ? r.ui : DEFAULT_FONT_PREFS.ui,
    uiCustom: typeof r.uiCustom === 'string' ? r.uiCustom.slice(0, 120) : DEFAULT_FONT_PREFS.uiCustom,
    terminal: isTerminalPreset(r.terminal) ? r.terminal : DEFAULT_FONT_PREFS.terminal,
    terminalCustom:
      typeof r.terminalCustom === 'string'
        ? r.terminalCustom.slice(0, 120)
        : DEFAULT_FONT_PREFS.terminalCustom
  };
}

/** Detect whether a font family is already installed locally on the OS using
 *  canvas text width comparison (unlike `document.fonts.check`, this reliably
 *  inspects system-installed faces without requiring `@font-face` entries). */
export function isLocalFontAvailable(family: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const sample = 'mmmmmmmmmmlli中文测试0123456789';
    for (const base of ['monospace', 'sans-serif']) {
      ctx.font = `72px ${base}`;
      const baseWidth = ctx.measureText(sample).width;
      ctx.font = `72px "${family}", ${base}`;
      if (ctx.measureText(sample).width !== baseWidth) return true;
    }
  } catch {
    return false;
  }
  return false;
}

const harmonyStateStore = writable<HarmonyFontState>('idle');
export const harmonyFontState = { subscribe: harmonyStateStore.subscribe };

let harmonyLoadGeneration = 0;
let harmonyLoadedUrl: string | null = null;

function removeHarmonyLink(): void {
  if (typeof document === 'undefined') return;
  document.getElementById(HARMONY_LINK_ID)?.remove();
}

async function loadStylesheetFromMirrors(gen: number): Promise<void> {
  if (typeof document === 'undefined' || !document.head) {
    harmonyStateStore.set('offline');
    return;
  }

  for (const url of HARMONYOS_FONT_STYLESHEET_URLS) {
    if (gen !== harmonyLoadGeneration) return;
    removeHarmonyLink();
    const ok = await new Promise<boolean>((resolve) => {
      const link = document.createElement('link');
      link.id = HARMONY_LINK_ID;
      link.rel = 'stylesheet';
      link.href = url;
      link.crossOrigin = 'anonymous';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, HARMONY_LOAD_TIMEOUT_MS);
      link.addEventListener('load', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
      link.addEventListener('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(false);
      });
      document.head.appendChild(link);
    });
    if (gen !== harmonyLoadGeneration) return;
    if (ok) {
      harmonyLoadedUrl = url;
      harmonyStateStore.set('loaded');
      return;
    }
  }

  removeHarmonyLink();
  if (gen === harmonyLoadGeneration) {
    harmonyStateStore.set('offline');
  }
}

export function syncHarmonyFontLoading(preset: UiFontPreset): void {
  harmonyLoadGeneration += 1;
  const gen = harmonyLoadGeneration;
  if (preset !== 'harmonyos') {
    harmonyStateStore.set('idle');
    return;
  }
  if (typeof document === 'undefined') return;

  if (harmonyLoadedUrl && document.getElementById(HARMONY_LINK_ID)) {
    harmonyStateStore.set('loaded');
    return;
  }

  if (isLocalFontAvailable('HarmonyOS Sans') || isLocalFontAvailable('HarmonyOS Sans SC')) {
    harmonyStateStore.set('local');
    return;
  }

  harmonyStateStore.set('loading');
  void loadStylesheetFromMirrors(gen);
}

export function retryHarmonyFontLoad(): void {
  harmonyLoadedUrl = null;
  removeHarmonyLink();
  syncHarmonyFontLoading('harmonyos');
}

function reflectDocument(prefs: FontPrefs): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font', prefs.ui);
  document.documentElement.style.setProperty('--font-sans', resolveUiFontStack(prefs));
  syncHarmonyFontLoading(prefs.ui);
}

function readMirror(): FontPrefs {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? parseFontPrefs(JSON.parse(raw)) : { ...DEFAULT_FONT_PREFS };
  } catch {
    return { ...DEFAULT_FONT_PREFS };
  }
}

function writeMirror(prefs: FontPrefs): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable: tauri-plugin-store remains canonical.
  }
}

async function persistStore(prefs: FontPrefs): Promise<void> {
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, prefs);
    await store.save();
  } catch {
    // Outside Tauri (tests, vite preview): localStorage mirror suffices.
  }
}

function createFontPrefs() {
  const initial = readMirror();
  reflectDocument(initial);
  const { subscribe, set: setStore } = writable<FontPrefs>(initial);
  let current = initial;
  let interacted = false;

  function apply(next: FontPrefs, user: boolean): void {
    current = next;
    reflectDocument(next);
    setStore(next);
    writeMirror(next);
    if (user) {
      interacted = true;
      void persistStore(next);
    }
  }

  return {
    subscribe,
    get: (): FontPrefs => current,
    update: (patch: Partial<FontPrefs>): void => {
      apply(parseFontPrefs({ ...current, ...patch }), true);
    },
    reset: (): void => {
      harmonyLoadedUrl = null;
      removeHarmonyLink();
      apply({ ...DEFAULT_FONT_PREFS }, true);
    },
    async hydrate(): Promise<void> {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load(STORE_FILE);
        const saved = await store.get<unknown>(STORE_KEY);
        if (!interacted && saved != null) apply(parseFontPrefs(saved), false);
      } catch {
        // Store unreachable: keep mirrored/default value.
      }
    }
  };
}

export const fontPrefs = createFontPrefs();
