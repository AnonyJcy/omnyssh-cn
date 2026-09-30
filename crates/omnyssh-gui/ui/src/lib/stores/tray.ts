import { writable } from 'svelte/store';
import type { TraySupportDto } from '$lib/bindings';

// Minimize and close to the system tray. A UI pref persisted like the others
// (tauri-plugin-store + a localStorage mirror for first paint, tech-gui.md §4.3); the
// backend acts on it only once `set_tray_behavior` hands it over, which `driveTray`
// does on start and on every change.
export interface TrayBehavior {
  minimizeToTray: boolean;
  closeToTray: boolean;
}

const LOCAL_KEY = 'omnyssh-tray';
const STORE_FILE = 'settings.json';
const STORE_KEY = 'tray';
const OFF: TrayBehavior = { minimizeToTray: false, closeToTray: false };

/** Read a stored value leniently: anything but a literal `true` is off. */
export function readBehavior(value: unknown): TrayBehavior {
  const v = (value ?? {}) as Partial<Record<keyof TrayBehavior, unknown>>;
  return { minimizeToTray: v.minimizeToTray === true, closeToTray: v.closeToTray === true };
}

function mirrored(): TrayBehavior {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw == null ? OFF : readBehavior(JSON.parse(raw));
  } catch {
    return OFF;
  }
}

function mirrorLocal(behavior: TrayBehavior): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(behavior));
  } catch {
    // localStorage unavailable (hardened webview): the store copy is canonical.
  }
}

async function persistStore(behavior: TrayBehavior): Promise<void> {
  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, behavior);
    await store.save();
  } catch {
    // Not under Tauri (tests, vite preview): the localStorage mirror suffices.
  }
}

function createTrayBehavior() {
  const initial = mirrored();
  const { subscribe, set: setStore } = writable<TrayBehavior>(initial);
  let current = initial;
  let interacted = false;

  function apply(behavior: TrayBehavior, user: boolean): void {
    current = behavior;
    setStore(behavior);
    mirrorLocal(behavior);
    if (user) {
      interacted = true;
      void persistStore(behavior);
    }
  }

  return {
    subscribe,
    /** Change one or both settings, as the user did. */
    update: (change: Partial<TrayBehavior>) => apply({ ...current, ...change }, true),
    /** Reconcile with the canonical tauri-plugin-store value once Tauri is reachable. */
    async hydrate(): Promise<void> {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load(STORE_FILE);
        const saved = await store.get<unknown>(STORE_KEY);
        if (!interacted && saved !== undefined) apply(readBehavior(saved), false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const trayBehavior = createTrayBehavior();

/** What this desktop allows the tray, as the backend last said. Assumed until it
 *  answers, so the settings do not flash a warning on every open. */
export const traySupport = writable<TraySupportDto>({ available: true, minimize: true });

/** Hand every value of the pref to the backend, which reports whether the tray exists.
 *  Returns a disposer. The command is passed in so this stays unit-testable. */
export function driveTray(
  apply: (behavior: TrayBehavior) => Promise<TraySupportDto>,
  onError: (message: string) => void
): () => void {
  // One call at a time, in order: two in flight could land the other way round and
  // leave the backend on an older value than the switches show.
  let chain: Promise<void> = Promise.resolve();
  return trayBehavior.subscribe((behavior) => {
    chain = chain.then(() =>
      apply(behavior).then(
        (support) => traySupport.set(support),
        (e) => {
          // No icon came up, so the window has nothing to hide into.
          traySupport.set({ available: false, minimize: false });
          onError(e instanceof Error ? e.message : String(e));
        }
      )
    );
  });
}
