import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { soundFX } from './utils/sound.js';
import './styles/theme.css';
import './styles/table-skins.css';

// Mobile browsers suspend Web Audio until a real gesture. Keep the listeners
// for subsequent gestures so Android can also recover after backgrounding.
window.addEventListener('pointerup', () => soundFX.unlock(), { passive: true });
window.addEventListener('click', () => soundFX.unlock(), { passive: true });
window.addEventListener('keydown', () => soundFX.unlock());

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
