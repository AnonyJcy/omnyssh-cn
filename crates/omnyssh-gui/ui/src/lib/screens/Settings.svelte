<script lang="ts">
  // Minimal settings (tech-gui.md §4.3): the light/dark theme mirrored from the sidebar
  // (§5.1), the metric auto-refresh interval and the tray (tauri-plugin-store UI prefs),
  // and the update preferences (`check_on_startup`) + a manual update check. Update prefs
  // persist to the shared config via `save_update_config`; the rest are frontend prefs.
  import { onMount } from 'svelte';
  import type { UpdateConfigDto } from '$lib/bindings';
  import { Surface, Icon } from '$lib/theme';
  import { theme } from '$lib/stores/theme';
  import { streamerMode } from '$lib/stores/streamer';
  import { refreshInterval, REFRESH_OPTIONS } from '$lib/stores/settings';
  import { traySupport, trayBehavior } from '$lib/stores/tray';
  import { isMac } from '$lib/platform';
  import { offerUpdate } from '$lib/stores/update';
  import { lastError } from '$lib/stores/notifications';
  import { checkUpdate, loadUpdateConfig, saveUpdateConfig } from '$lib/ipc/commands';
  import { locale, SUPPORTED_LOCALES, t } from '$lib/i18n';

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  const formatInterval = (secs: number): string => (secs < 60 ? `${secs}s` : `${secs / 60}m`);

  let updateConfig = $state<UpdateConfigDto | null>(null);
  type CheckState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'upToDate' }
    | { kind: 'available'; version: string }
    | { kind: 'error'; message: string };
  let check = $state<CheckState>({ kind: 'idle' });

  onMount(async () => {
    try {
      updateConfig = await loadUpdateConfig();
    } catch (e) {
      lastError.set(message(e));
    }
  });

  // Persist immediately; revert the optimistic flip if the write fails. Read-modify-write
  // fresh rather than from the mount-time cache: the update banner may have written a
  // `skipVersion` out-of-band, and `save_update_config` replaces the whole [update]
  // section — writing a stale copy would clobber that skip.
  async function toggleCheckOnStartup(): Promise<void> {
    if (!updateConfig) return;
    const previous = updateConfig;
    const desired = !previous.checkOnStartup;
    updateConfig = { ...previous, checkOnStartup: desired };
    try {
      const current = await loadUpdateConfig();
      const next = { ...current, checkOnStartup: desired };
      await saveUpdateConfig(next);
      updateConfig = next;
    } catch (e) {
      updateConfig = previous;
      lastError.set(message(e));
    }
  }

  async function checkNow(): Promise<void> {
    check = { kind: 'checking' };
    try {
      const info = await checkUpdate();
      if (info) {
        offerUpdate(info); // raise the banner too
        check = { kind: 'available', version: info.version };
      } else {
        check = { kind: 'upToDate' };
      }
    } catch (e) {
      check = { kind: 'error', message: message(e) };
    }
  }

  const seg =
    'rounded-lg px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const segState = (active: boolean): string =>
    active ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-surface-inset hover:text-fg';
</script>

<section class="mx-auto h-full max-w-2xl p-6">
  <h1 class="mb-5 text-lg font-semibold tracking-tight">{$t('settings.title')}</h1>

  <div class="space-y-4">
    <!-- Language / 语言 -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('settings.language')}</h2>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">{$t('settings.language')}</p>
          <p class="text-xs text-muted">{$t('settings.language_desc')}</p>
        </div>
        <div class="flex gap-1 rounded-xl bg-surface-inset p-1">
          {#each SUPPORTED_LOCALES as loc (loc.code)}
            <button
              type="button"
              class="{seg} {segState($locale === loc.code)}"
              aria-pressed={$locale === loc.code}
              onclick={() => locale.set(loc.code)}
            >
              {loc.label}
            </button>
          {/each}
        </div>
      </div>
    </Surface>

    <!-- Appearance -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('settings.appearance')}</h2>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">{$t('settings.theme')}</p>
          <p class="text-xs text-muted">{$t('settings.theme_desc')}</p>
        </div>
        <div class="flex gap-1 rounded-xl bg-surface-inset p-1">
          <button
            type="button"
            class="{seg} {segState($theme === 'light')}"
            aria-pressed={$theme === 'light'}
            onclick={() => theme.set('light')}
          >
            <span class="flex items-center gap-1.5"><Icon name="sun" size={14} /> {$t('settings.theme_light')}</span>
          </button>
          <button
            type="button"
            class="{seg} {segState($theme === 'dark')}"
            aria-pressed={$theme === 'dark'}
            onclick={() => theme.set('dark')}
          >
            <span class="flex items-center gap-1.5"><Icon name="moon" size={14} /> {$t('settings.theme_dark')}</span>
          </button>
        </div>
      </div>
    </Surface>

    <!-- Privacy -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('settings.streamer_mode')}</h2>
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm">{$t('settings.streamer_mode')}</p>
          <p class="text-xs text-muted">
            {$t('settings.streamer_mode_desc')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={$streamerMode}
          aria-label={$t('settings.streamer_mode')}
          onclick={() => streamerMode.toggle()}
          class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {$streamerMode
            ? 'bg-accent'
            : 'bg-surface-inset'}"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {$streamerMode
              ? 'left-[1.375rem]'
              : 'left-0.5'}"
          ></span>
        </button>
      </div>
    </Surface>

    <!-- Dashboard -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('dashboard.title')}</h2>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm">{$t('settings.metrics_refresh')}</p>
          <p class="text-xs text-muted">{$t('settings.metrics_refresh_desc')}</p>
        </div>
        <div class="flex flex-wrap justify-end gap-1 rounded-xl bg-surface-inset p-1">
          {#each REFRESH_OPTIONS as secs (secs)}
            <button
              type="button"
              class="{seg} tabular-nums {segState($refreshInterval === secs)}"
              aria-pressed={$refreshInterval === secs}
              onclick={() => refreshInterval.set(secs)}
            >
              {formatInterval(secs)}
            </button>
          {/each}
        </div>
      </div>
    </Surface>

    <!-- Window: the tray keeps sessions and tunnels up with no window on screen. macOS
         has no minimize event to act on, and keeps minimized windows in the Dock. -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('settings.window')}</h2>
      <div class="space-y-4">
        {#if !isMac}
          {@render traySwitch(
            $t('settings.minimize_to_tray'),
            $traySupport.available && !$traySupport.minimize
              ? $t('settings.minimize_to_tray_wayland')
              : $t('settings.minimize_to_tray_desc'),
            $trayBehavior.minimizeToTray && $traySupport.minimize,
            $traySupport.minimize,
            () => trayBehavior.update({ minimizeToTray: !$trayBehavior.minimizeToTray })
          )}
        {/if}
        {@render traySwitch(
          isMac ? $t('settings.close_to_menu_bar') : $t('settings.close_to_tray'),
          $t('settings.close_to_tray_desc'),
          $trayBehavior.closeToTray && $traySupport.available,
          $traySupport.available,
          () => trayBehavior.update({ closeToTray: !$trayBehavior.closeToTray })
        )}
        {#if !$traySupport.available}
          <p class="text-xs text-status-warn">
            {$t('settings.no_tray_warning')}
          </p>
        {:else if $trayBehavior.minimizeToTray || $trayBehavior.closeToTray}
          <!-- Some desktops keep tray icons out of sight (GNOME without the AppIndicator
               extension, an overflow menu); a second launch always finds the window. -->
          <p class="text-xs text-muted">
            {$t('settings.relaunch_hint')}
          </p>
        {/if}
      </div>
    </Surface>

    <!-- Updates -->
    <Surface class="p-5">
      <h2 class="mb-3 text-sm font-semibold">{$t('settings.updates')}</h2>
      <div class="space-y-4">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm">{$t('settings.check_startup')}</p>
            <p class="text-xs text-muted">{$t('settings.check_startup_desc')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={updateConfig?.checkOnStartup ?? false}
            aria-label={$t('settings.check_startup')}
            disabled={!updateConfig}
            onclick={toggleCheckOnStartup}
            class="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {updateConfig?.checkOnStartup
              ? 'bg-accent'
              : 'bg-surface-inset'}"
          >
            <span
              class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {updateConfig?.checkOnStartup
                ? 'left-[1.375rem]'
                : 'left-0.5'}"
            ></span>
          </button>
        </div>

        <div class="flex items-center justify-between gap-4 border-t border-default pt-4">
          <div class="min-w-0">
            <p class="text-sm">{$t('settings.check_now')}</p>
            <p class="text-xs text-muted">
              {#if check.kind === 'checking'}{$t('settings.checking')}
              {:else if check.kind === 'upToDate'}{$t('settings.up_to_date')}
              {:else if check.kind === 'available'}{$t('settings.update_available', { version: check.version })}
              {:else if check.kind === 'error'}{check.message}
              {:else}{$t('settings.check_startup_desc')}
              {/if}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-strong px-4 py-1.5 text-sm text-fg transition hover:bg-accent hover:text-accent-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            disabled={check.kind === 'checking'}
            onclick={checkNow}
          >
            <Icon name="refresh" size={14} />
            {$t('settings.check_now')}
          </button>
        </div>
      </div>
    </Surface>
  </div>
</section>

{#snippet traySwitch(
  label: string,
  hint: string,
  on: boolean,
  enabled: boolean,
  toggle: () => void
)}
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <p class="text-sm">{label}</p>
      <p class="text-xs text-muted">{hint}</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={!enabled}
      onclick={toggle}
      class="relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {on
        ? 'bg-accent'
        : 'bg-surface-inset'}"
    >
      <span
        class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {on
          ? 'left-[1.375rem]'
          : 'left-0.5'}"
      ></span>
    </button>
  </div>
{/snippet}
