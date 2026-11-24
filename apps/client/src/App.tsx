import React, { useCallback, useEffect, useState } from 'react';
import { useGameClient } from './hooks/useGameClient.js';
import { LobbyScreen } from './components/LobbyScreen.js';
import { WaitingRoom } from './components/WaitingRoom.js';
import { GameTable } from './components/GameTable.js';
import { SplashIntro } from './components/SplashIntro.js';
import { SettingsModal } from './components/SettingsModal.js';
import { RulesModal } from './components/RulesModal.js';
import {
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from './utils/settings.js';
import { soundFX } from './utils/sound.js';

export const App: React.FC = () => {
  const client = useGameClient();
  const [settings, setSettings] = useState<AppSettings>(() => {
    const initial = loadAppSettings();
    soundFX.setVolume(initial.soundVolume);
    soundFX.setHapticsEnabled(initial.hapticsEnabled);
    soundFX.setMuted(!initial.soundEnabled);
    return initial;
  });
  const [showSplash, setShowSplash] = useState<boolean>(() => settings.splashEnabled);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next: AppSettings = { ...prev, ...patch };
      saveAppSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    soundFX.setVolume(settings.soundVolume);
    soundFX.setHapticsEnabled(settings.hapticsEnabled);
    if (soundFX.isMuted() === settings.soundEnabled) {
      soundFX.setMuted(!settings.soundEnabled);
    }
  }, [settings.soundEnabled, settings.soundVolume, settings.hapticsEnabled]);

  const handleCopyRoomId = async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(roomId);
      client.pushToast(`房号 ${roomId} 已复制`);
    } catch {
      client.pushToast(`房号：${roomId}`);
    }
  };

  return (
    <div className="app-shell" data-table-skin={settings.tableSkin}>
      {showSplash && (
        <SplashIntro
          skin={settings.tableSkin}
          onFinish={() => setShowSplash(false)}
        />
      )}

      {!settings.hidePortraitBanner && (
        <div className="portrait-banner">
          <span>建议横屏游玩，38~48 张手牌体验最佳</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => updateSettings({ hidePortraitBanner: true })}
          >
            知道了
          </button>
        </div>
      )}

      <div className="toast-stack">
        {client.toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-item ${t.isError ? 'toast-error' : ''}`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {!client.room && (
        <LobbyScreen
          connStatus={client.connStatus}
          serverUrl={client.serverUrl}
          playerName={client.playerName}
          currentUser={client.currentUser}
          savedSession={client.savedSession}
          roomsList={client.roomsList}
          historyList={client.historyList}
          leaderboard={client.leaderboard}
          tableSkin={settings.tableSkin}
          onSetPlayerName={client.setPlayerName}
          onLogin={client.loginUser}
          onRegister={client.registerUser}
          onUpdateNickname={client.updateUserNickname}
          onLogout={client.logoutUser}
          onCreateRoom={client.createRoom}
          onJoinRoom={client.joinRoom}
          onReconnectSaved={client.reconnectSaved}
          onFetchRooms={client.fetchRooms}
          onFetchHistory={client.fetchHistory}
          onFetchLeaderboard={client.fetchLeaderboard}
          onOpenSettings={() => setShowSettings(true)}
          onOpenRules={() => setShowRules(true)}
        />
      )}

      {client.room && !client.view && client.session && (
        <WaitingRoom
          room={client.room}
          mySeat={client.session.seat}
          onSetMode={client.setRoomMode}
          onSetSeatBot={client.setSeatBot}
          onSwapSeat={client.swapSeat}
          onSetReady={client.setReady}
          onStartGame={client.startGame}
          onLeave={client.leaveRoom}
          onCopyRoomId={handleCopyRoomId}
        />
      )}

      {client.room && client.view && (
        <GameTable
          room={client.room}
          view={client.view}
          settings={settings}
          onOpenSettings={() => setShowSettings(true)}
          onSendAction={client.sendAction}
          onSetAutoBot={client.setAutoBot}
          onToggleDebugOpenHands={client.toggleDebugOpenHands}
          onLeaveRoom={client.leaveRoom}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          serverUrl={client.serverUrl}
          connStatus={client.connStatus}
          inGame={Boolean(client.room)}
          onUpdateSettings={updateSettings}
          onUpdateServerUrl={client.updateServerUrl}
          onReplaySplash={() => setShowSplash(true)}
          onOpenRules={() => setShowRules(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
};
