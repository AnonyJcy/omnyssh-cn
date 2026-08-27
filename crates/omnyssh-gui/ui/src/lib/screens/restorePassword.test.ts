// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { commands } from '$lib/bindings';
import { restorePasswordAuth } from '$lib/ipc/commands';
import { translate } from '$lib/i18n';

describe('restorePasswordAuth IPC command', () => {
  it('calls commands.restorePasswordAuth with hostName and resolves on ok', async () => {
    const spy = vi.spyOn(commands, 'restorePasswordAuth').mockResolvedValueOnce({
      status: 'ok',
      data: null
    });

    await expect(restorePasswordAuth('my-server')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('my-server');
  });

  it('throws descriptive error on command failure', async () => {
    vi.spyOn(commands, 'restorePasswordAuth').mockResolvedValueOnce({
      status: 'error',
      error: { message: 'Sudo access is required' }
    });

    await expect(restorePasswordAuth('my-server')).rejects.toThrow('Sudo access is required');
  });

  it('provides complete i18n translations for restore password modal and buttons in both zh-CN and en', () => {
    expect(translate('zh-CN', 'dashboard.restore_password_modal_title')).toBe('恢复密码登录');
    expect(translate('en', 'dashboard.restore_password_modal_title')).toBe('Restore Password Login');

    expect(translate('zh-CN', 'dashboard.restore_password_confirm', { name: 'web-1' })).toBe(
      '确定要恢复主机 “web-1” 的 SSH 密码登录吗？'
    );
    expect(translate('en', 'dashboard.restore_password_confirm', { name: 'web-1' })).toBe(
      'Restore SSH password login for “web-1”?'
    );

    expect(translate('zh-CN', 'dashboard.restore_password_btn')).toBe('恢复密码登录');
    expect(translate('en', 'dashboard.restore_password_btn')).toBe('Restore password');

    expect(translate('zh-CN', 'dashboard.restoring_password')).toBe('正在恢复…');
    expect(translate('en', 'dashboard.restoring_password')).toBe('Restoring…');
  });
});
