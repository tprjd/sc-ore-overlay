// Survey tab: draw several capture regions, assign each a role (RS number, ship
// position, system name), and watch them read live. Phase S1 focuses on getting
// the debug-overlay coordinate read working and verified; logging + the map come
// in S2/S3. Reuses the shared CapturePreview and the existing OCR pipeline.

import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AxisPlane, SignatureTable, SurveyEntry, Vec3 } from '../../core';
import { isStablePos, makeEntry, mergeEntries } from '../../core';
import type { SurveyRegionSetting } from '../../shared/bridge';
import type { DrawableSource, NormRegion } from '../preprocess';
import type { SimScan } from '../scanImage';
import { scanImage } from '../scanImage';
import { DEBUG_SHIP, debugEntries } from '../survey-debug';
import { Button } from '../ui';
import { cn } from '../ui/cn';
import type { LoopParams } from '../useCaptureLoop';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import { useSurveyCapture } from '../useSurveyCapture';
import type { PreviewRegion } from './CapturePreview';
import { CapturePreview } from './CapturePreview';
import { RegionList } from './RegionList';
import { newRegionId, ROLE_META } from './roles';
import { ScanResults } from './ScanResults';
import type { PickedSource } from './SourcePicker';
import { SurveyMap } from './SurveyMap';

type LeftMode = 'preview' | 'map';

export interface SurveyViewProps {
  source: PickedSource;
  table: SignatureTable;
  params: LoopParams;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  scout: string;
  onScoutChange: (scout: string) => void;
  onBack: () => void;
}

// Full precision (km) so the readout matches the HUD digit-for-digit — coordinate
// decimals are meaningful, so don't round to 2 places.
const km = (m: number): string =>
  (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 6 });

/** Trigger a client-side file download. */
function download(name: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Quote a CSV field. */
const csv = (s: string): string => `"${String(s).replace(/"/g, '""')}"`;

const INPUT =
  'rounded-md border border-border-strong bg-bg px-2 py-1 text-[13px] text-fg outline-none focus:border-accent/60';
const SELECT = `flex-1 ${INPUT} px-1.5`;

export function SurveyView({
  source,
  table,
  params,
  regions,
  onRegionsChange,
  scout,
  onScoutChange,
  onBack,
}: SurveyViewProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);
  const [leftMode, setLeftMode] = useState<LeftMode>('preview');
  const [debugMode, setDebugMode] = useState(false);
  const [plane, setPlane] = useState<AxisPlane>('xy');
  const [simScans, setSimScans] = useState<SimScan[]>([]);
  const [simBusy, setSimBusy] = useState(false);

  const active: ActiveSurveyRegion[] = useMemo(
    () =>
      regions
        .filter((r) => r.enabled)
        .map((r) => ({ id: r.id, role: r.role, rect: r.rect, scale: r.scale })),
    [regions],
  );
  // Pause the live OCR loop while batch-scanning uploads — they share one
  // single-threaded OCR engine, and competing for it tanks performance.
  const readout = useSurveyCapture(mediaRef, active, params, !simBusy, table);

  // Persisted scan log (separate userData file). Loaded once, saved on change.
  const [log, setLog] = useState<SurveyEntry[]>([]);
  const logLoaded = useRef(false);
  useEffect(() => {
    let alive = true;
    const p = window.sco?.getSurveyLog?.();
    if (!p) {
      logLoaded.current = true;
      return;
    }
    void p
      .then((e) => {
        if (alive) setLog(Array.isArray(e) ? e : []);
      })
      .finally(() => {
        logLoaded.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (logLoaded.current) window.sco?.saveSurveyLog?.(log);
  }, [log]);

  const debugList = useMemo(() => debugEntries(), []);
  const simEntries = useMemo(
    () => simScans.map((s) => s.entry).filter((e): e is SurveyEntry => e != null),
    [simScans],
  );
  const mapEntries = useMemo(
    () => [...log, ...(debugMode ? debugList : []), ...simEntries],
    [log, debugMode, debugList, simEntries],
  );
  // The map centers on the logged field itself; the ship is just a marker.
  const mapShip: Vec3 | null = debugMode ? DEBUG_SHIP : readout.pos;

  // Track recent ship positions so logging can require a steady read (parked),
  // rejecting a one-frame misread.
  const recentPos = useRef<Vec3[]>([]);
  useEffect(() => {
    if (!readout.pos) return;
    const r = recentPos.current;
    r.push(readout.pos);
    if (r.length > 5) r.shift();
  }, [readout.pos]);
  const [logWarn, setLogWarn] = useState<string | null>(null);

  const canLog = readout.pos != null;
  const STABLE_TOL_M = 5000; // 5 km
  const logScan = (): void => {
    if (!readout.pos) return;
    if (!isStablePos(recentPos.current, STABLE_TOL_M)) {
      setLogWarn('Ship position not steady yet — hold still a moment, then log.');
      return;
    }
    setLogWarn(null);
    const entry = makeEntry({
      id: newRegionId(),
      ts: Date.now(),
      scout: scout.trim() || 'Me',
      system: readout.system ?? 'Unknown',
      pos: readout.pos,
      rs: readout.rs ?? 0,
      candidates: readout.candidates,
      scan: readout.scan ?? undefined,
      source: 'local',
    });
    setLog((prev) => [entry, ...prev]);
  };
  const removeResult = (id: string): void => {
    setLog((prev) => prev.filter((e) => e.id !== id));
    setSimScans((prev) => prev.filter((s) => s.entry?.id !== id));
  };
  const resultsEntries = useMemo(() => [...log, ...simEntries], [log, simEntries]);

  const exportLog = (kind: 'json' | 'csv'): void => {
    if (kind === 'json') {
      download('survey-log.json', 'application/json', JSON.stringify(log, null, 2));
    } else {
      const head = 'ts,iso,scout,system,ore,nodes,rs,x,y,z';
      const rows = log.map((e) =>
        [
          e.ts,
          new Date(e.ts).toISOString(),
          csv(e.scout),
          csv(e.system),
          csv(e.ore ?? ''),
          e.nodes ?? '',
          e.rs,
          e.pos.x,
          e.pos.y,
          e.pos.z,
        ].join(','),
      );
      download('survey-log.csv', 'text/csv', [head, ...rows].join('\n'));
    }
  };
  const importLog = async (files: FileList | null): Promise<void> => {
    const file = files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as SurveyEntry[];
      if (Array.isArray(parsed)) setLog((prev) => mergeEntries(prev, parsed));
    } catch {
      // ignore malformed import
    }
  };

  const onSimFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setSimBusy(true);
    const results: SimScan[] = [];
    for (const file of Array.from(files)) {
      const scoutName = file.name.replace(/\.[^.]+$/, '') || 'Scout';
      results.push(await scanImage(file, active, table, scoutName, params.scale));
    }
    // One state update for the whole batch → one re-render / map redraw.
    setSimScans((prev) => [...prev, ...results]);
    setSimBusy(false);
  };

  const previewRegions: PreviewRegion[] = regions.map((r) => ({
    id: r.id,
    rect: r.rect,
    color: ROLE_META[r.role].color,
    active: r.id === activeId,
    label: ROLE_META[r.role].label,
  }));

  const onDraw = (rect: NormRegion): void => {
    if (activeId) onRegionsChange(regions.map((r) => (r.id === activeId ? { ...r, rect } : r)));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Sources
        </Button>
        <span className="flex items-center gap-1.5 text-[13px] text-fg/90">
          <span className="inline-flex items-center rounded-sm bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
            {source.kind}
          </span>
          {source.label}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted">Survey · scout &amp; map (S1: coordinate read)</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 px-3.5 pt-2.5">
            {(['preview', 'map'] as const).map((m) => (
              <button
                key={m}
                className={cn(
                  'rounded-md border px-3.5 py-1 text-xs capitalize transition-colors',
                  leftMode === m
                    ? 'border-accent bg-surface text-fg'
                    : 'border-border-strong text-muted hover:text-fg',
                )}
                onClick={() => setLeftMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {/* CapturePreview stays mounted in both views so the capture <video>
              keeps feeding the live OCR loop; the Map is drawn over it. */}
          <div className="relative flex min-h-0 flex-1">
            <CapturePreview
              source={source}
              mediaRef={mediaRef}
              regions={previewRegions}
              onDraw={onDraw}
              hint={
                activeId
                  ? 'Drag a box over the selected field. Zoom + scroll to refine.'
                  : 'Add a region below, then drag a box over the value on the HUD.'
              }
            />
            {leftMode === 'map' && (
              <div className="absolute inset-0 bg-surface-alt p-2 px-3.5 pb-3.5">
                <SurveyMap ship={mapShip} entries={mapEntries} plane={plane} />
              </div>
            )}
          </div>
        </div>

        <ScanResults entries={resultsEntries} onRemove={removeResult} />

        <div className="w-[380px] overflow-y-auto border-l border-border p-3.5">
          <Card title="Live readout">
            <KV k="System" v={readout.system ?? '—'} />
            <div className="my-2 rounded-md border border-border bg-bg px-2.5 py-2">
              <div className="mb-1.5 text-[11px] text-muted">
                Ship position{' '}
                {readout.posZone ? <span className="text-muted">· {readout.posZone}</span> : null}
              </div>
              {readout.pos ? (
                <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[11px] text-fg/50">X</span>
                  <Coord>{km(readout.pos.x)} km</Coord>
                  <span className="text-[11px] text-fg/50">Y</span>
                  <Coord>{km(readout.pos.y)} km</Coord>
                  <span className="text-[11px] text-fg/50">Z</span>
                  <Coord>{km(readout.pos.z)} km</Coord>
                </div>
              ) : (
                <div className="text-xs text-muted">no coordinates yet</div>
              )}
            </div>
            {readout.scan && (
              <div className="my-2 rounded-md border border-scan-border bg-scan-bg px-2.5 py-2">
                <div className="text-base font-bold text-magenta">
                  {readout.scan.ore}
                  {readout.scan.scu != null && (
                    <span className="text-xs text-muted"> · {readout.scan.scu} SCU</span>
                  )}
                </div>
                <div className="tnum mx-0 my-1.5 flex flex-wrap gap-2.5 text-[11px] text-fg/70">
                  {readout.scan.mass != null && (
                    <span>mass {readout.scan.mass.toLocaleString()}</span>
                  )}
                  {readout.scan.resistance != null && <span>res {readout.scan.resistance}%</span>}
                  {readout.scan.instability != null && <span>inst {readout.scan.instability}</span>}
                </div>
                <div className="mb-0.5 flex items-baseline gap-2 text-[9px] uppercase tracking-wide text-fg/40">
                  <span className="w-11 text-right">%</span>
                  <span className="min-w-0 flex-1">content</span>
                  <span className="w-10 text-right">qual</span>
                  <span className="w-12 text-right">SCU</span>
                </div>
                {readout.scan.composition.map((c, i) => (
                  <div key={i} className="flex items-baseline gap-2 py-px text-xs">
                    <span className="tnum w-11 text-right text-magenta">{c.percent}%</span>
                    <span className="min-w-0 flex-1 truncate">{c.material}</span>
                    <span className="tnum w-10 text-right text-fg/70">{c.quality}</span>
                    <span className="tnum w-12 text-right text-green">
                      {c.scu != null ? c.scu.toFixed(2) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <KV k="RS" v={readout.rs ?? '—'} />
            {readout.candidates.length > 0 && (
              <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                {readout.candidates.map((c) => (
                  <li
                    key={c.name}
                    className="flex items-baseline gap-2 rounded-md border border-border bg-bg px-2 py-1.5"
                  >
                    <span className="flex-1 text-sm font-semibold">{c.name}</span>
                    <span className="tnum text-sm text-accent">×{c.nodes}</span>
                    <span className="w-10 text-right text-[11px] text-fg/50">
                      {Math.round(c.score * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {readout.error && (
              <div className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                {readout.error}
              </div>
            )}
            <button
              className={cn(
                'mt-2.5 w-full rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors',
                canLog
                  ? 'border-[#2e9a68] bg-[#1f6f4a] text-[#eafff3] hover:bg-[#23805a]'
                  : 'cursor-not-allowed border-border bg-[#23272e] text-[#6b7480]',
              )}
              disabled={!canLog}
              onClick={logScan}
            >
              + Log scan
            </button>
            {!canLog && (
              <p className="mt-1 text-xs text-muted">
                Need a ship position to log (box a Ship Pos region).
              </p>
            )}
            {logWarn && <p className="mt-1 text-xs text-amber">{logWarn}</p>}
          </Card>

          <Card title="Log">
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-[13px] text-muted">Scout</span>
              <input
                className={`flex-1 ${INPUT}`}
                value={scout}
                placeholder="your callsign"
                onChange={(e) => onScoutChange(e.target.value)}
              />
            </label>
            <div className="mt-1.5 flex items-center justify-between gap-2 py-0.5">
              <span className="text-[13px] text-muted">{log.length} logged</span>
              <span className="flex gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!log.length}
                  onClick={() => exportLog('json')}
                >
                  JSON
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!log.length}
                  onClick={() => exportLog('csv')}
                >
                  CSV
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <label className="cursor-pointer">
                    Import
                    <input
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={(e) => {
                        void importLog(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!log.length}
                  onClick={() => setLog([])}
                >
                  Clear
                </Button>
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Entries appear in the Scan results column (right).
            </p>
          </Card>

          <Card title="Map">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="accent-accent"
                checked={debugMode}
                onChange={(e) => setDebugMode(e.target.checked)}
              />
              Debug values (synthetic field)
            </label>
            <div className="mt-2 flex items-center justify-between gap-2 py-0.5">
              <span className="text-[13px] text-muted">Plane</span>
              <select
                className={SELECT}
                value={plane}
                onChange={(e) => setPlane(e.target.value as AxisPlane)}
              >
                <option value="xy">X / Y (Z depth)</option>
                <option value="xz">X / Z (Y depth)</option>
                <option value="yz">Y / Z (X depth)</option>
              </select>
            </div>
            <KV k="Points" v={mapEntries.length} className="mt-1" />
            <p className="mt-1 text-xs text-muted">
              Open the <b>Map</b> view on the left. Ship is centered; hover a point for details.
              {debugMode ? '' : ' Real logging arrives in S3 — use Debug values to preview.'}
            </p>
          </Card>

          <Card title="Simulated scans">
            <p className="text-xs text-muted">
              Upload screenshots (debug overlay visible, same HUD layout as your regions). Each is
              OCR&apos;d through the regions and added as a peer scan — a stand-in for networked
              scouts.
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              className="mt-2 w-full text-xs text-muted"
              disabled={simBusy}
              onChange={(e) => {
                void onSimFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2 py-0.5">
              <span className="text-[13px] text-muted">
                {simBusy ? 'scanning…' : `${simEntries.length}/${simScans.length} placed`}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!simScans.length}
                onClick={() => setSimScans([])}
              >
                Clear
              </Button>
            </div>
            {active.every((r) => r.role !== 'shipPos') && (
              <p className="mt-1 text-xs text-muted">
                Add a “Ship Pos” region first, or scans can’t be placed.
              </p>
            )}
            {simScans.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-2">
                {simScans.map((s, i) => (
                  <div key={i} className="rounded-md border border-border bg-bg p-2">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="break-all text-[13px] font-semibold">{s.name}</span>
                      <span className={cn('text-[11px]', s.entry ? 'text-green' : 'text-danger')}>
                        {s.entry ? 'placed' : (s.error ?? 'failed')}
                      </span>
                    </div>
                    {s.regions.map((r, j) => (
                      <div key={j} className="mt-2 flex items-start gap-2">
                        <div className="flex min-h-9 min-w-24 items-center justify-center rounded-sm border border-border bg-black p-0.5">
                          {r.dataUrl ? (
                            <img
                              src={r.dataUrl}
                              alt="crop"
                              className="max-h-[60px] max-w-[140px] [image-rendering:pixelated]"
                            />
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              'break-all font-mono text-[13px]',
                              r.ok ? 'text-green' : 'text-muted',
                            )}
                          >
                            {ROLE_META[r.role].label}: {r.parsed}
                          </div>
                          <div className="mt-0.5 break-all text-[11px] text-fg/50">{r.rawText}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Regions">
            <RegionList
              regions={regions}
              onRegionsChange={onRegionsChange}
              activeId={activeId}
              onActiveChange={setActiveId}
              debug={readout.regions}
              roles={['scanResult', 'shipPos', 'rs', 'system']}
              defaultScale={params.scale}
              hint={
                <>
                  Enable SC&apos;s debug overlay (the <code>Zone … Pos</code> readout) and box the{' '}
                  <b>SolarSystem</b> line for absolute coordinates.
                </>
              }
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3.5 rounded-lg border border-border bg-surface p-3">
      <h2 className="m-0 mb-2.5 text-xs uppercase tracking-wide text-fg/60">{title}</h2>
      {children}
    </section>
  );
}

function KV({ k, v, className }: { k: string; v: ReactNode; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-2 py-0.5', className)}>
      <span className="text-[13px] text-muted">{k}</span>
      <span className="font-mono text-sm">{v}</span>
    </div>
  );
}

function Coord({ children }: { children: ReactNode }) {
  return <span className="text-right font-mono text-sm text-green">{children}</span>;
}
