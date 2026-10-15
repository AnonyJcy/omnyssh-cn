<script lang="ts">
  // Auto SSH-key setup progress panel (tech-gui.md §4.2). Renders the active run from
  // the keySetup store: a stepped progress bar while running, then the terminal
  // outcome (full or partial success / failure / rollback), each saying what happened
  // to the server's password login. On the first 'complete', or a failure that may
  // have left password login off, it reloads the host list once — the backend already
  // wrote hosts.toml, so the card must refresh to reflect the new hasKey /
  // passwordAuthDisabled, and "Open terminal" must use the saved key. Mounted globally
  // (AppShell) so it survives navigating away from the Dashboard mid-run.
  import Modal from '$lib/components/Modal.svelte';
  import { Button, Icon, StatusDot } from '$lib/theme';
  import { keySetup, dismissKeySetup } from '$lib/stores/keySetup';
  import { reloadHosts } from '$lib/ipc/commands';
  import { spawnSession } from '$lib/stores/navigation';
  import { lastError } from '$lib/stores/notifications';
  import { t } from '$lib/i18n';
  import { maskText } from '$lib/stores/streamer';

  const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  // Reload hosts once per run that may have saved a key. Cleared while a run has not, so
  // re-running setup on the same host reloads again.
  let reloadedFor = $state<string | null>(null);
  // The terminal waits for it, so it connects with the key the backend just saved.
  let reloaded: Promise<unknown> = Promise.resolve();
  const BACKUP = '/etc/ssh/sshd_config.omnyssh_backup.*';
  const CHECK_PASSWORD = 'sudo sshd -T | grep -i passwordauthentication';

  async function openTerminal(hostName: string): Promise<void> {
    await reloaded;
    spawnSession('terminal', hostName);
    dismissKeySetup();
  }

  $effect(() => {
    const run = $keySetup;
    if (!run) return;
    const phase = run.phase;
    if (phase.kind === 'complete' || (phase.kind === 'failed' && phase.passwordMayBeOff)) {
      if (reloadedFor !== run.hostName) {
        reloadedFor = run.hostName;
        reloaded = reloadHosts().catch((e) => lastError.set(message(e)));
      }
    } else if (reloadedFor === run.hostName) {
      reloadedFor = null;
    }
  });
</script>

{#if $keySetup}
  {@const run = $keySetup}
  {@const phase = run.phase}
  <Modal label={$t('keysetup.title', { name: $maskText(run.hostName) })} onClose={dismissKeySetup}>
    <div class="space-y-4 px-5 py-4">
      <div class="flex items-center gap-2.5">
        <Icon name="key" size={16} />
        <h2 class="min-w-0 truncate text-sm font-semibold">{$t('keysetup.title', { name: $maskText(run.hostName) })}</h2>
      </div>

      {#if phase.kind === 'running'}
        {@const index = phase.step?.index ?? 0}
        {@const total = phase.step?.total ?? 6}
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="min-w-0 truncate text-muted">{phase.step ? $maskText(phase.step.description) : $t('keysetup.connecting')}</span>
            <span class="shrink-0 tabular-nums text-faint">{index}/{total}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-inset">
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-300"
              style="width: {total ? Math.round((index / total) * 100) : 0}%"
            ></div>
          </div>
        </div>
        <p class="text-xs text-faint">{$t('keysetup.explainer')}</p>
      {:else if phase.kind === 'complete'}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status={phase.passwordOff ? 'ok' : 'warn'} size={9} /></span>
          <div class="min-w-0 space-y-1">
            {#if phase.passwordOff}
              <p class="text-sm font-medium">{$t('keysetup.success_password_off')}</p>
              <p class="break-all font-mono text-xs text-muted">{phase.keyPath}</p>
              <p class="text-xs text-faint">{$t('keysetup.settings_backup', { backup: BACKUP })}</p>
              <p class="text-xs text-faint">{$t('keysetup.saved_password_removed')}</p>
            {:else}
              <p class="text-sm font-medium">{$t('keysetup.success_password_on')}</p>
              <p class="break-all font-mono text-xs text-muted">{phase.keyPath}</p>
              <p class="text-xs text-faint">{$t('keysetup.saved_password_kept')}</p>
            {/if}
          </div>
        </div>
        <div class="flex justify-end">
          <Button variant="primary" onclick={dismissKeySetup}>{$t('keysetup.done')}</Button>
        </div>
      {:else if phase.kind === 'failed'}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status="crit" size={9} /></span>
          <div class="min-w-0 space-y-1">
            {#if phase.passwordMayBeOff}
              <p class="text-sm font-medium">{$t('keysetup.failed_password_may_be_off')}</p>
              <p class="text-xs text-muted">{$t('keysetup.failed_settings_warning')}</p>
              <p class="break-words text-xs text-muted">{$t('keysetup.check_password_login', { command: CHECK_PASSWORD })}</p>
              <p class="break-words text-xs text-muted">{$t('keysetup.restore_password_hint', { config: '/etc/ssh/sshd_config', backup: BACKUP })}</p>
            {:else}
              <p class="text-sm font-medium">{$t('keysetup.failed_title')}</p>
            {/if}
            <p class="break-words text-xs text-muted">{$maskText(phase.error)}</p>
            {#if !phase.passwordMayBeOff}
              <p class="text-xs text-faint">{$t('keysetup.failed_hint')}</p>
            {/if}
          </div>
        </div>
        <div class="flex justify-end gap-2">
          {#if phase.passwordMayBeOff}
            <Button variant="secondary" onclick={() => openTerminal(run.hostName)}>{$t('keysetup.open_terminal')}</Button>
          {/if}
          <Button variant="ghost" onclick={dismissKeySetup}>{$t('keysetup.close')}</Button>
        </div>
      {:else}
        <div class="flex items-start gap-2.5">
          <span class="mt-0.5 shrink-0"><StatusDot status="warn" size={9} /></span>
          <div class="min-w-0 space-y-1">
            <p class="text-sm font-medium">{$t('keysetup.rollback_password_restored')}</p>
            <p class="text-xs text-muted">{$t('keysetup.rollback_explainer')}</p>
            <p class="break-words text-xs text-faint">{$t('keysetup.rollback_cause', { cause: $maskText(phase.result) })}</p>
          </div>
        </div>
        <div class="flex justify-end">
          <Button variant="ghost" onclick={dismissKeySetup}>{$t('keysetup.close')}</Button>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
