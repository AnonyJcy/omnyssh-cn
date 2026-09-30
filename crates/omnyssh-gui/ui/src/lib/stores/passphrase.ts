import { derived, writable } from 'svelte/store';
import type { KeyPassphraseRequired } from '$lib/bindings';

// Encrypted keys waiting for a passphrase, oldest first, one entry per key: every
// host sharing a key is served by one unlock. The dialog shows the first.
export const passphraseQueue = writable<KeyPassphraseRequired[]>([]);

export const passphrasePrompt = derived(passphraseQueue, (queue) => queue[0] ?? null);

/** Queue a prompt unless its key is already waiting. Pure so the router can test it. */
export function enqueuePassphrase(
  queue: KeyPassphraseRequired[],
  next: KeyPassphraseRequired
): KeyPassphraseRequired[] {
  return queue.some((p) => p.keyPath === next.keyPath) ? queue : [...queue, next];
}

/** Drop the prompt for `keyPath`, whether it was unlocked or dismissed. */
export function settlePassphrase(keyPath: string): void {
  passphraseQueue.update((queue) => queue.filter((p) => p.keyPath !== keyPath));
}
