import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useGameClient } from './hooks/useGameClient.js';
import { LobbyScreen } from './components/LobbyScreen.js';
import { WaitingRoom } from './components/WaitingRoom.js';
import { GameTable } from './components/GameTable.js';
import { SplashIntro } from './components/SplashIntro.js';
import { SettingsModal } from './components/SettingsModal.js';
import { RulesModal } from './components/RulesModal.js';
import { Icon } from './components/Icons.js';
import {
  CARD_SCALE_STEP,
  clampCardScale,
  loadAppSettings,
  saveAppSettings,
  type AppSettings,
} from './utils/settings.js';
import {
  forceCloseDesktopApp,
  isRunningInTauriDesktop,
  listenDesktopCloseRequested,
  setActiveMatchGuard,
  toggleDesktopFullscreen,
} from './utils/desktopBridge.js';
import { bgmPlayer } from './utils/bgm.js';
import { soundFX } from './utils/sound.js';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const initial = loadAppSettings();
    soundFX.setVolume(initial.soundVolume);
    soundFX.setHapticsEnabled(initial.hapticsEnabled);
    soundFX.setMuted(!initial.soundEnabled);
    bgmPlayer.configure({
      enabled: initial.bgmEnabled,
      track: initial.bgmTrack,
      volume: initial.bgmVolume,
    });
    return initial;
  });
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;

  const client = useGameClient({
    allyBotDifficulty: settings.allyBotDifficulty,
    opponentBotDifficulty: settings.opponentBotDifficulty,
    dealSpeed: settings.dealSpeed,
  });
  const [showSplash, setShowSplash] = useState<boolean>(() => settings.splashEnabled);
  const [showSettings, setShowSettings] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showAppCloseConfirm, setShowAppCloseConfirm] = useState(false);
  const isDesktopApp = isRunningInTauriDesktop();

  const isInActiveMatch = Boolean(
    client.room &&
      client.view &&
      client.view.phase !== 'ROUND_OVER' &&
      client.view.phase !== 'MATCH_OVER',
  );

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    const next: AppSettings = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    saveAppSettings(next);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--card-scale', String(settings.cardScale));
  }, [settings.cardScale]);

  useEffect(() => {
    soundFX.setVolume(settings.soundVolume);
    soundFX.setHapticsEnabled(settings.hapticsEnabled);
    if (soundFX.isMuted() === settings.soundEnabled) {
      soundFX.setMuted(!settings.soundEnabled);
    }
  }, [settings.soundEnabled, settings.soundVolume, settings.hapticsEnabled]);

  useEffect(() => {
    bgmPlayer.configure({
      enabled: settings.bgmEnabled,
      track: settings.bgmTrack,
      volume: settings.bgmVolume,
    });
  }, [settings.bgmEnabled, settings.bgmTrack, settings.bgmVolume]);

  // Sync native window close guard during active matches
  useEffect(() => {
    if (!isDesktopApp) return;
    void setActiveMatchGuard(isInActiveMatch && settings.confirmExitInGame);
  }, [isDesktopApp, isInActiveMatch, settings.confirmExitInGame]);

  // Listen for intercepted native window close events
  useEffect(() => {
    if (!isDesktopApp) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void listenDesktopCloseRequested(() => {
      if (active) {
        setShowAppCloseConfirm(true);
      }
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [isDesktopApp]);

  // Global desktop shortcuts (F11, F1/?, Ctrl+/Ctrl-/Ctrl0, Esc) & context menu guard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable),
      );

      if (isDesktopApp && e.key === 'F11') {
        e.preventDefault();
        void toggleDesktopFullscreen();
        return;
      }

      if (
        e.key === 'F1' ||
        (!inEditable && !e.ctrlKey && !e.altKey && !e.metaKey && e.key === '?')
      ) {
        e.preventDefault();
        setShowSettings((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        if (showAppCloseConfirm) {
          e.preventDefault();
          setShowAppCloseConfirm(false);
          return;
        }
        if (showSettings) {
          e.preventDefault();
          setShowSettings(false);
          return;
        }
        if (showRules) {
          e.preventDefault();
          setShowRules(false);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          const nextScale = clampCardScale(settingsRef.current.cardScale + CARD_SCALE_STEP);
          updateSettings({ cardScale: nextScale });
          client.pushToast(`牌面缩放：${Math.round(nextScale * 100)}%`);
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          const nextScale = clampCardScale(settingsRef.current.cardScale - CARD_SCALE_STEP);
          updateSettings({ cardScale: nextScale });
          client.pushToast(`牌面缩放：${Math.round(nextScale * 100)}%`);
        } else if (e.key === '0') {
          e.preventDefault();
          updateSettings({ cardScale: 1.0 });
          client.pushToast('牌面缩放已重置为 100%');
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!isDesktopApp) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [
    isDesktopApp,
    updateSettings,
    client.pushToast,
    showSettings,
    showRules,
    showAppCloseConfirm,
  ]);

  const handleCopyText = async (text: string, label = '内容') => {
    try {
      await navigator.clipboard.writeText(text);
      client.pushToast(`${label}已复制`);
    } catch {
      client.pushToast(`${label}：${text}`);
    }
  };

  const handleCopyRoomId = (roomId: string) => {
    void handleCopyText(roomId, `房号 ${roomId}`);
  };

  return (
    <div className="app-shell" data-table-skin={settings.tableSkin}>
      {showSplash && (
        <SplashIntro
          skin={settings.tableSkin}
          onFinish={() => setShowSplash(false)}
        />
      )}

      {!settings.hidePortraitBanner && !isDesktopApp && (
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
          playMode={client.playMode}
          lanRole={client.lanRole}
          lanHostSupported={client.lanHostSupported}
          lanTargetUrl={client.lanTargetUrl}
          discoveredLanHosts={client.discoveredLanHosts}
          localHistory={client.localHistory}
          localStats={client.localStats}
          connStatus={client.connStatus}
          serverUrl={client.serverUrl}
          playerName={client.playerName}
          currentUser={client.currentUser}
          savedSession={client.savedSession}
          roomsList={client.roomsList}
          historyList={client.historyList}
          leaderboard={client.leaderboard}
          tableSkin={settings.tableSkin}
          defaultMatchSetup={{
            dealSpeed: settings.dealSpeed,
            allyBotDifficulty: settings.allyBotDifficulty,
            opponentBotDifficulty: settings.opponentBotDifficulty,
          }}
          onSaveMatchSetupDefaults={(patch) => updateSettings(patch)}
          onSetPlayMode={client.setPlayMode}
          onStartLanHost={client.startLanHostRoom}
          onJoinDiscoveredLanHost={client.joinDiscoveredLanHost}
          onConnectLanManual={client.connectLanManual}
          onDisconnectLanGuest={client.disconnectLanGuest}
          onClearLocalStats={client.clearLocalStats}
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
          playMode={client.playMode}
          lanHostInfo={client.lanRole === 'host' ? client.lanHostInfo : null}
          lanGuestCount={client.lanBridgeStatus.peerCount}
          onRefreshLanHost={client.refreshLanHostInfo}
          onSetMode={client.setRoomMode}
          onSetDealSpeed={client.setDealSpeed}
          onSetBotDifficulty={client.setBotDifficulty}
          onSaveMatchSetupDefaults={(patch) => updateSettings(patch)}
          onSetSeatBot={client.setSeatBot}
          onSwapSeat={client.swapSeat}
          onSetReady={client.setReady}
          onStartGame={client.startGame}
          onLeave={client.leaveRoom}
          onCopyRoomId={handleCopyRoomId}
          onCopyText={handleCopyText}
        />
      )}

      {client.room && client.view && (
        <GameTable
          room={client.room}
          view={client.view}
          settings={settings}
          playMode={client.playMode}
          hasExternalModal={showSettings || showRules || showAppCloseConfirm}
          onOpenSettings={() => setShowSettings(true)}
          onUpdateSettings={updateSettings}
          onPushToast={client.pushToast}
          onSendAction={client.sendAction}
          onSetAutoBot={client.setAutoBot}
          onToggleDebugOpenHands={client.toggleDebugOpenHands}
          onLeaveRoom={client.leaveRoom}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          playMode={client.playMode}
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

      {showAppCloseConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAppCloseConfirm(false)}
        >
          <div
            className="modal-card confirm-exit-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>当前正在对局中</h3>
              <button
                type="button"
                className="btn btn-xs btn-ghost modal-close"
                onClick={() => setShowAppCloseConfirm(false)}
              >
                <Icon name="close" />
                关闭
              </button>
            </div>
            <p className="confirm-exit-desc">
              关闭客户端后本局将中断连接（在线房间可稍后凭房号断线重连）。确认要关闭吗？
            </p>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-emerald"
                onClick={() => setShowAppCloseConfirm(false)}
              >
                继续对局 (Esc)
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowAppCloseConfirm(false);
                  client.leaveRoom();
                }}
              >
                仅退出回大厅
              </button>
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-crimson"
                onClick={() => void forceCloseDesktopApp()}
              >
                关闭客户端
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
