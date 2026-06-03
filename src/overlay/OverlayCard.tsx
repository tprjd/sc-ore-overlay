// The overlay's presentational card — pure, no IPC/window logic. Shared by the
// real transparent overlay window (Overlay.tsx) and the live preview in the
// control window (ScanView), so the preview can't drift from what ships.
//
// Renders the matched ore(s): the top candidate is emphasized (confidence dot
// + score bar); overlap candidates are demoted below a divider. A pulsing dot
// in the placeholder means the temporal voter is still confirming a reading; a
// solid dot on the top candidate means it's locked. Compact scale collapses to
// a single line.

import type { CSSProperties } from 'react';
import type { OverlayCandidate, OverlayConfig, OverlayScale } from '../shared/bridge';

/** Font sizes per preset (padding + gap come from config). */
const SCALE: Record<OverlayScale, { font: number; muted: number }> = {
  compact: { font: 15, muted: 12 },
  normal: { font: 22, muted: 14 },
  large: { font: 32, muted: 18 },
};

/** Keyframes for the confidence-dot pulse and the per-row enter animation. */
const KEYFRAMES = `
@keyframes scoDot { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
@keyframes scoEnter { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
`;

/** "#rrggbb" + alpha → "rgba(r,g,b,a)". */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Score (0..1, shown as %) → confidence-bar color. */
function scoreColor(pct: number): string {
  if (pct >= 60) return '#34d399';
  if (pct >= 30) return '#fbbf24';
  return '#f87171';
}

// In edit mode the whole card is a drag region (the window's grip is `no-drag`,
// so it resizes instead). `-webkit-app-region` isn't typed on CSSProperties.
const DRAG_REGION = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;

export interface OverlayCardProps {
  reading: number | null;
  candidates: OverlayCandidate[];
  settling?: boolean;
  config: OverlayConfig;
  /** Real window only: dashed border + drag region. Always false in preview. */
  editing?: boolean;
}

export function OverlayCard({ reading, candidates, settling = false, config, editing = false }: OverlayCardProps) {
  const sz = SCALE[config.scale];
  const compact = config.scale === 'compact';
  const secFont = Math.max(11, Math.round(sz.font * 0.7));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  const top = candidates[0];
  const topPct = top ? Math.max(0, Math.min(100, Math.round(top.score * 100))) : 0;

  /** Pulsing while the voter confirms a new value; solid once locked. */
  const dot = (
    <span
      style={{
        ...S.dot,
        background: settling ? '#fbbf24' : '#4fd1ff',
        animation: settling ? 'scoDot 1s ease-in-out infinite' : 'none',
      }}
    />
  );

  return (
    <div
      style={{
        ...S.card,
        fontFamily: config.fontFamily,
        padding: config.padding,
        gap: config.gap,
        background: cardBg,
        border: editing
          ? '1px dashed rgba(79,209,255,0.85)'
          : config.border
            ? '1px solid rgba(79,209,255,0.25)'
            : 'none',
        ...(editing ? DRAG_REGION : null),
      }}
    >
      <style>{KEYFRAMES}</style>
      {top && compact ? (
        // Compact: top candidate only, on a single line. No bar/hierarchy, but
        // still honor the signature toggle (inline, so it stays one line).
        <div key={`${top.name}-${top.noise ?? 'n'}-${top.loose ? 'L' : 'S'}`} style={{ ...S.row, animation: 'scoEnter 160ms ease-out' }}>
          {dot}
          <span style={{ ...S.name, fontSize: sz.font }}>{top.name}</span>
          <span style={{ ...S.nodes, fontSize: sz.font }}>×{top.nodes}</span>
        </div>
      ) : top ? (
        <>
          {/* Primary candidate — emphasized. */}
          <div key={`${top.name}-${top.noise ?? 'n'}-${top.loose ? 'L' : 'S'}`} style={{ ...S.primaryBlock, animation: 'scoEnter 160ms ease-out' }}>
            <div style={S.row}>
              {dot}
              <span style={{ ...S.name, fontSize: sz.font }}>
                {top.name}
                {top.noise != null && (
                  <span style={{ ...S.noiseBadge, fontSize: Math.max(10, sz.font * 0.45) }}>
                    +{top.noise.toLocaleString()}
                  </span>
                )}
                {top.loose && (
                  <span style={{ ...S.looseBadge, fontSize: Math.max(10, sz.font * 0.45) }}>loose</span>
                )}
              </span>
              <span style={{ ...S.nodes, fontSize: sz.font }}>×{top.nodes}</span>
            </div>
            <div style={S.bar}>
              <div style={{ ...S.barFill, width: `${topPct}%`, background: scoreColor(topPct) }} />
            </div>
          </div>

          {/* Secondary overlap candidates — demoted below a divider. */}
          {candidates.length > 1 && <div style={S.divider} />}
          {candidates.slice(1).map((c, i) => (
            <div
              key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`}
              style={{ ...S.secRow, animation: 'scoEnter 160ms ease-out' }}
            >
              <span style={{ ...S.secName, fontSize: secFont }}>
                {c.name}
                {c.noise != null && (
                  <span style={{ ...S.noiseBadge, fontSize: Math.max(9, secFont * 0.5) }}>
                    +{c.noise.toLocaleString()}
                  </span>
                )}
                {c.loose && (
                  <span style={{ ...S.looseBadge, fontSize: Math.max(9, secFont * 0.5) }}>loose</span>
                )}
              </span>
              <span style={{ ...S.secNodes, fontSize: secFont }}>×{c.nodes}</span>
            </div>
          ))}
        </>
      ) : reading != null ? (
        // Number on screen but matches nothing — diagnostic, always shown.
        <div style={{ ...S.muted, fontSize: sz.muted }}>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#e6e6e6' }}>
            {reading.toLocaleString()}
          </span>{' '}
          — no match
        </div>
      ) : config.showPlaceholder ? (
        // Settling = the voter is accumulating a value but hasn't locked yet, so
        // no candidate is shown. Surface that with a pulsing dot + "locking…".
        <div style={{ ...S.muted, fontSize: sz.muted, display: 'flex', alignItems: 'center' }}>
          {settling && dot}
          {settling ? 'locking…' : 'scanning…'}
        </div>
      ) : null}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    backdropFilter: 'blur(2px)',
    boxSizing: 'border-box',
  },
  primaryBlock: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  row: { display: 'flex', alignItems: 'baseline', lineHeight: 1.1, minWidth: 0 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flex: '0 0 auto',
    alignSelf: 'center',
    marginRight: 7,
    boxShadow: '0 0 4px rgba(0,0,0,0.6)',
  },
  name: {
    fontWeight: 700,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nodes: {
    fontWeight: 700,
    color: '#4fd1ff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginLeft: 'auto',
    paddingLeft: 8,
  },
  bar: {
    height: 3,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginLeft: 14,
  },
  barFill: { height: '100%', borderRadius: 2, transition: 'width 200ms ease-out, background 200ms' },
  divider: { height: 1, background: 'rgba(255,255,255,0.14)', margin: '1px 0' },
  secRow: { display: 'flex', alignItems: 'baseline', lineHeight: 1.1, minWidth: 0, opacity: 0.7 },
  secName: {
    fontWeight: 600,
    color: '#dbe4ee',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  secNodes: {
    fontWeight: 600,
    color: '#4fd1ff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginLeft: 'auto',
    paddingLeft: 8,
  },
  muted: { color: '#9fb3c8', textShadow: '0 1px 3px rgba(0,0,0,0.9)' },
  noiseBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    background: 'rgba(58,42,26,0.85)',
    color: '#fbbf24',
    border: '1px solid rgba(90,58,31,0.9)',
    borderRadius: 4,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    verticalAlign: 'middle',
  },
  looseBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    background: 'rgba(42,26,58,0.85)',
    color: '#c084fc',
    border: '1px solid rgba(74,42,90,0.9)',
    borderRadius: 4,
    fontWeight: 600,
    verticalAlign: 'middle',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
};
