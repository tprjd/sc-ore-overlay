import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScanOverlay } from './ScanOverlay';

const container = document.getElementById('scan-root');
if (!container) throw new Error('Scan root #scan-root not found');

createRoot(container).render(
  <React.StrictMode>
    <ScanOverlay />
  </React.StrictMode>,
);
