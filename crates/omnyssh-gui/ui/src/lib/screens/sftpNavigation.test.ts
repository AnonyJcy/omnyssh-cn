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

    expect(translate('zh-CN', 'sftp.hide_lnk')).toBe('隐藏 .lnk');
    expect(translate('en', 'sftp.hide_lnk')).toBe('Hide .lnk');
    expect(translate('zh-CN', 'sftp.show_lnk')).toBe('显示 .lnk');
    expect(translate('en', 'sftp.show_lnk')).toBe('Show .lnk');
  });

  it('filters .lnk files when on Windows and hideLnk is enabled', () => {
    const entries = [
      { name: '..', path: 'C:\\Users\\User', size: 0, isDir: true },
      { name: 'Projects', path: 'C:\\Users\\User\\Desktop\\Projects', size: 0, isDir: true },
      { name: 'document.pdf', path: 'C:\\Users\\User\\Desktop\\document.pdf', size: 1024, isDir: false },
      { name: 'WeChat.lnk', path: 'C:\\Users\\User\\Desktop\\WeChat.lnk', size: 512, isDir: false },
      { name: 'Chrome.LNK', path: 'C:\\Users\\User\\Desktop\\Chrome.LNK', size: 512, isDir: false }
    ];

    function filterEntries(
      list: typeof entries,
      isWin: boolean,
      hideLnk: boolean
    ) {
      if (isWin && hideLnk) {
        return list.filter((e) => e.name === '..' || e.isDir || !e.name.toLowerCase().endsWith('.lnk'));
      }
      return list;
    }

    const filtered = filterEntries(entries, true, true);
    expect(filtered.map((e) => e.name)).toEqual(['..', 'Projects', 'document.pdf']);

    const shown = filterEntries(entries, true, false);
    expect(shown.map((e) => e.name)).toEqual(['..', 'Projects', 'document.pdf', 'WeChat.lnk', 'Chrome.LNK']);
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
