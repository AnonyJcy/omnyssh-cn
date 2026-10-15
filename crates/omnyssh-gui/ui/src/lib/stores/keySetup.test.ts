import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { KeySetupStepDto } from '$lib/bindings';
import {
  beginKeySetup,
  dismissKeySetup,
  keyFilePath,
  keySetup,
  reduceComplete,
  reduceFailed,
  reduceProgress,
  reduceRollback,
  type KeySetupRun
} from './keySetup';

function step(index: number, description = 'Working'): KeySetupStepDto {
  return { index, total: 6, description };
}

describe('key-setup run lifecycle', () => {
  beforeEach(() => dismissKeySetup());

  it('beginKeySetup opens a running panel with no step yet', () => {
    beginKeySetup('web-1');
    expect(get(keySetup)).toEqual({ hostName: 'web-1', phase: { kind: 'running', step: null } });
  });

  it('dismiss clears the panel', () => {
    beginKeySetup('web-1');
    dismissKeySetup();
    expect(get(keySetup)).toBeNull();
  });
});

describe('reduceProgress', () => {
  const running: KeySetupRun = { hostName: 'web-1', phase: { kind: 'running', step: null } };

  it('advances the active host run to the reported step', () => {
    const s = step(3, 'Verifying key authentication');
    expect(reduceProgress(running, 'web-1', s)).toEqual({
      hostName: 'web-1',
      phase: { kind: 'running', step: s }
    });
  });

  it('ignores progress for a different host (single active run)', () => {
    // A stray step for another host must not hijack the active panel.
    expect(reduceProgress(running, 'db-9', step(2))).toBe(running);
  });

  it('ignores progress when no run is active', () => {
    expect(reduceProgress(null, 'web-1', step(1))).toBeNull();
  });

  it('never turns an outcome back into a running panel', () => {
    const done: KeySetupRun = {
      hostName: 'web-1',
      phase: { kind: 'complete', keyPath: '/k', passwordOff: true }
    };
    const failed: KeySetupRun = {
      hostName: 'web-1',
      phase: { kind: 'failed', error: 'x', passwordMayBeOff: true }
    };
    // A late step must not hide the outcome, least of all a may-be-off failure.
    expect(reduceProgress(done, 'web-1', step(4))).toBe(done);
    expect(reduceProgress(failed, 'web-1', step(5))).toBe(failed);
    expect(reduceProgress(done, 'db-9', step(4))).toBe(done);
  });
});

describe('terminal reducers', () => {
  it('reduceComplete carries the key path and whether password login is off', () => {
    expect(reduceComplete('web-1', '/home/me/.ssh/omnyssh_web-1_ed25519', false)).toEqual({
      hostName: 'web-1',
      phase: { kind: 'complete', keyPath: '/home/me/.ssh/omnyssh_web-1_ed25519', passwordOff: false }
    });
  });

  it('reduceFailed carries the error and whether password login may be off', () => {
    expect(reduceFailed('web-1', 'Connection failed', true)).toEqual({
      hostName: 'web-1',
      phase: { kind: 'failed', error: 'Connection failed', passwordMayBeOff: true }
    });
  });

  it('reduceRollback carries the rollback result', () => {
    expect(reduceRollback('web-1', 'Restored password auth.')).toEqual({
      hostName: 'web-1',
      phase: { kind: 'rolledBack', result: 'Restored password auth.' }
    });
  });
});

describe('keyFilePath', () => {
  // Pinned to the core's `sanitize_hostname` on the same inputs.
  it.each([
    ['web-prod_1', 'web-prod_1'],
    ['web.1', 'web_1'],
    ['Ελλάδα.prod-1', 'Ελλάδα_prod-1'],
    ['日本語', '日本語'],
    ['db²½Ⅻ', 'db²½Ⅻ'],
    ['my server (prod)', 'my_server__prod_'],
    ['../../etc/passwd', '______etc_passwd'],
    ['😀db', '_db'],
    ['e\u0301x', 'e_x'],
    ['', 'unnamed_host']
  ])('sanitizes %j to %s', (name, sanitized) => {
    expect(keyFilePath(name, false)).toBe(`~/.ssh/omnyssh_${sanitized}_ed25519`);
  });

  it('cuts the name to 64 code points', () => {
    expect(keyFilePath('λ'.repeat(70), false)).toBe(`~/.ssh/omnyssh_${'λ'.repeat(64)}_ed25519`);
  });

  it('shows the Windows profile folder on Windows', () => {
    expect(keyFilePath('web.1', true)).toBe('%USERPROFILE%\\.ssh\\omnyssh_web_1_ed25519');
  });
});
