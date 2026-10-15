import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { SnippetResult } from '$lib/bindings';
import {
  beginRun,
  clearRun,
  failPendingRun,
  reduceRunResult,
  snippetRun,
  type SnippetRun
} from './snippets';

function result(partial: Partial<SnippetResult>): SnippetResult {
  return { hostName: 'web-1', snippetName: 'deploy', ok: true, output: 'done', ...partial };
}

describe('snippet run lifecycle', () => {
  beforeEach(() => snippetRun.set(null));

  it('beginRun seeds one pending entry per host', () => {
    beginRun('deploy', ['web-1', 'web-2']);
    const run = get(snippetRun);
    expect(run?.snippetName).toBe('deploy');
    expect(run?.entries).toEqual([
      { hostName: 'web-1', pending: true, ok: false, output: '' },
      { hostName: 'web-2', pending: true, ok: false, output: '' }
    ]);
  });

  it('clearRun dismisses a finished run', () => {
    beginRun('deploy', ['web-1']);
    reduceRunResultInto(result({}));
    clearRun();
    expect(get(snippetRun)).toBeNull();
  });

  it('clearRun keeps a run with hosts pending out of sight until the last one reports', () => {
    beginRun('deploy', ['web-1', 'web-2']);
    reduceRunResultInto(result({ hostName: 'web-1' }));
    clearRun();
    expect(get(snippetRun)).toMatchObject({ dismissed: true });
    expect(get(snippetRun)?.entries[1].pending).toBe(true);

    reduceRunResultInto(result({ hostName: 'web-2' }));
    expect(get(snippetRun)).toBeNull();
  });

  it('a dismissed run goes once the execute command fails, and a new run starts fresh', () => {
    beginRun('deploy', ['web-1']);
    clearRun();
    failPendingRun('boom');
    expect(get(snippetRun)).toBeNull();

    beginRun('deploy', ['web-1']);
    clearRun();
    beginRun('other', ['web-2']);
    expect(get(snippetRun)?.dismissed).toBeUndefined();
    expect(get(snippetRun)?.snippetName).toBe('other');
  });

  it('failPendingRun fails only the still-pending entries', () => {
    beginRun('deploy', ['web-1', 'web-2']);
    reduceRunResultInto({ hostName: 'web-1', snippetName: 'deploy', ok: true, output: 'done' });
    failPendingRun('command failed');

    const run = get(snippetRun);
    // web-1 already resolved — left intact; web-2 was pending — now failed.
    expect(run?.entries[0]).toEqual({ hostName: 'web-1', pending: false, ok: true, output: 'done' });
    expect(run?.entries[1]).toEqual({ hostName: 'web-2', pending: false, ok: false, output: 'command failed' });
  });

  it('failPendingRun is a no-op with no active run', () => {
    clearRun();
    failPendingRun('boom');
    expect(get(snippetRun)).toBeNull();
  });
});

function reduceRunResultInto(payload: SnippetResult): void {
  snippetRun.update((run) => reduceRunResult(run, payload));
}

describe('reduceRunResult', () => {
  const base: SnippetRun = {
    snippetName: 'deploy',
    entries: [
      { hostName: 'web-1', pending: true, ok: false, output: '' },
      { hostName: 'web-2', pending: true, ok: false, output: '' }
    ]
  };

  it('fills the matching host entry and clears its pending flag', () => {
    const next = reduceRunResult(base, result({ hostName: 'web-1', ok: true, output: 'hi' }));
    expect(next?.entries[0]).toEqual({ hostName: 'web-1', pending: false, ok: true, output: 'hi' });
    // The other host stays pending.
    expect(next?.entries[1].pending).toBe(true);
  });

  it('records a failure output', () => {
    const next = reduceRunResult(base, result({ hostName: 'web-2', ok: false, output: 'boom' }));
    expect(next?.entries[1]).toEqual({ hostName: 'web-2', pending: false, ok: false, output: 'boom' });
  });

  it('ignores a result for a different snippet (stale run)', () => {
    const next = reduceRunResult(base, result({ snippetName: 'other', hostName: 'web-1' }));
    expect(next).toBe(base);
  });

  it('ignores a result for a host not in the run', () => {
    const next = reduceRunResult(base, result({ hostName: 'db-9' }));
    expect(next?.entries).toEqual(base.entries);
  });

  it('is a no-op when no run is active', () => {
    expect(reduceRunResult(null, result({}))).toBeNull();
  });
});
