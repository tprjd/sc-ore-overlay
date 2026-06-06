// Footer status strip: accepted RS, voter/pipeline state, capture rate, OCR
// confidence/latency, active engine, and the raw OCR text. Presentational — the
// orchestrator passes the already-derived voter label/color (it needs the
// overlay status + settling sub-state); confidence coloring is display-only here.

export interface StatusBarOcr {
  score: number;
  ms: number;
  lineCount: number;
  rawText: string;
}

export interface ProspectStatusBarProps {
  stableRs: number | null;
  voterLabel: string;
  voterColor: string;
  tickRate: number;
  paused: boolean;
  ocr: StatusBarOcr | null;
  effectiveBackend: string | null;
}

export function ProspectStatusBar({
  stableRs,
  voterLabel,
  voterColor,
  tickRate,
  paused,
  ocr,
  effectiveBackend,
}: ProspectStatusBarProps) {
  const confPct = ocr ? Math.round(ocr.score * 100) : null;
  // PP-OCR scores run high; treat <90% as worth noticing, <70% as bad.
  const confColor =
    confPct == null ? '#9fb3c8' : confPct >= 90 ? '#6ee7b7' : confPct >= 70 ? '#fbbf24' : '#f87171';

  return (
    <footer className="tnum flex items-center gap-4 border-t border-border bg-surface-alt px-3.5 py-1.5 text-[11px]">
      <StatItem label="RS" value={stableRs != null ? stableRs.toLocaleString() : '—'} />
      <span className="flex items-center gap-1.5">
        <span
          className="h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: voterColor }}
        />
        <span style={{ color: voterColor }}>{voterLabel}</span>
      </span>
      <StatItem
        label="rate"
        value={paused ? '—' : tickRate > 0 ? `${tickRate.toFixed(1)}/s` : '…'}
      />
      <span className="flex items-center gap-1.5" title="RS OCR confidence (best detected line)">
        <span className="uppercase tracking-wide text-fg/50">conf</span>
        <span className="font-semibold" style={{ color: confColor }}>
          {confPct != null ? `${confPct}%` : '—'}
        </span>
      </span>
      <StatItem label="ocr" value={ocr ? `${ocr.ms}ms · ${ocr.lineCount}L` : '—'} />
      <StatItem label="eng" value={effectiveBackend ?? '…'} />
      <span className="ml-auto flex min-w-0 items-center gap-1.5" title={ocr?.rawText || ''}>
        <span className="uppercase tracking-wide text-fg/50">raw</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap font-normal text-fg/80">
          {ocr?.rawText || '—'}
        </span>
      </span>
    </footer>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="uppercase tracking-wide text-fg/50">{label}</span>
      <span className="font-semibold text-fg">{value}</span>
    </span>
  );
}
