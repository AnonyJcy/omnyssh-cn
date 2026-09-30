<script lang="ts">
  // A centered dialog over a scrim (tech-gui.md §2.2 forms/results). Same overlay
  // language as the command palette — role="dialog", Escape to dismiss, backdrop
  // click to close — but a solid raised surface for readable forms. Content is
  // passed in; the chrome (scrim, box, key handling) is fixed here so the snippet
  // dialogs don't each re-implement it.
  import { onDestroy, type Snippet } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import { dialogs } from '$lib/stores/dialogs';

  let {
    label,
    onClose,
    backdropCloses = true,
    children
  }: { label: string; onClose: () => void; backdropCloses?: boolean; children: Snippet } = $props();

  // Dialogs can stack (the passphrase prompt opens on its own over any other):
  // Escape closes only the top one, and the one opened last is drawn on top.
  const id = Symbol('dialog');
  dialogs.update((open) => [...open, id]);
  onDestroy(() => dialogs.update((open) => open.filter((d) => d !== id)));
  const layer = $derived(50 + $dialogs.indexOf(id));

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && get(dialogs).at(-1) === id) {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]"
  style="z-index: {layer};"
  role="dialog"
  aria-modal="true"
  aria-label={label}
>
  <button
    type="button"
    tabindex="-1"
    aria-label={$t('common.close')}
    class="absolute inset-0 bg-overlay"
    onclick={() => backdropCloses && onClose()}
  ></button>

  <div
    class="relative flex max-h-[76vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-default bg-surface-raised shadow-soft"
  >
    {@render children()}
  </div>
</div>
