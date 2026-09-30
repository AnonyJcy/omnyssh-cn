import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { ConnectionStatusDto, HostDto, MetricsDto } from '$lib/bindings';
import type { HostServices } from '$lib/stores/services';
import {
  deriveCard,
  deriveTunnel,
  filterHosts,
  forwardListen,
  forwardTarget,
  metricStatus,
  QUICK_ACTIONS
} from './serverCard';

function host(name = 'web-1'): HostDto {
  return { name, hostname: '10.0.0.1', user: 'root', port: 22, tags: [], source: 'manual', hasKey: false, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false };
}

function tcpHost(name = 'fw-1'): HostDto {
  return { ...host(name), monitoring: 'tcpPort', monitorPort: 8443 };
}

function metrics(partial: Partial<MetricsDto>): MetricsDto {
  return { topProcesses: [], ageSeconds: 0, ...partial };
}

const CONNECTED: ConnectionStatusDto = { kind: 'connected' };

describe('metricStatus — mirrors metrics::threshold_level', () => {
  it('classifies against the 60 / 85 boundaries', () => {
    expect(metricStatus(0)).toBe('ok');
    expect(metricStatus(59.9)).toBe('ok');
    expect(metricStatus(60)).toBe('warn');
    expect(metricStatus(85)).toBe('warn');
    expect(metricStatus(85.1)).toBe('crit');
    expect(metricStatus(100)).toBe('crit');
  });
});

describe('deriveCard — health state', () => {
  it('a connected, healthy host is ok and not offline', () => {
    const card = deriveCard(host(), CONNECTED, metrics({ cpuPercent: 10, ramPercent: 20, diskPercent: 30 }), undefined);
    expect(card.overall).toBe('ok');
    expect(card.offline).toBe(false);
    expect(card.metricRows.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('a connected host takes the worst metric severity as its overall state', () => {
    const warn = deriveCard(host(), CONNECTED, metrics({ cpuPercent: 10, ramPercent: 70, diskPercent: 10 }), undefined);
    expect(warn.overall).toBe('warn');
    const crit = deriveCard(host(), CONNECTED, metrics({ cpuPercent: 95, ramPercent: 70, diskPercent: 10 }), undefined);
    expect(crit.overall).toBe('crit');
  });

  it('a connected host with no metrics yet is ok and not offline', () => {
    const card = deriveCard(host(), CONNECTED, undefined, undefined);
    expect(card.overall).toBe('ok');
    expect(card.offline).toBe(false);
    expect(card.metricRows.map((r) => r.percent)).toEqual([null, null, null]);
    expect(card.metricRows.map((r) => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });

  it('a failed host with no metrics is off and offline', () => {
    const card = deriveCard(host(), { kind: 'failed', message: 'refused' }, undefined, undefined);
    expect(card.overall).toBe('off');
    expect(card.offline).toBe(true);
  });

  it('says why a failed host is down, and nothing otherwise', () => {
    const failed: ConnectionStatusDto = { kind: 'failed', message: 'SSH connection failed: Connection refused' };
    expect(deriveCard(host(), failed, undefined, undefined).failure).toBe(failed.message);
    expect(deriveCard(host(), failed, metrics({ cpuPercent: 40 }), undefined).failure).toBe(failed.message);
    expect(deriveCard(tcpHost(), failed, undefined, undefined).failure).toBe(failed.message);
    expect(deriveCard(host(), CONNECTED, undefined, undefined).failure).toBeUndefined();
    expect(deriveCard(host(), { kind: 'connecting' }, undefined, undefined).failure).toBeUndefined();
  });

  it('a failed host keeps showing its last metrics rather than an offline state', () => {
    const card = deriveCard(host(), { kind: 'failed', message: 'refused' }, metrics({ cpuPercent: 40 }), undefined);
    expect(card.overall).toBe('off');
    expect(card.offline).toBe(false);
  });

  it('a failed host with only os-info renders (not offline), mirroring the TUI', () => {
    // Discovery emits an os-info-only sample; a down host still shows what it knows.
    const card = deriveCard(host(), { kind: 'failed', message: 'refused' }, metrics({ osInfo: 'Ubuntu 22.04' }), undefined);
    expect(card.offline).toBe(false);
    expect(card.osInfo).toBe('Ubuntu 22.04');
    expect(card.overall).toBe('off');
  });

  it('a connecting host is neutral and not offline', () => {
    const card = deriveCard(host(), { kind: 'connecting' }, undefined, undefined);
    expect(card.overall).toBe('unknown');
    expect(card.offline).toBe(false);
  });

  it('an unprobed host with no status is neutral and offline', () => {
    const card = deriveCard(host(), undefined, undefined, undefined);
    expect(card.overall).toBe('unknown');
    expect(card.offline).toBe(true);
  });

  it('a single reported metric drives severity while the others stay unknown', () => {
    const card = deriveCard(host(), CONNECTED, metrics({ diskPercent: 90 }), undefined);
    expect(card.overall).toBe('crit');
    expect(card.metricRows).toEqual([
      { label: 'CPU', percent: null, status: 'unknown' },
      { label: 'RAM', percent: null, status: 'unknown' },
      { label: 'Disk', percent: 90, status: 'crit' }
    ]);
  });

  it('carries uptime, os info and top processes through', () => {
    const card = deriveCard(
      host(),
      CONNECTED,
      metrics({ uptime: '3 days', osInfo: 'Ubuntu 22.04', topProcesses: [{ name: 'pg', cpuPercent: 30, memPercent: 12 }] }),
      undefined
    );
    expect(card.uptime).toBe('3 days');
    expect(card.osInfo).toBe('Ubuntu 22.04');
    expect(card.topProcesses).toHaveLength(1);
  });
});

describe('deriveCard — detected services', () => {
  it('names each kind and summarises the docker quick-scan container counts', () => {
    // The quick-scan emits containers_total + containers_running for docker, and no
    // metrics for the other kinds (they render name-only).
    const svc: HostServices = {
      kind: 'detected',
      services: [
        { kind: 'docker', metrics: [{ name: 'containers_total', value: 7 }, { name: 'containers_running', value: 6 }] },
        { kind: 'postgresql', metrics: [] }
      ]
    };
    const card = deriveCard(host(), CONNECTED, undefined, svc);
    expect(card.detectedServices).toEqual([
      { kind: 'docker', name: 'Docker', detail: '6/7 running' },
      { kind: 'postgresql', name: 'PostgreSQL', detail: '' }
    ]);
    expect(card.servicesError).toBeUndefined();
  });

  it('reads a docker host with containers present but none running', () => {
    const svc: HostServices = {
      kind: 'detected',
      services: [{ kind: 'docker', metrics: [{ name: 'containers_total', value: 3 }, { name: 'containers_running', value: 0 }] }]
    };
    expect(deriveCard(host(), CONNECTED, undefined, svc).detectedServices[0].detail).toBe('0/3 running');
  });

  it('shows no docker detail until its quick-scan metrics arrive', () => {
    const svc: HostServices = { kind: 'detected', services: [{ kind: 'docker', metrics: [] }] };
    expect(deriveCard(host(), CONNECTED, undefined, svc).detectedServices[0].detail).toBe('');
  });

  it('surfaces a discovery failure and shows no service chips', () => {
    const svc: HostServices = { kind: 'failed', message: 'scan timed out' };
    const card = deriveCard(host(), CONNECTED, undefined, svc);
    expect(card.detectedServices).toEqual([]);
    expect(card.servicesError).toBe('scan timed out');
  });
});

describe('filterHosts — mirrors the TUI host search', () => {
  const card = (o: Partial<HostDto>) => deriveCard({ ...host(), ...o }, CONNECTED, undefined, undefined);
  const cards = [
    card({ name: 'web-prod', hostname: '10.0.0.1', tags: ['production'], notes: 'billing frontend' }),
    card({ name: 'db-staging', hostname: '10.0.0.2', tags: ['staging', 'db'] }),
    card({ name: 'cache', hostname: '192.168.1.5', tags: [] })
  ];
  const names = (q: string) => filterHosts(cards, q).map((c) => c.host.name);

  it('keeps every card for an empty or whitespace query', () => {
    expect(filterHosts(cards, '')).toHaveLength(3);
    expect(filterHosts(cards, '   ')).toHaveLength(3);
  });

  it('matches name, hostname, tags and notes, case-insensitively', () => {
    expect(names('WEB')).toEqual(['web-prod']);
    expect(names('192.168')).toEqual(['cache']);
    expect(names('staging')).toEqual(['db-staging']);
    expect(names('BILLING')).toEqual(['web-prod']);
  });

  it('returns nothing when no card matches', () => {
    expect(filterHosts(cards, 'nope')).toEqual([]);
  });
});

// --- Quick-action dispatch: the card's sh/files buttons use the shared spawn path. ---

async function freshNav() {
  vi.resetModules();
  const { QUICK_ACTIONS: actions } = await import('./serverCard');
  const { spawnSession } = await import('$lib/stores/navigation');
  const { sessions } = await import('$lib/stores/sessions');
  const { activeEntity } = await import('$lib/stores/activeEntity');
  return { actions, spawnSession, sessions, activeEntity };
}

describe('quick actions', () => {
  it('map sh to a terminal and files to an SFTP session', () => {
    expect(QUICK_ACTIONS.map((a) => [a.id, a.kind])).toEqual([
      ['sh', 'terminal'],
      ['files', 'sftp']
    ]);
  });

  it('dispatch through the shared spawn path, appending an active session of the right kind', async () => {
    const { actions, spawnSession, sessions, activeEntity } = await freshNav();
    for (const action of actions) {
      const s = spawnSession(action.kind, 'web-1');
      expect(s.kind).toBe(action.kind);
      expect(get(activeEntity)).toEqual({ kind: 'session', id: s.id });
    }
    expect(get(sessions).map((s) => s.kind)).toEqual(['terminal', 'sftp']);
  });
});

describe('deriveCard — reachability hosts', () => {
  it('shows the probe result instead of metric tiles', () => {
    const card = deriveCard(tcpHost(), { kind: 'connected' }, undefined, undefined);
    expect(card.reachability).toBe('reachable');
    expect(card.metricRows).toEqual([]);
    expect(card.overall).toBe('ok');
    expect(card.offline).toBe(false);
  });

  it('reports a failed probe as unreachable and offline', () => {
    const card = deriveCard(tcpHost(), { kind: 'failed', message: 'refused' }, undefined, undefined);
    expect(card.reachability).toBe('unreachable');
    expect(card.offline).toBe(true);
    expect(card.overall).toBe('off');
  });

  it('is still checking before the first probe answers', () => {
    expect(deriveCard(tcpHost(), { kind: 'connecting' }, undefined, undefined).reachability).toBe('checking');
    expect(deriveCard(tcpHost(), undefined, undefined, undefined).reachability).toBe('checking');
  });

  it('never claims metrics an ssh host would have reported', () => {
    const card = deriveCard(tcpHost(), { kind: 'connected' }, metrics({ cpuPercent: 90 }), undefined);
    expect(card.metricRows).toEqual([]);
    expect(card.uptime).toBeUndefined();
  });

  it('leaves an ssh host on the metric path', () => {
    const card = deriveCard(host(), { kind: 'connected' }, metrics({ cpuPercent: 10 }), undefined);
    expect(card.reachability).toBeUndefined();
    expect(card.metricRows).toHaveLength(3);
  });
});

describe('deriveTunnel — the card\'s tunnel block', () => {
  const forwarded = (): HostDto => ({
    ...host('nas'),
    localForwards: [{ bindPort: 9443, remoteHost: '127.0.0.1', remotePort: 9443 }]
  });

  it('is absent for a host without forwards, whatever its status', () => {
    expect(deriveTunnel(host(), { kind: 'up' })).toBeUndefined();
    expect(deriveCard(host(), CONNECTED, undefined, undefined, { kind: 'up' }).tunnel).toBeUndefined();
  });

  it('reads as off until a status arrives, and after a stop', () => {
    expect(deriveTunnel(forwarded(), undefined)).toMatchObject({ running: false, label: 'Off', dot: 'unknown' });
  });

  it('tells running states from ended ones', () => {
    expect(deriveTunnel(forwarded(), { kind: 'connecting' })).toMatchObject({ running: true, dot: 'unknown' });
    expect(deriveTunnel(forwarded(), { kind: 'up' })).toMatchObject({ running: true, dot: 'ok', label: 'Active' });
    expect(deriveTunnel(forwarded(), { kind: 'retrying', message: 'connection lost' })).toMatchObject({
      running: true,
      dot: 'warn',
      message: 'connection lost'
    });
    expect(deriveTunnel(forwarded(), { kind: 'failed', message: 'port 9443 in use' })).toMatchObject({
      running: false,
      dot: 'off',
      message: 'port 9443 in use'
    });
  });

  it('rides along on a reachability card too — a port check still has SSH credentials', () => {
    const card = deriveCard({ ...forwarded(), monitoring: 'tcpPort' }, CONNECTED, undefined, undefined, { kind: 'up' });
    expect(card.reachability).toBe('reachable');
    expect(card.tunnel?.label).toBe('Active');
  });

  it('labels where a forward listens', () => {
    const listen = (bindAddress: string | undefined, on = false) =>
      forwardListen({ bindAddress, bindPort: 80, remoteHost: 'x', remotePort: 1 }, on);
    expect(listen(undefined)).toBe('localhost:80');
    expect(listen('0.0.0.0')).toBe('0.0.0.0:80');
    expect(listen('')).toBe('*:80');
    expect(listen('::1')).toBe('[::1]:80');
    // A LAN address of this machine is masked on stream; wildcards are not.
    expect(listen('192.168.1.20', true)).not.toContain('192.168.1.20');
    expect(listen('0.0.0.0', true)).toBe('0.0.0.0:80');
  });

  it('masks a target in streamer mode, but not the server\'s own loopback', () => {
    const target = (remoteHost: string, on: boolean) => forwardTarget({ bindPort: 1, remoteHost, remotePort: 5432 }, on);
    expect(target('10.20.30.40', false)).toBe('10.20.30.40:5432');
    expect(target('10.20.30.40', true)).not.toContain('10.20.30.40');
    for (const loopback of ['localhost', '127.0.0.1', '::1']) {
      expect(target(loopback, true)).toContain(loopback);
    }
    expect(target('fe80::1', false)).toBe('[fe80::1]:5432');
  });
});

