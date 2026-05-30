import React from 'react';
import { createRoot } from 'react-dom/client';
import { Detail } from './Detail';

const container = document.getElementById('detail-root');
if (!container) throw new Error('Detail root #detail-root not found');

createRoot(container).render(
  <React.StrictMode>
    <Detail />
  </React.StrictMode>,
);
