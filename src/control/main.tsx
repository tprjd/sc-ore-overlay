import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './App';
import { TooltipProvider } from './ui';

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

createRoot(container).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={300}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
