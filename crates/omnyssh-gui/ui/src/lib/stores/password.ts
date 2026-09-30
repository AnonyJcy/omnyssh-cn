import { derived, writable } from 'svelte/store';
import type { PasswordRequired } from '$lib/bindings';
import { displayHostname } from './streamer';

// Logins waiting for a password, oldest first. The dialog shows the first; each
// request is its own connection, so none is folded into another.
export const passwordQueue = writable<PasswordRequired[]>([]);

export const passwordPrompt = derived(passwordQueue, (queue) => queue[0] ?? null);

/** Drop the prompt `requestId`: answered, cancelled, or no longer waited on. */
export function settlePassword(requestId: number): void {
  passwordQueue.update((queue) => queue.filter((p) => p.requestId !== requestId));
}

/** `user@host` as the dialog shows it: the host masked in streamer mode. */
export function displayLogin(login: string, streamerOn: boolean): string {
  const at = login.lastIndexOf('@');
  return `${login.slice(0, at + 1)}${displayHostname(login.slice(at + 1), streamerOn)}`;
}
