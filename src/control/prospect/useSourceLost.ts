// Source-lost detection: a captured desktop/window stream can die (game closed,
// display unplugged). Watch its video tracks for `ended` / poll `readyState`, and
// push the result into the prospect store. Image/video-file sources can't be
// "lost", so this only arms for live streams.

import { useEffect } from 'react';
import type { PickedSource } from '../components/SourceGrid';
import { useProspectStore } from './store';

export function useSourceLost(source: PickedSource): void {
  const setSourceLost = useProspectStore((s) => s.setSourceLost);
  useEffect(() => {
    setSourceLost(false);
    const stream = source.stream;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    const onEnded = (): void => setSourceLost(true);
    tracks.forEach((t) => {
      t.addEventListener('ended', onEnded);
    });
    const id = window.setInterval(() => {
      if (tracks.some((t) => t.readyState === 'ended')) setSourceLost(true);
    }, 1000);
    return () => {
      tracks.forEach((t) => {
        t.removeEventListener('ended', onEnded);
      });
      window.clearInterval(id);
    };
  }, [source, setSourceLost]);
}
