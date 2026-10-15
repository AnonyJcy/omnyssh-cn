import { get, writable } from 'svelte/store';
import { locale, translate, type Locale, type TranslationKey } from '$lib/i18n';
import type { CloseRequestedEvent, Window } from '@tauri-apps/api/window';
import type { TunnelStatusDto } from '$lib/bindings';
import { sessions, type Session } from './sessions';
import { sftp, type SftpSession } from './sftp';
import { tunnels } from './tunnels';
import { snippetRun, type SnippetRun } from './snippets';

// Quitting ends every terminal, transfer, tunnel and snippet run at once, so the app
// asks first while any is live (tech-gui.md §4.3). `confirmQuit` persists
// like the other UI prefs (tauri-plugin-store + a localStorage mirror).
const LOCAL_KEY = 'omnyssh-confirm-quit';
const STORE_FILE = 'settings.json';
const STORE_KEY = 'confirmQuit';

function mirrored(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) !== 'false';
  } catch {
    return true; // localStorage unavailable: default to asking.
  }
}

function mirrorLocal(on: boolean): void {
  try {
    localStorage.setItem(LOCAL_KEY, String(on));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(on: boolean): Promise<void> {
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, on);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

function createConfirmQuit() {
  const initial = mirrored();
  const { subscribe, set: setStore } = writable<boolean>(initial);
  let current = initial;
  let interacted = false;

  function apply(on: boolean, user: boolean): Promise<void> {
    current = on;
    setStore(on);
    mirrorLocal(on);
    if (!user) return Promise.resolve();
    interacted = true;
    return persistStore(on);
  }

  return {
    subscribe,
    /** Resolves once saved: "Don't ask again" quits right after, and must not lose it. */
    set: (on: boolean) => apply(on, true),
    toggle: () => void apply(!current, true),
    /** Reconcile with the canonical tauri-plugin-store value once Tauri is reachable. */
    async hydrate(): Promise<void> {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load(STORE_FILE);
        const saved = await store.get<boolean>(STORE_KEY);
        if (!interacted && typeof saved === 'boolean') void apply(saved, false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const confirmQuit = createConfirmQuit();

export interface LiveWork {
  terminals: number;
  transfers: number;
  tunnels: number;
  snippetRuns: number;
}

const LIVE_TUNNEL: TunnelStatusDto['kind'][] = ['connecting', 'up', 'retrying'];

/** What a quit would cut off. An ended terminal tab is only a last screen. */
export function countLiveWork(
  list: Session[],
  sftpSessions: Map<number, SftpSession>,
  tunnelStatuses: Map<string, TunnelStatusDto>,
  run: SnippetRun | null
): LiveWork {
  return {
    terminals: list.filter(
      (s) => s.kind === 'terminal' && (s.status === 'connecting' || s.status === 'connected')
    ).length,
    // A queued upload or download is as good as running: the core works through them in turn.
    transfers: [...sftpSessions.values()].filter(
      (s) => s.transfer || s.pending.some((op) => op.kind === 'upload' || op.kind === 'download')
    ).length,
    tunnels: [...tunnelStatuses.values()].filter((t) => LIVE_TUNNEL.includes(t.kind)).length,
    snippetRuns: run?.entries.some((e) => e.pending) ? 1 : 0
  };
}

/** "2 terminals, 1 transfer and 1 tunnel"; empty when nothing is live. */
export function describeLiveWork(work: LiveWork, currentLocale: Locale = 'en'): string {
  const parts = (
    [
      [work.terminals, 'terminal'],
      [work.transfers, 'transfer'],
      [work.tunnels, 'tunnel'],
      [work.snippetRuns, 'snippet_run']
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, noun]) => translate(
      currentLocale,
      `quit.${noun}_${n === 1 ? 'singular' : 'plural'}` as TranslationKey,
      { count: n }
    ));
  if (parts.length < 2) return parts.join('');
  return translate(currentLocale, 'quit.work_list', {
    first: parts.slice(0, -1).join(currentLocale === 'zh-CN' ? '、' : ', '),
    last: parts.at(-1)!
  });
}

/** The open question's summary, or null when none is open. */
export const quitPrompt = writable<string | null>(null);

/** Opens the question if quitting would cut anything off and the user wants to be asked;
 *  false means quit now. One question at a time: a second request finds it open. */
function askToQuit(): boolean {
  if (get(quitPrompt) !== null) return true;
  if (!get(confirmQuit)) return false;
  const summary = describeLiveWork(
    countLiveWork(get(sessions), get(sftp), get(tunnels), get(snippetRun)),
    get(locale)
  );
  if (!summary) return false;
  quitPrompt.set(summary);
  return true;
}

/** The window's close button, ⌘⇧W, and the tray's or app menu's Quit, which brings the
 *  window out first. Not prevented, Tauri destroys the window and the app exits. */
export async function handleCloseRequested(event: CloseRequestedEvent, win: Window): Promise<void> {
  try {
    // The tray already hid it: that close keeps the app running.
    if (!(await win.isVisible())) return event.preventDefault();
    if (!askToQuit()) return;
    event.preventDefault();
    // A taskbar or dock close reaches a minimized window, and the question has to be seen.
    await win.unminimize();
    await win.setFocus();
  } catch {
    // Never leave a window that cannot be closed: let this one go.
  }
}
