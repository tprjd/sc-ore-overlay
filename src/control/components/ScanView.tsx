// Mining tab: draw capture regions (the RS number + the SCAN RESULTS panel),
// read them live, match the RS to ore(s), and push to the overlay. The RS is
// temporally voted for a stable overlay value; the scanned rock's composition
// (with per-material SCU) feeds the detail/scan overlay. Reuses the shared
// CapturePreview + RegionList + capture loop.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';

import { CapturePreview } from './CapturePreview';
import type { PreviewRegion } from './CapturePreview';
import { RegionList } from './RegionList';
import { ROLE_META } from './roles';
import type { PickedSource } from './SourcePicker';
import { useSurveyCapture } from '../useSurveyCapture';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import type { LoopParams } from '../useCaptureLoop';
import type { DrawableSource, NormRegion } from '../preprocess';
import {
  createVoter,
  matchWithNoise,
  groupLocations,
  getQualityDetail,
  cleanMaterial,
  snapMaterial,
} from '../../core';
import type { ScanResult, SignatureTable, Voter } from '../../core';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  OverlayScale,
  SurveyRegionSetting,
} from '../../shared/bridge';

/**
 * Two scans are "the same rock" when the OCR'd ore matches and the rock's
 * fingerprint (composition row count + mass) is close. Used to freeze the
 * scan box against OCR jitter while the rock stays targeted.
 */
function sameRock(a: ScanResult, b: ScanResult): boolean {
  if (a.ore.toLowerCase() !== b.ore.toLowerCase()) return false;
  if (a.composition.length !== b.composition.length) return false;
  const aMass = a.mass ?? 0;
  const bMass = b.mass ?? 0;
  if (Math.abs(aMass - bMass) > 200) return false;
  return true;
}

export interface ScanViewProps {
  source: PickedSource;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  noiseSignatures: number[];
  onNoiseSignaturesChange: (sigs: number[]) => void;
  params: LoopParams;
  onParamsChange: (p: LoopParams) => void;
  table: SignatureTable;
  location: string | null;
  onLocationChange: (location: string | null) => void;
  patches: string[];
  activePatch: string;
  onPatchChange: (patch: string) => void;
  hotkeys: HotkeyMap;
  hotkeyStatus: Partial<Record<HotkeyAction, boolean>>;
  onHotkeysChange: (map: HotkeyMap) => void;
  overlayConfig: OverlayConfig;
  onOverlayConfigChange: (config: OverlayConfig) => void;
  onBack: () => void;
}

export function ScanView({
  source,
  regions,
  onRegionsChange,
  noiseSignatures,
  onNoiseSignaturesChange,
  params,
  onParamsChange,
  table,
  location,
  onLocationChange,
  patches,
  activePatch,
  onPatchChange,
  hotkeys,
  hotkeyStatus,
  onHotkeysChange,
  overlayConfig,
  onOverlayConfigChange,
  onBack,
}: ScanViewProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);

  const active: ActiveSurveyRegion[] = useMemo(
    () => regions.filter((r) => r.enabled).map((r) => ({ id: r.id, role: r.role, rect: r.rect, scale: r.scale })),
    [regions],
  );
  const readout = useSurveyCapture(mediaRef, active, params, !paused, table);

  // Temporal voting on the RS reading → a stable value for the overlay. The
  // capture loop emits a fresh readout each tick, so push every tick.
  const voter = useRef<Voter>(createVoter({ quorum: params.quorum }));
  useEffect(() => {
    voter.current = createVoter({ quorum: params.quorum });
  }, [params.quorum]);
  const [stableRs, setStableRs] = useState<number | null>(null);
  useEffect(() => {
    setStableRs(voter.current.push(readout.rs));
  }, [readout]);

  const systemGroups = useMemo(() => groupLocations(table), [table]);
  const matches = useMemo(
    () =>
      stableRs != null
        ? matchWithNoise(stableRs, table, { method: 'Ship' }, { location }, noiseSignatures)
        : [],
    [stableRs, table, location, noiseSignatures],
  );

  // Known-ore vocabulary used to snap OCR'd material names to their nearest
  // legal table entry. The HUD font + tag leakage routinely turns "Agricium"
  // into "Agricius" or "Titanium (Cf)" into "Titaniumicf)" — snapMaterial
  // absorbs those without changing the underlying parsed numbers.
  const oreVocab = useMemo(() => table.deposits.map((d) => d.name), [table]);

  // Freeze the displayed scan once parseScanResult returns one — UI shifts and
  // OCR jitter would otherwise rewrite the percentages/qualities continuously.
  // Replace the frozen scan only when the OCR clearly reports a *different*
  // rock (ore name changed, row count changed, or mass differs by > 200).
  // Materials are snap-corrected against the table vocabulary at freeze time
  // so the overlay/IPC consumers see clean names without doing their own fuzzy
  // matching.
  const [frozenScan, setFrozenScan] = useState<ScanResult | null>(null);
  useEffect(() => {
    const next = readout.scan;
    if (!next) return;
    const snapped: ScanResult = {
      ...next,
      ore: snapMaterial(next.ore, oreVocab),
      composition: next.composition.map((c) => ({
        ...c,
        material: snapMaterial(c.material, oreVocab),
      })),
    };
    if (frozenScan && sameRock(frozenScan, snapped)) return;
    setFrozenScan(snapped);
  }, [readout, frozenScan, oreVocab]);

  // Push matches + top-candidate quality + the frozen scanned rock to the
  // overlay boxes. Effect deps only fire on meaningful changes so the overlay
  // doesn't re-arm its idle timer on every OCR tick.
  useEffect(() => {
    const top = matches[0];
    const detail = top ? getQualityDetail(table, top.name, top.signature, location) : null;
    window.sco?.sendMatches?.({
      reading: stableRs,
      candidates: matches.map((c) => ({
        name: c.name,
        nodes: c.nodes,
        score: c.score,
        noise: c.noise ?? null,
        loose: c.loose ?? false,
      })),
      detail,
      scan: frozenScan,
    });
  }, [stableRs, matches, table, location, frozenScan]);

  // Global-hotkey commands relayed from the main process. Recalibrate clears
  // both the regions *and* the frozen scan so the next rock takes over.
  useEffect(() => {
    return window.sco?.onCommand?.((command) => {
      if (command === 'pause') setPaused((p) => !p);
      else if (command === 'recalibrate') {
        onRegionsChange([]);
        setFrozenScan(null);
      }
    });
  }, [onRegionsChange]);

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
  const set = <K extends keyof LoopParams>(key: K, val: LoopParams[K]): void =>
    onParamsChange({ ...params, [key]: val });

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.btn} onClick={onBack}>← Sources</button>
        <span style={S.srcLabel}>
          <span style={S.badge}>{source.kind}</span>
          {source.label}
        </span>
        <span style={S.spacer} />
        <button style={S.btn} onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </header>

      <div style={S.body}>
        <CapturePreview
          source={source}
          mediaRef={mediaRef}
          regions={previewRegions}
          onDraw={onDraw}
          hint={
            activeId
              ? 'Drag a box over the selected field. Zoom + scroll to refine.'
              : 'Add a region (RS or Scan Result), then drag a box over it on the HUD.'
          }
        />

        <div style={S.panel}>
          <div style={S.readout}>
            <div style={S.readoutLabel}>Accepted reading</div>
            <div style={S.readoutValue}>{stableRs ?? '—'}</div>
            <div style={S.readoutMeta}>
              {paused ? 'paused' : `every ${params.intervalMs} ms · quorum ${params.quorum}`}
            </div>
          </div>

          <Section title="Match">
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Patch</span>
              <select style={S.select} value={activePatch} onChange={(e) => onPatchChange(e.target.value)}>
                {patches.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Location</span>
              <select
                style={S.select}
                value={location ?? ''}
                onChange={(e) => onLocationChange(e.target.value || null)}
              >
                <option value="">Anywhere</option>
                {systemGroups.map((g) => (
                  <optgroup key={g.system} label={g.system}>
                    {g.locations.map((loc) => (
                      <option key={`${g.system}:${loc}`} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {stableRs == null ? (
              <p style={S.dim}>Waiting for a stable reading…</p>
            ) : matches.length === 0 ? (
              <p style={S.dim}>
                No ore matches {stableRs}
                {location ? ` at ${location}` : ''}.
              </p>
            ) : (
              <ul style={S.candList}>
                {matches.map((c, i) => (
                  <li key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`} style={S.candRow}>
                    <span style={S.candName}>
                      {c.name}
                      {c.noise != null && (
                        <span style={S.noiseBadge} title={`RS = ${c.signature * c.nodes} + ${c.noise} noise`}>
                          +{c.noise.toLocaleString()}
                        </span>
                      )}
                      {c.loose && (
                        <span style={S.looseBadge} title="Outside the table's cluster range — table may be stale.">
                          loose
                        </span>
                      )}
                    </span>
                    <span style={S.candNodes}>×{c.nodes}</span>
                    <span style={S.candScore}>{Math.round(c.score * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Noise signatures" defaultOpen={false}>
            <p style={S.dim}>
              Non-ore signals (wrecks, satellites, debris) that can sit on top of an RS reading.
              Each value is tried as a subtraction before matching.
            </p>
            <NoiseEditor values={noiseSignatures} onChange={onNoiseSignaturesChange} />
          </Section>

          {frozenScan && (
            <Section title="Scanned rock">
              <div style={S.scanBlock}>
                <div style={S.scanOre}>
                  {frozenScan.ore}
                  {frozenScan.scu != null && <span style={S.dim}> · {frozenScan.scu} SCU</span>}
                  <button
                    type="button"
                    style={S.clearBtn}
                    onClick={() => setFrozenScan(null)}
                    title="Clear the frozen scan and accept the next recognized rock"
                  >
                    clear
                  </button>
                </div>
                <div style={S.scanMeta}>
                  {frozenScan.mass != null && <span>mass {frozenScan.mass.toLocaleString()}</span>}
                  {frozenScan.resistance != null && <span>res {frozenScan.resistance}%</span>}
                  {frozenScan.instability != null && <span>inst {frozenScan.instability}</span>}
                </div>
                <div style={S.compHead}>
                  <span style={S.compPct}>%</span>
                  <span style={S.compMat}>content</span>
                  <span style={S.compVal}>qual</span>
                  <span style={S.compScu}>SCU</span>
                </div>
                {frozenScan.composition.map((c, i) => (
                  <div key={i} style={S.compRow}>
                    <span style={S.compPct}>{c.percent}%</span>
                    <span style={S.compMat} title={c.material}>{cleanMaterial(c.material)}</span>
                    <span style={S.compVal}>{c.quality}</span>
                    <span style={S.compScu}>{c.scu != null ? c.scu.toFixed(2) : '—'}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Capture" defaultOpen={false}>
            <Slider
              label="Upscale"
              min={1}
              max={8}
              value={params.scale}
              onChange={(v) => set('scale', v)}
              suffix="×"
            />
            <p style={S.dim}>Default upscale; override per region in the Regions panel.</p>
          </Section>

          <Section title="Timing">
            <Slider
              label="Interval"
              min={300}
              max={2000}
              step={50}
              value={params.intervalMs}
              onChange={(v) => set('intervalMs', v)}
              suffix=" ms"
            />
            <Slider
              label="Vote quorum"
              min={1}
              max={8}
              value={params.quorum}
              onChange={(v) => set('quorum', v)}
              suffix=" frames"
            />
          </Section>

          <Section title="Hotkeys" defaultOpen={false}>
            {HOTKEY_ROWS.map(([action, label]) => (
              <div key={action} style={S.hotkeyRow}>
                <span style={S.sliderLabel}>{label}</span>
                <KeyCapture
                  value={hotkeys[action]}
                  onChange={(accel) => onHotkeysChange({ ...hotkeys, [action]: accel })}
                />
                {hotkeyStatus[action] === false && <span style={S.hotkeyErr}>conflict</span>}
              </div>
            ))}
            <p style={S.dim}>Click a binding, then press the combo (needs a modifier).</p>
          </Section>

          <Section title="Overlay" defaultOpen={false}>
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Fade after</span>
              <select
                style={S.select}
                value={overlayConfig.idleMs}
                onChange={(e) =>
                  onOverlayConfigChange({ ...overlayConfig, idleMs: Number(e.target.value) })
                }
              >
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
                <option value={60000}>60s</option>
                <option value={0}>Never</option>
              </select>
            </label>
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Size</span>
              <select
                style={S.select}
                value={overlayConfig.scale}
                onChange={(e) =>
                  onOverlayConfigChange({ ...overlayConfig, scale: e.target.value as OverlayScale })
                }
              >
                <option value="compact">Compact</option>
                <option value="normal">Normal</option>
                <option value="large">Large</option>
              </select>
            </label>
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Font</span>
              <select
                style={S.select}
                value={overlayConfig.fontFamily}
                onChange={(e) => onOverlayConfigChange({ ...overlayConfig, fontFamily: e.target.value })}
              >
                <option value="system-ui, sans-serif">System</option>
                <option value="'Segoe UI', sans-serif">Segoe UI</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Courier New', ui-monospace, monospace">Monospace</option>
              </select>
            </label>
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Background</span>
              <input
                type="color"
                style={S.color}
                value={overlayConfig.bgColor}
                onChange={(e) => onOverlayConfigChange({ ...overlayConfig, bgColor: e.target.value })}
              />
            </label>
            <Slider
              label="Opacity"
              min={0}
              max={100}
              value={Math.round(overlayConfig.bgOpacity * 100)}
              onChange={(v) => onOverlayConfigChange({ ...overlayConfig, bgOpacity: v / 100 })}
              suffix="%"
            />
            <Slider
              label="Padding"
              min={0}
              max={40}
              value={overlayConfig.padding}
              onChange={(v) => onOverlayConfigChange({ ...overlayConfig, padding: v })}
              suffix=" px"
            />
            <Slider
              label="Line gap"
              min={0}
              max={24}
              value={overlayConfig.gap}
              onChange={(v) => onOverlayConfigChange({ ...overlayConfig, gap: v })}
              suffix=" px"
            />
            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={overlayConfig.border}
                onChange={(e) => onOverlayConfigChange({ ...overlayConfig, border: e.target.checked })}
              />
              Border
            </label>
            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={overlayConfig.showPlaceholder}
                onChange={(e) =>
                  onOverlayConfigChange({ ...overlayConfig, showPlaceholder: e.target.checked })
                }
              />
              Show “scanning” placeholder
            </label>
            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={overlayConfig.showDetail}
                onChange={(e) =>
                  onOverlayConfigChange({ ...overlayConfig, showDetail: e.target.checked })
                }
              />
              Show ore detail box
            </label>
            <label style={S.checkRow}>
              <input
                type="checkbox"
                checked={overlayConfig.showScan}
                onChange={(e) =>
                  onOverlayConfigChange({ ...overlayConfig, showScan: e.target.checked })
                }
              />
              Show scanned-rock box (SCU per quality)
            </label>
            <p style={S.dim}>In edit mode (Alt+Shift+E): drag to move, drag the corner grip to resize.</p>
          </Section>

          <Section title="Regions">
            <RegionList
              regions={regions}
              onRegionsChange={onRegionsChange}
              activeId={activeId}
              onActiveChange={setActiveId}
              debug={readout.regions}
              roles={['rs', 'scanResult']}
              defaultScale={params.scale}
              hint="Box the RS number and the SCAN RESULTS panel."
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={S.section}>
      <button type="button" style={S.sectionHeader} onClick={() => setOpen((o) => !o)}>
        <span style={S.caret}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && children}
    </section>
  );
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label style={S.sliderRow}>
      <span style={S.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.range}
      />
      <span style={S.sliderValue}>
        {value}
        {suffix}
      </span>
    </label>
  );
}

/**
 * Comma-separated noise-signature editor. Lets the user manage the list of
 * non-ore signatures (wrecks, sats, etc) that the matcher tries subtracting
 * from a "no match" RS reading. Parses on blur / Enter; ignores garbage.
 */
function NoiseEditor({
  values,
  onChange,
}: {
  values: number[];
  onChange: (next: number[]) => void;
}) {
  const [text, setText] = useState<string>(values.join(', '));
  useEffect(() => {
    setText(values.join(', '));
  }, [values]);
  const commit = (): void => {
    const next = text
      .split(/[,\s]+/)
      .map((t) => Number.parseInt(t, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    onChange([...new Set(next)].sort((a, b) => a - b));
  };
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <input
        type="text"
        value={text}
        placeholder="10000, 5000, …"
        style={{ ...S.select, fontVariantNumeric: 'tabular-nums' }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

const HOTKEY_ROWS: Array<[HotkeyAction, string]> = [
  ['toggleOverlay', 'Toggle overlay'],
  ['pause', 'Pause / resume'],
  ['recalibrate', 'Recalibrate'],
  ['editOverlay', 'Edit overlay'],
];

/** Convert a KeyboardEvent key to an Electron accelerator token, or null. */
function normalizeKey(key: string): string | null {
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return null;
  if (key === ' ') return 'Space';
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F\d{1,2}$/.test(key)) return key;
  const special: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Enter: 'Return',
    Tab: 'Tab',
    Delete: 'Delete',
    Backspace: 'Backspace',
  };
  return special[key] ?? null;
}

/** A button that records the next key combo into an Electron accelerator. */
function KeyCapture({ value, onChange }: { value: string; onChange: (accel: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    if (e.key === 'Escape') {
      setCapturing(false);
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const key = normalizeKey(e.key);
    if (!key || mods.length === 0) return; // require at least one modifier + a real key
    onChange([...mods, key].join('+'));
    setCapturing(false);
  };
  return (
    <button
      type="button"
      style={{ ...S.keyBtn, ...(capturing ? S.keyBtnActive : null) }}
      onClick={() => setCapturing(true)}
      onKeyDown={capturing ? onKeyDown : undefined}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? 'press combo…' : value}
    </button>
  );
}

const text: CSSProperties = { color: '#e6e6e6' };
const S: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', color: '#e6e6e6', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #2c323d' },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 },
  spacer: { flex: 1 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  panel: { width: 380, borderLeft: '1px solid #2c323d', padding: 14, overflowY: 'auto', boxSizing: 'border-box' },
  readout: { background: '#1d2128', border: '1px solid #2c323d', borderRadius: 8, padding: 12, marginBottom: 14, textAlign: 'center' },
  readoutLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },
  readoutValue: { fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: '#4fd1ff' },
  readoutMeta: { fontSize: 11, opacity: 0.55 },
  section: { marginBottom: 16 },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: 0, margin: '0 0 8px', cursor: 'pointer', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#e6e6e6', opacity: 0.65, textAlign: 'left' },
  caret: { fontSize: 10, width: 10, display: 'inline-block' },
  dim: { opacity: 0.45, fontSize: 12 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  sliderLabel: { width: 82, fontSize: 12, opacity: 0.8 },
  range: { flex: 1 },
  sliderValue: { width: 56, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 },
  btn: { background: '#2a2f3a', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 },
  badge: { fontSize: 10, textTransform: 'uppercase', background: '#2c323d', borderRadius: 4, padding: '2px 5px', opacity: 0.8 },
  selectRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  select: { flex: 1, background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', fontSize: 13 },
  candList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  candRow: { display: 'flex', alignItems: 'baseline', gap: 8, background: '#1d2128', border: '1px solid #2c323d', borderRadius: 6, padding: '8px 10px' },
  candName: { flex: 1, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 6 },
  noiseBadge: { fontSize: 10, padding: '1px 5px', background: '#3a2a1a', color: '#fbbf24', border: '1px solid #5a3a1f', borderRadius: 4, fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  looseBadge: { fontSize: 10, padding: '1px 5px', background: '#2a1a3a', color: '#c084fc', border: '1px solid #4a2a5a', borderRadius: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 },
  candNodes: { fontSize: 16, color: '#4fd1ff', fontVariantNumeric: 'tabular-nums' },
  candScore: { fontSize: 11, opacity: 0.5, width: 40, textAlign: 'right' },
  hotkeyRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  hotkeyErr: { fontSize: 11, color: '#ffb4bd' },
  keyBtn: { flex: 1, background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'ui-monospace, monospace', cursor: 'pointer', textAlign: 'left' },
  keyBtnActive: { borderColor: '#4fd1ff', color: '#4fd1ff' },
  color: { width: 48, height: 28, padding: 0, background: 'transparent', border: '1px solid #3a4150', borderRadius: 6, cursor: 'pointer' },
  scanBlock: { padding: '8px 10px', background: '#160f18', border: '1px solid #5b3a63', borderRadius: 6 },
  scanOre: { ...text, fontSize: 16, fontWeight: 700, color: '#f0abfc', display: 'flex', alignItems: 'baseline', gap: 6 },
  clearBtn: { marginLeft: 'auto', background: 'transparent', color: '#9fb3c8', border: '1px solid #3a4150', borderRadius: 4, padding: '1px 6px', fontSize: 10, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 0.4 },
  scanMeta: { display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, opacity: 0.7, margin: '2px 0 6px', fontVariantNumeric: 'tabular-nums' },
  compHead: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.4, marginBottom: 2 },
  compRow: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '1px 0' },
  compPct: { width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#f0abfc' },
  compMat: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  compVal: { width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 },
  compScu: { width: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6ee7b7' },
};
