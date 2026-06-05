// First-run setup wizard. After the source is picked (SourcePicker, shown by
// App), this walks a fresh profile through the two remaining must-haves —
// drawing the RS capture region and choosing a location — then hands them back
// to App, which drops into the normal Mining panel. Existing profiles never see
// this; it's also reachable again from the panel's "Setup" button.
//
// It reuses CapturePreview (self-contained — no capture loop needed just to
// draw a box) and the same location grouping as the main panel.

import type { CSSProperties } from 'react';
import { useMemo, useRef, useState } from 'react';
import type { SignatureTable } from '../../core';
import { groupLocations } from '../../core';
import type { SurveyRegionSetting } from '../../shared/bridge';
import { recognize } from '../ocr';
import type { DrawableSource, NormRegion } from '../preprocess';
import { preprocess } from '../preprocess';
import { pickReading } from '../useCaptureLoop';
import type { PreviewRegion } from './CapturePreview';
import { CapturePreview } from './CapturePreview';
import { newRegionId, ROLE_META } from './roles';
import type { PickedSource } from './SourcePicker';
import { C, R } from './tokens';

export interface SetupWizardProps {
  source: PickedSource;
  table: SignatureTable;
  onComplete: (region: SurveyRegionSetting, location: string | null) => void;
  onSkip: () => void;
  onBack: () => void;
}

type Step = 'region' | 'location';

export function SetupWizard({ source, table, onComplete, onSkip, onBack }: SetupWizardProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const regionId = useRef(newRegionId());
  const [step, setStep] = useState<Step>('region');
  const [rect, setRect] = useState<NormRegion | null>(null);
  const [location, setLocation] = useState<string | null>(null);

  // A2 — confirm-read gate: OCR the drawn box once so a bad crop is caught at
  // setup time. The user can't advance past the region step until a plausible
  // reading shows (pickReading cross-checks the table) or they explicitly skip it.
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const [rawText, setRawText] = useState('');
  const [overridden, setOverridden] = useState(false);

  const resetTest = (): void => {
    setTested(false);
    setReading(null);
    setRawText('');
    setOverridden(false);
  };

  // Redrawing the box invalidates any prior read.
  const onDraw = (r: NormRegion): void => {
    setRect(r);
    resetTest();
  };

  const testRead = async (): Promise<void> => {
    const media = mediaRef.current;
    if (!media || !rect) return;
    setTesting(true);
    try {
      const pre = preprocess(media, rect, { scale: 4 });
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

  const canAdvance = !!rect && (reading != null || overridden);

  const systemGroups = useMemo(() => groupLocations(table), [table]);

  const previewRegions: PreviewRegion[] = rect
    ? [
        {
          id: regionId.current,
          rect,
          color: ROLE_META.rs.color,
          active: true,
          label: ROLE_META.rs.label,
        },
      ]
    : [];

  const finish = (): void => {
    if (!rect) return;
    onComplete({ id: regionId.current, role: 'rs', rect, enabled: true }, location);
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.btn} onClick={onBack}>
          ← Sources
        </button>
        <span style={S.title}>Setup</span>
        <span style={S.srcLabel}>
          <span style={S.badge}>{source.kind}</span>
          {source.label}
        </span>
        <span style={S.spacer} />
        <button style={S.linkBtn} onClick={onSkip}>
          Skip setup
        </button>
      </header>

      <div style={S.steps}>
        <Stepper
          index={0}
          active={step === 'region'}
          done={!!rect && step !== 'region'}
          label="Draw RS region"
        />
        <span style={S.stepLine} />
        <Stepper index={1} active={step === 'location'} done={false} label="Choose location" />
      </div>

      {step === 'region' ? (
        <div style={S.body}>
          <CapturePreview
            source={source}
            mediaRef={mediaRef}
            regions={previewRegions}
            onDraw={onDraw}
            hint="Drag a box over the RADAR SIGNATURE number on the mining scanner HUD. A rough box is fine — detection finds the digits inside it."
          />
          <div style={S.side}>
            <h2 style={S.h2}>Step 1 — RS region</h2>
            <p style={S.p}>
              Find the scanner HUD in the preview, then drag a rectangle over the{' '}
              <b>Radar Signature</b> number. You can redraw it; the last box wins.
            </p>
            <p style={S.status}>{rect ? '✓ Region set' : 'No region drawn yet'}</p>

            <button
              type="button"
              style={{ ...S.btn, ...(rect && !testing ? null : S.disabled) }}
              disabled={!rect || testing}
              onClick={testRead}
            >
              {testing ? 'Reading…' : 'Test read'}
            </button>
            {tested &&
              (reading != null ? (
                <p style={S.readOk}>✓ Reads {reading.toLocaleString()} — looks good.</p>
              ) : (
                <div style={S.readBad}>
                  <p style={S.readBadLine}>
                    No usable reading. OCR saw: <span style={S.raw}>{rawText}</span>
                  </p>
                  <p style={S.readHint}>
                    Redraw the box tighter over the number, or skip the check.
                  </p>
                  <button type="button" style={S.linkBtn} onClick={() => setOverridden(true)}>
                    Use anyway
                  </button>
                </div>
              ))}
            {overridden && reading == null && (
              <p style={S.readWarn}>Check skipped — advancing without a confirmed read.</p>
            )}

            <span style={S.spacer} />
            <div style={S.footer}>
              <button
                style={{ ...S.primary, ...(canAdvance ? null : S.disabled) }}
                disabled={!canAdvance}
                onClick={() => setStep('location')}
                title={
                  canAdvance ? undefined : 'Run "Test read" and confirm a reading (or use anyway)'
                }
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={S.body}>
          <div style={S.locPane}>
            <h2 style={S.h2}>Step 2 — Location</h2>
            <p style={S.p}>
              Pick where you're mining to narrow and re-weight matches, or leave it on{' '}
              <b>Anywhere</b>. You can change this any time from the Match tab.
            </p>
            <label style={S.selectRow}>
              <span style={S.selLabel}>Location</span>
              <select
                style={S.select}
                value={location ?? ''}
                onChange={(e) => setLocation(e.target.value || null)}
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
            <span style={S.spacer} />
            <div style={S.footer}>
              <button style={S.btn} onClick={() => setStep('region')}>
                ← Back
              </button>
              <span style={S.spacer} />
              <button style={S.primary} onClick={finish}>
                Finish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({
  index,
  active,
  done,
  label,
}: {
  index: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <span style={S.step}>
      <span style={{ ...S.stepDot, ...(active ? S.stepDotActive : done ? S.stepDotDone : null) }}>
        {done ? '✓' : index + 1}
      </span>
      <span style={{ ...S.stepLabel, opacity: active ? 1 : 0.6 }}>{label}</span>
    </span>
  );
}

const S: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    color: C.text,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderBottom: `1px solid ${C.border}`,
  },
  title: { fontWeight: 700, fontSize: 14 },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 },
  spacer: { flex: 1 },
  steps: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderBottom: `1px solid ${C.border}`,
    background: C.surfaceAlt,
  },
  step: { display: 'flex', alignItems: 'center', gap: 8 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
    fontWeight: 700,
    background: C.surface,
    border: `1px solid ${C.borderStrong}`,
    color: C.text,
  },
  stepDotActive: { background: C.accent, borderColor: C.accent, color: '#0d0f12' },
  stepDotDone: { background: '#1d3a2e', borderColor: '#2f6b51', color: C.green },
  stepLabel: { fontSize: 12 },
  stepLine: { flex: '0 0 32px', height: 1, background: C.border },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  side: {
    width: 340,
    borderLeft: `1px solid ${C.border}`,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
  },
  locPane: { flex: 1, padding: 24, display: 'flex', flexDirection: 'column', maxWidth: 520 },
  h2: { fontSize: 16, margin: '0 0 8px' },
  p: { fontSize: 13, lineHeight: 1.5, opacity: 0.8, margin: '0 0 12px' },
  status: { fontSize: 13, fontWeight: 600, color: C.accent },
  readOk: { fontSize: 13, fontWeight: 600, color: C.green, margin: '10px 0 0' },
  readBad: { marginTop: 10 },
  readBadLine: { fontSize: 12, margin: 0, color: C.amber },
  raw: { fontFamily: 'ui-monospace, monospace', opacity: 0.85, color: C.text },
  readHint: { fontSize: 12, opacity: 0.7, margin: '4px 0 6px' },
  readWarn: { fontSize: 12, color: C.amber, margin: '8px 0 0' },
  selectRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  selLabel: { width: 70, fontSize: 13, opacity: 0.8 },
  select: {
    flex: 1,
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: R.md,
    padding: '8px 10px',
    fontSize: 14,
  },
  footer: { display: 'flex', alignItems: 'center', gap: 8 },
  btn: {
    background: C.btn,
    color: C.text,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: R.md,
    padding: '7px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
  linkBtn: {
    background: 'none',
    color: '#9fb3c8',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    textDecoration: 'underline',
  },
  primary: {
    background: C.accent,
    color: '#0d0f12',
    border: 'none',
    borderRadius: R.md,
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
  },
  disabled: { opacity: 0.4, cursor: 'not-allowed' },
  badge: {
    fontSize: 10,
    textTransform: 'uppercase',
    background: C.border,
    borderRadius: R.sm,
    padding: '2px 5px',
    opacity: 0.8,
  },
};
