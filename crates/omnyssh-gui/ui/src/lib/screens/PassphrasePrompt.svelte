<script lang="ts">
  // Asks for the passphrase of an encrypted identity file (tech-gui.md §4.2). The
  // backend keeps it in memory only; here it is dropped as soon as it is sent.
  import Modal from '$lib/components/Modal.svelte';
  import { Button, Icon } from '$lib/theme';
  import { passphrasePrompt, settlePassphrase } from '$lib/stores/passphrase';
  import { unlockIdentity } from '$lib/ipc/commands';
  import { t } from '$lib/i18n';

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  let passphrase = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement>();

  // A fresh, focused form per key. Keyed on the path, not the prompt object, so a
  // repeat event for the key on screen does not wipe what is being typed. Focus is
  // taken outright: autofocus yields to whatever holds it, often a live terminal,
  // which would then receive the passphrase.
  const keyPath = $derived($passphrasePrompt?.keyPath);
  $effect(() => {
    void keyPath;
    passphrase = '';
    error = null;
    submitting = false;
    input?.focus();
  });

  // The dialog opens unbidden, often over a terminal: focus goes back there when
  // the last prompt closes. Pre-effect, so it is read before the input takes it.
  const open = $derived($passphrasePrompt !== null);
  let opener: Element | null = null;
  let form = $state<HTMLFormElement>();
  $effect.pre(() => {
    if (open) {
      opener = document.activeElement;
    } else {
      // Only if the keyboard is still here: a dialog opened on top of this one
      // keeps it, or its keys would go to the opener (often a terminal).
      const here = document.activeElement === document.body || form?.contains(document.activeElement);
      if (here && opener instanceof HTMLElement) opener.focus();
      opener = null;
    }
  });

  async function submit(): Promise<void> {
    // Held across the await: a cancel meanwhile moves the dialog to another key.
    const path = keyPath;
    if (!path || submitting || !passphrase) return;
    const secret = passphrase;
    passphrase = '';
    submitting = true;
    error = null;
    try {
      await unlockIdentity(path, secret);
      settlePassphrase(path);
    } catch (e) {
      if (keyPath === path) error = message(e);
    } finally {
      if (keyPath === path) submitting = false;
    }
  }

  function cancel(): void {
    if (keyPath) settlePassphrase(keyPath);
  }

  const field =
    'w-full rounded-lg bg-surface-inset px-3 py-2 text-sm text-fg outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus placeholder:text-faint';
</script>

{#if $passphrasePrompt}
  {@const prompt = $passphrasePrompt}
  <Modal label={$t('passphrase.modal_label')} onClose={cancel}>
    <form
      bind:this={form}
      class="space-y-4 px-5 py-4"
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div class="space-y-1">
        <div class="flex items-center gap-2.5">
          <Icon name="key" size={16} />
          <h2 class="min-w-0 truncate text-sm font-semibold">{$t('passphrase.title', { name: prompt.hostName })}</h2>
        </div>
        <p class="break-all font-mono text-xs text-muted">{prompt.keyPath}</p>
      </div>
      <label class="block space-y-1 text-xs font-medium text-muted">
        <span>{$t('passphrase.label')}</span>
        <input
          type="password"
          bind:this={input}
          bind:value={passphrase}
          class={field}
          autocomplete="off"
        />
      </label>
      <p class="text-xs text-faint">
        {$t('passphrase.hint')}
      </p>
      {#if error}
        <p class="text-xs text-status-crit">{error}</p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button variant="ghost" type="button" onclick={cancel}>{$t('passphrase.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={submitting || !passphrase}>
          {submitting ? $t('passphrase.unlocking') : $t('passphrase.unlock')}
        </Button>
      </div>
    </form>
  </Modal>
{/if}
