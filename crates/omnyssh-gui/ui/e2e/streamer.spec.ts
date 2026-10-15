import { expect, test, type Page } from '@playwright/test';

// Streamer mode (tech-gui.md §4.1, 2026-10-09 note). Tauri is stubbed at
// `__TAURI_INTERNALS__` (§6.4); `__fire` plays a core event, so an error carrying a
// real address can be sent the way the backend would send it.
const HOSTS = [
  {
    name: 'db',
    hostname: 'db.example.com',
    user: 'admin',
    port: 22,
    tags: [],
    source: 'manual',
    hasKey: true,
    monitoring: 'ssh',
    localForwards: [{ bindAddress: '192.168.1.5', bindPort: 8080, remoteHost: '10.20.3.7', remotePort: 5432 }],
    tunnelAutostart: false,
    forwardAgent: false
  }
];

async function boot(page: Page, streamer: boolean, hosts: unknown[] = HOSTS): Promise<void> {
  await page.addInitScript(
    ({ hosts, streamer }) => {
      localStorage.setItem('omnyssh-streamer-mode', String(streamer));
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
      const win = window as unknown as Record<string, unknown>;
      win.__fire = (event: string, payload: unknown): void => {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      };
      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve(hosts);
            case 'save_host':
              win.__saved = args;
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
        },
        unregisterCallback: (id: number) => {
          delete win[`__cb${id}`];
        }
      };
    },
    { hosts, streamer }
  );
  await page.goto('/');
  await expect(page.getByText('1 host', { exact: true })).toBeVisible();
}

const TUNNEL_ERROR = "Tunnel to 'db': 8080:10.20.3.7:5432 could not be opened: db.example.com refused";

async function fireError(page: Page, message: string): Promise<void> {
  await page.evaluate(
    (message) => (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire('error', { message }),
    message
  );
}

test('streamer mode keeps real addresses out of the status bar and its tooltip', async ({ page }) => {
  await boot(page, true);
  await fireError(page, TUNNEL_ERROR);

  const status = page.getByRole('contentinfo').getByText("Tunnel to 'db'");
  await expect(status).toBeVisible();
  for (const real of ['10.20.3.7', 'db.example.com']) {
    await expect(status).not.toContainText(real);
    await expect(status).not.toHaveAttribute('title', new RegExp(real.replaceAll('.', '\\.')));
  }
  await expect(status).toContainText(':5432 could not be opened');
});

test('with streamer mode off the status bar shows the error as sent', async ({ page }) => {
  await boot(page, false);
  await fireError(page, TUNNEL_ERROR);
  await expect(page.getByRole('contentinfo').getByText(TUNNEL_ERROR)).toHaveAttribute('title', TUNNEL_ERROR);
});

test('an eye in the status bar says streamer mode is on, without changing its height', async ({ page }) => {
  await boot(page, false);
  const statusBar = page.getByRole('contentinfo');
  const eye = statusBar.getByRole('img', { name: 'Streamer mode is on' });
  await expect(eye).toHaveCount(0);
  const before = (await statusBar.boundingBox())?.height;

  await page.keyboard.press('Control+Shift+S');
  await expect(eye).toBeVisible();
  await expect(eye).toHaveAttribute('title', /\(Ctrl\+Shift\+S\)$/);
  await expect(statusBar).not.toContainText('Streamer mode');
  expect((await statusBar.boundingBox())?.height).toBe(before);
});

test('the command palette toggles streamer mode', async ({ page }) => {
  await boot(page, false);
  const eye = page.getByRole('contentinfo').getByRole('img', { name: 'Streamer mode is on' });

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('textbox').fill('streamer');
  await expect(palette.getByText('Commands')).toBeVisible();
  await expect(palette.getByRole('button', { name: 'Toggle streamer mode Ctrl+Shift+S' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(eye).toBeVisible();

  await page.keyboard.press('Control+k');
  await palette.getByRole('button', { name: /Toggle streamer mode/ }).click();
  await expect(palette).toHaveCount(0);
  await expect(eye).toHaveCount(0);
});

test('Ctrl+Shift+S toggles streamer mode and re-masks what is already on screen', async ({ page }) => {
  await boot(page, false);
  await fireError(page, TUNNEL_ERROR);
  const statusBar = page.getByRole('contentinfo');
  await expect(statusBar).toContainText('10.20.3.7');

  await page.keyboard.press('Control+Shift+S');
  await expect(statusBar).toContainText("Tunnel to 'db'");
  await expect(statusBar).not.toContainText('10.20.3.7');
  await expect(statusBar.getByRole('img', { name: 'Streamer mode is on' })).toBeVisible();

  // Typing in a field does not hold it back.
  await page.getByRole('button', { name: 'Search hosts' }).click();
  await page.getByRole('textbox', { name: 'Search hosts' }).press('Control+Shift+S');
  await expect(statusBar).toContainText('10.20.3.7');
  await expect(statusBar.getByRole('img', { name: 'Streamer mode is on' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search hosts' })).toHaveValue('');
});

test('the host form shows disguised addresses until Reveal, and saves the real ones', async ({ page }) => {
  await boot(page, true);
  await page.getByRole('button', { name: 'Edit db' }).click();
  let editor = page.getByRole('dialog', { name: 'Edit host' });
  let hostname = editor.getByLabel('Hostname / IP');
  const local = editor.getByLabel('Forward 1 local port');
  const remote = editor.getByLabel('Forward 1 remote host');

  await expect(hostname).toHaveAttribute('readonly', '');
  await expect(hostname).toHaveValue(/^[a-z]+\d+\.com$/);
  await expect(local).toHaveAttribute('readonly', '');
  await expect(local).toHaveValue(/^\d+\.\d+\.\d+\.\d+:8080$/);
  await expect(local).not.toHaveValue('192.168.1.5:8080');
  await expect(remote).toHaveAttribute('readonly', '');
  await expect(remote).not.toHaveValue('10.20.3.7');
  // Edit focus skips the disguised field.
  await expect(editor.getByLabel('User', { exact: true })).toBeFocused();

  await editor.getByRole('button', { name: 'Reveal' }).first().click();
  await expect(hostname).toHaveValue('db.example.com');
  await expect(hostname).toBeFocused();
  await expect(hostname).not.toHaveAttribute('readonly');
  await expect(local).toHaveValue('192.168.1.5:8080');
  await expect(remote).toHaveValue('10.20.3.7');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(0);

  // A reveal lasts for this open form only; saving while disguised keeps the real values.
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Edit db' }).click();
  editor = page.getByRole('dialog', { name: 'Edit host' });
  hostname = editor.getByLabel('Hostname / IP');
  await expect(hostname).toHaveAttribute('readonly', '');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.stringify((window as unknown as { __saved: unknown }).__saved));
  expect(saved).toContain('"hostname":"db.example.com"');
  expect(saved).toContain('"remoteHost":"10.20.3.7"');
});

test('a new host and new forwards stay editable in streamer mode, and save as typed', async ({ page }) => {
  await boot(page, true);
  await page.getByRole('button', { name: 'Add host' }).click();
  const editor = page.getByRole('dialog', { name: 'Add host' });
  const hostname = editor.getByLabel('Hostname / IP');
  await expect(hostname).not.toHaveAttribute('readonly');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(0);

  await editor.getByLabel('Name', { exact: true }).fill('cache');
  await hostname.fill('cache.example.com');
  await expect(hostname).toHaveValue('cache.example.com');
  await expect(hostname).not.toHaveAttribute('readonly');

  await editor.getByRole('button', { name: 'Add forward' }).click();
  await editor.getByLabel('Forward 1 local port').fill('6380');
  await editor.getByLabel('Forward 1 remote host').fill('10.9.8.7');
  await editor.getByLabel('Forward 1 remote port').fill('6379');
  await expect(editor.getByLabel('Forward 1 remote host')).toHaveValue('10.9.8.7');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(0);

  await editor.getByRole('button', { name: 'Add host' }).click();
  await expect(editor).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.stringify((window as unknown as { __saved: unknown }).__saved));
  expect(saved).toContain('"hostname":"cache.example.com"');
  expect(saved).toContain('"remoteHost":"10.9.8.7"');
});

test('only the forwards present at open are disguised', async ({ page }) => {
  await boot(page, true);
  await page.getByRole('button', { name: 'Edit db' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });

  await editor.getByRole('button', { name: 'Add forward' }).click();
  await expect(editor.getByLabel('Forward 1 remote host')).toHaveAttribute('readonly', '');
  const added = editor.getByLabel('Forward 2 remote host');
  await expect(added).not.toHaveAttribute('readonly');
  await added.fill('10.1.2.3');
  await expect(added).toHaveValue('10.1.2.3');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(2);

  // Removing the disguised row leaves the added one, still editable, and no forward to reveal.
  await editor.getByRole('button', { name: 'Remove forward 1' }).click();
  await expect(editor.getByLabel('Forward 1 remote host')).toHaveValue('10.1.2.3');
  await expect(editor.getByLabel('Forward 1 remote host')).not.toHaveAttribute('readonly');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(1);
  await expect(editor.getByLabel('Hostname / IP')).toHaveAttribute('readonly', '');
});

test('switching streamer mode on mid-edit never locks the field being typed in', async ({ page }) => {
  await boot(page, false);
  await page.getByRole('button', { name: 'Edit db' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  const hostname = editor.getByLabel('Hostname / IP');
  const remote = editor.getByLabel('Forward 1 remote host');

  await hostname.fill('db2.example.com');
  await hostname.press('Control+Shift+S');
  await expect(page.getByRole('contentinfo').getByRole('img', { name: 'Streamer mode is on' })).toBeVisible();
  await expect(hostname).not.toHaveAttribute('readonly');
  await expect(hostname).toBeFocused();
  await hostname.press('x');
  await expect(hostname).toHaveValue('db2.example.comx');
  // The untouched forward was there at open, so it is disguised now.
  await expect(remote).toHaveAttribute('readonly', '');
  await expect(remote).not.toHaveValue('10.20.3.7');
});

test('turning streamer mode off and on again hides a revealed form again', async ({ page }) => {
  await boot(page, true);
  await page.getByRole('button', { name: 'Edit db' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  const hostname = editor.getByLabel('Hostname / IP');
  const remote = editor.getByLabel('Forward 1 remote host');

  await editor.getByRole('button', { name: 'Reveal' }).first().click();
  await expect(hostname).toHaveValue('db.example.com');
  await hostname.press('Control+Shift+S');
  await hostname.press('Control+Shift+S');
  await expect(page.getByRole('contentinfo').getByRole('img', { name: 'Streamer mode is on' })).toBeVisible();
  await expect(hostname).toHaveAttribute('readonly', '');
  await expect(hostname).not.toHaveValue('db.example.com');
  await expect(remote).toHaveAttribute('readonly', '');
  await expect(remote).not.toHaveValue('10.20.3.7');
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(2);
});

test('a field its disguise leaves as is stays editable without a Reveal', async ({ page }) => {
  await boot(page, true, [
    { ...HOSTS[0], localForwards: [{ bindPort: 8080, remoteHost: 'localhost', remotePort: 80 }] }
  ]);
  await page.getByRole('button', { name: 'Edit db' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit host' });
  const local = editor.getByLabel('Forward 1 local port');
  const remote = editor.getByLabel('Forward 1 remote host');

  await expect(local).toHaveValue('8080');
  await expect(local).not.toHaveAttribute('readonly');
  await expect(remote).toHaveValue('localhost');
  await expect(remote).not.toHaveAttribute('readonly');
  // Only the hostname is held, and changing the port leaves it disguised.
  await expect(editor.getByRole('button', { name: 'Reveal' })).toHaveCount(1);
  await local.fill('9090');
  await expect(local).toHaveValue('9090');
  await expect(editor.getByLabel('Hostname / IP')).toHaveAttribute('readonly', '');
  await expect(editor.getByLabel('Hostname / IP')).not.toHaveValue('db.example.com');
});
