<script lang="ts">
  // Add/edit host form (tech-gui.md §4.1). Always writes a manual entry: editing an
  // SSH-config import adopts it, leaving ~/.ssh/config untouched. Validation mirrors the TUI via
  // `formToInput`; on submit the parent persists + reloads, and a rejected save
  // surfaces inline without closing. Semantic tokens only.
  import { onMount, tick } from 'svelte';
  import type { HostInputDto } from '$lib/bindings';
  import { Button, Icon } from '$lib/theme';
  import Modal from '$lib/components/Modal.svelte';
  import Select from '$lib/components/Select.svelte';
  import { isWindows } from '$lib/platform';
  import { maskAddress, maskHostname, maskText, streamerMode } from '$lib/stores/streamer';
  import { bracketed, emptyForwardRow, formToInput, type HostFormFields } from './hostForm';
  import { t } from '$lib/i18n';

  let {
    mode,
    initial,
    previousName,
    imported = false,
    onSubmit,
    onCancel
  }: {
    mode: 'add' | 'edit';
    initial: HostFormFields;
    previousName?: string;
    /** Editing an `~/.ssh/config` import, so the save is an adoption — say so. */
    imported?: boolean;
    onSubmit: (input: HostInputDto, previousName: string | undefined) => Promise<void>;
    onCancel: () => void;
  } = $props();

  // Seeded once from `initial`; the editor is remounted per open, so the prop never
  // changes under a live instance.
  // svelte-ignore state_referenced_locally
  let fields = $state<HostFormFields>({ ...initial });
  let error = $state<string | null>(null);
  let saving = $state(false);
  let nameEl = $state<HTMLInputElement>();
  let hostnameEl = $state<HTMLInputElement>();
  let userEl = $state<HTMLInputElement>();
  let localEls = $state<HTMLInputElement[]>([]);

  // In streamer mode an address present when the form opened shows its disguise,
  // read-only, until Reveal; a reveal lasts while this form is open (it is remounted per
  // open) and streamer mode stays on. What the user adds or types is theirs and stays
  // editable, so a field never turns read-only under their cursor, even when the mode is
  // switched on mid-edit. A field the disguise leaves as is (a bare port, localhost) is
  // not held, so editing it never takes a Reveal.
  let revealed = $state(false);
  const hide = $derived($streamerMode && !revealed);
  $effect(() => {
    if (!$streamerMode) revealed = false;
  });
  // svelte-ignore state_referenced_locally
  let heldHostname = $state(maskHostname(initial.hostname) !== initial.hostname);
  // Parallel to `fields.forwards`.
  // svelte-ignore state_referenced_locally
  let heldRows = $state(
    initial.forwards.map((r) => ({
      local: maskListen(r.local) !== r.local,
      remote: maskAddress(r.remoteHost) !== r.remoteHost
    }))
  );
  const hostnameMasked = $derived(hide && heldHostname);
  const firstHeldRow = $derived(heldRows.findIndex((r) => r.local || r.remote));

  async function reveal(target: () => HTMLInputElement | undefined): Promise<void> {
    revealed = true;
    await tick();
    target()?.focus();
  }

  /** `[address:]port` with the address disguised, as the card shows a forward. */
  function maskListen(raw: string): string {
    const i = raw.lastIndexOf(':');
    if (i < 0) return raw;
    return `${bracketed(maskAddress(raw.slice(0, i).replace(/^\[(.*)\]$/, '$1')))}${raw.slice(i)}`;
  }

  // The name is the on-disk key; a rename can't carry backend-only secrets across the
  // boundary (§3.4), so on edit it is immutable — rename by delete + re-add. Focus the
  // first editable field accordingly.
  onMount(() => (mode === 'add' ? nameEl : hostnameMasked ? userEl : hostnameEl)?.focus());

  async function save(): Promise<void> {
    const result = formToInput(fields);
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = null;
    saving = true;
    try {
      await onSubmit(result.input, previousName);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  // On edit the DTO omits identity/password (§3.4), so the fields start blank and mean
  // "keep the stored value"; on add they mean "none".
  const secretHint = $derived(mode === 'edit' ? $t('host_editor.secret_hint') : undefined);

  const label = 'block space-y-1 text-xs font-medium text-muted';
  const forwardGrid = 'grid grid-cols-[8.5rem,1fr,4.5rem,1.75rem] items-center gap-2';
  const smallBtn =
    'inline-flex items-center gap-1 rounded-full border border-default px-2 py-0.5 text-xs text-muted transition ' +
    'hover:border-strong hover:bg-accent hover:text-accent-fg ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
  const field =
    'w-full rounded-lg bg-surface-inset px-3 py-2 text-sm text-fg outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus placeholder:text-faint';
  const maskedField = 'cursor-default text-muted';
</script>

<Modal label={mode === 'add' ? $t('host_editor.add_title') : $t('host_editor.edit_title')} onClose={onCancel}>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    class="flex min-h-0 flex-col"
  >
    <header class="border-b border-default px-5 py-3.5">
      <h2 class="text-sm font-semibold">{mode === 'add' ? $t('host_editor.add_title') : $t('host_editor.edit_title')}</h2>
    </header>

    <div class="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
      {#if imported}
        <p class="rounded-lg bg-surface-inset px-3 py-2 text-xs text-muted">
          {$t('host_editor.imported_notice')}
        </p>
      {/if}
      <label class={label}>
        <span>{mode === 'edit' ? $t('host_editor.name_fixed') : $t('host_editor.name')}</span>
        <input
          bind:this={nameEl}
          bind:value={fields.name}
          class="{field} {mode === 'edit' ? 'cursor-not-allowed text-muted' : ''}"
          placeholder="web-prod-1"
          readonly={mode === 'edit'}
          title={mode === 'edit' ? $t('host_editor.name_fixed_title') : undefined}
        />
      </label>

      <div class="flex items-end gap-2">
        <label class="{label} min-w-0 flex-1">
          <span>{$t('host_editor.hostname')}</span>
          <input
            bind:this={hostnameEl}
            bind:value={
              () => (hostnameMasked ? maskHostname(fields.hostname) : fields.hostname),
              (v) => {
                fields.hostname = v;
                heldHostname = false;
              }
            }
            readonly={hostnameMasked}
            class="{field} font-mono {hostnameMasked ? maskedField : ''}"
            placeholder="10.0.0.1"
          />
        </label>
        {#if hostnameMasked}
          <button type="button" class="{smallBtn} mb-1.5 shrink-0" onclick={() => reveal(() => hostnameEl)}>
            {$t('host_editor.reveal')}
          </button>
        {/if}
      </div>

      <div class="grid grid-cols-[1fr,7rem] gap-3">
        <label class={label}>
          <span>{$t('host_editor.user')}</span>
          <input bind:this={userEl} bind:value={fields.user} class={field} placeholder="root" />
        </label>
        <label class={label}>
          <span>{$t('host_editor.port')}</span>
          <input bind:value={fields.port} inputmode="numeric" class={field} placeholder="22" />
        </label>
      </div>

      <label class={label}>
        <span>{$t('host_editor.identity_file')}</span>
        <input
          bind:value={fields.identityFile}
          class="{field} font-mono"
          placeholder={secretHint ?? '~/.ssh/id_ed25519'}
        />
      </label>

      <label class={label}>
        <span>{$t('host_editor.password')}</span>
        <input
          type="password"
          bind:value={fields.password}
          class={field}
          placeholder={secretHint ?? $t('host_editor.password_placeholder')}
          autocomplete="off"
        />
      </label>

      <div class="space-y-1">
        <label class={label}>
          <span>{$t('host_editor.tags')}</span>
          <input
            bind:value={fields.tags}
            class={field}
            placeholder="prod, web"
            aria-describedby="host-tags-hint"
          />
        </label>
        <p id="host-tags-hint" class="text-xs text-faint">{$t('host_editor.tags_hint')}</p>
      </div>

      <label class={label}>
        <span>{$t('host_editor.notes')}</span>
        <textarea bind:value={fields.notes} rows="2" class="{field} resize-y" placeholder={$t('host_editor.notes_placeholder')}></textarea>
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class={label}>
          <span>{$t('host_editor.monitoring')}</span>
          <Select bind:value={fields.monitoring} class={field}>
            <option value="ssh">{$t('host_editor.monitoring_ssh')}</option>
            <option value="tcpPort">{$t('host_editor.monitoring_tcp')}</option>
          </Select>
        </label>
        {#if fields.monitoring === 'tcpPort'}
          <label class={label}>
            <span>{$t('host_editor.monitor_port')}</span>
            <input
              bind:value={fields.monitorPort}
              inputmode="numeric"
              class={field}
              placeholder={fields.port || '22'}
            />
          </label>
        {/if}
      </div>
      {#if fields.monitoring === 'tcpPort'}
        <p class="text-xs text-faint">{$t('host_editor.tcp_port_hint')}</p>
      {/if}

      <div class="flex items-center justify-between gap-4 border-t border-default pt-3.5">
        <div class="min-w-0">
          <p class="text-sm text-fg">{$t('host_editor.forward_agent')}</p>
          <p class="text-xs text-faint">
            {$t('host_editor.forward_agent_desc')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={fields.forwardAgent}
          aria-label={$t('host_editor.forward_agent')}
          disabled={isWindows}
          onclick={() => (fields.forwardAgent = !fields.forwardAgent)}
          class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 {fields.forwardAgent
            ? 'bg-accent'
            : 'bg-surface-inset'}"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {fields.forwardAgent
              ? 'left-[1.375rem]'
              : 'left-0.5'}"
          ></span>
        </button>
      </div>

      <!-- Port forwarding (`ssh -L`): each row listens on a local port and carries it to
           a host:port the server reaches. One tunnel per host carries every row. -->
      <div class="space-y-2 border-t border-default pt-3.5">
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-medium text-muted">{$t('host_editor.port_forwarding')}</span>
          <div class="flex gap-2">
            {#if hide && firstHeldRow >= 0}
              <button type="button" class={smallBtn} onclick={() => reveal(() => localEls[firstHeldRow])}>
                {$t('host_editor.reveal')}
              </button>
            {/if}
            <button
              type="button"
              class={smallBtn}
              onclick={() => {
                fields.forwards.push(emptyForwardRow());
                heldRows.push({ local: false, remote: false });
              }}
            >
              <Icon name="plus" size={12} />
              {$t('host_editor.add_forward')}
            </button>
          </div>
        </div>
        {#if fields.forwards.length}
          <div class="{forwardGrid} text-[11px] text-faint">
            <span>{$t('host_editor.local_port')}</span>
            <span>{$t('host_editor.remote_host')}</span>
            <span>{$t('host_editor.remote_port')}</span>
            <span></span>
          </div>
          {#each fields.forwards as row, i (i)}
            {@const localMasked = hide && heldRows[i].local}
            {@const remoteMasked = hide && heldRows[i].remote}
            <div class={forwardGrid}>
              <input
                bind:this={localEls[i]}
                bind:value={
                  () => (localMasked ? maskListen(row.local) : row.local),
                  (v) => {
                    row.local = v;
                    heldRows[i].local = false;
                  }
                }
                readonly={localMasked}
                class="{field} font-mono {localMasked ? maskedField : ''}"
                placeholder="9443"
                aria-label={$t('host_editor.forward_local_port', { index: i + 1 })}
              />
              <input
                bind:value={
                  () => (remoteMasked ? maskAddress(row.remoteHost) : row.remoteHost),
                  (v) => {
                    row.remoteHost = v;
                    heldRows[i].remote = false;
                  }
                }
                readonly={remoteMasked}
                class="{field} font-mono {remoteMasked ? maskedField : ''}"
                placeholder="localhost"
                aria-label={$t('host_editor.forward_remote_host', { index: i + 1 })}
              />
              <input
                bind:value={row.remotePort}
                inputmode="numeric"
                class="{field} font-mono"
                placeholder="9443"
                aria-label={$t('host_editor.forward_remote_port', { index: i + 1 })}
              />
              <button
                type="button"
                class="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surface-inset hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                title={$t('host_editor.remove_forward', { index: i + 1 })}
                aria-label={$t('host_editor.remove_forward', { index: i + 1 })}
                onclick={() => {
                  fields.forwards.splice(i, 1);
                  heldRows.splice(i, 1);
                }}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          {/each}
          <p class="text-xs text-faint">
            {$t('host_editor.port_forwarding_hint')}
          </p>
          <div class="flex items-center justify-between gap-4 pt-1">
            <span class="text-sm text-fg">{$t('host_editor.tunnel_autostart')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={fields.tunnelAutostart}
              aria-label={$t('host_editor.tunnel_autostart')}
              onclick={() => (fields.tunnelAutostart = !fields.tunnelAutostart)}
              class="relative h-6 w-11 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus {fields.tunnelAutostart
                ? 'bg-accent'
                : 'bg-surface-inset'}"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow-soft transition-[left] {fields.tunnelAutostart
                  ? 'left-[1.375rem]'
                  : 'left-0.5'}"
              ></span>
            </button>
          </div>
        {:else}
          <p class="text-xs text-faint">
            {$t('host_editor.port_forwarding_empty')}
          </p>
        {/if}
      </div>

      {#if error}
        <p class="text-xs text-status-crit">{$maskText(error)}</p>
      {/if}
    </div>

    <footer class="flex justify-end gap-2 border-t border-default px-5 py-3">
      <Button variant="ghost" onclick={onCancel}>{$t('common.cancel')}</Button>
      <Button variant="primary" type="submit" disabled={saving}>
        {mode === 'add' ? $t('host_editor.add_title') : $t('host_editor.save')}
      </Button>
    </footer>
  </form>
</Modal>
