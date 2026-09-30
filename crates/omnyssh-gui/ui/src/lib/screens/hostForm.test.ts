import { describe, expect, it } from 'vitest';
import type { HostDto } from '$lib/bindings';
import { emptyForm, emptyForwardRow, formFromHost, formToInput, type HostFormFields } from './hostForm';

function fields(partial: Partial<HostFormFields>): HostFormFields {
  return { ...emptyForm(), ...partial };
}

function host(partial: Partial<HostDto>): HostDto {
  return {
    name: 'web',
    hostname: 'web.example.com',
    user: 'deploy',
    port: 22,
    tags: [],
    source: 'manual',
    hasKey: false,
    monitoring: 'ssh',
    localForwards: [],
    tunnelAutostart: false,
    forwardAgent: false,
    ...partial
  };
}

describe('formToInput — mirrors the TUI to_host', () => {
  it('rejects an empty name', () => {
    expect(formToInput(fields({ name: '  ', hostname: 'h' }))).toEqual({
      ok: false,
      error: 'Name cannot be empty'
    });
  });

  it('rejects an empty hostname', () => {
    expect(formToInput(fields({ name: 'n', hostname: '  ' }))).toEqual({
      ok: false,
      error: 'Hostname / IP cannot be empty'
    });
  });

  it('defaults an empty user to root', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', user: '  ' }));
    expect(r.ok && r.input.user).toBe('root');
  });

  it('defaults an empty port to 22', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', port: '' }));
    expect(r.ok && r.input.port).toBe(22);
  });

  it('parses a valid port', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', port: '2222' }));
    expect(r.ok && r.input.port).toBe(2222);
  });

  it('accepts the max port 65535', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', port: '65535' }));
    expect(r.ok && r.input.port).toBe(65535);
  });

  it('accepts an optional leading + (parity with Rust u16::parse)', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', port: '+22' }));
    expect(r.ok && r.input.port).toBe(22);
  });

  it.each(['0', '65536', '-1', '22.5', 'abc', '2e3', '0x10', '99999'])(
    'rejects an invalid port %s',
    (port) => {
      const r = formToInput(fields({ name: 'n', hostname: 'h', port }));
      expect(r).toEqual({
        ok: false,
        error: `Port must be a number between 1 and 65535, got '${port}'`
      });
    }
  );

  it('trims name/hostname and splits tags, dropping blanks', () => {
    const r = formToInput(fields({ name: '  web ', hostname: ' 10.0.0.1 ', tags: 'prod, , db ,' }));
    expect(r.ok && r.input.name).toBe('web');
    expect(r.ok && r.input.hostname).toBe('10.0.0.1');
    expect(r.ok && r.input.tags).toEqual(['prod', 'db']);
  });

  it('drops blank optionals to undefined so the wire form stays sparse', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', identityFile: '  ', password: '', notes: ' ' }));
    expect(r.ok && r.input.identityFile).toBeUndefined();
    expect(r.ok && r.input.password).toBeUndefined();
    expect(r.ok && r.input.notes).toBeUndefined();
  });

  it('keeps identity/password/notes when provided', () => {
    const r = formToInput(
      fields({ name: 'n', hostname: 'h', identityFile: '~/.ssh/id', password: 's3cret', notes: 'prod box' })
    );
    expect(r.ok && r.input.identityFile).toBe('~/.ssh/id');
    expect(r.ok && r.input.password).toBe('s3cret');
    expect(r.ok && r.input.notes).toBe('prod box');
  });

  it('always emits a tags array (empty, not undefined)', () => {
    const r = formToInput(fields({ name: 'n', hostname: 'h', tags: '' }));
    expect(r.ok && r.input.tags).toEqual([]);
  });
});

describe('formFromHost', () => {
  it('seeds the editable fields and leaves secrets blank (the DTO omits them)', () => {
    const f = formFromHost(host({ name: 'db', hostname: '10.0.0.2', user: 'root', port: 2200, tags: ['prod', 'db'], notes: 'primary' }));
    expect(f.name).toBe('db');
    expect(f.hostname).toBe('10.0.0.2');
    expect(f.user).toBe('root');
    expect(f.port).toBe('2200');
    expect(f.tags).toBe('prod, db');
    expect(f.notes).toBe('primary');
    // Backend-only fields are never shown — blank means "keep the stored value".
    expect(f.identityFile).toBe('');
    expect(f.password).toBe('');
  });

  it('round-trips the observable fields back through formToInput', () => {
    const original = host({ name: 'db', hostname: '10.0.0.2', user: 'root', port: 2200, tags: ['ops'], notes: 'x' });
    const r = formToInput(formFromHost(original));
    expect(r.ok && r.input).toEqual({
      name: 'db',
      hostname: '10.0.0.2',
      user: 'root',
      port: 2200,
      identityFile: undefined,
      password: undefined,
      tags: ['ops'],
      notes: 'x',
      monitoring: 'ssh',
      localForwards: [],
      tunnelAutostart: false,
      forwardAgent: false,
      monitorPort: undefined
    });
  });
});

describe('formToInput — agent forwarding', () => {
  it('sends the switch as set, with no forwards needed', () => {
    const r = formToInput(fields({ name: 'lab', hostname: 'h', forwardAgent: true }));
    expect(r.ok && r.input.forwardAgent).toBe(true);
  });

  it('seeds the edit form from the host, an ssh-config import included', () => {
    expect(formFromHost(host({ source: 'sshConfig', forwardAgent: true })).forwardAgent).toBe(true);
    expect(emptyForm().forwardAgent).toBe(false);
  });
});

describe('formToInput — monitoring mode', () => {
  it('defaults to ssh and sends no probe port', () => {
    const result = formToInput({ ...emptyForm(), name: 'web', hostname: '10.0.0.1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.monitoring).toBe('ssh');
      expect(result.input.monitorPort).toBeUndefined();
    }
  });

  it('carries a probe port for a reachability host', () => {
    const result = formToInput({
      ...emptyForm(),
      name: 'fw',
      hostname: '10.0.0.9',
      monitoring: 'tcpPort',
      monitorPort: '8443'
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.monitoring).toBe('tcpPort');
      expect(result.input.monitorPort).toBe(8443);
    }
  });

  it('falls back to the host port when the probe port is blank', () => {
    const result = formToInput({ ...emptyForm(), name: 'fw', hostname: '10.0.0.9', monitoring: 'tcpPort' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.monitorPort).toBeUndefined();
  });

  it('rejects an out-of-range probe port', () => {
    for (const monitorPort of ['0', '99999', 'ssh']) {
      const result = formToInput({
        ...emptyForm(),
        name: 'fw',
        hostname: '10.0.0.9',
        monitoring: 'tcpPort',
        monitorPort
      });
      expect(result.ok).toBe(false);
    }
  });

  it('ignores a probe port left over from switching back to ssh', () => {
    const result = formToInput({
      ...emptyForm(),
      name: 'web',
      hostname: '10.0.0.1',
      monitoring: 'ssh',
      monitorPort: '8443'
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.monitorPort).toBeUndefined();
  });

  it('round-trips a reachability host through the edit form', () => {
    const fields = formFromHost(host({ monitoring: 'tcpPort', monitorPort: 8443 }));
    expect(fields.monitoring).toBe('tcpPort');
    expect(fields.monitorPort).toBe('8443');
  });
});

describe('formToInput — port forwarding', () => {
  const base = { name: 'nas', hostname: '10.0.0.5' };
  const row = (local: string, remoteHost: string, remotePort: string) => ({ local, remoteHost, remotePort });

  it('reads a port, an address and a bracketed IPv6 address on the local side', () => {
    const r = formToInput(
      fields({
        ...base,
        forwards: [
          row('9443', 'localhost', '9443'),
          row('0.0.0.0:8080', 'web.internal', '80'),
          row('[::1]:5432', '[fe80::1]', '5432')
        ]
      })
    );
    expect(r.ok && r.input.localForwards).toEqual([
      { bindAddress: undefined, bindPort: 9443, remoteHost: 'localhost', remotePort: 9443 },
      { bindAddress: '0.0.0.0', bindPort: 8080, remoteHost: 'web.internal', remotePort: 80 },
      { bindAddress: '::1', bindPort: 5432, remoteHost: 'fe80::1', remotePort: 5432 }
    ]);
  });

  it('drops a row left blank', () => {
    const r = formToInput(fields({ ...base, forwards: [emptyForwardRow(), row('3000', 'localhost', '3000')] }));
    expect(r.ok && r.input.localForwards).toHaveLength(1);
  });

  it('names the row and the problem', () => {
    const cases: [ReturnType<typeof row>, string][] = [
      [row('0', 'localhost', '80'), 'Forward 1: local port'],
      [row('::1:8080', 'localhost', '80'), 'Forward 1: put an IPv6 address in brackets'],
      [row('8080', '  ', '80'), 'Forward 1: enter the host'],
      [row('8080', 'local host', '80'), 'Forward 1: enter the host'],
      [row('8080', 'localhost', '70000'), 'Forward 1: remote port']
    ];
    for (const [bad, message] of cases) {
      const r = formToInput(fields({ ...base, forwards: [bad] }));
      expect(r.ok ? '' : r.error).toContain(message);
    }
  });

  it('refuses two forwards on one local port, however it is written', () => {
    const r = formToInput(
      fields({ ...base, forwards: [row('9443', 'localhost', '1'), row('localhost:9443', 'localhost', '2')] })
    );
    expect(r).toEqual({ ok: false, error: 'Forward 2 listens on the same port as forward 1' });
  });

  it('drops the autostart flag along with the last forward', () => {
    const r = formToInput(fields({ ...base, forwards: [], tunnelAutostart: true }));
    expect(r.ok && r.input.tunnelAutostart).toBe(false);
  });

  it('round-trips forwards and autostart through the edit form', () => {
    const original = host({
      localForwards: [
        { bindPort: 9443, remoteHost: '127.0.0.1', remotePort: 9443 },
        { bindAddress: '::1', bindPort: 8080, remoteHost: 'db', remotePort: 5432 }
      ],
      tunnelAutostart: true
    });
    const f = formFromHost(original);
    expect(f.forwards.map((r) => r.local)).toEqual(['9443', '[::1]:8080']);
    const r = formToInput(f);
    expect(r.ok && r.input.tunnelAutostart).toBe(true);
    expect(r.ok && r.input.localForwards).toEqual([
      { bindAddress: undefined, bindPort: 9443, remoteHost: '127.0.0.1', remotePort: 9443 },
      { bindAddress: '::1', bindPort: 8080, remoteHost: 'db', remotePort: 5432 }
    ]);
  });
});
