// Standalone capture-source page. Shown when the app has a profile but no live
// source (streams don't survive a relaunch). The actual chooser lives in
// SourceGrid, shared with the setup wizard's Source step. First-run users see
// the wizard (which embeds the same grid) instead of this bare page.

import type { PickedSource } from './SourceGrid';
import { SourceGrid } from './SourceGrid';

export type { PickedSource } from './SourceGrid';

export function SourcePicker({
  onPick,
  lastSourceId,
}: {
  onPick: (s: PickedSource) => void;
  lastSourceId?: string;
}) {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">SC Ore Overlay</h1>
        <p className="mt-1 text-sm text-muted">
          Pick the screen or window showing the mining scanner to capture.
        </p>
      </header>
      <SourceGrid onPick={onPick} lastSourceId={lastSourceId} />
    </div>
  );
}
