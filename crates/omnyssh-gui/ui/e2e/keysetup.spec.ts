import { expect, test, type Page } from '@playwright/test';

// Auto SSH-key setup (tech-gui.md §4.2). e2e runs against the static SPA with Tauri
// absent, so we stub `__TAURI_INTERNALS__` at the boundary (§6.4). `start_key_setup` is
// faked: it streams `key-setup-progress` events and then `key-setup-complete`, flipping
// the host's hasKey/passwordAuthDisabled so the follow-up `reload_hosts` replays a keyed
// host — exactly how the real backend drives the panel and refreshes the card.
const HOSTS = [
  { name: 'pw-host', hostname: 'pw.example.com', user: 'root', port: 22, tags: [], source: 'manual', hasKey: false, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

async function boot(page: Page): Promise<void> {
  await page.addInitScript(
    ({ hosts }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state: { hosts: Array<Record<string, unknown>> } = { hosts: hosts.map((h) => ({ ...h })) };
      const win = window as unknown as Record<string, unknown>;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'start_key_setup': {
              const name = args.hostName as string;
              const step = (index: number, description: string) =>
                fire('key-setup-progress', { hostName: name, step: { index, total: 6, description } });
              setTimeout(() => step(1, 'Generating Ed25519 key pair'), 40);
              setTimeout(() => step(3, 'Verifying key authentication'), 120);
              setTimeout(() => {
                // The real backend persists the key before emitting complete; mirror
                // that so the panel's reload shows a keyed host.
                const h = state.hosts.find((x) => (x as { name: string }).name === name);
                if (h) {
                  h.hasKey = true;
                  h.passwordAuthDisabled = true;
                }
                fire('key-setup-complete', { hostName: name, keyPath: `/home/me/.ssh/omnyssh_${name}_ed25519` });
              }, 400);
              return Promise.resolve(null);
            }
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
    { hosts: HOSTS }
  );
  await page.goto('/');
  await expect(page.getByText('pw-host', { exact: true })).toBeVisible();
}

test('prompts key setup, streams progress, then reflects key auth on the card', async ({ page }) => {
  await boot(page);

  // A password host with no key offers the host-first "Set up key" action (§4.2).
  await page.getByRole('button', { name: 'Set up an SSH key for pw-host' }).click();

  const dialog = page.getByRole('dialog', { name: 'Key setup' });
  await expect(dialog).toBeVisible();

  // A step streams in while the flow runs.
  await expect(dialog.getByText('Verifying key authentication')).toBeVisible();

  // Completion shows the generated key path.
  await expect(dialog.getByText('Key authentication configured')).toBeVisible();
  await expect(dialog.getByText(/omnyssh_pw-host_ed25519/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The reload flipped hasKey/passwordAuthDisabled: the card now reads key-only and no
  // longer offers key setup.
  await expect(page.getByText('key-only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up an SSH key for pw-host' })).toHaveCount(0);
});
