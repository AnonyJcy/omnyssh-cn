import { writable } from 'svelte/store';
import type { SnippetDto, SnippetResult } from '$lib/bindings';

// Saved snippets, mirroring `snippets.toml` (tech-gui.md §2.2). Refreshed from
// `list_snippets` after every mutation so the store never drifts from the shared
// on-disk source of truth (the same file the TUI reads/writes).
export const snippets = writable<SnippetDto[]>([]);

/** One target host's slot in a running snippet's results panel. */
export interface SnippetResultEntry {
  hostName: string;
  /** True until the host's `snippet-result` arrives. */
  pending: boolean;
  ok: boolean;
  output: string;
}

/** The in-flight (or just-finished) execution the results panel renders. */
export interface SnippetRun {
  snippetName: string;
  entries: SnippetResultEntry[];
  /** The panel was closed with hosts still running: kept, out of sight, so a quit
   *  still asks about it, and dropped once the last host reports. */
  dismissed?: boolean;
}

// The active execution, or null when there is none (tech-gui.md §2.2).
export const snippetRun = writable<SnippetRun | null>(null);

// A dismissed run has nothing left to show once no host is pending.
function settle(run: SnippetRun): SnippetRun | null {
  return run.dismissed && !run.entries.some((e) => e.pending) ? null : run;
}

/** Seed a run with one pending entry per target host — called the moment execute
 *  fires, so every host shows as pending before its result streams back. */
export function beginRun(snippetName: string, hostNames: string[]): void {
  snippetRun.set({
    snippetName,
    entries: hostNames.map((hostName) => ({ hostName, pending: true, ok: false, output: '' }))
  });
}

/** Dismiss the results panel. The core keeps running whatever is still pending. */
export function clearRun(): void {
  snippetRun.update((run) => (run ? settle({ ...run, dismissed: true }) : run));
}

/** Mark every still-pending entry of the active run as failed. Used when the execute
 *  command itself rejects, so no per-host results will arrive and the panel would
 *  otherwise stay stuck on "Running…". */
export function failPendingRun(errorMessage: string): void {
  snippetRun.update((run) =>
    run
      ? settle({
          ...run,
          entries: run.entries.map((e) =>
            e.pending ? { hostName: e.hostName, pending: false, ok: false, output: errorMessage } : e
          )
        })
      : run
  );
}

/** Fold a `snippet-result` into the active run, filling the matching host's entry.
 *  A result for a different snippet (name mismatch) or a host not in the run is
 *  ignored. A late result from a prior run of the *same* snippet+host can still land
 *  (the event carries no run id, §4.3) — harmless, as it re-reports the same command
 *  on the same host. Pure, so the router and the tests share one definition. */
export function reduceRunResult(run: SnippetRun | null, payload: SnippetResult): SnippetRun | null {
  if (!run || run.snippetName !== payload.snippetName) return run;
  return settle({
    ...run,
    entries: run.entries.map((e) =>
      e.hostName === payload.hostName
        ? { hostName: e.hostName, pending: false, ok: payload.ok, output: payload.output }
        : e
    )
  });
}
