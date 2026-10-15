import { expect, test, type Page } from '@playwright/test';

// Auto SSH-key setup (tech-gui.md §4.2). e2e runs against the static SPA with Tauri
// absent, so we stub `__TAURI_INTERNALS__` at the boundary (§6.4). `start_key_setup` is
// faked per outcome: it streams the `key-setup-progress` steps the real run would reach,
// persists what the backend persists (full success: key + password off; partial: key +
// password on; may-be-off failure: the key alone), then emits the terminal event, so the
// follow-up `reload_hosts` replays
// the host as the real backend would leave it.
const HOSTS = [
  { name: 'pw-host', hostname: 'pw.example.com', user: 'root', port: 22, tags: [], source: 'manual', hasKey: false, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

type Outcome = 'success' | 'partial' | 'unsafe' | 'rollback';

async function boot(page: Page, outcome: Outcome = 'success'): Promise<void> {
  await page.addInitScript(
    ({ hosts, outcome }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const state: { hosts: Array<Record<string, unknown>> } = { hosts: hosts.map((h) => ({ ...h })) };
      const win = window as unknown as Record<string, unknown>;
      win.__startCalls = 0;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }

      const LABELS = [
        'Generating Ed25519 key pair',
        'Copying public key to server',
        'Verifying key authentication',
        'Disabling password authentication',
        'Reloading SSH service',
        'Final verification'
      ];
      // The last step each outcome reaches: partial stops after the verify step (no
      // passwordless sudo), the unsafe failure in the disable step, and a rollback
      // after the final check.
      const LAST: Record<string, number> = { success: 6, partial: 3, unsafe: 4, rollback: 6 };

      function run(name: string): void {
        const last = LAST[outcome];
        for (let i = 1; i <= last; i++) {
          setTimeout(
            () => fire('key-setup-progress', { hostName: name, step: { index: i, total: 6, description: LABELS[i - 1] } }),
            40 * i
          );
        }
        setTimeout(() => {
          const h = state.hosts.find((x) => (x as { name: string }).name === name);
          const keyPath = `/home/me/.ssh/omnyssh_${name}_ed25519`;
          if (outcome === 'success' || outcome === 'partial') {
            // The real backend persists before emitting complete.
            if (h) {
              h.hasKey = true;
              h.passwordAuthDisabled = outcome === 'success';
            }
            fire('key-setup-complete', { hostName: name, keyPath, passwordOff: outcome === 'success' });
          } else if (outcome === 'unsafe') {
            if (h) h.hasKey = true;
            fire('key-setup-failed', {
              hostName: name,
              error: 'Failed to disable password authentication: timeout',
              passwordMayBeOff: true
            });
          } else {
            fire('key-setup-rollback', {
              hostName: name,
              result: 'Final verification failed after disabling password. Attempting rollback.'
            });
          }
        }, 40 * last + 200);
      }

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve([...state.hosts]);
            case 'reload_hosts':
              setTimeout(() => fire('hosts-loaded', [...state.hosts]), 0);
              return Promise.resolve(null);
            case 'start_key_setup':
              win.__startCalls = (win.__startCalls as number) + 1;
              run(args.hostName as string);
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
    { hosts: HOSTS, outcome }
  );
  await page.goto('/');
  await expect(page.getByText('pw-host', { exact: true })).toBeVisible();
}

const startCalls = (page: Page) => page.evaluate(() => (window as unknown as { __startCalls: number }).__startCalls);

/** Open the confirm dialog from the card and accept it. */
async function confirmSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Set up an SSH key for pw-host' }).click();
  await page.getByRole('dialog', { name: 'Set up key login' }).getByRole('button', { name: 'Set up key login' }).click();
}

test('asks before key setup, with Cancel focused, and Cancel starts nothing', async ({ page }) => {
  await boot(page);

  await page.getByRole('button', { name: 'Set up an SSH key for pw-host' }).click();
  const confirm = page.getByRole('dialog', { name: 'Set up key login' });
  await expect(confirm.getByText('Set up key login for pw-host?')).toBeVisible();
  // Desktop Chrome's user agent says Windows, so the path is the Windows one.
  await expect(confirm.getByText('%USERPROFILE%\\.ssh\\omnyssh_pw-host_ed25519')).toBeVisible();
  await expect(confirm.getByText('root@pw.example.com')).toBeVisible();
  await expect(confirm.getByText(/for every account and device/)).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await startCalls(page)).toBe(0);

  // Escape cancels too.
  await page.getByRole('button', { name: 'Set up an SSH key for pw-host' }).click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await startCalls(page)).toBe(0);
});

test('a full success says password login is off and the card shows the shield', async ({ page }) => {
  await boot(page, 'success');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: 'Key setup' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Key login is set up and password login is off')).toBeVisible();
  await expect(dialog.getByText(/omnyssh_pw-host_ed25519/)).toBeVisible();
  await expect(dialog.getByText('The password saved in OmnySSH was removed.')).toBeVisible();
  expect(await startCalls(page)).toBe(1);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The reload flipped hasKey/passwordAuthDisabled: the card shows the shield and no
  // longer offers key setup.
  await expect(page.getByRole('img', { name: 'Key login only' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up an SSH key for pw-host' })).toHaveCount(0);
});

test('a partial run says password login is still on and offers to turn it off', async ({ page }) => {
  await boot(page, 'partial');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: 'Key setup' });
  await expect(dialog.getByText(/Key login works\. Password login is still on/)).toBeVisible();
  await expect(dialog.getByText('Your saved password was kept.')).toBeVisible();
  await expect(dialog.getByText(/password login is off/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();

  const badge = page.getByRole('button', { name: 'Password on' });
  await expect(badge).toBeVisible();
  await expect(page.getByRole('img', { name: 'Key login only' })).toHaveCount(0);

  await badge.click();
  const rerun = page.getByRole('dialog', { name: 'Turn off password login' });
  await expect(rerun.getByText('Turn off password login on pw-host?')).toBeVisible();
  await expect(rerun.getByText(/Reuse the login key OmnySSH made before/)).toBeVisible();
  await expect(rerun.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await rerun.getByRole('button', { name: 'Turn off password login' }).click();
  await expect(page.getByRole('dialog', { name: 'Key setup' })).toBeVisible();
  expect(await startCalls(page)).toBe(2);
});

test('a failure that may leave password login off says so', async ({ page }) => {
  await boot(page, 'unsafe');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: 'Key setup' });
  await expect(dialog.getByText('Key setup failed — password login may be off')).toBeVisible();
  await expect(dialog.getByText(/off\s+now, or after the SSH service next restarts/)).toBeVisible();
  await expect(dialog.getByText(/The new key was saved for this\s+host/)).toBeVisible();
  await expect(dialog.getByText('sudo sshd -T | grep -i passwordauthentication')).toBeVisible();
  await expect(dialog.getByText(/from the newest/)).toBeVisible();
  await expect(dialog.getByText('Failed to disable password authentication: timeout')).toBeVisible();
  await expect(dialog.getByText('Password login was not changed.')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Open terminal' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

  // The reload picked up the saved key, so the card stops offering key setup.
  await expect(page.getByTitle('Key authentication configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up an SSH key for pw-host' })).toHaveCount(0);
});

test('a rollback says password login was turned back on', async ({ page }) => {
  await boot(page, 'rollback');
  await confirmSetup(page);

  const dialog = page.getByRole('dialog', { name: 'Key setup' });
  await expect(dialog.getByText('Password login was turned back on')).toBeVisible();
  await expect(dialog.getByText(/A step after password login was turned off failed/)).toBeVisible();
  await expect(dialog.getByText(/restored the\s+server's SSH settings from its backup/)).toBeVisible();
  await expect(dialog.getByText(/stopped working/)).toHaveCount(0);
  await expect(
    dialog.getByText('Cause: Final verification failed after disabling password. Attempting rollback.')
  ).toBeVisible();
});
