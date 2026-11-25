import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { bgmPlayer } from './utils/bgm.js';
import { soundFX } from './utils/sound.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/cards.css';
import './styles/splash.css';
import './styles/lobby.css';
import './styles/waiting.css';
import './styles/table.css';
import './styles/modals.css';

// Mobile browsers suspend Web Audio until a real gesture. Keep the listeners
// for subsequent gestures so Android can also recover after backgrounding.
const unlockAllAudio = () => {
  soundFX.unlock();
  bgmPlayer.unlock();
};
window.addEventListener('pointerup', unlockAllAudio, { passive: true });
window.addEventListener('click', unlockAllAudio, { passive: true });
window.addEventListener('keydown', unlockAllAudio);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
