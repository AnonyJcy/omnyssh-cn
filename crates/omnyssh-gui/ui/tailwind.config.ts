import type { Config } from 'tailwindcss';

// Colour utilities resolve to the semantic CSS variables defined in app.css
// (tech-gui.md §5.1). The default palette is replaced, not extended, so a stray
// `bg-red-500` or literal hex simply has no class — token discipline is
// structural, not a lint afterthought. Values live once in app.css; a theme
// switch swaps them.
export default {
  content: ['./src/**/*.{html,svelte,ts}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      bg: 'var(--bg)',
      surface: 'var(--surface)',
      'surface-raised': 'var(--surface-raised)',
      'surface-inset': 'var(--surface-inset)',
      fg: 'var(--text)',
      muted: 'var(--text-muted)',
      faint: 'var(--text-faint)',
      accent: 'var(--accent)',
      'accent-fg': 'var(--accent-fg)',
      focus: 'var(--focus-ring)',
      glass: 'var(--glass)',
      overlay: 'var(--overlay)',
      'status-ok': 'var(--status-ok)',
      'status-warn': 'var(--status-warn)',
      'status-crit': 'var(--status-crit)',
      'status-off': 'var(--status-off)'
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        // Same tail as the terminal's stack (screens/TerminalView.svelte), and for the
        // same reason: the chrome's `font-mono` also renders raw remote output — snippet
        // results and SFTP file previews, and any remote path or filename it lists. The
        // patched families stay behind the generic `monospace` so they can never become
        // the chrome's typeface.
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
          'Symbols Nerd Font Mono',
          'Symbols Nerd Font',
          'MesloLGS NF',
          'JetBrainsMono Nerd Font Mono',
          'JetBrainsMono Nerd Font',
          'Hack Nerd Font Mono',
          'Hack Nerd Font',
          'FiraCode Nerd Font Mono',
          'FiraCode Nerd Font'
        ]
      },
      // Border tokens live under borderColor only, so `border-default`/
      // `border-strong` work without polluting text-/bg-/ring- with a hairline
      // grey. Bare `border` (and preflight's universal border-color) uses DEFAULT.
      borderColor: {
        DEFAULT: 'var(--border)',
        default: 'var(--border)',
        strong: 'var(--border-strong)'
      },
      // The one soft elevation for floating elements (brandbook §05); value is a
      // per-theme token so it stays visible on dark.
      boxShadow: { soft: 'var(--shadow-soft)' }
    }
  },
  plugins: []
} satisfies Config;
