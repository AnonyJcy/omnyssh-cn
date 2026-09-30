import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { driveTray, readBehavior, traySupport, trayBehavior, type TrayBehavior } from './tray';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('readBehavior', () => {
  it('reads a stored pref, and anything unexpected as off', () => {
    expect(readBehavior({ minimizeToTray: true, closeToTray: false })).toEqual({
      minimizeToTray: true,
      closeToTray: false
    });
    for (const junk of [undefined, null, 'yes', 1, { closeToTray: 'true' }]) {
      expect(readBehavior(junk)).toEqual({ minimizeToTray: false, closeToTray: false });
    }
  });
});

describe('driveTray', () => {
  it('hands every value to the backend and keeps what it says about the tray', async () => {
    const sent: TrayBehavior[] = [];
    let support = { available: true, minimize: true };
    const stop = driveTray(
      (b) => {
        sent.push(b);
        return Promise.resolve(support);
      },
      () => {}
    );
    // The current value goes over on start, so a relaunch restores the behaviour.
    await flush();
    expect(sent).toEqual([{ minimizeToTray: false, closeToTray: false }]);

    support = { available: true, minimize: false };
    trayBehavior.update({ closeToTray: true });
    await flush();
    expect(sent.at(-1)).toEqual({ minimizeToTray: false, closeToTray: true });
    expect(get(traySupport)).toEqual({ available: true, minimize: false });

    stop();
    trayBehavior.update({ minimizeToTray: true });
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('reports a failure, and shows the tray as unavailable after one', async () => {
    traySupport.set({ available: true, minimize: true });
    const errors: string[] = [];
    const stop = driveTray(
      () => Promise.reject(new Error('Could not add the tray icon: boom')),
      (m) => errors.push(m)
    );
    await flush();
    expect(errors).toEqual(['Could not add the tray icon: boom']);
    expect(get(traySupport)).toEqual({ available: false, minimize: false });
    stop();
  });

  it('sends one value at a time, in the order they were set', async () => {
    const started: boolean[] = [];
    const pending: (() => void)[] = [];
    const stop = driveTray(
      (b) => {
        started.push(b.closeToTray);
        return new Promise((resolve) =>
          pending.push(() => resolve({ available: true, minimize: true }))
        );
      },
      () => {}
    );
    trayBehavior.update({ closeToTray: false });
    trayBehavior.update({ closeToTray: true });
    await flush();
    // The start value is in flight; the two changes wait for it, then go in turn.
    expect(started).toHaveLength(1);
    pending.shift()!();
    await flush();
    expect(started).toHaveLength(2);
    pending.shift()!();
    await flush();
    expect(started.slice(1)).toEqual([false, true]);
    pending.shift()!();
    stop();
  });
});
