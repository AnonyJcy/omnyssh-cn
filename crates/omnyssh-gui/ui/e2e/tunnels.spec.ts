import { expect, test, type Page } from '@playwright/test';

// Port forwarding (issue #104). Tauri is stubbed at `__TAURI_INTERNALS__` (§6.4): the
// stub keeps a host list, records every command it gets, and answers `tunnel_start`/
// `tunnel_stop` with the `tunnel-status-changed` events the backend would emit.
const BASE = {
  user: 'admin',
  port: 22,
  tags: [],
  source: 'manual',
  hasKey: true,
  monitoring: 'ssh',
  localForwards: [],
  tunnelAutostart: false,
  forwardAgent: false
};
const HOSTS = [
  {
    ...BASE,
    name: 'nas',
    hostname: '10.0.0.5',
    localForwards: [
      { bindPort: 9443, remoteHost: '127.0.0.1', remotePort: 9443 },
      { bindPort: 5432, remoteHost: 'db.internal', remotePort: 5432 }
    ]
  },
  { ...BASE, name: 'web-1', hostname: 'web-1.example.com' }
];

type Call = { cmd: string; args: Record<string, unknown> };

async function boot(page: Page, options: { rejectStart?: string } = {}): Promise<void> {
  await page.addInitScript(
    ({ hosts, rejectStart }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state = { hosts: hosts.map((h) => ({ ...h })) as Array<Record<string, unknown>> };
      const win = window as unknown as Record<string, unknown>;
      const calls: Call[] = [];
      win.__calls = calls;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }
      win.__fire = fire;
      const tunnel = (hostName: string, ...statuses: unknown[]) =>
        statuses.forEach((status, i) => setTimeout(() => fire('tunnel-status-changed', { hostName, status }), 10 * (i + 1)));

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args });
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'save_host': {
              const h = args.input as Record<string, unknown> & { name: string };
              const i = state.hosts.findIndex((x) => x.name === h.name);
              const view = {
                ...state.hosts[i],
                hostname: h.hostname,
                localForwards: h.localForwards,
                tunnelAutostart: h.tunnelAutostart,
                forwardAgent: h.forwardAgent
              };
              state.hosts[i] = view;
              return Promise.resolve(null);
            }
            case 'tunnel_start':
              if (rejectStart) return Promise.reject({ message: rejectStart });
              tunnel(args.hostName as string, { kind: 'connecting' }, { kind: 'up' });
              return Promise.resolve(null);
            case 'tunnel_stop':
              tunnel(args.hostName as string, { kind: 'stopped' });
              return Promise.resolve(null);
            case 'plugin:event|listen': {
              const { event, handler } = args as { event: string; handler: number };
              (listeners[event] ||= []).push(handler);
              return Promise.resolve(cbid);
            }
            default:
              return Promise.resolve(null);
          }
        },
        transformCallback: (cb: unknown) => {
          const id = ++cbid;
          win[`__cb${id}`] = cb;
          return id;
        }
      };
    },
    { hosts: HOSTS, rejectStart: options.rejectStart }
  );
  await page.goto('/');
  await expect(page.getByText('nas', { exact: true })).toBeVisible();
}

const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);

test('starts and stops a tunnel from its card', async ({ page }) => {
  await boot(page);

  // Both forwards are listed; a host without forwards has no tunnel block at all.
  await expect(page.getByText('localhost:9443')).toBeVisible();
  await expect(page.getByText('db.internal:5432')).toBeVisible();
  await expect(page.getByRole('button', { name: /tunnel to web-1/ })).toHaveCount(0);

  const toggle = page.getByRole('button', { name: 'Start the tunnel to nas' });
  await toggle.click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  expect((await calls(page)).filter((c) => c.cmd === 'tunnel_start')).toEqual([
    { cmd: 'tunnel_start', args: { hostName: 'nas' } }
  ]);

  // A drop shows why, while the tunnel keeps trying on its own.
  await page.evaluate(() =>
    (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire('tunnel-status-changed', {
      hostName: 'nas',
      status: { kind: 'retrying', message: 'connection lost' }
    })
  );
  await expect(page.getByText('Reconnecting…')).toBeVisible();
  await expect(page.getByText('connection lost')).toBeVisible();

  await page.getByRole('button', { name: 'Stop the tunnel to nas' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start the tunnel to nas' })).toBeVisible();
});

test('a start the backend refuses surfaces its reason', async ({ page }) => {
  await boot(page, { rejectStart: "'nas' has no port forwards" });
  await page.getByRole('button', { name: 'Start the tunnel to nas' }).click();
  await expect(page.getByText("'nas' has no port forwards")).toBeVisible();
});

test('adds a forward in the editor and the card picks it up', async ({ page }) => {
  await boot(page);

  await page.getByRole('button', { name: 'Edit web-1' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await editor.getByRole('button', { name: 'Add forward' }).click();
  await editor.getByLabel('Forward 1 local port').fill('8080');
  await editor.getByLabel('Forward 1 remote host').fill('127.0.0.1');
  await editor.getByLabel('Forward 1 remote port').fill('80');
  await editor.getByRole('switch', { name: 'Start tunnel when OmnySSH opens' }).click();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const saved = (await calls(page)).find((c) => c.cmd === 'save_host')?.args.input as Record<string, unknown>;
  expect(saved.localForwards).toEqual([{ bindPort: 8080, remoteHost: '127.0.0.1', remotePort: 80 }]);
  expect(saved.tunnelAutostart).toBe(true);

  await expect(page.getByText('localhost:8080')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start the tunnel to web-1' })).toBeVisible();
  await expect(page.getByTitle('Starts when OmnySSH opens')).toBeVisible();
});

test('a half-filled forward keeps the editor open with the reason', async ({ page }) => {
  await boot(page);

  await page.getByRole('button', { name: 'Edit web-1' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  await editor.getByRole('button', { name: 'Add forward' }).click();
  await editor.getByLabel('Forward 1 local port').fill('8080');
  await editor.getByRole('button', { name: 'Save' }).click();

  await expect(editor.getByText('Forward 1: remote port must be a number')).toBeVisible();
  expect((await calls(page)).some((c) => c.cmd === 'save_host')).toBe(false);
});
