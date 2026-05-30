// Control window — Phase 0 scaffold only.
// Capture-source picker, region calibration, OCR debug view, the location
// dropdown, and the capture→match loop arrive in Phases 1–2.

export function App() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        color: '#e6e6e6',
        background: '#16181d',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ margin: '0 0 8px' }}>SC Ore Overlay</h1>
      <p style={{ opacity: 0.8, maxWidth: 560 }}>
        Control window — Phase 0 scaffold. The tested core (matcher, validator,
        signature table) is in place. Screen capture, region calibration, and
        OCR land in Phase 1.
      </p>
    </main>
  );
}
