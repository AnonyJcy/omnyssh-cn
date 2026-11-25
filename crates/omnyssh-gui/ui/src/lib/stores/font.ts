import { writable } from 'svelte/store';

// UI and terminal font preferences. Persisted canonically in `tauri-plugin-store`
// with a synchronous `localStorage` mirror read by `app.html` before first paint
// so there is no font flash on launch. Defaults to the bundled HarmonyOS Sans font
// so Windows/Linux/macOS all render crisp CJK + Latin text offline out of the box.

export type UiFontPreset = 'harmonyos' | 'system' | 'classic' | 'custom';
export type TerminalFontPreset = 'default' | 'cascadia' | 'jetbrains' | 'fira' | 'custom';

export interface FontPrefs {
  ui: UiFontPreset;
  uiCustom: string;
  terminal: TerminalFontPreset;
  terminalCustom: string;
}

export const UI_FONT_PRESETS: readonly UiFontPreset[] = ['harmonyos', 'system', 'classic', 'custom'];
export const TERMINAL_FONT_PRESETS: readonly TerminalFontPreset[] = [
  'default',
  'cascadia',
  'jetbrains',
  'fira',
  'custom'
];

export const DEFAULT_FONT_PREFS: FontPrefs = {
  ui: 'harmonyos',
  uiCustom: '',
  terminal: 'default',
  terminalCustom: ''
};

export const UI_FONT_STACKS: Record<Exclude<UiFontPreset, 'custom'>, string> = {
  harmonyos:
    "'HarmonyOS Sans', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
  system:
    "system-ui, -apple-system, 'PingFang SC', 'Segoe UI', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif",
  classic: "'Helvetica Neue', Helvetica, Arial, sans-serif"
};

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
    return custom ? `${custom}, ${UI_FONT_STACKS.harmonyos}` : UI_FONT_STACKS.harmonyos;
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
  return v === 'harmonyos' || v === 'system' || v === 'classic' || v === 'custom';
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

function reflectDocument(prefs: FontPrefs): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font', prefs.ui);
  document.documentElement.style.setProperty('--font-sans', resolveUiFontStack(prefs));
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
