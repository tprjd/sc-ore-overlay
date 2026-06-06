// Control window root: load the bundled signature tables, own the live capture
// source + routing (wizard → source picker → mining/survey), and render the
// update banner + tab chrome. The persisted-settings layer, OCR-engine apply, and
// update check live in hooks (./settings) so this file stays routing + layout.

import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isVersionNewer } from '../core/semver';
import type { SetupResult } from './components/SetupWizard';
import { SetupWizard } from './components/SetupWizard';
import type { PickedSource } from './components/SourcePicker';
import { SourcePicker } from './components/SourcePicker';
import { SurveyView } from './components/SurveyView';
import { ProspectView } from './prospect/ProspectView';
import { useAppSettings } from './settings/useAppSettings';
import { useOcrEngine } from './settings/useOcrEngine';
import { useTables } from './settings/useTables';
import { useUpdateCheck } from './settings/useUpdateCheck';
import { Button } from './ui';
import { cn } from './ui/cn';

type Tab = 'mining' | 'survey';

/** Newest patch label among the available tables (the one the app uses). */
function newestPatch(patches: string[]): string {
  return patches.reduce((best, p) => (isVersionNewer(p, best) ? p : best), patches[0] ?? 'unknown');
}

export function App() {
  // Bundled tables, overlaid with any runtime-crawled ones (see useTables).
  const {
    tables,
    refreshing: tablesRefreshing,
    progress: tablesProgress,
    refresh: refreshTables,
  } = useTables();
  const patches = useMemo(() => Object.keys(tables), [tables]);
  const activePatch = useMemo(() => newestPatch(patches), [patches]);

  const s = useAppSettings(tables);
  const effectiveBackend = useOcrEngine(s.ocrBackend, s.loaded);
  const update = useUpdateCheck(s.loaded);

  // Live capture source (not persisted — a MediaStream can't survive a relaunch).
  const [source, setSource] = useState<PickedSource | null>(null);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [tab, setTab] = useState<Tab>('mining');
  // First-run wizard: decided once on restore, then re-openable from the panel.
  const [showWizard, setShowWizard] = useState(false);
  useEffect(() => {
    if (s.loaded) setShowWizard(s.initialShowWizard);
  }, [s.loaded, s.initialShowWizard]);

  const handlePick = (picked: PickedSource): void => {
    setAutoReconnect(false);
    setSource(picked);
    // Remember a desktop source so a one-click reconnect can re-select it.
    if (picked.kind === 'desktop' && picked.sourceId)
      s.rememberSource(picked.sourceId, picked.label);
  };

  // Source-lost reconnect: drop back to the picker but keep auto-reconnect armed
  // so it re-selects the same source as soon as it reappears (D1).
  const handleReconnect = (): void => {
    setAutoReconnect(true);
    source?.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    setSource(null);
  };

  const handleBack = (): void => {
    setAutoReconnect(false); // explicit "← Sources" — don't auto-reconnect again
    source?.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    if (source?.imageUrl) URL.revokeObjectURL(source.imageUrl);
    if (source?.videoUrl) URL.revokeObjectURL(source.videoUrl);
    setSource(null);
  };

  const completeSetup = (result: SetupResult): void => {
    // Replace just the RS / scanResult regions the wizard set; keep any others
    // the user already had, so re-running setup isn't destructive. A skipped
    // step leaves its region null → that role is left untouched.
    s.setMiningRegions((prev) => {
      let regions = prev;
      if (result.rsRegion) regions = [result.rsRegion, ...regions.filter((r) => r.role !== 'rs')];
      if (result.scanRegion)
        regions = [...regions.filter((r) => r.role !== 'scanResult'), result.scanRegion];
      return regions;
    });
    s.setLocation(result.location);
    if (result.overlayPreset) s.setOverlayConfig({ ...s.overlayConfig, ...result.overlayPreset });
    if (result.captureParams) s.setParams({ ...s.params, ...result.captureParams });
    setShowWizard(false);
    s.markSetupComplete();
  };

  const skipSetup = (): void => {
    setShowWizard(false);
    s.markSetupComplete();
  };

  const table = tables[activePatch] ?? tables[patches[0] ?? ''];

  // The overlay only draws while the Mining capture view is actually live.
  // Whenever it isn't — settings still loading, no table, no source picked, the
  // setup wizard is up, or the Survey tab is active — push an `inactive` status
  // so the overlay boxes hide. Otherwise the main box would sit showing its
  // launch placeholder (or a stale reading) with nothing capturing. ProspectView
  // owns the push while live, so these never conflict.
  const miningLive =
    s.loaded && !!table && !!source && !showWizard && (s.surveyEnabled ? tab === 'mining' : true);
  useEffect(() => {
    if (!miningLive)
      window.sco?.sendMatches?.({ reading: null, candidates: [], status: 'inactive' });
  }, [miningLive]);

  if (!s.loaded) return null;
  if (!table) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold">No signature table</h1>
        <p className="mt-2 text-sm text-muted">
          Run <code className="rounded-sm bg-bg px-1 py-0.5 font-mono">npm run crawl</code> to
          generate one under{' '}
          <code className="rounded-sm bg-bg px-1 py-0.5 font-mono">src/data/tables/</code>.
        </p>
      </main>
    );
  }
  // The wizard owns the Source step, so it renders before the standalone picker:
  // a fresh profile lands on Welcome and picks its source inside the flow.
  if (showWizard) {
    return (
      <SetupWizard
        source={source}
        onPickSource={handlePick}
        lastSourceId={autoReconnect ? s.lastSource.current.id : undefined}
        table={table}
        hotkeys={s.hotkeys}
        hotkeyStatus={s.hotkeyStatus}
        onHotkeysChange={s.setHotkeys}
        onComplete={completeSetup}
        onSkip={skipSetup}
        onExit={skipSetup}
      />
    );
  }
  if (!source) {
    return (
      <SourcePicker
        onPick={handlePick}
        lastSourceId={autoReconnect ? s.lastSource.current.id : undefined}
      />
    );
  }
  // With Survey gated off, Mining is the only view — force it and drop the tab
  // bar entirely (no orphan single tab).
  const activeTab: Tab = s.surveyEnabled ? tab : 'mining';
  const showUpdate = !!update?.available && update.latest !== s.dismissedUpdate;
  return (
    <div className="flex h-screen flex-col">
      {showUpdate && update && (
        <div className="flex items-center gap-2.5 border-b border-accent bg-[#13282b] px-3 py-2 text-[13px] text-[#d7e3e6]">
          <span className="flex-1">
            Update available: <strong>{update.latest}</strong>
            <span className="text-muted"> (you have v{update.current})</span>
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.sco?.openExternal?.(update.url)}
          >
            Download
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted"
            onClick={() => s.setDismissedUpdate(update.latest ?? undefined)}
            aria-label="Dismiss update notice"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {tablesRefreshing && (
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-alt px-3 py-1.5 text-xs text-muted">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
          <span>
            Updating ore data…
            {tablesProgress?.phase === 'detail' &&
              ` (${tablesProgress.done}/${tablesProgress.total})`}
          </span>
        </div>
      )}
      {s.surveyEnabled && (
        <nav className="flex gap-0.5 border-b border-border bg-surface-alt px-2.5 pt-1.5">
          {(['mining', 'survey'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                'rounded-t-md border border-transparent px-4 py-1.5 text-[13px] capitalize transition-colors',
                activeTab === t
                  ? 'border-border border-b-surface bg-surface text-fg'
                  : 'text-muted hover:text-fg',
              )}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      )}
      <div className="min-h-0 flex-1">
        {activeTab === 'mining' ? (
          <ProspectView
            source={source}
            regions={s.miningRegions}
            onRegionsChange={s.setMiningRegions}
            noiseSignatures={s.noiseSignatures}
            onNoiseSignaturesChange={s.setNoiseSignatures}
            enforceCluster={s.enforceCluster}
            onEnforceClusterChange={s.setEnforceCluster}
            params={s.params}
            onParamsChange={s.setParams}
            ocrBackend={s.ocrBackend}
            effectiveBackend={effectiveBackend}
            onOcrBackendChange={s.setOcrBackend}
            table={table}
            location={s.location}
            onLocationChange={s.setLocation}
            activePatch={activePatch}
            tablesRefreshing={tablesRefreshing}
            onRefreshTables={refreshTables}
            hotkeys={s.hotkeys}
            hotkeyStatus={s.hotkeyStatus}
            onHotkeysChange={s.setHotkeys}
            overlayConfig={s.overlayConfig}
            onOverlayConfigChange={s.setOverlayConfig}
            onBack={handleBack}
            onReconnect={handleReconnect}
            onSetup={() => setShowWizard(true)}
          />
        ) : (
          <SurveyView
            source={source}
            table={table}
            params={s.params}
            regions={s.surveyRegions}
            onRegionsChange={s.setSurveyRegions}
            scout={s.surveyScout}
            onScoutChange={s.setSurveyScout}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}
