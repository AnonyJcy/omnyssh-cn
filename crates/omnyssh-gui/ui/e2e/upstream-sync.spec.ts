import { expect, test, type Page } from '@playwright/test';

// Chinese-fork regression coverage for the upstream merge. No real SSH, filesystem or
// window operations: commands are recorded and backend events are delivered through
// the same Tauri callback boundary as the existing upstream E2E fixtures.
const HOSTS = [
  { name: 'web-1', hostname: 'web.example.com', user: 'deploy', port: 22, tags: [], source: 'manual', hasKey: true, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false },
  { name: 'pw-host', hostname: 'pw.example.com', user: 'root', port: 22, tags: ['prod'], source: 'manual', hasKey: false, monitoring: 'ssh', localForwards: [], tunnelAutostart: false, forwardAgent: false },
  { name: 'db', hostname: 'db.example.com', user: 'deploy', port: 22, tags: ['prod'], source: 'manual', hasKey: true, passwordAuthDisabled: true, monitoring: 'ssh', localForwards: [{ bindAddress: '192.168.1.5', bindPort: 8080, remoteHost: '10.20.3.7', remotePort: 5432 }], tunnelAutostart: false, forwardAgent: false }
];

type Call = { cmd: string; args: Record<string, unknown> };
type Bridge = {
  __syncCalls: Call[];
  __syncFire: (event: string, payload: unknown) => void;
  __syncHosts: Array<Record<string, unknown>>;
  __omnysshAsksOnClose?: boolean;
};

async function boot(page: Page, rootPaths = false): Promise<void> {
  await page.addInitScript(({ hosts, rootPaths }) => {
    localStorage.setItem('omnyssh-locale', 'zh-CN');
    localStorage.setItem('omnyssh-streamer-mode', 'false');
    localStorage.setItem('omnyssh-confirm-quit', 'true');
    localStorage.setItem('omnyssh-dashboard-view', JSON.stringify({ groupByTag: false, collapsed: [], sort: 'custom', order: [] }));
    let callbackId = 0;
    let sessionId = 0;
    const callbacks: Record<number, (value: unknown) => void> = {};
    const listeners: Record<string, number[]> = {};
    const win = window as unknown as Record<string, unknown>;
    const state = hosts.map((h) => ({ ...h })) as Array<Record<string, unknown>>;
    const calls: Call[] = [];
    win.__syncCalls = calls;
    win.__syncHosts = state;
    const fire = (event: string, payload: unknown): void => {
      for (const id of [...(listeners[event] ?? [])]) callbacks[id]?.({ event, id, payload });
    };
    win.__syncFire = fire;

    type Entry = { name: string; path: string; size: number; isDir: boolean };
    const file = (path: string): Entry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, size: 24, isDir: false });
    const folder = (path: string): Entry => ({ ...file(path), size: 0, isDir: true });
    const local: Record<string, Entry[]> = {
      '/home/user/Desktop': [file('/home/user/Desktop/notes.txt'), folder('/home/user/Desktop/work')],
      '/home/user/Downloads': [file('/home/user/Downloads/download.txt')],
      '/home/user/Documents': [file('/home/user/Documents/document.txt')],
      '/home/user': [folder('/home/user/Desktop')],
      '/': [file('/root-file.txt')]
    };
    const remote: Record<string, Entry[]> = {
      '/': [file('/config.yml'), folder('/var')],
      '/var/log': [file('/var/log/server.log')]
    };
    const later = (event: string, payload: unknown): void => { setTimeout(() => fire(event, payload), 0); };

    win.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        calls.push({ cmd, args });
        switch (cmd) {
          case 'list_hosts': return Promise.resolve(state);
          case 'reload_hosts':
            later('hosts-loaded', state.map((h) => ({ ...h })));
            return Promise.resolve(null);
          case 'list_snippets': return Promise.resolve([]);
          case 'restore_password_auth': {
            const host = state.find((h) => h.name === args.hostName);
            if (host) host.passwordAuthDisabled = false;
            return Promise.resolve(null);
          }
          case 'set_tray_behavior': return Promise.resolve({ available: true, minimize: true });
          case 'plugin:window|is_visible': return Promise.resolve(true);
          case 'plugin:window|scale_factor': return Promise.resolve(window.devicePixelRatio);
          case 'plugin:store|load': return Promise.resolve(1);
          // Do not override the localStorage-first preferences during hydrate.
          case 'plugin:store|get': return Promise.resolve(undefined);
          case 'plugin:path|resolve_directory': {
            const dirs: Record<number, string> = { 18: '/home/user/Desktop', 7: '/home/user/Downloads', 6: '/home/user/Documents', 21: '/home/user' };
            return Promise.resolve(rootPaths ? '/' : (dirs[args.directory as number] ?? '/home/user'));
          }
          case 'list_local_roots': return Promise.resolve(['/']);
          case 'list_local_dir': return Promise.resolve(local[args.path as string] ?? []);
          case 'sftp_open': {
            const id = ++sessionId;
            later('sftp-connected', { sessionId: id, hostName: args.hostName });
            return Promise.resolve(id);
          }
          case 'sftp_list':
            later('sftp-dir-listed', { sessionId: args.sessionId, path: args.path, entries: remote[args.path as string] ?? [] });
            return Promise.resolve(null);
          // A transfer stays live until cancelled; queued operations must not start.
          case 'sftp_upload':
          case 'sftp_download':
            later('transfer-progress', { sessionId: args.sessionId, transferId: 1, done: 4, total: 8 });
            return Promise.resolve(null);
          case 'sftp_cancel':
            later('sftp-op-done', { sessionId: args.sessionId, ok: false, error: 'Transfer cancelled' });
            return Promise.resolve(null);
          case 'sftp_mkdir': {
            const path = args.path as string;
            const parent = path.slice(0, path.lastIndexOf('/')) || '/';
            (remote[parent] ||= []).push(folder(path));
            remote[path] = [];
            later('sftp-op-done', { sessionId: args.sessionId, ok: true });
            return Promise.resolve(null);
          }
          case 'terminal_open': {
            const id = ++sessionId;
            const channel = (args.onOutput as { id: number }).id;
            setTimeout(() => callbacks[channel]?.({ message: new TextEncoder().encode('ready> ').buffer, index: 0 }), 0);
            return Promise.resolve(id);
          }
          case 'plugin:event|listen': {
            const { event, handler } = args as { event: string; handler: number };
            (listeners[event] ||= []).push(handler);
            return Promise.resolve(handler);
          }
          case 'plugin:event|unlisten': {
            const { event, eventId } = args as { event: string; eventId: number };
            listeners[event] = (listeners[event] ?? []).filter((id) => id !== eventId);
            return Promise.resolve(null);
          }
          default: return Promise.resolve(null);
        }
      },
      transformCallback: (cb: (value: unknown) => void) => {
        const id = ++callbackId;
        callbacks[id] = cb;
        return id;
      },
      unregisterCallback: (id: number) => { delete callbacks[id]; }
    };
  }, { hosts: HOSTS, rootPaths });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '仪表盘', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('3 台主机');
  // reload_hosts is called after the complete event bridge is registered.
  await expect.poll(() => commands(page)).toContain('reload_hosts');
  await expect.poll(() => page.evaluate(() => (window as unknown as Bridge).__omnysshAsksOnClose)).toBe(true);
}

async function calls(page: Page, command: string): Promise<Call[]> {
  return page.evaluate((command) => (window as unknown as Bridge).__syncCalls.filter((c) => c.cmd === command), command);
}
async function commands(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as Bridge).__syncCalls.map((c) => c.cmd));
}
async function fire(page: Page, event: string, payload: unknown = null): Promise<void> {
  await page.evaluate(({ event, payload }) => (window as unknown as Bridge).__syncFire(event, payload), { event, payload });
}
async function patchHost(page: Page, name: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(({ name, patch }) => {
    const host = (window as unknown as Bridge).__syncHosts.find((h) => h.name === name);
    if (!host) throw new Error(`Unknown stub host ${name}`);
    Object.assign(host, patch);
  }, { name, patch });
}
async function beginSetup(page: Page): Promise<void> {
  await page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '配置密钥登录', exact: true });
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await confirm.getByRole('button', { name: '配置密钥登录', exact: true }).click();
  await expect.poll(() => calls(page, 'start_key_setup')).toHaveLength(1);
}
const progress = (page: Page) => page.getByRole('dialog', { name: 'SSH 密钥自动化配置 —— pw-host', exact: true });

test('中文密钥确认默认聚焦取消，取消与 Escape 均不启动操作', async ({ page }) => {
  await boot(page);
  const trigger = page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true });
  await trigger.click();
  const confirm = page.getByRole('dialog', { name: '配置密钥登录', exact: true });
  await expect(confirm).toContainText('为 pw-host 配置密钥登录？');
  await expect(confirm).toContainText('服务器上所有账户和设备的密码登录');
  await expect(confirm).toContainText('root@pw.example.com');
  await expect(confirm).toContainText('omnyssh_pw-host_ed25519');
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  expect(await calls(page, 'start_key_setup')).toHaveLength(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  expect(await calls(page, 'start_key_setup')).toHaveLength(0);
});

test('中文密钥完整成功显示密码关闭、备份和删除已保存密码', async ({ page }) => {
  await boot(page);
  await beginSetup(page);
  await patchHost(page, 'pw-host', { hasKey: true, passwordAuthDisabled: true });
  await fire(page, 'key-setup-complete', { hostName: 'pw-host', keyPath: '/home/user/.ssh/omnyssh_pw-host_ed25519', passwordOff: true });
  await expect(progress(page)).toContainText('密钥登录已配置，密码登录已关闭');
  await expect(progress(page)).toContainText('/etc/ssh/sshd_config.omnyssh_backup.*');
  await expect(progress(page)).toContainText('OmnySSH 中保存的密码已移除。');
  await progress(page).getByRole('button', { name: '完成', exact: true }).click();
  const card = page.locator('[data-card]').filter({ has: page.getByTitle('pw-host', { exact: true }) });
  await expect(card.getByRole('img', { name: '密码认证已禁用 —— 仅允许密钥登录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true })).toHaveCount(0);
});

test('中文部分成功保留密码并提供复用密钥关闭密码登录的确认', async ({ page }) => {
  await boot(page);
  await beginSetup(page);
  await patchHost(page, 'pw-host', { hasKey: true, passwordAuthDisabled: false });
  await fire(page, 'key-setup-complete', { hostName: 'pw-host', keyPath: '/home/user/.ssh/omnyssh_pw-host_ed25519', passwordOff: false });
  await expect(progress(page)).toContainText('密码登录仍然开启');
  await expect(progress(page)).toContainText('已保留您保存的密码。');
  await expect(progress(page)).not.toContainText('密码登录已关闭');
  await progress(page).getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '密码登录已启用', exact: true }).click();
  const rerun = page.getByRole('dialog', { name: '关闭密码登录', exact: true });
  await expect(rerun).toContainText('复用 OmnySSH 之前生成的登录密钥');
  await expect(rerun.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await rerun.getByRole('button', { name: '关闭密码登录', exact: true }).click();
  await expect.poll(() => calls(page, 'start_key_setup')).toHaveLength(2);
});

test('中文危险失败保留恢复指导并用保存的密钥打开终端', async ({ page }) => {
  await boot(page);
  await beginSetup(page);
  await patchHost(page, 'pw-host', { hasKey: true });
  await fire(page, 'key-setup-failed', { hostName: 'pw-host', error: 'sshd reload timed out', passwordMayBeOff: true });
  await expect(progress(page)).toContainText('密钥配置失败——密码登录可能已关闭');
  await expect(progress(page)).toContainText('SSH 服务下次重启后关闭');
  await expect(progress(page)).toContainText('sudo sshd -T | grep -i passwordauthentication');
  await expect(progress(page)).toContainText('服务器提供商的控制台');
  await expect(progress(page)).not.toContainText('服务器密码认证配置未被更改');
  await expect(page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true })).toHaveCount(0);
  await progress(page).getByRole('button', { name: '打开终端', exact: true }).click();
  await expect(progress(page)).toHaveCount(0);
  await expect(page.locator('.xterm-rows')).toContainText('ready>');
  expect((await calls(page, 'terminal_open'))[0].args).toMatchObject({ hostName: 'pw-host' });
});

test('中文安全失败与回滚准确说明密码登录状态', async ({ page }) => {
  await boot(page);
  await beginSetup(page);
  await fire(page, 'key-setup-failed', { hostName: 'pw-host', error: 'Key verification failed', passwordMayBeOff: false });
  await expect(progress(page)).toContainText('服务器密码认证配置未被更改。');
  await expect(progress(page).getByRole('button', { name: '打开终端', exact: true })).toHaveCount(0);
  await progress(page).getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true }).click();
  await page.getByRole('dialog', { name: '配置密钥登录', exact: true }).getByRole('button', { name: '配置密钥登录', exact: true }).click();
  await expect.poll(() => calls(page, 'start_key_setup')).toHaveLength(2);
  await fire(page, 'key-setup-rollback', { hostName: 'pw-host', result: 'Final verification failed' });
  await expect(progress(page)).toContainText('密码登录已重新开启');
  await expect(progress(page)).toContainText('已从备份恢复服务器的 SSH 设置');
  await expect(progress(page)).toContainText('原因：Final verification failed');
});

test('中文视图分组与排序可用，原有恢复密码功能保留', async ({ page }) => {
  await boot(page);
  const viewButton = page.getByRole('button', { name: '视图选项', exact: true });
  await viewButton.click();
  const view = page.getByRole('dialog', { name: '视图选项', exact: true });
  await view.getByRole('radio', { name: '名称', exact: true }).click();
  await expect(view.getByRole('radio', { name: '名称', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-card] span.truncate.font-medium')).toHaveText(['db', 'pw-host', 'web-1']);
  await view.getByRole('switch', { name: '按标签分组', exact: true }).click();
  await expect(page.getByRole('region', { name: 'prod分组的主机', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '无标签分组的主机', exact: true })).toBeVisible();
  await view.getByRole('radio', { name: '状态', exact: true }).click();
  await expect(view.getByRole('radio', { name: '状态', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(view).toHaveCount(0);
  await expect(viewButton).toBeFocused();
  const pref = await page.evaluate(() => JSON.parse(localStorage.getItem('omnyssh-dashboard-view')!));
  expect(pref).toMatchObject({ groupByTag: true, sort: 'status' });
  const prod = page.getByRole('region', { name: 'prod分组的主机', exact: true });
  await prod.getByRole('button', { name: /^prod/ }).click();
  await expect(page.getByRole('button', { name: '恢复 db 的密码登录', exact: true })).toBeHidden();
  await prod.getByRole('button', { name: /^prod/ }).click();
  await page.getByRole('button', { name: '恢复 db 的密码登录', exact: true }).click();
  const restore = page.getByRole('dialog', { name: '恢复密码登录', exact: true });
  await expect(restore).toContainText('现有的 SSH 密钥免密登录将被完整保留');
  await restore.getByRole('button', { name: '取消', exact: true }).click();
  expect(await calls(page, 'restore_password_auth')).toHaveLength(0);
  await page.getByRole('button', { name: '恢复 db 的密码登录', exact: true }).click();
  await restore.getByRole('button', { name: '恢复密码登录', exact: true }).click();
  await expect(restore).toHaveCount(0);
  expect((await calls(page, 'restore_password_auth'))[0].args).toMatchObject({ hostName: 'db' });
});

test('中文 SFTP 快捷目录、路径输入、新建文件夹和批量取消', async ({ page }) => {
  await boot(page);
  await page.getByTitle('SFTP (web-1)', { exact: true }).click();
  const local = page.getByRole('region', { name: '本地', exact: true });
  const remote = page.getByRole('region', { name: 'web-1', exact: true });
  await expect(local.getByText('notes.txt', { exact: true })).toBeVisible();
  await expect(remote.getByText('config.yml', { exact: true })).toBeVisible();
  for (const label of ['桌面', '下载', '文档', '主目录', '根目录']) {
    await expect(local.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await local.getByRole('button', { name: '下载', exact: true }).click();
  await expect(local.getByText('download.txt', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: '文档', exact: true }).click();
  await expect(local.getByText('document.txt', { exact: true })).toBeVisible();
  await local.getByRole('button', { name: '桌面', exact: true }).click();
  await remote.getByRole('button', { name: '/', exact: true }).click();
  const input = remote.getByPlaceholder('输入路径并按回车…');
  await expect(input).toBeFocused();
  await input.fill('/var/log');
  await remote.getByRole('button', { name: '前往路径', exact: true }).click();
  await expect(remote.getByText('server.log', { exact: true })).toBeVisible();
  await remote.getByRole('button', { name: '根目录', exact: true }).click();
  await remote.getByRole('button', { name: '新建文件夹', exact: true }).click();
  const mkdir = page.getByRole('dialog', { name: '新建文件夹', exact: true });
  await mkdir.getByRole('textbox', { name: '文件夹名称', exact: true }).fill('中文资料');
  await mkdir.getByRole('button', { name: '创建', exact: true }).click();
  await expect(remote.getByText('中文资料', { exact: true })).toBeVisible();
  expect((await calls(page, 'sftp_mkdir'))[0].args).toMatchObject({ path: '/中文资料' });
  await local.getByRole('checkbox', { name: '标记 notes.txt', exact: true }).click();
  await local.getByRole('checkbox', { name: '标记 work', exact: true }).click();
  await local.getByRole('button', { name: '上传', exact: true }).click();
  const strip = page.getByLabel('传输进度', { exact: true });
  await expect(strip).toContainText('正在上传');
  await strip.getByRole('button', { name: '取消传输', exact: true }).click();
  await expect(strip).toHaveCount(0);
  await expect(page.getByText('传输已取消', { exact: true })).toBeVisible();
  expect(await calls(page, 'sftp_cancel')).toHaveLength(1);
  expect(await calls(page, 'sftp_upload')).toHaveLength(1);
  expect((await calls(page, 'sftp_upload'))[0].args).toMatchObject({ local: '/home/user/Desktop/notes.txt', remote: '/notes.txt' });
});

test('SFTP 桌面、主目录和根目录重合时保持中文快捷入口且无页面错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page, true);
  await page.getByTitle('SFTP (web-1)', { exact: true }).click();
  const local = page.getByRole('region', { name: '本地', exact: true });
  await expect(local.getByText('root-file.txt', { exact: true })).toBeVisible();
  for (const label of ['桌面', '主目录', '根目录']) {
    const shortcut = local.getByRole('button', { name: label, exact: true });
    await expect(shortcut).toHaveAttribute('title', '/');
    await shortcut.click();
    await expect(local.getByText('root-file.txt', { exact: true })).toBeVisible();
  }
  await local.getByRole('button', { name: '/', exact: true }).click();
  const path = local.getByPlaceholder('输入路径并按回车…');
  await expect(path).toHaveValue('/');
  await path.fill('/');
  await path.press('Enter');
  await expect(path).toHaveCount(0);
  await expect(local.getByText('root-file.txt', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('中文命令搜索切换主播模式，表单和错误不泄露真实地址', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: '命令面板 (⌘K)', exact: true });
  await palette.getByRole('textbox').fill('主播');
  await expect(palette.getByText('命令', { exact: true })).toBeVisible();
  await expect(palette.getByRole('button', { name: /切换主播模式/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  const bar = page.getByRole('contentinfo');
  await expect(bar.getByRole('img', { name: '主播模式已开启 —— 主机名已脱敏', exact: true })).toBeVisible();
  await fire(page, 'error', { message: 'Tunnel to db.example.com:8080:10.20.3.7:5432 refused' });
  await expect(bar).toContainText('127.0.0.1');
  await expect(bar).not.toContainText('db.example.com');
  await expect(bar).not.toContainText('10.20.3.7');
  await expect(bar.locator('span[title]').first()).not.toHaveAttribute('title', /db\.example\.com|10\.20\.3\.7/);
  await page.getByRole('button', { name: '为 pw-host 自动配置 SSH 密钥', exact: true }).click();
  const keyConfirm = page.getByRole('dialog', { name: '配置密钥登录', exact: true });
  await expect(keyConfirm).toContainText('主播模式下已隐藏密钥路径');
  await expect(keyConfirm).toContainText('admin@127.0.0.1');
  await expect(keyConfirm).not.toContainText('pw.example.com');
  await expect(keyConfirm).not.toContainText('omnyssh_pw-host_ed25519');
  await keyConfirm.getByRole('button', { name: '取消', exact: true }).click();
  expect(await calls(page, 'start_key_setup')).toHaveLength(0);
  await page.getByRole('button', { name: '编辑主机 db', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑主机', exact: true });
  for (const [label, value] of [
    ['主机地址 / IP', '127.0.0.1'],
    ['转发 1 的本地端口', '127.0.0.1:8080'],
    ['转发 1 的远程主机', '127.0.0.1']
  ]) {
    await expect(editor.getByLabel(label, { exact: true })).toHaveValue(value);
    await expect(editor.getByLabel(label, { exact: true })).toHaveAttribute('readonly', '');
  }
  await expect(editor.getByLabel('登录用户名', { exact: true })).toBeFocused();
  await expect(editor).not.toContainText('db.example.com');
  await expect(editor).not.toContainText('10.20.3.7');
  await expect(editor.getByRole('button', { name: '显示原值', exact: true })).toHaveCount(2);
  await editor.getByRole('button', { name: '保存主机', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = (await calls(page, 'save_host'))[0].args;
  expect(saved).toMatchObject({ input: { hostname: 'db.example.com', localForwards: [{ bindAddress: '192.168.1.5', remoteHost: '10.20.3.7' }] } });
  await page.keyboard.press('Control+k');
  await palette.getByRole('textbox').fill('主播');
  await palette.getByRole('button', { name: /切换主播模式/ }).click();
  await expect(bar.getByRole('img', { name: '主播模式已开启 —— 主机名已脱敏', exact: true })).toHaveCount(0);
  await expect(bar).toContainText('db.example.com');
});

test('中文退出摘要保留终端和隧道，默认取消防止误按 Enter 退出', async ({ page }) => {
  await boot(page);
  await fire(page, 'tunnel-status-changed', { hostName: 'db', status: { kind: 'up' } });
  await page.getByTitle('终端 (web-1)', { exact: true }).click();
  await expect(page.locator('.xterm-rows')).toContainText('ready>');
  await page.locator('.xterm-helper-textarea').focus();
  await fire(page, 'tauri://close-requested');
  const quit = page.getByRole('dialog', { name: '退出 OmnySSH？', exact: true });
  await expect(quit).toContainText('将关闭 1 个终端和1 条隧道。');
  await expect(quit.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await fire(page, 'tauri://close-requested');
  await expect(quit).toHaveCount(1);
  await expect(quit.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(quit).toHaveCount(0);
  expect(await commands(page)).not.toContain('plugin:window|destroy');
  expect(await calls(page, 'terminal_close')).toHaveLength(0);
  await expect(page.locator('.xterm-rows')).toContainText('ready>');
  await fire(page, 'tauri://close-requested');
  await expect(quit.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await quit.getByRole('button', { name: '退出', exact: true }).click();
  await expect.poll(() => commands(page)).toContain('plugin:window|destroy');
});
