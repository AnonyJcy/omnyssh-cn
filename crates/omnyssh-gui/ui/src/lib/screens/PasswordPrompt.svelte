<script lang="ts">
  // Asks for the login password a connection waits on (tech-gui.md §4.2). The
  // server checks it; a refused one comes back as a new prompt marked `retry`.
  // The password is dropped here as soon as it is sent.
  import Modal from '$lib/components/Modal.svelte';
  import { Button, Icon } from '$lib/theme';
  import { displayLogin, passwordPrompt, settlePassword } from '$lib/stores/password';
  import { streamerMode } from '$lib/stores/streamer';
  import { lastError } from '$lib/stores/notifications';
  import { answerPassword } from '$lib/ipc/commands';
  import { t } from '$lib/i18n';

  let password = $state('');
  let input = $state<HTMLInputElement>();

  // A fresh, focused form per request. Focus is taken outright: autofocus yields to
  // whatever holds it, often a live terminal, which would then get the password.
  const requestId = $derived($passwordPrompt?.requestId);
  $effect(() => {
    void requestId;
    password = '';
    input?.focus();
  });

  // The dialog opens unbidden: focus goes back when the last prompt closes.
  // Pre-effect, so it is read before the input takes it.
  const open = $derived($passwordPrompt !== null);
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

  async function answer(secret: string | null): Promise<void> {
    const id = requestId;
    if (id === undefined) return;
    password = '';
    // Settled first either way: the answer goes once. A login that stopped
    // waiting (it gives up after a few minutes) refuses it; say so, or a typed
    // password would vanish without a word.
    settlePassword(id);
    await answerPassword(id, secret).catch(() =>
      lastError.set('That login stopped waiting for a password. Open it again.')
    );
  }

  function submit(): void {
    if (password) void answer(password);
  }

  const field =
    'w-full rounded-lg bg-surface-inset px-3 py-2 text-sm text-fg outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus placeholder:text-faint';
</script>

{#if $passwordPrompt}
  {@const prompt = $passwordPrompt}
  <!-- A stray click beside it must not cancel the login. -->
  <Modal label={$t('password.modal_label')} onClose={() => void answer(null)} backdropCloses={false}>
    <form
      bind:this={form}
      class="space-y-4 px-5 py-4"
      onsubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div class="space-y-1">
        <div class="flex items-center gap-2.5">
          <Icon name="key" size={16} />
          <h2 class="min-w-0 truncate text-sm font-semibold">{$t('password.title', { name: prompt.hostName })}</h2>
        </div>
        <p class="break-all font-mono text-xs text-muted">
          {displayLogin(prompt.login, $streamerMode)}
        </p>
      </div>
      <label class="block space-y-1 text-xs font-medium text-muted">
        <span>{$t('password.label')}</span>
        <input
          type="password"
          bind:this={input}
          bind:value={password}
          class={field}
          autocomplete="off"
        />
      </label>
      <p class="text-xs text-faint">
        {$t('password.hint')}
      </p>
      {#if prompt.retry}
        <p class="text-xs text-status-crit">{$t('password.retry_error')}</p>
      {:else if prompt.newHostKey}
        <p class="break-all text-xs text-status-warn">
          {$t('password.new_host_key', { key: prompt.newHostKey })}
        </p>
      {/if}
      <div class="flex justify-end gap-2">
        <Button variant="ghost" type="button" onclick={() => void answer(null)}>{$t('password.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={!password}>{$t('password.login')}</Button>
      </div>
    </form>
  </Modal>
{/if}
