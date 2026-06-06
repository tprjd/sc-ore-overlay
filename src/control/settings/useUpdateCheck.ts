// One-shot app-version check against GitHub Releases, run once settings are
// loaded (so the dismissed-tag is known). Failures resolve to a non-available
// result; the banner just hides. The dismissed tag itself is a persisted setting
// owned by useAppSettings — this hook only fetches the latest-release info.

import { useEffect, useState } from 'react';
import type { UpdateInfo } from '../../shared/bridge';

export function useUpdateCheck(loaded: boolean): UpdateInfo | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void window.sco?.checkForUpdates?.().then((info) => {
      if (alive) setUpdate(info ?? null);
    });
    return () => {
      alive = false;
    };
  }, [loaded]);
  return update;
}
