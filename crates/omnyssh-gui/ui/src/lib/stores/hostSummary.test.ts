import { describe, expect, it } from 'vitest';
import type { ConnectionStatusDto, HostDto, MetricsDto } from '$lib/bindings';
import { deriveHostSummary } from './hostSummary';

function host(name: string): HostDto {
  return { name, hostname: '10.0.0.1', user: 'root', port: 22, tags: [], source: 'manual', hasKey: false, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false };
}

function metrics(partial: Partial<MetricsDto>): MetricsDto {
  return { topProcesses: [], ageSeconds: 0, ...partial };
}

const CONNECTED: ConnectionStatusDto = { kind: 'connected' };

describe('deriveHostSummary', () => {
  it('is all zero for no hosts', () => {
    expect(deriveHostSummary([], new Map(), new Map())).toEqual({
      total: 0,
      online: 0,
      alert: 0,
      offline: 0
    });
  });

  it('counts a connected, healthy host as online', () => {
    const statuses = new Map([['a', CONNECTED]]);
    const m = new Map([['a', metrics({ cpuPercent: 10, ramPercent: 20, diskPercent: 30 })]]);
    expect(deriveHostSummary([host('a')], statuses, m)).toMatchObject({ online: 1, alert: 0, offline: 0 });
  });

  it('counts a connected host with no metrics yet as online, not alert', () => {
    const statuses = new Map([['a', CONNECTED]]);
    expect(deriveHostSummary([host('a')], statuses, new Map())).toMatchObject({ online: 1, alert: 0 });
  });

  it('counts a connected host over threshold as alert (60% boundary)', () => {
    const statuses = new Map([['a', CONNECTED]]);
    const m = new Map([['a', metrics({ cpuPercent: 5, ramPercent: 60, diskPercent: 5 })]]);
    expect(deriveHostSummary([host('a')], statuses, m)).toMatchObject({ online: 0, alert: 1, offline: 0 });
  });

  it('treats failed, unknown and connecting hosts as offline', () => {
    const statuses = new Map<string, ConnectionStatusDto>([
      ['f', { kind: 'failed', message: 'boom' }],
      ['u', { kind: 'unknown' }],
      ['c', { kind: 'connecting' }],
      ['n', CONNECTED] // no status entry would also be offline; this one is online
    ]);
    const summary = deriveHostSummary(
      [host('f'), host('u'), host('c'), host('n')],
      statuses,
      new Map()
    );
    expect(summary).toEqual({ total: 4, online: 1, alert: 0, offline: 3 });
  });

  it('a host with no status entry at all is offline', () => {
    expect(deriveHostSummary([host('a')], new Map(), new Map())).toMatchObject({ offline: 1 });
  });
});

// --- Property: the three buckets partition the hosts, so they sum to total. ---

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUS_KINDS = ['unknown', 'connecting', 'connected', 'failed'] as const;

function randomStatus(rand: () => number): ConnectionStatusDto {
  const kind = STATUS_KINDS[Math.floor(rand() * STATUS_KINDS.length)];
  return kind === 'failed' ? { kind, message: 'x' } : { kind };
}

// Random percentage, or undefined ~1/4 of the time (a metric the core couldn't read).
function maybePercent(rand: () => number): number | null {
  return rand() < 0.25 ? null : Math.round(rand() * 100);
}

describe('deriveHostSummary — partition invariant', () => {
  it('online + alert + offline === total for arbitrary inputs', () => {
    const rand = mulberry32(0x51ade);
    for (let iter = 0; iter < 500; iter++) {
      const n = Math.floor(rand() * 30);
      const hostList: HostDto[] = [];
      const statusMap = new Map<string, ConnectionStatusDto>();
      const metricMap = new Map<string, MetricsDto>();
      for (let i = 0; i < n; i++) {
        const name = `h${i}`;
        hostList.push(host(name));
        // Some hosts have no status / no metrics entry at all.
        if (rand() < 0.85) statusMap.set(name, randomStatus(rand));
        if (rand() < 0.7) {
          metricMap.set(
            name,
            metrics({
              cpuPercent: maybePercent(rand),
              ramPercent: maybePercent(rand),
              diskPercent: maybePercent(rand)
            })
          );
        }
      }

      const s = deriveHostSummary(hostList, statusMap, metricMap);
      expect(s.total).toBe(n);
      expect(s.online + s.alert + s.offline).toBe(s.total);
      expect(s.online).toBeGreaterThanOrEqual(0);
      expect(s.alert).toBeGreaterThanOrEqual(0);
      expect(s.offline).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('deriveHostSummary — reachability hosts', () => {
  it('does not count a stale sample against a host that no longer reports metrics', () => {
    const fw: HostDto = { ...host('fw'), monitoring: 'tcpPort' };
    const summary = deriveHostSummary(
      [fw],
      new Map([['fw', { kind: 'connected' } as ConnectionStatusDto]]),
      // Left over from before the host was switched to a port check.
      new Map([['fw', metrics({ cpuPercent: 92 })]])
    );

    expect(summary).toEqual({ total: 1, online: 1, alert: 0, offline: 0 });
  });

  it('still counts a breaching ssh host as an alert', () => {
    const summary = deriveHostSummary(
      [host('web')],
      new Map([['web', { kind: 'connected' } as ConnectionStatusDto]]),
      new Map([['web', metrics({ cpuPercent: 92 })]])
    );

    expect(summary.alert).toBe(1);
  });
});
