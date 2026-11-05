<script lang="ts">
  // The find bar over a terminal tab (⌘F / Ctrl+Shift+F). Drives xterm's search addon
  // over the scrollback: every match is highlighted, the current one more strongly, and
  // the highlights follow new output while the bar is open. Enter and Shift+Enter step
  // through matches; Esc closes the bar and hands the keyboard back to the terminal.
  import { onMount, onDestroy } from 'svelte';
  import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
  import { theme } from '$lib/stores/theme';
  import { lastError } from '$lib/stores/notifications';
  import { searchColours } from '$lib/theme/terminalTheme';
  import Icon from '$lib/theme/Icon.svelte';
  import { isMac } from '$lib/platform';
  import { t, locale } from '$lib/i18n';
  import { findLabel, type FindResult } from './terminalFind';
  import { isFindShortcut } from './terminalInput';

  let {
    search,
    seed = '',
    onclose
  }: { search: SearchAddon; seed?: string; onclose: () => void } = $props();

  let input: HTMLInputElement;
  let query = $state('');
  let caseSensitive = $state(false);
  let regex = $state(false);
  let result = $state<FindResult>({ kind: 'idle' });
  let resultsSub: { dispose(): void } | undefined;

  const shortcut = isMac ? '⌘F' : 'Ctrl+Shift+F';

  // The options the highlights were drawn with. The addon records new options before
  // comparing them with the last ones (addon-search 0.16), so it never notices a
  // change of case, regex or colours by itself; dropping its cached query makes it
  // highlight afresh.
  let drawnWith = '';

  function find(backwards: boolean, incremental = false): void {
    if (!query) {
      search.clearDecorations();
      result = { kind: 'idle' };
      return;
    }
    const key = `${caseSensitive}|${regex}|${$theme}`;
    if (key !== drawnWith) {
      search.clearDecorations();
      drawnWith = key;
    }
    const options: ISearchOptions = {
      caseSensitive,
      regex,
      incremental,
      decorations: searchColours($theme)
    };
    try {
      if (backwards) search.findPrevious(query, options);
      else search.findNext(query, options);
    } catch (err) {
      // Drop the last good query's highlights so they do not pass for this one's.
      search.clearDecorations();
      if (regex && err instanceof SyntaxError) {
        result = { kind: 'invalid' };
      } else {
        result = { kind: 'idle' };
        lastError.set(`Find failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Search as the query is typed, and again when an option or the theme (the
  // highlight colours) changes. Incremental keeps the current match while it still
  // matches the longer query, rather than jumping to the next one.
  $effect(() => {
    void [query, caseSensitive, regex, $theme];
    find(false, true);
  });

  /** Take the keyboard, optionally starting from `seed` (a one-line selection). */
  export function focus(seed?: string): void {
    if (seed) query = seed;
    input?.focus();
    input?.select();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      find(e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (isFindShortcut(e, isMac)) {
      e.preventDefault();
      input.select();
    }
  }

  onMount(() => {
    resultsSub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      result = { kind: 'matches', index: resultIndex, count: resultCount };
    });
    focus(seed);
  });

  onDestroy(() => {
    resultsSub?.dispose();
    try {
      search.clearDecorations();
    } catch {
      // The terminal, and the addon with it, may already be disposed.
    }
  });

  // Buttons keep the keyboard in the query, so Enter goes on stepping after a click.
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  const iconButton =
    'flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-inset ' +
    'hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-40';
  const toggleOn = 'bg-surface-inset text-fg';
  let noMatches = $derived(
    result.kind === 'invalid' || (result.kind === 'matches' && result.count === 0)
  );
  let canStep = $derived(result.kind === 'matches' && result.count > 0);
</script>

<div
  role="search"
  class="absolute right-4 z-10 flex items-center gap-1 rounded-xl border border-default bg-surface-raised py-1 pl-3 pr-1 shadow-soft"
  style="top: max(var(--titlebar-h), 0.5rem);"
>
  <span class="flex text-muted"><Icon name="search" size={14} /></span>
  <input
    bind:this={input}
    bind:value={query}
    onkeydown={onKeydown}
    type="text"
    placeholder={$t('terminal.find')}
    title={$t('terminal.find_in_terminal', { shortcut })}
    aria-label={$t('terminal.find_aria_label')}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    class="w-44 bg-transparent px-1 py-1 text-sm text-fg outline-none placeholder:text-faint"
  />
  <span
    class="min-w-[5.5rem] whitespace-nowrap pr-1 text-right text-xs tabular-nums {noMatches
      ? 'text-status-crit'
      : 'text-muted'}"
    aria-live="polite">{findLabel(result, $locale)}</span
  >
  <button
    type="button"
    class="{iconButton} font-mono text-xs {caseSensitive ? toggleOn : ''}"
    title={$t('terminal.find_match_case')}
    aria-label={$t('terminal.find_match_case')}
    aria-pressed={caseSensitive}
    onmousedown={keepFocus}
    onclick={() => (caseSensitive = !caseSensitive)}>Aa</button
  >
  <button
    type="button"
    class="{iconButton} font-mono text-xs {regex ? toggleOn : ''}"
    title={$t('terminal.find_use_regex')}
    aria-label={$t('terminal.find_use_regex')}
    aria-pressed={regex}
    onmousedown={keepFocus}
    onclick={() => (regex = !regex)}>.*</button
  >
  <button
    type="button"
    class={iconButton}
    title={$t('terminal.find_prev')}
    aria-label={$t('terminal.find_prev_aria')}
    disabled={!canStep}
    onmousedown={keepFocus}
    onclick={() => find(true)}
  >
    <span class="flex rotate-180"><Icon name="chevron" size={14} /></span>
  </button>
  <button
    type="button"
    class={iconButton}
    title={$t('terminal.find_next')}
    aria-label={$t('terminal.find_next_aria')}
    disabled={!canStep}
    onmousedown={keepFocus}
    onclick={() => find(false)}
  >
    <Icon name="chevron" size={14} />
  </button>
  <button
    type="button"
    class={iconButton}
    title={$t('terminal.find_close')}
    aria-label={$t('terminal.find_close_aria')}
    onmousedown={keepFocus}
    onclick={onclose}
  >
    <Icon name="close" size={14} />
  </button>
</div>
