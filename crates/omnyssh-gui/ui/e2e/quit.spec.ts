import { expect, test, type Page } from '@playwright/test';

// Quitting with live work asks first (tech-gui.md §4.3). Tauri is stubbed at
// `__TAURI_INTERNALS__` (§6.4): the window's close, and the tray's or app menu's Quit,
// arrive as `tauri://close-requested`, and the stub records every command so a test can
// tell whether the window was destroyed.
const HOSTS = [
  { name: 'web-1', hostname: 'web-1.example.com', user: 'deploy', port: 22, tags: [], source: 'manual', hasKey: true, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

type Call = { cmd: string; args: Record<string, unknown> };

async function boot(page: Page, options: { tunnel?: boolean; visible?: boolean } = {}): Promise<void> {
  await page.addInitScript(
    ({ hosts, tunnel, visible }) => {
      let cbid = 0;
      const listeners: Record<string, number[]> = {};
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

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: 'main' },
          currentWebview: { windowLabel: 'main', label: 'main' }
        },
        invoke: (cmd: string, args: Record<string, unknown>) => {
          calls.push({ cmd, args });
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve(hosts);
            case 'reload_hosts':
              if (tunnel) {
                setTimeout(() => fire('tunnel-status-changed', { hostName: 'web-1', status: { kind: 'up' } }), 0);
              }
              return Promise.resolve(null);
            case 'set_tray_behavior':
              return Promise.resolve({ available: true, minimize: true });
            case 'terminal_open': {
              const chId = (args.onOutput as { id: number }).id;
              setTimeout(() => {
                const cb = win[`__cb${chId}`] as ((m: unknown) => void) | undefined;
                cb?.({ message: new TextEncoder().encode('ready> ').buffer, index: 0 });
              }, 0);
              return Promise.resolve(1);
            }
            case 'plugin:window|is_visible':
              return Promise.resolve(visible);
            case 'plugin:event|listen': {
              const { event, handler } = args as { event: string; handler: number };
              (listeners[event] ||= []).push(handler);
              return Promise.resolve(handler);
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
    { hosts: HOSTS, tunnel: options.tunnel ?? false, visible: options.visible ?? true }
  );
  await page.goto('/');
  await expect(page.getByText('web-1', { exact: true })).toBeVisible();
}

const calls = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __calls: Call[] }).__calls).map((c) => c.cmd));

const fire = (page: Page, event: string, payload: unknown = null) =>
  page.evaluate(
    ([e, p]) => (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire(e as string, p),
    [event, payload]
  );

const closeWindow = (page: Page) => fire(page, 'tauri://close-requested');

async function openTerminal(page: Page): Promise<void> {
  await page.getByTitle('sh on web-1').click();
  await expect(page.locator('.xterm-rows')).toContainText('ready>');
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Quit OmnySSH?' });

test('closing with a live terminal and tunnel asks first, and Cancel keeps the app', async ({ page }) => {
  await boot(page, { tunnel: true });
  await openTerminal(page);

  await closeWindow(page);
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText('1 terminal and 1 tunnel will be closed.')).toBeVisible();
  // Not the terminal, which had the keyboard: a stray Enter must not quit.
  await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page)).not.toContain('plugin:window|destroy');
  await expect(page.locator('.xterm-rows')).toContainText('ready>');
});

test('Quit destroys the window', async ({ page }) => {
  await boot(page, { tunnel: true });
  await closeWindow(page);
  await expect(dialog(page).getByText('1 tunnel will be closed.')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Quit' }).click();
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
});

test("Don't ask again sticks, and the next close quits without asking", async ({ page }) => {
  await boot(page, { tunnel: true });
  await closeWindow(page);
  await dialog(page).getByLabel("Don't ask again").check();
  await dialog(page).getByRole('button', { name: 'Quit' }).click();
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
  expect(await page.evaluate(() => localStorage.getItem('omnyssh-confirm-quit'))).toBe('false');
  const stored = await page.evaluate(() =>
    (window as unknown as { __calls: Call[] }).__calls.find((c) => c.cmd === 'plugin:store|set')?.args
  );
  expect(stored).toMatchObject({ key: 'confirmQuit', value: false });

  // The next launch.
  await page.reload();
  await expect(page.getByText('web-1', { exact: true })).toBeVisible();
  await closeWindow(page);
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
  await expect(dialog(page)).toHaveCount(0);

  // Settings turns the question back on.
  await page.getByRole('button', { name: 'Settings' }).click();
  const ask = page.getByRole('switch', { name: 'Ask before quitting' });
  await expect(ask).toHaveAttribute('aria-checked', 'false');
  await ask.click();
  await expect(ask).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('omnyssh-confirm-quit'))).toBe('true');
});

test('with nothing live the window closes at once', async ({ page }) => {
  await boot(page);
  await closeWindow(page);
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
  await expect(dialog(page)).toHaveCount(0);
});

test('a window the tray already hid is left alone', async ({ page }) => {
  await boot(page, { tunnel: true, visible: false });
  await closeWindow(page);
  await expect.poll(() => calls(page)).toContain('plugin:window|is_visible');
  await page.waitForTimeout(100);
  expect(await calls(page)).not.toContain('plugin:window|destroy');
  await expect(dialog(page)).toHaveCount(0);
});

test('the question brings a minimized window forward, once', async ({ page }) => {
  await boot(page, { tunnel: true });
  await closeWindow(page);
  await expect(dialog(page).getByText('1 tunnel will be closed.')).toBeVisible();
  await expect
    .poll(() => calls(page))
    .toEqual(expect.arrayContaining(['plugin:window|unminimize', 'plugin:window|set_focus']));

  // A second close while it is open does not stack another.
  await closeWindow(page);
  await expect(dialog(page)).toHaveCount(1);

  // Keeping it running in the tray instead goes to the setting.
  await dialog(page).getByRole('button', { name: 'Keep running in the tray instead' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Close to tray' })).toBeVisible();
  expect(await calls(page)).not.toContain('plugin:window|destroy');
});

test('with nothing live a minimized window closes where it is', async ({ page }) => {
  await boot(page);
  await closeWindow(page);
  await expect.poll(() => calls(page)).toContain('plugin:window|destroy');
  await expect(dialog(page)).toHaveCount(0);
  expect(await calls(page)).not.toContain('plugin:window|unminimize');
});

// The Desktop Chrome device reports a Windows user agent: Ctrl+W is the shell's.
test('off macOS Ctrl+W goes to the terminal', async ({ page }) => {
  await boot(page);
  await openTerminal(page);
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('button', { name: 'web-1 · terminal', exact: true })).toBeVisible();
});

test.describe('on macOS', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
  });

  test('⌘W closes the active tab, not the window', async ({ page }) => {
    await boot(page);
    await openTerminal(page);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Meta+w');
    await expect(page.getByRole('button', { name: 'web-1 · terminal', exact: true })).toHaveCount(0);
    await expect(page.locator('.xterm')).toHaveCount(0);
    expect(await calls(page)).not.toContain('plugin:window|destroy');

    // With no tab left it does nothing.
    await page.keyboard.press('Meta+w');
    await expect(page.getByText('web-1', { exact: true })).toBeVisible();
    expect(await calls(page)).not.toContain('plugin:window|destroy');
  });

  test('⌘W leaves the tab alone while a dialog is open', async ({ page }) => {
    await boot(page);
    await openTerminal(page);
    await closeWindow(page);
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Meta+w');
    await expect(page.getByRole('button', { name: 'web-1 · terminal', exact: true })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: 'Keep running in the menu bar instead' })).toBeVisible();
  });

  test('⌘W leaves the tab alone while the command palette is open', async ({ page }) => {
    await boot(page);
    await openTerminal(page);
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Meta+w');
    await expect(page.getByRole('button', { name: 'web-1 · terminal', exact: true })).toBeVisible();
  });
});
