// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { HostDto } from '$lib/bindings';
import { addressMasker, displayHostname, knownAddresses, maskHostname, maskUser, displayUser, displayHostTitle } from './streamer';

// Streamer mode disguises host addresses on screen (tech-gui.md §4.3). The mask must be
// deterministic (same host → same disguise all recording), never leak the real value,
// and keep the address shape so cards still read like real servers.
describe('address masking', () => {
  it('is deterministic for a given host', () => {
    expect(maskHostname('203.0.113.7')).toBe('127.0.0.1');
    expect(maskHostname('db.example.com')).toBe('127.0.0.1');
  });

  it('maps an IPv4 to 127.0.0.1', () => {
    expect(maskHostname('192.168.1.10')).toBe('127.0.0.1');
    expect(maskHostname('47.100.20.30')).toBe('127.0.0.1');
  });

  it('maps an IPv6 to ::1', () => {
    expect(maskHostname('2001:db8::1')).toBe('::1');
  });

  it('displayHostname passes through when streamer mode is off', () => {
    expect(displayHostname('203.0.113.7', false)).toBe('203.0.113.7');
    expect(displayHostname('203.0.113.7', true)).toBe('127.0.0.1');
  });

  it('masks username to admin in streamer mode', () => {
    expect(maskUser('root')).toBe('admin');
    expect(maskUser('ubuntu')).toBe('admin');
    expect(displayUser('root', false)).toBe('root');
    expect(displayUser('root', true)).toBe('admin');
  });

  it('disguises host title when matching IP or hostname, preserves custom aliases', () => {
    expect(displayHostTitle('47.100.20.30', false)).toBe('47.100.20.30');
    expect(displayHostTitle('47.100.20.30', true)).toBe('127.0.0.1');
    expect(displayHostTitle('my-host', true, 'my-host')).toBe('127.0.0.1');
    expect(displayHostTitle('生产服务器', true, '47.100.20.30')).toBe('生产服务器');
  });
});

function host(hostname: string, localForwards: HostDto['localForwards'] = []): HostDto {
  return {
    name: hostname,
    hostname,
    user: 'deploy',
    port: 22,
    tags: [],
    source: 'manual',
    hasKey: false,
    monitoring: 'ssh',
    localForwards,
    tunnelAutostart: false,
    forwardAgent: false
  };
}

// Error text reaches the status bar verbatim from the core, so the masker has to find
// addresses in the core's own message shapes and leave everything else readable.
describe('masking addresses in text', () => {
  const HOSTS = [
    host('db.example.com', [{ bindPort: 8080, remoteHost: '10.20.3.7', remotePort: 5432 }]),
    host('2001:db8::1'),
    host('nas'),
    host('203.0.113.7')
  ];
  const mask = addressMasker(knownAddresses(HOSTS));
  const m = maskHostname;

  it('collects hostnames and forward ends, deduped, longest first, without loopback', () => {
    const list = knownAddresses([
      ...HOSTS,
      host('DB.Example.com', [{ bindAddress: '0.0.0.0', bindPort: 1, remoteHost: 'localhost', remotePort: 2 }]),
      host(' db.example.com '),
      host('  ')
    ]);
    expect(list).toEqual(['db.example.com', 'DB.Example.com', '2001:db8::1', '203.0.113.7', '10.20.3.7', 'nas']);
  });

  it('gives each case spelling of a dotted name its own card disguise', () => {
    const list = [host('db.example.com'), host('DB.Example.COM')];
    expect(knownAddresses(list)).toEqual(['db.example.com', 'DB.Example.COM']);
    const words = addressMasker(knownAddresses(list));
    for (const h of list) expect(words(`${h.hostname} refused`)).toBe(`${m(h.hostname)} refused`);
    // A spelling no card has takes the first one seen.
    expect(words('Db.Example.Com refused')).toBe(`${m('db.example.com')} refused`);
  });

  it('masks a dotted ProxyJump hop no host knows, in the core wordings', () => {
    const hop = 'jump.corp.example.com';
    const cases = [
      `ProxyJump via '${hop}' failed: SSH connection timed out (10 s)`,
      `connecting via '${hop}' failed: refused`,
      `unusable ProxyJump hop '${hop}:abc': invalid port`,
      `ProxyJump cycle detected at '${hop}'`,
      `ProxyJump via 'bastion' failed: open tunnel to ${hop}:22: refused`
    ];
    for (const text of cases) expect(mask(text)).toBe(text.replace(hop, m(hop)));
  });

  it('keeps a single-label hop readable and a known hop or literal as its card shows it', () => {
    const plain = "ProxyJump via 'bastion' failed: refused";
    expect(mask(plain)).toBe(plain);
    expect(mask("ProxyJump via 'DB.EXAMPLE.COM' failed")).toBe(`ProxyJump via '${m('db.example.com')}' failed`);
    expect(mask("ProxyJump via 'nas' failed")).toBe(`ProxyJump via '${m('nas')}' failed`);
    expect(mask('open tunnel to 10.20.3.7:22: refused')).toBe(`open tunnel to ${m('10.20.3.7')}:22: refused`);
  });

  it('masks the whole of an IPv6 literal with an embedded IPv4 tail', () => {
    for (const ip of ['2001:db8::192.0.2.1', '64:ff9b::198.51.100.7', '1:2:3:4:5:6:1.2.3.4', '::ffff:203.0.113.9']) {
      expect(mask(`via ${ip} refused`)).toBe(`via ${m(ip)} refused`);
      expect(mask(`[${ip}]:2222`)).toBe(`[${m(ip)}]:2222`);
    }
    expect(mask('fe80::1 and 12:30:45 and 10.0.0.1.5')).toBe(`${m('fe80::1')} and 12:30:45 and 10.0.0.1.5`);
  });

  it('masks a changed host key message, on port 22 and off it', () => {
    const fp = 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s';
    const file = '/home/me/.ssh/known_hosts';
    const on22 =
      `Host key of db.example.com has changed: its ED25519 key ${fp} does not match the one ` +
      `saved in ${file}. Remove it with ssh-keygen -R "db.example.com" -f "${file}".`;
    expect(mask(on22)).toBe(on22.replaceAll('db.example.com', m('db.example.com')));
    const off22 = `Host key of 203.0.113.7 port 2222 has changed. ssh-keygen -R "[203.0.113.7]:2222" -f "${file}"`;
    expect(mask(off22)).toBe(
      `Host key of ${m('203.0.113.7')} port 2222 has changed. ssh-keygen -R "[${m('203.0.113.7')}]:2222" -f "${file}"`
    );
  });

  it('masks the connect and tunnel messages, keeping ports and brackets', () => {
    expect(mask('open tunnel to db.example.com:22: refused')).toBe(`open tunnel to ${m('db.example.com')}:22: refused`);
    expect(mask("Tunnel to 'db': 8080:10.20.3.7:5432 could not be opened: refused")).toBe(
      `Tunnel to 'db': 8080:${m('10.20.3.7')}:5432 could not be opened: refused`
    );
    expect(mask('0.0.0.0:8080:[2001:db8::1]:443')).toBe(`0.0.0.0:8080:[${m('2001:db8::1')}]:443`);
    expect(mask('no answer from 198.51.100.4:22')).toBe(`no answer from ${m('198.51.100.4')}:22`);
  });

  it('masks unknown IP literals and the domain of user@domain', () => {
    expect(mask('via 192.168.1.10, fe80::1 and 2001:0db8:0:0:0:0:0:2')).toBe(
      `via ${m('192.168.1.10')}, ${m('fe80::1')} and ${m('2001:0db8:0:0:0:0:0:2')}`
    );
    expect(mask("unusable ProxyJump hop 'ops@bastion.corp.io:2200'")).toBe(
      `unusable ProxyJump hop 'ops@${m('bastion.corp.io')}:2200'`
    );
    expect(mask('admin@db.example.com')).toBe(`admin@${m('db.example.com')}`);
  });

  it('gives a known name exactly the disguise its card shows, whatever its case', () => {
    for (const h of HOSTS) expect(mask(h.hostname)).toBe(m(h.hostname));
    expect(mask('DB.EXAMPLE.COM refused')).toBe(`${m('db.example.com')} refused`);
  });

  it('never masks a disguise again', () => {
    const once = mask('db.example.com 10.20.3.7 2001:db8::1');
    expect(once).toBe(`${m('db.example.com')} ${m('10.20.3.7')} ${m('2001:db8::1')}`);
    expect(once).not.toContain('10.20.3.7');
  });

  it('leaves loopback, wildcards, fingerprints, versions, times, paths and MACs alone', () => {
    const plain = [
      'listen on 127.0.0.1:8080, [::1]:22, 0.0.0.0:80, :: and *:443 failed',
      'key SHA256:nas+Zm9vYmFy/nas and ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
      'OmnySSH 1.1.4 at 2026-10-09 12:30:45, file id_ed25519.pub in /srv/10.0.0.5/logs',
      'link aa:bb:cc:dd:ee:ff up; std::io error; github.com is fine'
    ];
    for (const text of plain) expect(mask(text)).toBe(text);
  });

  it('masks a single-label name only as a whole token', () => {
    expect(mask('nas: refused')).toBe(`${m('nas')}: refused`);
    expect(mask('nasty nas.local nas-2 synas')).toBe('nasty nas.local nas-2 synas');
  });

  it('matches a single-label name only in its stored spelling, dotted names and IPv6 in any', () => {
    const words = addressMasker(knownAddresses([host('backup'), host('server'), host('Vault'), ...HOSTS]));
    const plain = ['sshd config validation failed. Backup restored.', 'copy public key to Server', 'vault'];
    for (const text of plain) expect(words(text)).toBe(text);
    expect(words('pwsudo@backup:22 and copy to server')).toBe(`pwsudo@${m('backup')}:22 and copy to ${m('server')}`);
    expect(words('Vault: refused')).toBe(`${m('Vault')}: refused`);
    expect(words('2001:DB8::1 refused')).toBe(`${m('2001:db8::1')} refused`);
  });

  it('keeps each spelling of a single-label name, so each gets its own card disguise', () => {
    const list = [host('backup'), host('Backup')];
    expect(knownAddresses(list)).toEqual(['backup', 'Backup']);
    const words = addressMasker(knownAddresses(list));
    for (const h of list) expect(words(h.hostname)).toBe(m(h.hostname));
  });

  it('masks only literals when no host is known', () => {
    expect(addressMasker([])('10.0.0.9 and nas')).toBe(`${m('10.0.0.9')} and nas`);
  });
});

describe('maskText store', () => {
  it('hands text back as is while streamer mode is off, and masks once it is on', async () => {
    vi.resetModules();
    const { maskText, streamerMode } = await import('./streamer');
    const { hosts } = await import('./hosts');
    hosts.set([host('db.example.com')]);
    streamerMode.set(false);
    expect(get(maskText)('db.example.com 10.0.0.9')).toBe('db.example.com 10.0.0.9');
    streamerMode.set(true);
    expect(get(maskText)('db.example.com 10.0.0.9')).toBe(
      `${maskHostname('db.example.com')} ${maskHostname('10.0.0.9')}`
    );
  });
});

// Persistence mirrors the sidebar-collapse pref: a fake Tauri store, a fresh module per
// test to reset the singleton, and the localStorage mirror seeding the initial value.
const backend = { get: vi.fn(), set: vi.fn(), save: vi.fn() };
vi.mock('@tauri-apps/plugin-store', () => ({ load: vi.fn(async () => backend) }));

async function fresh() {
  vi.resetModules();
  return (await import('./streamer')).streamerMode;
}

describe('streamer mode persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    backend.get.mockReset();
    backend.set.mockReset().mockResolvedValue(undefined);
    backend.save.mockReset().mockResolvedValue(undefined);
  });

  it('defaults to off and mirrors a toggle to localStorage', async () => {
    const streamerMode = await fresh();
    expect(get(streamerMode)).toBe(false);
    streamerMode.toggle();
    expect(get(streamerMode)).toBe(true);
    expect(localStorage.getItem('omnyssh-streamer-mode')).toBe('true');
  });

  it('writes the canonical tauri-plugin-store on a user flip', async () => {
    const streamerMode = await fresh();
    streamerMode.set(true);
    await vi.waitFor(() => {
      expect(backend.set).toHaveBeenCalledWith('streamerMode', true);
      expect(backend.save).toHaveBeenCalled();
    });
  });

  it('hydrate applies the stored value without clobbering a fresh user flip', async () => {
    backend.get.mockResolvedValue(false); // stale persisted value
    const streamerMode = await fresh();
    streamerMode.set(true); // user acts before hydrate resolves
    await streamerMode.hydrate();
    expect(get(streamerMode)).toBe(true);
  });
});
