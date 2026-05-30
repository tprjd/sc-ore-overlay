// Step 1: choose what to capture. Lists desktopCapturer screens/windows, and
// also accepts a static image file — handy for tuning the OCR against a saved
// HUD screenshot without Star Citizen running.

import { useEffect, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import type { CaptureSource } from '../../shared/bridge';

/** What the picker hands back to the app once a source is chosen. */
export interface PickedSource {
  kind: 'desktop' | 'image';
  label: string;
  stream?: MediaStream;
  imageUrl?: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function SourcePicker({ onPick }: { onPick: (s: PickedSource) => void }) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (!window.sco) {
        throw new Error('Preload bridge unavailable — run inside Electron, or use “Load image” below.');
      }
      setSources(await window.sco.getCaptureSources());
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const pickDesktop = async (src: CaptureSource): Promise<void> => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        // Electron desktop-capture constraints (not standard MediaTrackConstraints).
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: src.id,
          },
        },
      } as unknown as MediaStreamConstraints);
      onPick({ kind: 'desktop', label: src.name, stream });
    } catch (e) {
      setError(`Could not capture “${src.name}”: ${msg(e)}`);
    }
  };

  const pickImage = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) onPick({ kind: 'image', label: file.name, imageUrl: URL.createObjectURL(file) });
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>SC Ore Overlay</h1>
        <p style={S.sub}>Pick the screen or window showing the mining scanner.</p>
      </header>

      <div style={S.toolbar}>
        <button style={S.btn} onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Scanning…' : 'Refresh sources'}
        </button>
        <label style={{ ...S.btn, ...S.fileBtn }}>
          Load image…
          <input type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
        </label>
      </div>

      {error && <div style={S.error}>{error}</div>}

      <div style={S.grid}>
        {sources.map((src) => (
          <button key={src.id} style={S.card} onClick={() => void pickDesktop(src)} title={src.name}>
            <img src={src.thumbnailDataUrl} alt="" style={S.thumb} />
            <span style={S.cardLabel}>
              <span style={S.badge}>{src.type}</span>
              {src.name}
            </span>
          </button>
        ))}
        {!loading && sources.length === 0 && !error && (
          <p style={S.empty}>No capture sources found.</p>
        )}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { padding: 24, color: '#e6e6e6', minHeight: '100vh', boxSizing: 'border-box' },
  header: { marginBottom: 16 },
  h1: { margin: '0 0 4px', fontSize: 22 },
  sub: { margin: 0, opacity: 0.7 },
  toolbar: { display: 'flex', gap: 8, marginBottom: 12 },
  btn: {
    background: '#2a2f3a',
    color: '#e6e6e6',
    border: '1px solid #3a4150',
    borderRadius: 6,
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
  fileBtn: { display: 'inline-flex', alignItems: 'center' },
  error: {
    background: '#3a1f24',
    border: '1px solid #7a3b44',
    color: '#ffb4bd',
    padding: '8px 12px',
    borderRadius: 6,
    marginBottom: 12,
    fontSize: 13,
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: '#1d2128',
    border: '1px solid #2c323d',
    borderRadius: 8,
    padding: 8,
    cursor: 'pointer',
    textAlign: 'left',
    color: '#e6e6e6',
  },
  thumb: { width: '100%', height: 124, objectFit: 'cover', borderRadius: 4, background: '#000' },
  cardLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: 1.3 },
  badge: {
    fontSize: 10,
    textTransform: 'uppercase',
    background: '#2c323d',
    borderRadius: 4,
    padding: '2px 5px',
    opacity: 0.8,
  },
  empty: { opacity: 0.6 },
};
