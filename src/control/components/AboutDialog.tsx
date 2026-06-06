// "About & help" as a modal. The same info/setup/help content is available as a
// Mining sub-tab once a capture source is live, but the source picker (shown
// before any source is chosen) had no way to reach it — so version, the
// borderless-windowed requirement, hotkeys, update check, logs, and setup reset
// were all locked behind picking a source. This wraps the shared AboutPanel in a
// dialog so the picker can surface it too.

import { Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SignatureTable } from '../../core';
import type { HotkeyMap } from '../../shared/bridge';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../ui';
import { AboutPanel } from './AboutPanel';

export function AboutDialog({
  table,
  hotkeys,
  onReRunSetup,
  trigger,
}: {
  table: SignatureTable;
  hotkeys: HotkeyMap;
  /** Re-open the first-run setup wizard (keeps existing settings). */
  onReRunSetup: () => void;
  /** Custom trigger; defaults to a small "About" button. */
  trigger?: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" size="sm">
            <Info className="h-3.5 w-3.5" />
            About
          </Button>
        )}
      </DialogTrigger>
      {/* p-0 + own header/body: the close lives in a fixed header bar (showClose
          disables the built-in absolute X, which scrolled with the content), and
          the body owns its max-height + overflow so scrolling doesn't depend on
          the parent resolving a flex height. */}
      <DialogContent
        showClose={false}
        className="w-[min(560px,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <DialogTitle>About &amp; help</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted" aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </header>
        <DialogDescription className="sr-only">
          App version, signature table, the borderless-windowed requirement, hotkeys, and setup.
        </DialogDescription>
        {/* Block (not flex): flex children default to shrink:1 and compress the
            section cards. space-y keeps the gap without flex. */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          <AboutPanel table={table} hotkeys={hotkeys} onReRunSetup={onReRunSetup} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
