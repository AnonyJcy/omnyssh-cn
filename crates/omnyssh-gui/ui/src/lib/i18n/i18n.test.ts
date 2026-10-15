// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { locale, t, translate, SUPPORTED_LOCALES } from './index';
import { en, type TranslationKey } from './locales/en';
import { zhCN } from './locales/zh-CN';

describe('i18n module', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('supports zh-CN and en locales', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(2);
    expect(SUPPORTED_LOCALES.map((l) => l.code)).toEqual(['zh-CN', 'en']);
  });

  it('translates basic keys in zh-CN and en', () => {
    expect(translate('zh-CN', 'dashboard.title')).toBe('仪表盘');
    expect(translate('en', 'dashboard.title')).toBe('Dashboard');
  });

  it('interpolates parameters correctly', () => {
    expect(translate('zh-CN', 'dashboard.no_match', { query: 'test-server' })).toBe(
      '没有匹配 “test-server” 的主机。'
    );
    expect(translate('en', 'dashboard.no_match', { query: 'test-server' })).toBe(
      'No hosts match “test-server”.'
    );
    expect(translate('zh-CN', 'dashboard.restore_password_title', { name: 'prod-server' })).toBe(
      '恢复 prod-server 的密码登录'
    );
    expect(translate('en', 'dashboard.restore_password_title', { name: 'prod-server' })).toBe(
      'Restore password login for prod-server'
    );
  });

  it('keeps both dictionaries complete with matching interpolation parameters', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    const parameters = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as TranslationKey[]) {
      expect(zhCN[key].trim(), key).not.toBe('');
      // Chinese may omit a grammatical noun parameter (e.g. English host/hosts).
      // It must never invent a parameter the caller cannot supply.
      for (const param of parameters(zhCN[key])) {
        expect(parameters(en[key]), key).toContain(param);
      }
      if (key.startsWith('quit.') || key.startsWith('keysetup.confirm_') || key === 'dashboard.moved_position') {
        expect(parameters(zhCN[key]), key).toEqual(parameters(en[key]));
      }
    }
  });

  it('translates new safety controls and never loses their placeholders', () => {
    expect(translate('zh-CN', 'keysetup.confirm_setup_title', { name: 'web' })).toBe('为 web 配置密钥登录？');
    expect(translate('zh-CN', 'keysetup.failed_password_may_be_off')).toBe('密钥配置失败——密码登录可能已关闭');
    expect(translate('zh-CN', 'quit.summary', { summary: '1 条隧道' })).toBe('将关闭 1 条隧道。');
    expect(translate('en', 'quit.summary', { summary: '1 tunnel' })).toBe('1 tunnel will be closed.');
  });

  it('reactive t store reflects locale changes', () => {
    locale.set('zh-CN');
    expect(get(locale)).toBe('zh-CN');
    const translateFnZh = get(t);
    expect(translateFnZh('sidebar.dashboard')).toBe('仪表盘');

    locale.set('en');
    expect(get(locale)).toBe('en');
    const translateFnEn = get(t);
    expect(translateFnEn('sidebar.dashboard')).toBe('Dashboard');
  });
});
