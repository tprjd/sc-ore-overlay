// Always-visible Results pane: the accepted reading, the top identified ore, and
// any overlap candidates. Presentational — values come from the orchestrator
// (matches) and the store (stableRs/paused via props).

import type { OreCandidate } from '../../core';

export interface ProspectResultsProps {
  stableRs: number | null;
  matches: OreCandidate[];
  paused: boolean;
  intervalMs: number;
  quorum: number;
  location: string | null;
  enforceCluster: boolean;
}

export function ProspectResults({
  stableRs,
  matches,
  paused,
  intervalMs,
  quorum,
  location,
  enforceCluster,
}: ProspectResultsProps) {
  const top = matches[0];
  return (
    <div className="flex max-h-[48%] shrink-0 flex-col gap-2 overflow-y-auto border-b border-border p-3.5">
      <div className="rounded-lg border border-border bg-surface p-3 text-center">
        <div className="text-[11px] uppercase tracking-wide text-muted">Accepted reading</div>
        <div className="tnum text-4xl font-bold leading-tight text-accent">
          {stableRs != null ? stableRs.toLocaleString() : '—'}
        </div>
        {top ? (
          <div className="mt-0.5 flex items-baseline justify-center gap-2">
            <span className="inline-flex items-baseline gap-1.5 text-lg font-bold">
              {top.name}
              {top.noise != null && (
                <NoiseBadge value={top.noise} sig={top.signature} nodes={top.nodes} />
              )}
              {top.loose && <LooseBadge />}
            </span>
            <span className="tnum text-lg font-bold text-accent">×{top.nodes}</span>
            <span className="text-xs text-fg/50">{Math.round(top.score * 100)}%</span>
          </div>
        ) : stableRs != null ? (
          <div className="mt-0.5 text-sm text-danger">no match</div>
        ) : (
          <div className="mt-0.5 text-[13px] text-fg/50">waiting for a stable reading…</div>
        )}
        <div className="mt-1 text-[11px] text-fg/55">
          {paused ? 'paused' : `every ${intervalMs} ms · quorum ${quorum}`}
        </div>
      </div>

      {matches.length > 1 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-fg/50">also matches</div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {matches.slice(1).map((c, i) => (
              <li
                key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`}
                className="flex items-baseline gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
              >
                <span className="flex flex-1 items-baseline gap-1.5 text-base font-semibold">
                  {c.name}
                  {c.noise != null && (
                    <NoiseBadge value={c.noise} sig={c.signature} nodes={c.nodes} />
                  )}
                  {c.loose && <LooseBadge />}
                </span>
                <span className="tnum text-base text-accent">×{c.nodes}</span>
                <span className="w-10 text-right text-[11px] text-fg/50">
                  {Math.round(c.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stableRs != null && matches.length === 0 && (
        <p className="text-xs text-muted">
          No ore matches {stableRs}
          {location ? ` at ${location} (try "Anywhere")` : ''}
          {enforceCluster ? '. Cluster check is on — try disabling it.' : '.'}
        </p>
      )}
    </div>
  );
}

function NoiseBadge({ value, sig, nodes }: { value: number; sig: number; nodes: number }) {
  return (
    <span
      className="tnum rounded-sm border border-[#5a3a1f] bg-[#3a2a1a] px-1.5 py-px text-[10px] font-semibold text-amber"
      title={`RS = ${sig * nodes} + ${value} noise`}
    >
      +{value.toLocaleString()}
    </span>
  );
}

function LooseBadge() {
  return (
    <span
      className="rounded-sm border border-[#4a2a5a] bg-[#2a1a3a] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-purple"
      title="Outside the table's cluster range — table may be stale."
    >
      loose
    </span>
  );
}
