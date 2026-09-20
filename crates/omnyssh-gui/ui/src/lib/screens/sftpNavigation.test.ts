// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { translate } from '$lib/i18n';

describe('SFTP navigation and quick locations', () => {
  it('provides translations for quick access buttons and path editing in both zh-CN and en', () => {
    expect(translate('zh-CN', 'sftp.desktop')).toBe('桌面');
    expect(translate('en', 'sftp.desktop')).toBe('Desktop');

    expect(translate('zh-CN', 'sftp.downloads')).toBe('下载');
    expect(translate('en', 'sftp.downloads')).toBe('Downloads');

    expect(translate('zh-CN', 'sftp.documents')).toBe('文档');
    expect(translate('en', 'sftp.documents')).toBe('Documents');

    expect(translate('zh-CN', 'sftp.home_dir')).toBe('主目录');
    expect(translate('en', 'sftp.home_dir')).toBe('Home');

    expect(translate('zh-CN', 'sftp.root_dir')).toBe('根目录');
    expect(translate('en', 'sftp.root_dir')).toBe('Root');

    expect(translate('zh-CN', 'sftp.path_placeholder')).toBe('输入路径并按回车…');
    expect(translate('en', 'sftp.path_placeholder')).toBe('Enter path and press Enter…');

    expect(translate('zh-CN', 'sftp.go_to_path')).toBe('前往路径');
    expect(translate('en', 'sftp.go_to_path')).toBe('Go to path');

    expect(translate('zh-CN', 'sftp.click_to_edit_path')).toBe('点击修改路径');
    expect(translate('en', 'sftp.click_to_edit_path')).toBe('Click to edit path');
  });

  it('handles path normalization across Windows and Unix conventions', () => {
    function normalize(p: string): string {
      return p.replace(/[\\/]+$/, '').toLowerCase().replace(/\\/g, '/');
    }

    expect(normalize('C:\\Users\\User\\Desktop\\')).toBe('c:/users/user/desktop');
    expect(normalize('c:/Users/User/Desktop')).toBe('c:/users/user/desktop');
    expect(normalize('/home/user/Desktop/')).toBe('/home/user/desktop');
    expect(normalize('/home/user/Desktop')).toBe('/home/user/desktop');
  });
});
