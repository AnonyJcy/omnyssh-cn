import { writable } from 'svelte/store';

// Open modal dialogs, oldest first. Only the newest answers Escape, and a
// terminal takes the keyboard only while none is open.
export const dialogs = writable<symbol[]>([]);
