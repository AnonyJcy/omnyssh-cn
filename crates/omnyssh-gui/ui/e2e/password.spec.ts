import { expect, test, type Page } from '@playwright/test';

// Login passwords (tech-gui.md §4.2/§4.3). e2e runs against the static SPA with
// Tauri absent, so `__TAURI_INTERNALS__` is stubbed at the boundary (§6.4). The
// stub plays the core: opening files on a host without a usable key sends
// `password-required`, `answer_password` hands the answer back, a wrong password
// comes back as a new request marked `retry`, and every answer is recorded.
const HOSTS = [
  { name: 'nas', hostname: 'nas.example.com', user: 'admin', port: 22, tags: [], source: 'sshConfig', hasKey: false, localForwards: [], tunnelAutostart: false, forwardAgent: false }
];

type Answer = { requestId: number; password: string | null };

async function boot(page: Page): Promise<void> {
  await page.addInitScript(
    ({ hosts }) => {
      let cbid = 0;
      let request = 0;
      const win = window as unknown as Record<string, unknown>;
      const listeners: Record<string, number[]> = {};
      const answers: Array<{ requestId: number; password: string | null }> = [];
      win.__answers = answers;

      function fire(event: string, payload: unknown): void {
        for (const id of listeners[event] ?? []) {
          const cb = win[`__cb${id}`] as ((e: unknown) => void) | undefined;
          cb?.({ event, id, payload });
        }
      }
      win.__fire = fire;

      function ask(retry: boolean): number {
        request += 1;
        const requestId = request;
        setTimeout(
          () =>
            fire('password-required', {
              requestId,
              hostName: 'nas',
              login: 'admin@nas.example.com',
              retry,
              newHostKey: null
            }),
          0
        );
        return requestId;
      }

      let waiting: ((ok: boolean) => void) | null = null;

      (win as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown>) => {
          switch (cmd) {
            case 'list_hosts':
              return Promise.resolve(hosts);
            case 'sftp_open':
              // Resolves only once the login is settled, as the core's connect does.
              ask(false);
              return new Promise((resolve, reject) => {
                waiting = (ok) => (ok ? resolve(11) : reject({ message: 'SFTP SSH connect: SSH login cancelled for nas' }));
              });
            case 'list_local_roots':
              return Promise.resolve(['/']);
            case 'answer_password': {
              const { requestId, password } = args as { requestId: number; password: string | null };
              // Only the request the stub issued last is waited on, as in the core.
              if (requestId !== request) return Promise.reject({ message: 'no login is waiting for this password' });
              answers.push({ requestId, password });
              if (password === null) waiting?.(false);
              else if (password === 'sesame') waiting?.(true);
              else ask(true);
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
        },
        unregisterCallback: (id: number) => {
          delete win[`__cb${id}`];
        }
      };
    },
    { hosts: HOSTS }
  );
  await page.goto('/');
  await expect(page.getByText('1 host')).toBeVisible();
}

const answers = (page: Page): Promise<Answer[]> =>
  page.evaluate(() => (window as unknown as { __answers: Answer[] }).__answers);

test('a login without a usable key asks for the password until the server takes one', async ({ page }) => {
  await boot(page);
  await page.getByTitle('files on nas').click();

  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await expect(dialog.getByText('SSH login — nas')).toBeVisible();
  await expect(dialog.getByText('admin@nas.example.com')).toBeVisible();
  const input = dialog.getByLabel('Password');
  await expect(input).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Log in' })).toBeDisabled();
  await expect(dialog.getByText('Permission denied')).toHaveCount(0);

  // A refused password comes back as a fresh prompt that says so.
  await input.fill('wrong');
  await input.press('Enter');
  await expect(dialog.getByText('Permission denied, please try again.')).toBeVisible();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await input.fill('sesame');
  await input.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await answers(page)).toEqual([
    { requestId: 1, password: 'wrong' },
    { requestId: 2, password: 'sesame' }
  ]);
});

test('cancelling ends the login with the reason', async ({ page }) => {
  await boot(page);
  await page.getByTitle('files on nas').click();

  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await expect(dialog.getByLabel('Password')).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await answers(page)).toEqual([{ requestId: 1, password: null }]);
  await expect(page.getByRole('main').getByText('SFTP SSH connect: SSH login cancelled for nas')).toBeVisible();
});

test('a server met for the first time shows its host key before the password goes', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const fire = (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire;
    fire('password-required', {
      requestId: 40,
      hostName: 'nas',
      login: 'admin@nas.example.com',
      retry: false,
      newHostKey: 'SHA256:abcDEF123'
    });
  });
  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await expect(dialog.getByText('SHA256:abcDEF123')).toBeVisible();
});

test('a prompt its login gave up on closes and says so when answered', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const fire = (window as unknown as { __fire: (e: string, p: unknown) => void }).__fire;
    fire('password-required', { requestId: 41, hostName: 'nas', login: 'admin@nas.example.com', retry: false, newHostKey: null });
  });
  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await dialog.getByLabel('Password').fill('late');
  await dialog.getByLabel('Password').press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('That login stopped waiting for a password. Open it again.')).toBeVisible();
});

test('a click beside the dialog does not cancel the login', async ({ page }) => {
  await boot(page);
  await page.getByTitle('files on nas').click();
  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await expect(dialog.getByLabel('Password')).toBeFocused();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  expect(await answers(page)).toEqual([]);
});

test('streamer mode keeps the host out of the prompt', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('omnyssh-streamer-mode', 'true'));
  await boot(page);
  await page.getByTitle('files on nas').click();

  const dialog = page.getByRole('dialog', { name: 'SSH login' });
  await expect(dialog.getByLabel('Password')).toBeFocused();
  await expect(dialog.getByText('nas.example.com')).toHaveCount(0);
});
