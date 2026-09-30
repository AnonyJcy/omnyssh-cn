<script lang="ts">
  // The three fixed regions (tech-gui.md §2): sidebar (left), content (one thing),
  // status bar (full-width bottom). Content is passed in; the chrome is fixed. The
  // sidebar column width follows the collapse store; collapse is manual only — the
  // header button or ⌘B/Ctrl+B, never navigation.
  import type { Snippet } from 'svelte';
  import Sidebar from './Sidebar.svelte';
  import StatusBar from './StatusBar.svelte';
  import CommandPalette from './CommandPalette.svelte';
  import SupportModal from './SupportModal.svelte';
  import KeySetupProgress from '$lib/screens/KeySetupProgress.svelte';
  import PassphrasePrompt from '$lib/screens/PassphrasePrompt.svelte';
  import PasswordPrompt from '$lib/screens/PasswordPrompt.svelte';
  import UpdateBanner from './UpdateBanner.svelte';
  import { support } from '$lib/stores/support';
  import { sidebarCollapsed, isCollapseChord } from '$lib/stores/ui';

  let { children }: { children: Snippet } = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (isCollapseChord(e)) {
      e.preventDefault();
      sidebarCollapsed.toggle();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="relative grid h-screen grid-rows-[1fr_auto] overflow-hidden bg-bg text-fg transition-[grid-template-columns] duration-200 ease-out {$sidebarCollapsed
    ? 'grid-cols-[var(--rail-w)_1fr]'
    : 'grid-cols-[15rem_1fr]'}"
>
  <!-- Draggable strip under the macOS overlay traffic lights; zero-height elsewhere
       (--titlebar-h, app.css). Sits below the z-40/z-50 overlays so they stay usable. -->
  <div data-tauri-drag-region class="absolute inset-x-0 top-0 z-20 h-[var(--titlebar-h)]"></div>
  <Sidebar />
  <main class="col-start-2 row-start-1 min-h-0 overflow-hidden">
    {@render children()}
  </main>
  <StatusBar />
  <CommandPalette />
  {#if $support}
    <SupportModal />
  {/if}
  <KeySetupProgress />
  <PassphrasePrompt />
  <PasswordPrompt />
  <UpdateBanner />
</div>
