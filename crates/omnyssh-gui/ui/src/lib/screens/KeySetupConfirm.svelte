<script lang="ts">
  // Asks before a key setup (tech-gui.md §4.3 note, 2026-10-09): it changes this
  // computer and, with sudo, the server's login for everyone. `rerun` is the "Password
  // on" badge's second try, which reuses the key OmnySSH made before.
  import { onMount } from 'svelte';
  import type { HostDto } from '$lib/bindings';
  import Modal from '$lib/components/Modal.svelte';
  import { Button } from '$lib/theme';
  import { keyFilePath } from '$lib/stores/keySetup';
  import { streamerMode, displayHostname, displayHostTitle, displayUser } from '$lib/stores/streamer';
  import { isWindows } from '$lib/platform';
  import { t } from '$lib/i18n';

  let {
    host,
    rerun,
    onConfirm,
    onCancel
  }: { host: HostDto; rerun: boolean; onConfirm: () => void; onCancel: () => void } = $props();

  const keyPath = $derived(keyFilePath(host.name, isWindows));

  // Cancel is first in `actions`. Focused by hand: Modal sets no initial focus, and
  // `autofocus` is skipped while the opening button still holds focus.
  let actions = $state<HTMLElement>();
  onMount(() => actions?.querySelector('button')?.focus());
</script>

<Modal label={$t(rerun ? 'keysetup.confirm_disable' : 'keysetup.confirm_setup')} onClose={onCancel}>
  <div class="space-y-3 px-5 py-4">
    <h2 class="text-sm font-semibold">
      {$t(rerun ? 'keysetup.confirm_disable_title' : 'keysetup.confirm_setup_title', { name: displayHostTitle(host.name, $streamerMode, host.hostname) })}
    </h2>
    <ul class="list-disc space-y-1.5 pl-5 text-sm text-muted">
      {#if rerun}
        <li>
          {$t('keysetup.confirm_reuse')}
          <span class="break-all font-mono text-xs">{$streamerMode ? $t('keysetup.path_hidden') : keyPath}</span>
        </li>
      {:else}
        <li>
          {$t('keysetup.confirm_create')}
          <span class="break-all font-mono text-xs">{$streamerMode ? $t('keysetup.path_hidden') : keyPath}</span> {$t('keysetup.confirm_no_passphrase')}
        </li>
      {/if}
      <li>
        {$t('keysetup.confirm_authorize_prefix')}
        <span class="break-all font-mono text-xs">{displayUser(host.user, $streamerMode)}@{displayHostname(host.hostname, $streamerMode)}</span>,
        {$t('keysetup.confirm_authorize_suffix')}
      </li>
      <li>
        {$t('keysetup.confirm_server_change')}
      </li>
    </ul>
    <p class="text-xs text-faint">
      {$t('keysetup.confirm_key_warning')}
    </p>
    <div class="flex justify-end gap-2 pt-1" bind:this={actions}>
      <Button variant="ghost" onclick={onCancel}>{$t('common.cancel')}</Button>
      <Button variant="primary" onclick={onConfirm}>
        {$t(rerun ? 'keysetup.confirm_disable' : 'keysetup.confirm_setup')}
      </Button>
    </div>
  </div>
</Modal>
