// About / help panel (Mining → About sub-tab). Surfaces the things a user
// otherwise can't see without the README: app version, which signature table is
// loaded (patch + crawl date), the borderless-windowed requirement, a hotkey
// cheat-sheet, and links (GitHub, manual update check, open the log folder for
// bug reports). Self-contained — talks to window.sco directly.

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { SignatureTable } from '../../core';
import type { HotkeyMap, UpdateInfo } from '../../shared/bridge';
import { HOTKEY_ROWS, Section } from './controls';
import { C, F, R } from './tokens';

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

export function AboutPanel({ table, hotkeys }: { table: SignatureTable; hotkeys: HotkeyMap }) {
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
        <div style={s.appRow}>
          <span style={s.appName}>SC Ore Overlay</span>
          <span style={s.version}>{version ? `v${version}` : '—'}</span>
        </div>
        <p style={s.dim}>
          Unofficial, fan-made tool for Star Citizen ship mining. Not affiliated with Cloud Imperium
          Games. Licensed MIT.
        </p>
        <div style={s.btnRow}>
          <button
            type="button"
            style={s.btn}
            onClick={checkUpdates}
            disabled={update.status === 'checking'}
          >
            {update.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          <button type="button" style={s.btn} onClick={() => window.sco?.openExternal?.(REPO_URL)}>
            GitHub
          </button>
          <button
            type="button"
            style={s.btn}
            onClick={() => window.sco?.openLogs?.()}
            title="Open the folder with main.log for bug reports"
          >
            Open logs
          </button>
        </div>
        {update.status === 'latest' && <p style={s.ok}>You're on the latest version.</p>}
        {update.status === 'available' && (
          <p style={s.update}>
            Update available: <strong>{update.info.latest}</strong>{' '}
            <button
              type="button"
              style={s.link}
              onClick={() => window.sco?.openExternal?.(update.info.url)}
            >
              Download
            </button>
          </p>
        )}
        {update.status === 'error' && (
          <p style={s.dim}>Update check failed (offline or no releases yet).</p>
        )}
      </Section>

      <Section title="Signature table">
        <dl style={s.dl}>
          <dt style={s.dt}>Patch</dt>
          <dd style={s.dd}>{table.patch}</dd>
          <dt style={s.dt}>Updated</dt>
          <dd style={s.dd}>{formatDate(table.generatedAt)}</dd>
          <dt style={s.dt}>Deposits</dt>
          <dd style={s.dd}>{table.deposits.length}</dd>
          <dt style={s.dt}>Methods</dt>
          <dd style={s.dd}>{table.methodsIncluded.join(', ')}</dd>
        </dl>
        <p style={s.dim}>
          Signatures and clustering change between game patches. Re-crawl per patch (
          <code style={s.code}>npm run crawl</code>) and switch the table from the Match tab.
        </p>
      </Section>

      <Section title="Requirement: borderless windowed">
        <p style={s.body}>
          Click-through overlays don't draw over <strong>exclusive fullscreen</strong>. Set Star
          Citizen to <strong>Borderless</strong> (or Windowed) in graphics settings so the overlay
          shows on top of the game.
        </p>
      </Section>

      <Section title="Hotkeys">
        <dl style={s.dl}>
          {HOTKEY_ROWS.map(([action, label]) => (
            <div key={action} style={s.hotkeyRow}>
              <dt style={s.dt}>{label}</dt>
              <dd style={s.kbd}>{hotkeys[action]}</dd>
            </div>
          ))}
        </dl>
        <p style={s.dim}>
          Rebind these in the Hotkeys tab. Bindings work while the game is focused.
        </p>
      </Section>
    </>
  );
}

const s: Record<string, CSSProperties> = {
  appRow: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  appName: { fontSize: 16, fontWeight: 700 },
  version: { fontSize: 13, color: C.accent, fontVariantNumeric: 'tabular-nums' },
  body: { fontSize: 12, lineHeight: 1.5, margin: 0 },
  dim: { opacity: 0.5, fontSize: 12, lineHeight: 1.5, marginTop: 8, marginBottom: 0 },
  ok: { color: C.green, fontSize: 12, marginTop: 8, marginBottom: 0 },
  update: { color: C.amber, fontSize: 12, marginTop: 8, marginBottom: 0 },
  btnRow: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  btn: {
    background: C.btn,
    color: C.text,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: R.md,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  link: {
    background: 'none',
    border: 'none',
    color: C.accent,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
    textDecoration: 'underline',
  },
  dl: { margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  hotkeyRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dt: { fontSize: 12, opacity: 0.7 },
  dd: { margin: 0, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  kbd: {
    margin: 0,
    fontSize: 12,
    fontFamily: F.mono,
    color: C.accent,
    background: C.bg,
    border: `1px solid ${C.borderStrong}`,
    borderRadius: R.sm,
    padding: '2px 6px',
  },
  code: {
    fontFamily: F.mono,
    fontSize: 11,
    background: C.bg,
    borderRadius: R.sm,
    padding: '1px 4px',
  },
};
