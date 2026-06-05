// The capture-source chooser, extracted so both the standalone SourcePicker page
// and the setup wizard's "Source" step share one implementation. Enumerates
// desktopCapturer screens/windows, supports a name filter and a screen/window
// segment, accepts a static image or video file (for OCR tuning without the game
// running), and auto-reconnects to the last-used source.

import { Film, Image as ImageIcon, MonitorPlay, RefreshCw, Search } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureSource } from '../../shared/bridge';
import { Button } from '../ui';
import { cn } from '../ui/cn';

/** What the picker hands back to the app once a source is chosen. */
export interface PickedSource {
  kind: 'desktop' | 'image' | 'video';
  label: string;
  stream?: MediaStream;
  imageUrl?: string;
  /** Object URL for a chosen video file (kind 'video'). */
  videoUrl?: string;
  /** desktopCapturer id (desktop sources only) — persisted for auto-reconnect. */
  sourceId?: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Filter = 'all' | 'screen' | 'window';

export function SourceGrid({
  onPick,
  lastSourceId,
  selectedId,
}: {
  onPick: (s: PickedSource) => void;
  lastSourceId?: string;
  /** Currently-chosen desktop source id (shows a selected ring in the wizard). */
  selectedId?: string;
}) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const reconnected = useRef(false);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (!window.sco) {
        throw new Error(
          'Preload bridge unavailable — run inside Electron, or use “Load image” below.',
        );
      }
      setSources(await window.sco.getCaptureSources());
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only — enumerate sources once on open.
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
      onPick({ kind: 'desktop', label: src.name, stream, sourceId: src.id });
    } catch (e) {
      setError(`Could not capture “${src.name}”: ${msg(e)}`);
    }
  };

  // Auto-reconnect to the last-used source once it appears in the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs on source/id change only — pickDesktop is stable for this purpose.
  useEffect(() => {
    if (reconnected.current || !lastSourceId) return;
    const hit = sources.find((s) => s.id === lastSourceId);
    if (hit) {
      reconnected.current = true;
      void pickDesktop(hit);
    }
  }, [sources, lastSourceId]);

  const pickImage = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) onPick({ kind: 'image', label: file.name, imageUrl: URL.createObjectURL(file) });
  };

  const pickVideo = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) onPick({ kind: 'video', label: file.name, videoUrl: URL.createObjectURL(file) });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sources.filter(
      (s) => (filter === 'all' || s.type === filter) && (!q || s.name.toLowerCase().includes(q)),
    );
  }, [sources, query, filter]);

  const counts = useMemo(
    () => ({
      screen: sources.filter((s) => s.type === 'screen').length,
      window: sources.filter((s) => s.type === 'window').length,
    }),
    [sources],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter screens & windows…"
            className="h-9 w-full rounded-md border border-border-strong bg-bg pl-8 pr-2.5 text-sm text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent/60"
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-border-strong">
          {(['all', 'screen', 'window'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 text-xs capitalize transition-colors',
                filter === f ? 'bg-accent/15 text-accent' : 'text-muted hover:text-fg',
              )}
            >
              {f}
              {f !== 'all' && (
                <span className="ml-1 opacity-60">{counts[f as 'screen' | 'window']}</span>
              )}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          {loading ? 'Scanning…' : 'Refresh'}
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <label className="cursor-pointer">
            <ImageIcon className="h-3.5 w-3.5" />
            Image…
            <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
          </label>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <label
            className="cursor-pointer"
            title="Use a recorded clip as the source — loops for reproducible debugging"
          >
            <Film className="h-3.5 w-3.5" />
            Video…
            <input type="file" accept="video/*" onChange={pickVideo} className="hidden" />
          </label>
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      )}

      {/* pt/px give the cards' hover-lift + selected ring room so the top edge
          isn't clipped by this scroll container. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-1 pt-1.5">
        {loading && sources.length === 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-[164px] animate-pulse rounded-lg border border-border bg-surface"
              />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="grid place-items-center py-16 text-center text-sm text-muted">
            <MonitorPlay className="mb-2 h-8 w-8 opacity-40" />
            {sources.length === 0
              ? 'No capture sources found. Try Refresh, or load an image/video.'
              : 'Nothing matches your filter.'}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {shown.map((src) => (
              <button
                key={src.id}
                type="button"
                onClick={() => void pickDesktop(src)}
                title={src.name}
                className={cn(
                  'sco-srccard group flex flex-col gap-2 rounded-lg border bg-surface p-2 text-left transition-all',
                  'hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lg',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  selectedId === src.id ? 'border-accent ring-2 ring-accent/50' : 'border-border',
                )}
              >
                <img
                  src={src.thumbnailDataUrl}
                  alt=""
                  className="h-[124px] w-full rounded bg-black object-cover"
                />
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-tight">
                  <span className="inline-flex shrink-0 items-center rounded-sm bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                    {src.type}
                  </span>
                  <CardName name={src.name} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Source-card name: truncated by default, scrolled (marquee) on card hover so a
 * long window title is fully readable. The scroll distance/duration are measured
 * from the actual overflow (CSS can't know it) and written as CSS vars; the
 * `.sco-srccard:hover` rule in theme.css runs the animation. A native title
 * tooltip is the keyboard/no-hover fallback.
 */
function CardName({ name }: { name: string }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the name text changes — it's read via the DOM (scrollWidth), not referenced directly.
  useEffect(() => {
    const w = wrap.current;
    const i = inner.current;
    if (!w || !i) return;
    const measure = (): void => {
      const over = i.scrollWidth - w.clientWidth;
      w.style.setProperty('--marquee-d', over > 1 ? `-${over}px` : '0px');
      // ~35 px/s, min 2.5s, so long titles don't whip past.
      w.style.setProperty('--marquee-dur', `${Math.max(2.5, over / 35)}s`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(w);
    return () => ro.disconnect();
  }, [name]);
  return (
    <span ref={wrap} className="sco-marquee min-w-0 flex-1 overflow-hidden" title={name}>
      <span ref={inner} className="sco-marquee-inner block whitespace-nowrap">
        {name}
      </span>
    </span>
  );
}
