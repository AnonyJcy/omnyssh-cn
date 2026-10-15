<script lang="ts">
  // Asks before a quit cuts off live work (stores/quit.ts). Cancel holds the focus, so
  // a stray Enter or a key meant for the terminal never quits.
  import Modal from './Modal.svelte';
  import { confirmQuit, quitPrompt } from '$lib/stores/quit';
  import { traySupport } from '$lib/stores/tray';
  import { activeEntity } from '$lib/stores/activeEntity';
  import { isMac } from '$lib/platform';
  import { t } from '$lib/i18n';

  let { summary }: { summary: string } = $props();

  let dontAsk = $state(false);
  let quitting = $state(false);
  let cancelButton = $state<HTMLButtonElement>();

  // `autofocus` yields to whatever holds the focus, often a live terminal.
  $effect(() => cancelButton?.focus());

  function cancel(): void {
    quitPrompt.set(null);
  }

  function keepRunning(): void {
    cancel();
    activeEntity.selectSettings();
  }

  async function quit(): Promise<void> {
    quitting = true;
    try {
      if (dontAsk) await confirmQuit.set(false);
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().destroy();
    } catch {
      quitting = false;
    }
  }

  const button =
    'inline-flex items-center justify-center rounded-full px-7 py-2.5 text-sm font-medium transition ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50';
</script>

<Modal label={$t('quit.title')} onClose={cancel}>
  <div class="space-y-3 px-5 py-4">
    <h2 class="text-sm font-semibold">{$t('quit.title')}</h2>
    <p class="text-sm text-muted">{$t('quit.summary', { summary })}</p>
    <label class="flex items-center gap-2 text-sm text-muted">
      <input type="checkbox" class="accent-accent" bind:checked={dontAsk} />
      {$t('quit.dont_ask')}
    </label>
    {#if $traySupport.available}
      <button
        type="button"
        class="text-left text-sm text-fg underline underline-offset-2 hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        onclick={keepRunning}
      >
        {$t(isMac ? 'quit.keep_menu_bar' : 'quit.keep_tray')}
      </button>
    {/if}
    <div class="flex justify-end gap-2 pt-1">
      <button
        bind:this={cancelButton}
        type="button"
        class="{button} text-muted hover:bg-surface-inset hover:text-fg"
        onclick={cancel}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="button"
        class="{button} bg-status-crit text-bg hover:opacity-90 active:scale-[0.98]"
        disabled={quitting}
        onclick={quit}
      >
        {$t('quit.confirm')}
      </button>
    </div>
  </div>
</Modal>
