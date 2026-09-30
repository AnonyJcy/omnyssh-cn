import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  enqueuePassphrase,
  passphrasePrompt,
  passphraseQueue,
  settlePassphrase
} from './passphrase';

const web = { hostName: 'web-1', keyPath: '/home/me/.ssh/id_ed25519' };
const db = { hostName: 'db-1', keyPath: '/home/me/.ssh/other' };

describe('passphrase prompt queue', () => {
  beforeEach(() => passphraseQueue.set([]));

  it('queues one prompt per key, oldest first', () => {
    let queue = enqueuePassphrase([], web);
    queue = enqueuePassphrase(queue, db);
    // Another host on the same key is served by the same unlock.
    queue = enqueuePassphrase(queue, { hostName: 'web-2', keyPath: web.keyPath });
    expect(queue).toEqual([web, db]);
  });

  it('shows the first waiting key, then the next once it is settled', () => {
    passphraseQueue.set([web, db]);
    expect(get(passphrasePrompt)).toEqual(web);

    settlePassphrase(web.keyPath);
    expect(get(passphrasePrompt)).toEqual(db);

    settlePassphrase(db.keyPath);
    expect(get(passphrasePrompt)).toBeNull();
  });
});
