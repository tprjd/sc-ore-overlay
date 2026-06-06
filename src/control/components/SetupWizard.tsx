// First-run setup wizard. Walks a fresh profile through everything needed to
// start, with every non-essential step skippable and the whole flow skippable
// from the header. Steps:
//   welcome → source → RS region (+ test read) → scan panel (opt) → capture speed
//   (opt) → options (opt) → hotkeys (opt) → done
//
// It owns no persistence: it collects choices and hands them back via onComplete;
// App applies them. Reuses CapturePreview (self-contained — no capture loop just
// to draw a box), SourceGrid (shared with the standalone picker), and the same
// location grouping + overlay presets as the main panel.

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Gauge,
  Keyboard,
  Layers,
  MonitorPlay,
  Rocket,
  ScanLine,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { SignatureTable } from '../../core';
import { groupLocations } from '../../core';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  SurveyRegionSetting,
} from '../../shared/bridge';
import { recognize } from '../ocr';
import type { DrawableSource, NormRegion } from '../preprocess';
import { preprocess } from '../preprocess';
import {
  Badge,
  Button,
  Card,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Stepper,
} from '../ui';
import { cn } from '../ui/cn';
import type { LoopParams } from '../useCaptureLoop';
import { pickReading } from '../useCaptureLoop';
import type { PreviewRegion } from './CapturePreview';
import { CapturePreview } from './CapturePreview';
import { HotkeyEditor } from './controls';
import type { CapturePreset, OverlayPreset } from './presets';
import { CAPTURE_PRESETS, OVERLAY_PRESETS } from './presets';
import { newRegionId, ROLE_META } from './roles';
import type { PickedSource } from './SourceGrid';
import { SourceGrid } from './SourceGrid';

/** What the wizard collected, applied by App on completion. */
export interface SetupResult {
  rsRegion: SurveyRegionSetting | null;
  scanRegion: SurveyRegionSetting | null;
  location: string | null;
  overlayPreset: Partial<OverlayConfig> | null;
  /** Capture-speed preset (interval + quorum); null = leave as-is. */
  captureParams: Pick<LoopParams, 'intervalMs' | 'quorum'> | null;
}

export interface SetupWizardProps {
  source: PickedSource | null;
  onPickSource: (s: PickedSource) => void;
  lastSourceId?: string;
  table: SignatureTable;
  /** Current hotkey bindings + live registration status (edited in-place). */
  hotkeys: HotkeyMap;
  hotkeyStatus: Partial<Record<HotkeyAction, boolean>>;
  onHotkeysChange: (map: HotkeyMap) => void;
  onComplete: (result: SetupResult) => void;
  onSkip: () => void;
  /** Leave the wizard entirely (← from the welcome step). */
  onExit: () => void;
}

type Step = 'welcome' | 'source' | 'rs' | 'scan' | 'speed' | 'options' | 'hotkeys' | 'done';
const FLOW: Step[] = ['welcome', 'source', 'rs', 'scan', 'speed', 'options', 'hotkeys', 'done'];

const STEPPER = [
  { label: 'Source' },
  { label: 'RS region' },
  { label: 'Scan panel', optional: true },
  { label: 'Capture', optional: true },
  { label: 'Options', optional: true },
  { label: 'Hotkeys', optional: true },
];
const STEPPER_INDEX: Partial<Record<Step, number>> = {
  source: 0,
  rs: 1,
  scan: 2,
  speed: 3,
  options: 4,
  hotkeys: 5,
};

export function SetupWizard({
  source,
  onPickSource,
  lastSourceId,
  table,
  hotkeys,
  hotkeyStatus,
  onHotkeysChange,
  onComplete,
  onSkip,
  onExit,
}: SetupWizardProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const rsId = useRef(newRegionId());
  const scanId = useRef(newRegionId());
  const [step, setStep] = useState<Step>('welcome');
  const [changingSource, setChangingSource] = useState(false);

  const [rsRect, setRsRect] = useState<NormRegion | null>(null);
  const [scanRect, setScanRect] = useState<NormRegion | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<OverlayPreset | null>('standard');
  const [captureId, setCaptureId] = useState<CapturePreset>('normal');

  // RS confirm-read gate: OCR the drawn box once so a bad crop is caught here.
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const [rawText, setRawText] = useState('');
  const [overridden, setOverridden] = useState(false);

  const systemGroups = useMemo(() => groupLocations(table), [table]);

  const idx = FLOW.indexOf(step);
  const next = (): void => setStep(FLOW[Math.min(FLOW.length - 1, idx + 1)]);
  const back = (): void => {
    if (step === 'welcome') onExit();
    else setStep(FLOW[Math.max(0, idx - 1)]);
  };

  const resetRsTest = (): void => {
    setTested(false);
    setReading(null);
    setRawText('');
    setOverridden(false);
  };

  const testRead = async (): Promise<void> => {
    const media = mediaRef.current;
    if (!media || !rsRect) return;
    setTesting(true);
    try {
      const pre = preprocess(media, rsRect, { scale: 4 });
      if (!pre) {
        setReading(null);
        setRawText('(no crop)');
      } else {
        const lines = await recognize(pre.dataUrl);
        setReading(pickReading(lines, table));
        setRawText(
          lines
            .map((l) => l.text)
            .join(' ')
            .trim() || '(no text)',
        );
      }
      setTested(true);
    } catch {
      setReading(null);
      setRawText('(read failed)');
      setTested(true);
    } finally {
      setTesting(false);
    }
  };

  const finish = (): void => {
    onComplete({
      rsRegion: rsRect ? { id: rsId.current, role: 'rs', rect: rsRect, enabled: true } : null,
      scanRegion: scanRect
        ? { id: scanId.current, role: 'scanResult', rect: scanRect, enabled: true }
        : null,
      location,
      overlayPreset: presetId
        ? (OVERLAY_PRESETS.find((p) => p.id === presetId)?.patch ?? null)
        : null,
      captureParams: CAPTURE_PRESETS.find((p) => p.id === captureId)?.patch ?? null,
    });
  };

  const canAdvanceRs = !!rsRect && (reading != null || overridden);
  const stepperIndex = STEPPER_INDEX[step] ?? (step === 'done' ? STEPPER.length : -1);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border px-3.5 py-2.5">
        <Button variant="ghost" size="sm" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
          {step === 'welcome' ? 'Sources' : 'Back'}
        </Button>
        <span className="text-sm font-bold">Setup</span>
        {source && (
          <span className="flex items-center gap-1.5 text-[13px] text-fg/90">
            <Badge>{source.kind}</Badge>
            <span className="max-w-[180px] truncate">{source.label}</span>
          </span>
        )}
        <span className="flex-1" />
        <Button variant="link" onClick={onSkip}>
          Skip setup
        </Button>
      </header>

      {/* Stepper (config steps only) */}
      {stepperIndex >= 0 && (
        <div className="border-b border-border bg-surface-alt px-4 py-3">
          <Stepper steps={STEPPER} current={stepperIndex} />
        </div>
      )}

      {/* Body */}
      {step === 'welcome' && <WelcomeStep onStart={() => setStep('source')} onSkip={onSkip} />}

      {step === 'source' && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
          <StepHeading
            icon={<MonitorPlay className="h-5 w-5" />}
            title="Choose what to capture"
            desc="Run Star Citizen in borderless/windowed, then pick its window or your whole screen. You can also load a screenshot or clip to set things up offline."
          />
          {source && !changingSource ? (
            <Card className="flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 place-items-center rounded-md bg-green/15 text-green">
                <Check className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Badge className="shrink-0">{source.kind}</Badge>
                  <span className="min-w-0 truncate font-semibold">{source.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">Capturing this source.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setChangingSource(true)}>
                Change
              </Button>
            </Card>
          ) : (
            <SourceGrid
              onPick={(s) => {
                onPickSource(s);
                setChangingSource(false);
              }}
              lastSourceId={lastSourceId}
              selectedId={source?.sourceId}
            />
          )}
          <Footer>
            <span className="flex-1" />
            <Button onClick={next} disabled={!source} variant="primary">
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Footer>
        </div>
      )}

      {step === 'rs' &&
        (source ? (
          <div className="flex min-h-0 flex-1">
            <CapturePreview
              source={source}
              mediaRef={mediaRef}
              regions={rsRect ? [previewRegion(rsId.current, rsRect, 'rs')] : []}
              onDraw={(r) => {
                setRsRect(r);
                resetRsTest();
              }}
              hint="Drag a box over the RADAR SIGNATURE number on the mining scanner HUD. A rough box is fine — detection finds the digits inside it."
            />
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-border p-4">
              <StepHeading
                icon={<Crosshair className="h-5 w-5" />}
                title="RS region"
                desc="Drag a rectangle over the Radar Signature number. Redraw freely — the last box wins."
              />
              <p
                className={cn(
                  'mt-1 text-[13px] font-semibold',
                  rsRect ? 'text-accent' : 'text-muted',
                )}
              >
                {rsRect ? '✓ Region set' : 'No region drawn yet'}
              </p>

              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!rsRect || testing}
                  onClick={() => void testRead()}
                >
                  {testing ? 'Reading…' : 'Test read'}
                </Button>
              </div>
              {tested &&
                (reading != null ? (
                  <p className="mt-2.5 text-[13px] font-semibold text-green">
                    ✓ Reads {reading.toLocaleString()} — looks good.
                  </p>
                ) : (
                  <div className="mt-2.5">
                    <p className="text-xs text-amber">
                      No usable reading. OCR saw:{' '}
                      <span className="font-mono text-fg/85">{rawText}</span>
                    </p>
                    <p className="mt-1 mb-1.5 text-xs text-muted">
                      Redraw the box tighter over the number, or skip the check.
                    </p>
                    <Button variant="link" onClick={() => setOverridden(true)}>
                      Use anyway
                    </Button>
                  </div>
                ))}
              {overridden && reading == null && (
                <p className="mt-2 text-xs text-amber">
                  Check skipped — advancing without a confirmed read.
                </p>
              )}

              <span className="flex-1" />
              <Footer>
                <Button variant="link" onClick={next}>
                  Skip this step
                </Button>
                <span className="flex-1" />
                <Button
                  variant="primary"
                  disabled={!canAdvanceRs}
                  onClick={next}
                  title={
                    canAdvanceRs
                      ? undefined
                      : 'Run “Test read” and confirm a reading (or use anyway)'
                  }
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Footer>
            </aside>
          </div>
        ) : (
          <NeedSource onBack={() => setStep('source')} />
        ))}

      {step === 'scan' &&
        (source ? (
          <div className="flex min-h-0 flex-1">
            <CapturePreview
              source={source}
              mediaRef={mediaRef}
              regions={scanRect ? [previewRegion(scanId.current, scanRect, 'scanResult')] : []}
              onDraw={setScanRect}
              hint="Optional: drag a box over the SCAN RESULTS panel (the ore-composition readout). This feeds the detail/scan overlay boxes."
            />
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-border p-4">
              <StepHeading
                icon={<ScanLine className="h-5 w-5" />}
                title="Scan panel (optional)"
                desc="Box the SCAN RESULTS panel to show each rock's per-quality SCU on the overlay. Skip if you only want ore identification."
              />
              <p
                className={cn(
                  'mt-1 text-[13px] font-semibold',
                  scanRect ? 'text-magenta' : 'text-muted',
                )}
              >
                {scanRect ? '✓ Region set' : 'Not set — that’s fine'}
              </p>
              <span className="flex-1" />
              <Footer>
                <Button variant="link" onClick={next}>
                  Skip this step
                </Button>
                <span className="flex-1" />
                <Button variant="primary" onClick={next}>
                  Next
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Footer>
            </aside>
          </div>
        ) : (
          <NeedSource onBack={() => setStep('source')} />
        ))}

      {step === 'speed' && (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto p-6">
          <StepHeading
            icon={<Gauge className="h-5 w-5" />}
            title="Capture speed (optional)"
            desc="How often the RS region is read and how many matching reads it takes to lock a value. Faster reacts quicker but jumps more; slower is steadier and lighter on CPU. Changeable later from the Mining panel."
          />

          <section className="flex flex-col gap-2">
            {CAPTURE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setCaptureId(p.id)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                  captureId === p.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className="flex items-center gap-1.5 font-semibold">
                  <Gauge className="h-3.5 w-3.5 text-accent" />
                  {p.label}
                </span>
                <span className="text-xs text-muted">{p.hint}</span>
              </button>
            ))}
          </section>

          <Footer className="mt-auto">
            <Button variant="link" onClick={next}>
              Skip this step
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={next}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Footer>
        </div>
      )}

      {step === 'options' && (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto p-6">
          <StepHeading
            icon={<SlidersHorizontal className="h-5 w-5" />}
            title="Options (optional)"
            desc="Tune matching and the overlay look. Everything here is changeable later from the Mining panel."
          />

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Mining location
            </h3>
            <Select
              value={location ?? 'any'}
              onValueChange={(v) => setLocation(v === 'any' ? null : v)}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Anywhere</SelectItem>
                {systemGroups.map((g) => (
                  <SelectGroup key={g.system}>
                    <SelectLabel>{g.system}</SelectLabel>
                    {g.locations.map((loc) => (
                      <SelectItem key={`${g.system}:${loc}`} value={loc}>
                        {loc}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs text-muted">
              Narrows and re-weights matches. Leave on “Anywhere” if unsure.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Overlay style
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {OVERLAY_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={cn(
                    'flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
                    presetId === p.id
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-surface hover:border-border-strong',
                  )}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Layers className="h-3.5 w-3.5 text-accent" />
                    {p.label}
                  </span>
                  <span className="text-xs text-muted">{p.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <Footer className="mt-auto">
            <Button variant="link" onClick={next}>
              Skip this step
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={next}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Footer>
        </div>
      )}

      {step === 'hotkeys' && (
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto p-6">
          <StepHeading
            icon={<Keyboard className="h-5 w-5" />}
            title="Hotkeys (optional)"
            desc="Global shortcuts that work while Star Citizen is focused. Defaults are set — change any binding or skip. Editable later from the Mining panel."
          />

          <section className="max-w-md">
            <HotkeyEditor
              hotkeys={hotkeys}
              hotkeyStatus={hotkeyStatus}
              onChange={onHotkeysChange}
            />
          </section>

          <Footer className="mt-auto">
            <Button variant="link" onClick={next}>
              Skip this step
            </Button>
            <span className="flex-1" />
            <Button variant="primary" onClick={next}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Footer>
        </div>
      )}

      {step === 'done' && (
        <DoneStep
          rsSet={!!rsRect}
          scanSet={!!scanRect}
          location={location}
          presetLabel={OVERLAY_PRESETS.find((p) => p.id === presetId)?.label ?? null}
          onFinish={finish}
        />
      )}
    </div>
  );
}

function previewRegion(id: string, rect: NormRegion, role: 'rs' | 'scanResult'): PreviewRegion {
  return { id, rect, color: ROLE_META[role].color, active: true, label: ROLE_META[role].label };
}

function StepHeading({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-base font-bold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{desc}</p>
    </div>
  );
}

function Footer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-2 pt-4', className)}>{children}</div>;
}

function NeedSource({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div>
        <p className="text-sm text-muted">Pick a capture source first.</p>
        <Button className="mt-3" variant="secondary" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back to source
        </Button>
      </div>
    </div>
  );
}

function WelcomeStep({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to SC Ore Overlay</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          A non-obstructive overlay that reads your mining scanner’s Radar Signature and tells you
          which ore you’re looking at — and how many nodes — while you play. This quick setup gets
          you reading in under a minute. Every step is optional and you can re-run it anytime.
        </p>
      </div>

      <Card className="flex gap-3 border-amber/30 bg-amber/5 p-4">
        <Layers className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <div>
          <p className="text-sm font-semibold text-amber">Run the game borderless or windowed</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Click-through overlays don’t draw over exclusive fullscreen. Set Star Citizen to
            <strong className="text-fg"> Borderless</strong> (or Windowed) in graphics settings so
            the overlay shows on top.
          </p>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" size="lg" onClick={onStart}>
          <Rocket className="h-4 w-4" />
          Get started
        </Button>
        <Button variant="link" onClick={onSkip}>
          Skip setup — I’ll configure it myself
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  rsSet,
  scanSet,
  location,
  presetLabel,
  onFinish,
}: {
  rsSet: boolean;
  scanSet: boolean;
  location: string | null;
  presetLabel: string | null;
  onFinish: () => void;
}) {
  const rows: Array<[string, string, boolean]> = [
    ['RS region', rsSet ? 'Set' : 'Not set — add it from Capture', rsSet],
    ['Scan panel', scanSet ? 'Set' : 'Skipped', scanSet],
    ['Location', location ?? 'Anywhere', true],
    ['Overlay style', presetLabel ?? 'Unchanged', true],
  ];
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-green/15 text-green">
            <Check className="h-5 w-5" />
          </span>
          You’re set
        </h1>
        <p className="mt-2 text-sm text-muted">
          Here’s what’s configured. You can change all of it later from the Mining panel.
        </p>
      </div>
      <Card className="divide-y divide-border">
        {rows.map(([k, v, ok]) => (
          <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-muted">{k}</span>
            <span
              className={cn('flex items-center gap-1.5 font-medium', ok ? 'text-fg' : 'text-amber')}
            >
              {ok && <Check className="h-3.5 w-3.5 text-green" />}
              {v}
            </span>
          </div>
        ))}
      </Card>
      <div>
        <Button variant="primary" size="lg" onClick={onFinish}>
          Finish
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
