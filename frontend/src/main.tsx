/**
 * main.tsx — application entry point.
 * ----------------------------------------------------------------------------
 * Applies the persisted theme to <html> BEFORE the first paint (so the paper
 * never flashes the wrong colour), imports the Warm Almanac design system plus
 * the minimal reset, and mounts <App/> into #root under StrictMode.
 * ----------------------------------------------------------------------------
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/almanac.css';
import './index.css';

// Pre-paint theme application: stored choice wins, otherwise the OS decides.
// <App/> re-reads this and keeps it in sync from then on.
const storedTheme = localStorage.getItem('almanac_theme');
const initialTheme =
  storedTheme === 'light' || storedTheme === 'dark'
    ? storedTheme
    : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
document.documentElement.setAttribute('data-theme', initialTheme);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
