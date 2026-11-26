import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

async function start() {
  // `vite dev` opened in a plain browser has no Electron bridge: use made-up data.
  // This branch is removed from the production build.
  if (import.meta.env.DEV && !window.hrms) await import('./devMock.js');
  createRoot(document.getElementById('root')).render(<App />);
}
start();
