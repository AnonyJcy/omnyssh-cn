import { writable } from 'svelte/store';
import type { TunnelStatusDto } from '$lib/bindings';

/** Latest tunnel status per host, keyed by host name; a host with no entry has no
 *  tunnel running (tech-gui.md §3.5). */
export const tunnels = writable<Map<string, TunnelStatusDto>>(new Map());
