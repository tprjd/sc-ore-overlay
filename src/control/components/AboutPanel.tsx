// About / help panel (Mining → About sub-tab). Surfaces the things a user
// otherwise can't see without the README: app version, which signature table is
// loaded (patch + crawl date), the borderless-windowed requirement, a hotkey
// cheat-sheet, setup reset controls, and links (GitHub, manual update check, open
// the log folder for bug reports). Self-contained — talks to window.sco directly.

import { useEffect, useState } from 'react';
import type { SignatureTable } from '../../core';
import type { HotkeyMap, UpdateInfo } from '../../shared/bridge';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '../ui';
import { HOTKEY_ROWS, Section } from './controls';

const REPO_URL = 'https://github.com/tprjd/sc-ore-overlay';

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'latest'; info: UpdateInfo }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'error' };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function AboutPanel({
  table,
  hotkeys,
  onReRunSetup,
}: {
  table: SignatureTable;
  hotkeys: HotkeyMap;
  /** Re-open the first-run setup wizard (keeps existing settings). */
  onReRunSetup: () => void;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });

  useEffect(() => {
    let alive = true;
    void window.sco?.appVersion?.().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const checkUpdates = (): void => {
    setUpdate({ status: 'checking' });
    void window.sco
      ?.checkForUpdates?.()
      .then((info) => {
        setUpdate(
          info?.available
            ? { status: 'available', info }
            : info
              ? { status: 'latest', info }
              : { status: 'error' },
        );
      })
      .catch(() => setUpdate({ status: 'error' }));
  };

  return (
    <>
      <Section title="About">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-base font-bold">SC Ore Overlay</span>
          <span className="tnum text-[13px] text-accent">{version ? `v${version}` : '—'}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Unofficial, fan-made tool for Star Citizen ship mining. Not affiliated with Cloud Imperium
          Games. Licensed MIT.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={checkUpdates}
            disabled={update.status === 'checking'}
          >
            {update.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.sco?.openExternal?.(REPO_URL)}
          >
            GitHub
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.sco?.openLogs?.()}
            title="Open the folder with main.log for bug reports"
          >
            Open logs
          </Button>
        </div>
        {update.status === 'latest' && (
          <p className="mt-2 text-xs text-green">You're on the latest version.</p>
        )}
        {update.status === 'available' && (
          <p className="mt-2 text-xs text-amber">
            Update available: <strong>{update.info.latest}</strong>{' '}
            <button
              type="button"
              className="font-semibold text-accent underline"
              onClick={() => window.sco?.openExternal?.(update.info.url)}
            >
              Download
            </button>
          </p>
        )}
        {update.status === 'error' && (
          <p className="mt-2 text-xs text-muted">
            Update check failed (offline or no releases yet).
          </p>
        )}
      </Section>

      <Section title="Setup">
        <p className="mb-2.5 text-xs leading-relaxed text-muted">
          Re-run the guided setup, or wipe everything back to a clean first launch.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={onReRunSetup}>
            Re-run setup
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm" className="text-danger hover:text-danger">
                Reset everything…
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Reset everything?</DialogTitle>
              <DialogDescription>
                This deletes all saved settings — capture source, regions, location, overlay
                appearance, hotkeys — and relaunches the app to a clean first-run state. Your survey
                scan log is kept. This can’t be undone.
              </DialogDescription>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" size="sm">
                    Cancel
                  </Button>
                </DialogClose>
                <Button variant="danger" size="sm" onClick={() => window.sco?.resetSettings?.()}>
                  Reset &amp; relaunch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Section>

      <Section title="Signature table">
        <dl className="m-0 flex flex-col gap-1.5">
          <Row k="Patch" v={table.patch} />
          <Row k="Updated" v={formatDate(table.generatedAt)} />
          <Row k="Deposits" v={String(table.deposits.length)} />
          <Row k="Methods" v={table.methodsIncluded.join(', ')} />
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Signatures and clustering change between game patches. Re-crawl per patch (
          <code className="rounded-sm bg-bg px-1 py-0.5 font-mono text-[11px]">npm run crawl</code>)
          and switch the table from the Match tab.
        </p>
      </Section>

      <Section title="Requirement: borderless windowed">
        <p className="m-0 text-xs leading-relaxed">
          Click-through overlays don't draw over <strong>exclusive fullscreen</strong>. Set Star
          Citizen to <strong>Borderless</strong> (or Windowed) in graphics settings so the overlay
          shows on top of the game.
        </p>
      </Section>

      <Section title="Hotkeys">
        <dl className="m-0 flex flex-col gap-1.5">
          {HOTKEY_ROWS.map(([action, label]) => (
            <div key={action} className="flex items-center justify-between gap-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="m-0 rounded-sm border border-border-strong bg-bg px-1.5 py-0.5 font-mono text-xs text-accent">
                {hotkeys[action]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted">
          Rebind these in the Hotkeys tab. Bindings work while the game is focused.
        </p>
      </Section>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="tnum m-0 text-xs font-semibold">{v}</dd>
    </div>
  );
}
