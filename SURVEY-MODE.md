# SURVEY-MODE.md — Scouting & Ore Map (plan)

> **Status: plan only. No code yet.** This document is the architecture and phased
> build plan for a second mode in SC Ore Overlay: a **Survey** tab that logs *where*
> ore was scanned and plots it on a shared, ship-centered map for organized scouting.
> It builds on the existing capture → OCR → match pipeline and the locked stack in
> `CLAUDE.md`. Read that first; this file does not restate the guardrails, it inherits
> them.

---

## 1. Goal

Star Citizen orgs scout with small, fast mining vessels ahead of the slow main vessel
(e.g. an ARGO MOLE). A scout wants to fly a field, scan rocks, and have each rock's
**ore, node count, quality, and absolute position** logged automatically and shown on a
map — so the org can route the main vessel to the richest clusters. Multiple scouts feed
**one live shared map** in real time.

Survey Mode is built in priority order: first a **coordinate reader** (OCR of the debug
position line) and a **2D top-down ship-centered map** you can develop against
**debug/mock values**, then a **local survey log** that feeds the map from real scans.
**Networked multi-scout sync is deferred to a later phase** — the local store is designed
sync-ready (a transport seam) so sync can be layered on later without rework.

---

## 2. Decisions captured (from the design Q&A)

| Question | Answer | Consequence |
| --- | --- | --- |
| Source of position numbers | **SC's debug diagnostic overlay** (the `Zone: … Pos: x y z` readout the user already enables via the in-game console). | We OCR on-screen text only — stays within the read-only guardrail. No memory reads. |
| Which line / frame | The **`SolarSystem_<id>` Pos** line = **absolute, updates live**. | All scouts in the same system share one coordinate frame, so logged points line up directly with no transform. |
| Map model (v1) | **2D top-down, ship-centered.** | Project the X/Y plane; show Z (depth) as a label/secondary cue. Ship at map center. |
| Scope | **Local first; networked sync deferred.** Priority = coordinate read + map visuals (debug-seeded), then local logging. | Build the local store **sync-ready** (a `SyncTransport` seam), but do **not** build the relay/rooms until a later phase (§7, §10 S4). |
| "Boxes + roles" | **OCR regions with field roles** — like today's RS box, but several, each tagged with what it reads. | Generalize the single-region picker + OCR loop to a list of `{ role, rect }`. |
| Rock position | **Log the rock at the ship's current coordinates.** | No bearing/offset math in v1 — scout flies up to a rock, scans, logs. Accuracy = how close they park. |

---

## 3. The coordinate source, in detail

The debug overlay prints several nested zone frames, innermost → outermost. From the
sample HUD:

```
Zone: ARGO_MOLE_Teach_372772292218            Pos: -1.00m       20.15m         0.78m
Zone: glaciemring_segment_mission_genrl_002-022 Pos: 46.6484km   106.5163km     734.87m
Zone: SolarSystem_285626946665                Pos: -14215974.6126km -4787767.8108km 734.87m
Zone: Root                                    Pos: -14215974.6126km -4787767.8108km 734.87m
Current player location : NyxSolarSystem
No Current Planet
```

- **`ARGO_MOLE_…`** — position *inside the ship* (local to the vehicle). Not useful here.
- **`glaciemring_segment_…`** — position local to a nearby area. Not stable across the field.
- **`SolarSystem_<id>`** — **absolute position in system space.** This is our target. It is
  identical to `Root` in this sample, but `SolarSystem_<id>` is the correct per-system
  frame to standardize on (every scout in `NyxSolarSystem` reads the same `<id>`).
- **`Current player location : NyxSolarSystem`** — friendly **system name** for labeling
  and as a sync-room scoping key. **`No Current Planet`** — body context when present.

### Parsing rules (the coordinate parser must handle all of these)

- **Per-axis units vary and are mixed on one line**: `…km`, `…m` (and likely `Mm`/`Gm` at
  larger scales). Parse the unit suffix on **each** token and convert to a single canonical
  unit (**meters**) for storage; display in km.
- **Negative and decimal** values: `-14215974.6126km`.
- Pull the three tokens that follow `Pos:` **on the chosen zone line only** — not from the
  other zone lines. The user boxes that one line; OCR returns it; the parser keys off the
  `SolarSystem_` prefix (or a user-selected line) and then off `Pos:`.
- The third axis (`734.87m`) reads far smaller than X/Y here. Whether that's "near the
  ecliptic plane" or a different unit/axis convention is **unconfirmed** — see Open
  Questions §11. The parser stays unit-driven so it's correct regardless; only the *map
  axis assignment* needs confirmation.

> **Caveat to document for the user:** enabling SC's debug overlay is the user's own
> client-side display choice. The app never enables it, never reads memory, and only OCRs
> what's already drawn on screen. Same posture as the RS reader.

---

## 4. Architecture overview

```
┌─ Control window ───────────────────────────────────────────────┐
│  Tab bar:  [ Mining ]  [ Survey ]                               │
│                                                                 │
│  Mining  = today's ScanView (unchanged behavior)                │
│                                                                 │
│  Survey  = ┌ Regions (multi-box + roles) ─────────────┐         │
│            │  RS box · ShipPos box · System box …      │         │
│            ├ Session (scout name, room, main/scout) ───┤         │
│            ├ Log (table of scanned rocks) ─────────────┤         │
│            └ Map (2D top-down, ship-centered) ─────────┘         │
└─────────────────────────────────────────────────────────────────┘
              │ capture frame (existing desktopCapturer pipeline)
              ▼
   preprocess (crop per region) → OCR (PP-OCR) → route by ROLE
              │                                        │
        role=rs → matchOre → ore/qty/quality    role=shipPos → coord parser
              └──────────────┬─────────────────────────┘
                             ▼
                    SurveyEntry (built on "log scan")
                       │            │
                 local store   SyncTransport ──ws──► session relay ──► other scouts
                             │
                             ▼  map renders entries (own + peers) ship-centered
```

**Reuse, don't rebuild:**

- **Capture**: the existing `desktopCapturer` source + media element feeds both modes.
- **Region picker**: generalize `ScanView`'s single normalized rect + zoomable preview into
  a **list** of regions; add a role selector per region. Same drawing/zoom UX.
- **OCR**: `src/control/ocr.ts` + `preprocess.ts` run **once per enabled region**; results
  routed by role. RS role → existing `matchOre`/quality. ShipPos role → new parser.
- **Matcher / quality**: `src/core/matcher.ts`, `src/core/quality.ts` unchanged.
- **Persistence**: extend `AppSettings` (regions list, scout identity, session, map prefs)
  and add a separate survey-log store.

---

## 5. Data model (illustrative — not final code)

```ts
// src/core/survey.ts (pure)
type Vec3 = { x: number; y: number; z: number }; // meters, absolute SolarSystem frame

interface SurveyEntry {
  id: string;            // uuid (dedupe key across the network)
  ts: number;            // epoch ms when logged
  scout: string;         // who logged it (callsign)
  system: string;        // e.g. "NyxSolarSystem" (room-scoping + label)
  pos: Vec3;             // ship position at scan time
  rs: number;            // radar signature reading
  candidates: Array<{ ore: string; nodes: number; score: number }>; // from matchOre
  ore?: string;          // primary (top candidate or user-picked)
  nodes?: number;
  quality?: QualityDetail; // reuse src/core/quality.ts when location known
  notes?: string;
  source: 'local' | 'peer';
}

// Live presence (not persisted): where each connected scout currently is.
interface ScoutPresence {
  scout: string;
  role: 'main' | 'scout';
  system: string;
  pos: Vec3;
  ts: number;            // last update; stale markers fade
}
```

- **Coordinate frame**: store meters, absolute `SolarSystem_<id>` space. No transform needed
  between scouts in the same system. Cross-system entries are simply filtered by `system`.
- **Dedupe / merge**: entries are append-only, keyed by `id`. A peer's entry with a known id
  is ignored. Optional near-duplicate collapse (same ore within N meters) as a later nicety.
- **Offline-first**: every scan logs locally regardless of connection; queued entries flush
  to the session on (re)connect.

---

## 6. Components & files (new / changed — names are guidance)

**New**

- `src/core/coords.ts` — pure coordinate parser: `parsePosLine(text) → { zone, pos }`,
  unit normalization (m/km/Mm/Gm → m), token extraction keyed on `Pos:`. Unit-tested first.
- `src/core/survey.ts` — `SurveyEntry`, `ScoutPresence`, builders, dedupe/merge helpers,
  axis-projection helper for the map. Pure, unit-tested.
- `src/control/components/SurveyView.tsx` — the Survey tab: region list + roles, session
  panel, log table, embedded map.
- `src/control/components/RegionList.tsx` — multi-region picker (roles + add/remove/draw),
  factored out of the current single-region UI.
- `src/control/components/SurveyMap.tsx` — 2D canvas/SVG top-down map (§8).
- `src/control/survey-debug.ts` — **debug/mock data**: a synthetic ship position + a field
  of fake `SurveyEntry` points, so the map can be built and tuned *before* OCR/logging are
  reliable. Gated behind a "Debug values" toggle in the Survey tab (Phase S2).
- *(deferred — Phase S4)* `src/control/sync.ts` — `SyncTransport` interface +
  `LocalTransport` (no-op) and `WsTransport` (relay client). The **interface** lands early as
  a seam; the ws client is built in S4.
- *(deferred — Phase S4)* `server/relay.ts` — standalone WebSocket relay (rooms, presence,
  fan-out, backlog). Self-hostable; not bundled into the Electron app. (See §7.)
- `test/coords.test.ts`, `test/survey.test.ts` — parser + merge specs.

**Changed**

- `src/control/App.tsx` — add top-level **tab state** (`'mining' | 'survey'`); render
  `ScanView` or `SurveyView`. Hydrate new settings.
- `src/control/useCaptureLoop.ts` — generalize from one region to **N regions by role**;
  OCR each enabled region per tick; emit a per-role result map. Mining mode consumes `rs`
  exactly as today; Survey mode consumes `rs` + `shipPos` (+ `system`).
- `src/shared/bridge.ts` — extend `AppSettings` (regions, scout, session, map prefs); add
  any IPC needed for the sync transport if it lives in main.
- `electron/main.ts` / `preload.ts` — only if the ws client runs in main (vs renderer).
  Likely keep sync in the renderer to avoid new main-process surface; revisit.

---

## 7. Networked session sync — DEFERRED (Phase S4)

> **Not part of the first milestone.** Coordinate read + map + local logging ship first.
> This section is the design to layer on later; the only thing built early is the
> `SyncTransport` seam (§4) so the local store doesn't need reworking when sync arrives.

**Model: rooms + presence + append-only entries.**

- A scout sets a **callsign** and a **role** (`main` vs `scout`), then **hosts or joins a
  session** by room code. Sessions are scoped by `system` so a room only shows relevant points.
- Each client periodically broadcasts its **ScoutPresence** (live ship pos, throttled
  ~1–2 s) and, on each logged scan, broadcasts a **SurveyEntry**.
- The relay **fans out** presence + entries to the room and keeps an **entry backlog** so a
  late-joining scout receives everything logged so far.
- The map shows: own ship (center), peer scout markers (live, fading when stale), and every
  shared rock. "Main vessel" role just controls labeling/centering preference.

**Transport abstraction** (`SyncTransport`): `LocalTransport` (single client, no network) and
`WsTransport` (room relay). The map and log read from the same merged store regardless, so
the local build (Phase S2) works untouched and S3 swaps the transport in.

**What leaves the machine, and consent:**

- Only when a scout **joins a session**: their callsign, system, live ship position, and
  logged entries go to the relay and other room members. This is an **outward-facing publish**
  — opt-in per session, off by default, with a clear indicator while connected.
- **Hosting**: provide a self-hostable Node relay (org runs it; room code + optional shared
  secret). Whether to also offer a default public instance is an **Open Question** (§11) —
  recommended default is self-host only, to avoid us operating a server and to keep position
  data inside the org.
- No accounts, no analytics, minimal payload. Document exactly what is sent.

---

## 8. Map rendering (2D top-down, ship-centered, v1)

- **Projection**: pick two axes as the ground plane (default X/Y), the third as depth (Z).
  Ship = current live `shipPos`, drawn at center (0,0). Each entry at `(entry.x − ship.x,
  entry.y − ship.y)` scaled to pixels. Depth shown as a label / dot-size / color ramp.
- **Interactions**: pan (drag), zoom (wheel, cursor-anchored — reuse the pattern already
  built for the region preview), hover tooltip (ore, nodes, quality, depth, scout, age),
  click to select → focus its log row.
- **Empty-map first**: grid + range rings + crosshair + ship marker + N/S/E/W or axis ticks.
  No real starmap art in v1.
- **Filters** (light, v1-optional): by ore, by min quality, by scout, hide stale.
- Renders from the merged store; peers' points appear as they arrive over the transport.

> A transparent always-on-top **map overlay window** (like today's overlay/detail boxes) is
> a natural follow-on but is **out of scope for v1** — the map lives in the Survey tab first.

---

## 9. Settings & persistence additions

Extend `AppSettings` (Electron `userData`, same mechanism as today):

- `survey.regions: Array<{ id, role: 'rs' | 'shipPos' | 'system', rect, enabled }>`
- `survey.scout: string`, `survey.role: 'main' | 'scout'`
- `survey.session?: { code: string; url?: string }` (last room; do not auto-join silently)
- `survey.map?: { axisPlane: 'xy' | 'xz' | 'yz'; scale; … }`
- The **survey log** persists to its own file (e.g. `userData/survey-log.json`) — append-only,
  separate from `settings.json`, with JSON/CSV **export**.

---

## 10. Phased build plan (with acceptance checks)

Small commits per sub-phase, run the acceptance check, **stop at the human-verification
checkpoint**.

Priority is the first milestone: **read coordinates, then draw the map (debug-seeded).**
Local logging follows. Networking is parked until explicitly requested.

### Phase S0 — pure core (no UI)
- `coords.ts` parser + `survey.ts` model / dedupe / map projection. Unit tests first.
- **Accept:** `npm test` green incl. new specs — mixed units, negatives, wrong-line rejection,
  m/km/Mm/Gm, dedupe-by-id, axis projection. `npm run typecheck` clean.

### Phase S1 — coordinate read (Survey tab + multi-region OCR roles)  ← priority
- Tab bar in `App.tsx`; `SurveyView` + `RegionList`; generalize `useCaptureLoop` to N roles.
- Wire `shipPos` → `coords.ts` (live parsed ship X/Y/Z), optional `system` box; `rs` reuses
  the existing matcher.
- **Accept (build mechanism):** can add / draw / label multiple regions; the tab shows the
  **live parsed ship coordinates + system** read off the debug `Pos:` line.
- **🔴 HUMAN CHECKPOINT — coordinate OCR verification.** Like the Phase 1 RS checkpoint: the
  dense debug-overlay text is harder to read than the big RS number. **Stop and ask the user**
  to confirm coords parse correctly from their real HUD across distances/units (and negatives).
  Add temporal voting / a manual-confirm-before-log guard if reads jitter. Do not claim it
  works without confirmed reads.

### Phase S2 — map visuals, seeded with debug values  ← priority
- Build `SurveyMap`: 2D top-down, ship-centered, grid + range rings + crosshair, pan, wheel
  zoom (cursor-anchored — reuse the region-preview pattern), hover tooltip.
- Feed it from `survey-debug.ts` (synthetic ship pos + a fake field of points) behind a
  **"Debug values"** toggle, so the map is built and tuned **without flying or relying on
  perfect OCR**. When live `shipPos` from S1 is available it can drive the map center instead.
- **Accept:** toggle Debug values → a field of points renders ship-centered; pan / zoom /
  hover work; switching the center between the debug pos and the live ship pos repositions
  the points correctly.

### Phase S3 — local survey log (real scans feed the map)
- Build a `SurveyEntry` on each logged scan (live ship pos + RS match + quality); local
  append-only store (`userData/survey-log.json`); JSON/CSV export. The map now renders real
  entries (the Debug-values toggle stays for development).
- **Accept:** scan a rock → an entry appears in the log **and** as a point on the map at the
  right offset from the ship; export round-trips; reopening the app restores the log.

### Phase S4 — networked session sync (DEFERRED — only when asked)
- `SyncTransport` + `WsTransport`; `server/relay.ts` (rooms, presence, backlog/fan-out);
  session panel (host/join, callsign, main/scout role); offline-first queue; peer markers +
  shared points; privacy gate (opt-in, off by default, connected-state indicated).
- The S3 store already writes through the transport seam, so this layers on without rework.
- **Accept:** two clients in one room — scout A logs a rock, it appears on B's map within
  ~1 s; B sees A's live marker move; a late joiner gets the backlog; disconnect keeps logging
  locally and re-syncs on reconnect.

### Phase S5 — polish (optional)
- Map filters/labels, axis-mapping setting, near-duplicate collapse, richer tooltips.
- Possible transparent **map overlay window** for in-game viewing.

---

## 11. Open questions / risks / assumptions

1. **Debug-overlay toggle & stability.** Assumes the user keeps the `Zone … Pos` readout
   enabled while scouting, in a fixed screen spot. Confirm the exact toggle/cvar and that the
   line position is stable enough to box once. (User already runs it — needs the specifics.)
2. **Axis semantics.** The Z token reads much smaller than X/Y in the sample. Need a couple
   more coordinate samples (different altitudes/areas) to confirm which two axes form the
   ground plane and the per-axis units, so the map projection is right. Parser is unit-driven
   regardless; only the *map* needs this.
3. **Which absolute line to standardize on** — `SolarSystem_<id>` vs `Root`. They match in the
   sample; confirm they always do, and that all scouts in a system see the same `<id>`.
   (Recommend `SolarSystem_<id>` + the `Current player location` name.)
4. **Relay hosting.** Self-host only (recommended) vs also offering a default public instance.
   **Deferred with Phase S4 — no decision needed yet.** Revisit when sync is built.
5. **OCR cadence for live position.** "Place at ship position" only needs pos at scan time
   (on-demand OCR). Live peer markers need periodic pos OCR (~1–2 s). Confirm the extra
   continuous OCR of the dense debug text is acceptable for CPU/jitter, or gate live-marker
   broadcasting behind a toggle.
6. **OCR reliability of dense small text** vs the large RS digits. Mitigations: tight boxing,
   temporal voting, manual-confirm-before-log. This is the main technical risk — hence the
   S1 human checkpoint.
7. **ToS posture.** App stays read-only screen-capture; enabling SC's debug overlay is the
   user's client-side choice. Worth a line in the README so users understand what they're
   enabling.

---

## 12. Out of scope for the first milestone

- **Networked multi-scout sync** — **deferred to Phase S4**, not cut. The first milestone is
  coordinate read + map + local logging. Only the transport *seam* is built early.
- 3D map / point cloud (chose 2D top-down).
- Bearing/offset placement (chose "log at ship position").
- ROC/FPS mining methods (deferred project-wide).
- Transparent in-game map overlay window (Survey tab map first).
- Accounts, persistent server-side history beyond a live session's backlog, public data hosting.
