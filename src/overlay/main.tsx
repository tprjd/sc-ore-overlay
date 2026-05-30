import React from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay';

const container = document.getElementById('overlay-root');
if (!container) throw new Error('Overlay root #overlay-root not found');

createRoot(container).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
