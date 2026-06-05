/**
 * main.tsx — application entry point.
 * ----------------------------------------------------------------------------
 * Mounts the routed <App/> shell (BrowserRouter + bottom tab bar) into #root.
 * StrictMode and the minimal index.css reset are preserved per CONTRACT §7.
 * ----------------------------------------------------------------------------
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
