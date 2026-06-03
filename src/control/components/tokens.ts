// Shared design tokens for the control window. Centralizes the colors, radii,
// and fonts that were previously hardcoded (and duplicated) across the panel
// components, so the palette is tweakable in one place.

/** Colors. */
export const C = {
  /** Primary text. */
  text: '#e6e6e6',
  /** Deepest background (inputs, code-ish surfaces). */
  bg: '#0d0f12',
  /** Card / readout surface. */
  surface: '#1d2128',
  /** Header / tab-strip surface. */
  surfaceAlt: '#16181d',
  /** Neutral button fill. */
  btn: '#2a2f3a',
  /** Hairline divider / card border. */
  border: '#2c323d',
  /** Stronger border for interactive inputs. */
  borderStrong: '#3a4150',
  /** Accent (RS value, node count). */
  accent: '#4fd1ff',
  /** Scanned-rock ore name. */
  magenta: '#f0abfc',
  /** "loose" badge. */
  purple: '#c084fc',
  /** Noise badge. */
  amber: '#fbbf24',
  /** SCU value. */
  green: '#6ee7b7',
  /** Error / conflict text. */
  danger: '#ffb4bd',
  /** Scanned-rock block fill + border. */
  scanBg: '#160f18',
  scanBorder: '#5b3a63',
} as const;

/** Corner radii. */
export const R = { sm: 4, md: 6, lg: 8, xl: 10 } as const;

/** Font stacks. */
export const F = { mono: 'ui-monospace, monospace' } as const;
