import { writable } from 'svelte/store';
import { translate, type Locale } from '$lib/i18n';
import type { ConnectionStatusDto, HostDto } from '$lib/bindings';
import type { Status } from '$lib/theme';
import { firstOfEachName } from './hosts';
import type { Session } from './sessions';

// The ⌘K overlay and the host-picker are one component in two modes (tech-gui.md §2):
// `navigate` lists open sessions + hosts (jump to a session, or open a host); `pickHost`
// is scoped to "pick a host for this action" and hands the choice back to its caller.
export type PaletteMode = 'navigate' | 'pickHost';

// A selectable row. Sessions and commands surface only in the navigator; the picker is
// host-only.
export type PaletteItem =
  | { kind: 'session'; session: Session }
  | { kind: 'host'; host: HostDto }
  | CommandItem;

type CommandItem = { kind: 'command'; id: 'toggle-streamer'; label: string };

const COMMANDS: CommandItem[] = [{ kind: 'command', id: 'toggle-streamer', label: 'Toggle streamer mode' }];

function hostHaystack(h: HostDto): string {
  return `${h.name} ${h.hostname} ${h.user} ${h.tags.join(' ')}`.toLowerCase();
}

function sessionHaystack(s: Session): string {
  return `${s.hostName} ${s.kind}`.toLowerCase();
}

// All whitespace-separated tokens must appear (AND), so "web prod" narrows to a host
// tagged prod named web-* — an empty query keeps everything.
function matches(haystack: string, query: string): boolean {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** The filtered, ordered rows for the current mode: sessions, hosts, then commands (the
 *  picker keeps only the hosts). Order mirrors the stores so the list is stable. */
export function paletteItems(
  mode: PaletteMode,
  hosts: HostDto[],
  sessions: Session[],
  query: string,
  currentLocale: Locale = 'en'
): PaletteItem[] {
  // One row per name, the first: a session opens a name on its first host, so a second
  // row would open that one too. Deduped before the query, so no search shows the twin.
  const hostRows: PaletteItem[] = firstOfEachName(hosts)
    .filter((h) => matches(hostHaystack(h), query))
    .map((host) => ({ kind: 'host', host }));
  if (mode === 'pickHost') return hostRows;
  const sessionRows: PaletteItem[] = sessions
    .filter((s) => matches(sessionHaystack(s), query))
    .map((session) => ({ kind: 'session', session }));
  const commandRows = COMMANDS.filter((c) =>
    matches(`${c.label} ${translate(currentLocale, 'palette.toggle_streamer')}`.toLowerCase(), query)
  );
  return [...sessionRows, ...hostRows, ...commandRows];
}

/** A stable key for the current result set — its rows' identity and order, but not
 *  volatile fields like a session's live status. The palette resets its highlight only
 *  when this changes, so a background status flip (which mints fresh item objects with
 *  the same ids) never snaps the selection back to the top mid-navigation. */
export function paletteSignature(items: PaletteItem[]): string {
  return items.map(itemKey).join('\u0000');
}

function itemKey(it: PaletteItem): string {
  switch (it.kind) {
    case 'session':
      return `s:${it.session.id}`;
    case 'host':
      return `h:${it.host.name}`;
    case 'command':
      return `c:${it.id}`;
  }
}

/** Move the selection by `delta`, wrapping at both ends; an empty list stays at 0. */
export function nextIndex(current: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return (((current + delta) % length) + length) % length;
}

// A host reference shows its connection state as a dot (tech-gui.md §2, 1.3), mapped to
// the shared server-state palette. Connecting/not-yet-probed stay neutral; a failed
// host reads offline, matching the status-bar summary's offline bucket.
export function hostStatusDot(status: ConnectionStatusDto | undefined): Status {
  switch (status?.kind) {
    case 'connected':
      return 'ok';
    case 'failed':
      return 'off';
    default:
      return 'unknown';
  }
}

export interface PaletteState {
  open: boolean;
  mode: PaletteMode;
}

function createPalette() {
  const { subscribe, set } = writable<PaletteState>({ open: false, mode: 'navigate' });
  // A pending `pickHost()` resolver. Every open/close settles it exactly once so a
  // caller never hangs when the user switches to the navigator or dismisses the picker.
  let pending: ((host: HostDto | null) => void) | null = null;

  function settle(host: HostDto | null): void {
    const resolve = pending;
    pending = null;
    resolve?.(host);
  }

  return {
    subscribe,
    /** ⌘K navigator: jump to an open session or open a host. */
    open(): void {
      settle(null);
      set({ open: true, mode: 'navigate' });
    },
    /** Action-scoped host picker; resolves with the chosen host, or null if dismissed. */
    pickHost(): Promise<HostDto | null> {
      settle(null);
      set({ open: true, mode: 'pickHost' });
      return new Promise((resolve) => (pending = resolve));
    },
    /** Picker mode: hand the chosen host back to the caller and close. */
    choose(host: HostDto): void {
      settle(host);
      set({ open: false, mode: 'navigate' });
    },
    close(): void {
      settle(null);
      set({ open: false, mode: 'navigate' });
    }
  };
}

export const palette = createPalette();
