import { derived, writable } from 'svelte/store';
import type { HostDto } from '$lib/bindings';
import { hosts } from './hosts';

// Streamer mode: a privacy pref that swaps real host addresses in the UI for
// deterministic fake-but-realistic ones, so IPs never appear on screen while recording.
// It is a pure display transform — the real address still drives every connection. The
// pref persists like the other UI-chrome prefs (tauri-plugin-store + a localStorage
// mirror for first paint, tech-gui.md §4.3), matching the sidebar-collapse shape.
const LOCAL_KEY = 'omnyssh-streamer-mode';
const STORE_FILE = 'settings.json';
const STORE_KEY = 'streamerMode';

function mirrored(): boolean {
  try {
    return localStorage.getItem(LOCAL_KEY) === 'true';
  } catch {
    return false; // localStorage unavailable: default to off.
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

function createStreamerMode() {
  const initial = mirrored();
  const { subscribe, set: setStore } = writable<boolean>(initial);
  let current = initial;
  let interacted = false;

  function apply(on: boolean, user: boolean): void {
    current = on;
    setStore(on);
    mirrorLocal(on);
    if (user) {
      interacted = true;
      void persistStore(on);
    }
  }

  return {
    subscribe,
    set: (on: boolean) => apply(on, true),
    toggle: () => apply(!current, true),
    /** Reconcile with the canonical tauri-plugin-store value once Tauri is reachable. */
    async hydrate(): Promise<void> {
      try {
        const { load } = await import('@tauri-apps/plugin-store');
        const store = await load(STORE_FILE);
        const saved = await store.get<boolean>(STORE_KEY);
        if (!interacted && typeof saved === 'boolean') apply(saved, false);
      } catch {
        // Store unreachable: keep the mirrored value.
      }
    }
  };
}

export const streamerMode = createStreamerMode();

// --- Address masking (pure, deterministic) --------------------------------------

// A 32-bit FNV-1a-style hash (via Math.imul) so a host always maps to the same
// disguised address for the whole session — stable across cards, the palette, and
// refreshes. Salted so each octet/segment derives an independent value.
function hash(seed: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// First octets that read as real public space, so the disguise never looks private/local.
const PUBLIC_FIRST_OCTET = [
  23, 45, 51, 62, 72, 84, 91, 103, 116, 128, 139, 146, 151, 167, 178, 185, 193, 201, 209, 217
];

// Pseudo-words for disguised domains; a real-looking hostname label.
const DOMAIN_WORDS = [
  'nova', 'atlas', 'harbor', 'quartz', 'vertex', 'cobalt', 'summit', 'delta', 'onyx',
  'cedar', 'orbit', 'flux', 'ridge', 'pixel', 'crimson', 'zephyr'
];

function isIpv4(host: string): boolean {
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function fakeIpv4(host: string): string {
  const first = PUBLIC_FIRST_OCTET[hash(host, 1) % PUBLIC_FIRST_OCTET.length];
  const b = hash(host, 2) % 256;
  const c = hash(host, 3) % 256;
  const d = 1 + (hash(host, 4) % 254); // 1..254 — skip .0 and .255
  return `${first}.${b}.${c}.${d}`;
}

function fakeIpv6(host: string): string {
  const g = (salt: number): string => (hash(host, salt) & 0xffff).toString(16).padStart(4, '0');
  return `2a02:${g(1)}:${g(2)}::${g(3)}`;
}

function fakeDomain(host: string): string {
  const labels = host.split('.');
  const tld = labels.length > 1 ? labels[labels.length - 1] : 'net';
  const word = DOMAIN_WORDS[hash(host, 5) % DOMAIN_WORDS.length];
  const n = hash(host, 6) % 100;
  return `${word}${n}.${tld}`;
}

/** A disguised address for `hostname`: masks IP and hostnames to 127.0.0.1 (or ::1 for IPv6). */
export function maskHostname(hostname: string): string {
  const h = hostname.trim();
  if (!h) return hostname;
  if (h.includes(':')) return '::1';
  return '127.0.0.1';
}

/** The address to render for a host: disguised when streamer mode is on, else the real one. */
export function displayHostname(hostname: string, streamerOn: boolean): string {
  return streamerOn ? maskHostname(hostname) : hostname;
}

function looksLikeHostOrIp(str: string): boolean {
  if (isIpv4(str) || str.includes(':')) return true;
  if (str.includes('.') && !str.includes(' ') && /^[a-zA-Z0-9.-]+$/.test(str)) return true;
  return false;
}

/** Masks a username for streamer/privacy mode to 'admin'. */
export function maskUser(user: string): string {
  const u = user.trim();
  if (!u) return user;
  return 'admin';
}

/** The username to render: disguised when streamer mode is on, else the real one. */
export function displayUser(user: string, streamerOn: boolean): string {
  return streamerOn ? maskUser(user) : user;
}

/** The host title/name to render: disguised when streamer mode is on and the name is an IP/hostname/domain or matches the host address. */
export function displayHostTitle(name: string, streamerOn: boolean, hostname?: string): string {
  if (!streamerOn) return name;
  const n = name.trim();
  if (!n) return name;
  if (looksLikeHostOrIp(n) || (hostname && n.toLowerCase() === hostname.trim().toLowerCase())) {
    return maskHostname(n);
  }
  return name;
}

// Loopback and wildcard addresses reveal nothing, and read wrong disguised.
export const REVEALS_NOTHING = /^(localhost|127(\.\d{1,3}){3}|::1|\*|0\.0\.0\.0|::)$/i;

/** `address` disguised like a host address, unless it reveals nothing. */
export function maskAddress(address: string): string {
  return REVEALS_NOTHING.test(address.trim()) ? address : maskHostname(address);
}

// --- Masking free text ------------------------------------------------------------

// A name with no dot or colon (`backup`) is also an ordinary word, so it is matched only
// in its exact stored spelling: "Backup restored." stays readable.
const singleLabel = (address: string): boolean => !/[.:]/.test(address);

/** Every address the host list knows (hostnames and forward ends), trimmed, deduped
 *  exactly so each spelling keeps its own card's disguise, in first-seen order, and
 *  longest first so a name is never cut short by a shorter one it starts with. */
export function knownAddresses(list: HostDto[]): string[] {
  const seen = new Set<string>();
  for (const h of list) {
    const ends = h.localForwards.flatMap((f) => [f.remoteHost, f.bindAddress ?? '']);
    for (const raw of [h.hostname, ...ends]) {
      const a = raw.trim();
      if (a && !REVEALS_NOTHING.test(a)) seen.add(a);
    }
  }
  return [...seen].sort((a, b) => b.length - a.length);
}

const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IPV4 = String.raw`${OCTET}(?:\.${OCTET}){3}`;
const HEX = '[0-9a-fA-F]{1,4}';
const HEXES = `${HEX}(?::${HEX}){0,6}`;
// All eight groups, or compressed with `::`: a time (12:30:45), a MAC or a forward's
// `port:host:port` never reads as one. An embedded IPv4 tail is tried first, or the match
// would stop short of it and leave the real prefix.
const IPV6 =
  `(?:${HEX}:){6}${IPV4}|(?:${HEXES})?::(?:${HEX}:){0,5}${IPV4}|` +
  `(?:${HEX}:){7}${HEX}|(?:${HEXES})?::(?:${HEXES})?`;
// A token stands alone: not inside a word, a path or a base64 fingerprint. A dot ends it
// only when no word follows, so `10.0.0.1.5` is not `10.0.0.1` and `nas.local` not `nas`.
const START = String.raw`(^|[^\w.+/\\-])`;
const END = String.raw`(?=$|[^\w.+-]|\.(?!\w))`;
const DOMAIN = String.raw`[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+`;
// Where the core names a ProxyJump hop or a tunnelled target, which no host entry may
// know: a dotted name there is masked, a single-label alias stays readable.
const HOP = `ProxyJump (?:via|hop|cycle detected at) '|connecting via '|open tunnel to `;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Either case without the `i` flag, which would fold single-label names too.
const caseless = (s: string): string => s.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);

/** Disguises every address in `text`: the known names (each to the exact disguise its
 *  card shows; single-label ones only as stored, the rest in any case, an unknown case
 *  variant as the first spelling seen), IPv4 and IPv6 literals, the domain of a
 *  `user@domain`, and a dotted name where the core names a ProxyJump hop. Ports,
 *  brackets and quotes around an address stay, and so do loopback and wildcards,
 *  fingerprints, versions and paths. One pass, so no disguise is masked again. No
 *  lookbehind, which older WKWebView rejects: the text before a token is captured and
 *  written back. */
export function addressMasker(known: readonly string[]): (text: string) => string {
  const exact = new Set(known);
  const firstSeen = new Map<string, string>();
  for (const k of known) if (!singleLabel(k) && !firstSeen.has(k.toLowerCase())) firstSeen.set(k.toLowerCase(), k);
  // One caseless pattern per dotted name; which spelling it was is settled after the match.
  const names = known
    .filter((k) => singleLabel(k) || firstSeen.get(k.toLowerCase()) === k)
    .map((k) => (singleLabel(k) ? escapeRegExp(k) : caseless(escapeRegExp(k))));
  const token = [...names, IPV4, IPV6].join('|');
  // Known names and literals come before DOMAIN after a hop, so they keep their disguise.
  const re = new RegExp(`${START}(${token})${END}|(${HOP})(${token}|${DOMAIN})${END}|@(${DOMAIN})${END}`, 'g');
  const disguise = (a: string): string => maskAddress(exact.has(a) ? a : (firstSeen.get(a.toLowerCase()) ?? a));
  return (text) =>
    text.replace(re, (_, pre?: string, address?: string, hop?: string, hopAddress?: string, domain?: string) => {
      if (address !== undefined) return `${pre}${disguise(address)}`;
      if (hopAddress !== undefined) return `${hop}${disguise(hopAddress)}`;
      return `@${maskAddress(domain ?? '')}`;
    });
}

/** Masks the addresses in error text while streamer mode is on, else returns it as is.
 *  Applied at render, so flipping the mode re-renders what is already on screen. */
export const maskText = derived([streamerMode, hosts], ([on, list]) =>
  on ? addressMasker(knownAddresses(list)) : (text: string) => text
);
