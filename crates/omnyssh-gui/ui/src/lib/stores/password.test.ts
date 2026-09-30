import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { displayLogin, passwordPrompt, passwordQueue, settlePassword } from './password';

const sftp = { requestId: 1, hostName: 'nas', login: 'admin@10.0.0.5', retry: false, newHostKey: null };
const terminal = { requestId: 2, hostName: 'db', login: 'root@10.0.0.6', retry: false, newHostKey: null };

describe('password prompt queue', () => {
  beforeEach(() => passwordQueue.set([]));

  it('shows the oldest waiting login, then the next once it is settled', () => {
    passwordQueue.set([sftp, terminal]);
    expect(get(passwordPrompt)).toEqual(sftp);

    settlePassword(sftp.requestId);
    expect(get(passwordPrompt)).toEqual(terminal);

    settlePassword(terminal.requestId);
    expect(get(passwordPrompt)).toBeNull();
  });

  it('settling a request nobody shows changes nothing', () => {
    passwordQueue.set([sftp]);
    settlePassword(99);
    expect(get(passwordQueue)).toEqual([sftp]);
  });
});

describe('displayLogin', () => {
  it('keeps the user and masks only the host in streamer mode', () => {
    expect(displayLogin('root@10.0.0.5', false)).toBe('root@10.0.0.5');
    const masked = displayLogin('root@10.0.0.5', true);
    expect(masked.startsWith('root@')).toBe(true);
    expect(masked).not.toContain('10.0.0.5');
  });
});
