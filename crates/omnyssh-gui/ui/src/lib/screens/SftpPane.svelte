<script lang="ts">
  // One side of the dual-pane SFTP browser (tech-gui.md §3.2): an interactive
  // current-path header with quick-access buttons and a parent-supplied toolbar,
  // then the entry list. Clicking a directory (or the `..` row) navigates; clicking
  // a file previews; clicking the path allows manual input and navigation.
  import type { Snippet } from 'svelte';
  import { Icon, type IconName } from '$lib/theme';
  import type { FileEntryDto } from '$lib/bindings';
  import { formatBytes, type Pane } from '$lib/stores/sftp';
  import { t } from '$lib/i18n';

  export type ShortcutLocation = {
    label: string;
    path: string;
    icon?: IconName;
  };

  let {
    title,
    pane,
    shortcuts = [],
    isWindows = false,
    onNavigate,
    onNavigatePath,
    onToggleMark,
    onPreview,
    toolbar
  }: {
    title: string;
    pane: Pane;
    shortcuts?: ShortcutLocation[];
    isWindows?: boolean;
    onNavigate: (entry: FileEntryDto) => void;
    onNavigatePath?: (path: string) => void;
    onToggleMark: (path: string) => void;
    onPreview: (entry: FileEntryDto) => void;
    toolbar?: Snippet;
  } = $props();

  let isEditing = $state(false);
  let editValue = $state('');
  let pathInput = $state<HTMLInputElement>();

  let hideLnk = $state(
    typeof window !== 'undefined'
      ? (localStorage.getItem('omnyssh.sftp.hide_lnk') ?? 'true') === 'true'
      : true
  );

  function toggleHideLnk(): void {
    hideLnk = !hideLnk;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('omnyssh.sftp.hide_lnk', String(hideLnk));
      } catch {}
    }
  }

  const isWin = $derived(
    isWindows ||
      (pane.path ? pane.path.includes('\\') || /^[a-zA-Z]:/.test(pane.path) : false) ||
      (typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent))
  );

  const lnkFilesCount = $derived(
    pane.entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.lnk')).length
  );

  const visibleEntries = $derived.by(() => {
    if (isWin && hideLnk) {
      return pane.entries.filter((e) => e.name === '..' || e.isDir || !e.name.toLowerCase().endsWith('.lnk'));
    }
    return pane.entries;
  });

  function startEditing(): void {
    editValue = pane.path || '';
    isEditing = true;
    requestAnimationFrame(() => {
      pathInput?.focus();
      pathInput?.select();
    });
  }

  function cancelEditing(): void {
    isEditing = false;
  }

  function submitEditing(): void {
    const trimmed = editValue.trim();
    if (trimmed && onNavigatePath) {
      onNavigatePath(trimmed);
    }
    isEditing = false;
  }

  function normalize(p: string): string {
    return p.replace(/[\\/]+$/, '').toLowerCase();
  }

  function isSameLocation(a?: string, b?: string): boolean {
    if (!a || !b) return false;
    return normalize(a) === normalize(b);
  }

  const rowBase =
    'flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
</script>

<section aria-label={title} class="flex min-h-0 min-w-0 flex-1 flex-col">
  <header class="shrink-0 border-b border-default px-3 py-2.5">
    <div class="flex items-center justify-between gap-2">
      <h2
        title={title}
        class="truncate text-xs font-semibold uppercase tracking-[0.14em] text-muted"
      >
        {title}
      </h2>
      <div class="flex shrink-0 items-center gap-1">
        {#if isWin}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus {hideLnk
              ? 'border-accent/40 bg-accent/15 text-accent font-semibold'
              : 'border-default text-muted hover:border-strong hover:bg-surface-inset hover:text-fg'}"
            title={hideLnk ? $t('sftp.show_lnk_tooltip') : $t('sftp.hide_lnk_tooltip')}
            onclick={toggleHideLnk}
          >
            <Icon name={hideLnk ? 'eyeOff' : 'eye'} size={13} />
            <span>.lnk</span>
            {#if lnkFilesCount > 0}
              <span class="ml-0.5 rounded px-1 text-[10px] opacity-75 {hideLnk ? 'bg-accent/20' : 'bg-surface-inset'}">{lnkFilesCount}</span>
            {/if}
          </button>
        {/if}
        {@render toolbar?.()}
      </div>
    </div>

    <!-- Path Bar (editable address bar) -->
    {#if isEditing}
      <form
        class="mt-2 flex items-center gap-1.5"
        onsubmit={(e) => {
          e.preventDefault();
          submitEditing();
        }}
      >
        <div class="relative flex min-w-0 flex-1 items-center">
          <input
            bind:this={pathInput}
            bind:value={editValue}
            type="text"
            class="w-full rounded-md border border-accent bg-surface-inset px-2.5 py-1 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-accent"
            placeholder={$t('sftp.path_placeholder')}
            onkeydown={(e) => {
              if (e.key === 'Escape') cancelEditing();
            }}
          />
        </div>
        <button
          type="submit"
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-default text-muted transition hover:border-strong hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          title={$t('sftp.go_to_path')}
          aria-label={$t('sftp.go_to_path')}
        >
          <Icon name="check" size={13} />
        </button>
        <button
          type="button"
          class="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-default text-muted transition hover:border-strong hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          title={$t('sftp.cancel')}
          aria-label={$t('sftp.cancel')}
          onclick={cancelEditing}
        >
          <Icon name="close" size={13} />
        </button>
      </form>
    {:else}
      <div
        role="button"
        tabindex="0"
        class="group mt-2 flex items-center justify-between gap-2 rounded-md border border-default/40 bg-surface-inset/50 px-2.5 py-1 font-mono text-xs text-muted transition hover:border-default hover:bg-surface-inset cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
        title={$t('sftp.click_to_edit_path')}
        onclick={startEditing}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            startEditing();
          }
        }}
      >
        <div class="flex min-w-0 items-center gap-1.5 flex-1">
          <span class="text-faint transition group-hover:text-muted shrink-0">
            <Icon name="folder" size={13} />
          </span>
          <span class="truncate text-fg" title={pane.path}>
            {pane.path || '—'}
          </span>
        </div>
        <span
          class="shrink-0 text-faint opacity-50 transition group-hover:opacity-100 group-hover:text-muted"
          title={$t('sftp.click_to_edit_path')}
        >
          <Icon name="edit" size={12} />
        </span>
      </div>
    {/if}

    <!-- Quick Access Location Buttons -->
    {#if shortcuts.length > 0}
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        {#each shortcuts as sc (sc.path)}
          {@const active = isSameLocation(pane.path, sc.path)}
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus
              {active
                ? 'border border-accent/40 bg-accent/15 text-accent font-semibold shadow-sm'
                : 'border border-default/70 text-muted hover:border-strong hover:bg-surface-inset hover:text-fg'}"
            title={sc.path}
            onclick={() => onNavigatePath?.(sc.path)}
          >
            {#if sc.icon}<Icon name={sc.icon} size={11} />{/if}
            <span>{sc.label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
    {#if pane.error}
      <p class="px-2 py-6 text-center text-sm text-status-crit">{pane.error}</p>
    {:else if pane.loading && pane.entries.length === 0}
      <p class="px-2 py-6 text-center text-sm text-faint">{$t('sftp.loading')}</p>
    {:else if visibleEntries.length === 0}
      <p class="px-2 py-6 text-center text-sm text-faint">{$t('sftp.empty_directory')}</p>
    {:else}
      <ul class="space-y-0.5">
        {#each visibleEntries as entry, i (i)}
          {@const isParent = entry.name === '..'}
          {@const marked = pane.marked.has(entry.path)}
          <li class="flex items-center gap-1.5">
            {#if isParent}
              <span class="h-4 w-4 shrink-0"></span>
            {:else}
              <button
                type="button"
                role="checkbox"
                aria-checked={marked}
                aria-label="Mark {entry.name}"
                class="grid h-4 w-4 shrink-0 place-items-center rounded border transition
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
                  {marked ? 'border-accent bg-accent text-accent-fg' : 'border-strong text-transparent'}"
                onclick={() => onToggleMark(entry.path)}
              >
                {#if marked}<Icon name="check" size={11} />{/if}
              </button>
            {/if}
            <button
              type="button"
              class="{rowBase} text-muted hover:bg-surface-inset hover:text-fg"
              title={entry.name}
              onclick={() => (entry.isDir ? onNavigate(entry) : onPreview(entry))}
            >
              <Icon name={entry.isDir ? 'folder' : 'file'} size={15} />
              <span class="min-w-0 flex-1 truncate {entry.isDir ? 'font-medium text-fg' : ''}">
                {entry.name}
              </span>
              {#if !entry.isDir}
                <span class="shrink-0 tabular-nums text-xs text-faint">{formatBytes(entry.size)}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
