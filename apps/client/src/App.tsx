import React, { useState } from 'react';
import { useGameClient } from './hooks/useGameClient.js';
import { LobbyScreen } from './components/LobbyScreen.js';
import { WaitingRoom } from './components/WaitingRoom.js';
import { GameTable } from './components/GameTable.js';

export const App: React.FC = () => {
  const client = useGameClient();
  const [hidePortraitBanner, setHidePortraitBanner] = useState(false);

  const handleCopyRoomId = async (roomId: string) => {
    try {
      await navigator.clipboard.writeText(roomId);
      client.pushToast(`房号 ${roomId} 已复制`);
    } catch {
      client.pushToast(`房号：${roomId}`);
    }
  };

  return (
    <div className="app-shell">
      {!hidePortraitBanner && (
        <div className="portrait-banner">
          <span>建议横屏游玩，38~48 张手牌体验最佳</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => setHidePortraitBanner(true)}
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
          savedSession={client.savedSession}
          roomsList={client.roomsList}
          historyList={client.historyList}
          onSetPlayerName={client.setPlayerName}
          onUpdateServerUrl={client.updateServerUrl}
          onCreateRoom={client.createRoom}
          onJoinRoom={client.joinRoom}
          onReconnectSaved={client.reconnectSaved}
          onFetchRooms={client.fetchRooms}
          onFetchHistory={client.fetchHistory}
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
          muted={client.muted}
          onToggleMute={client.toggleMute}
          onSendAction={client.sendAction}
          onSetAutoBot={client.setAutoBot}
          onToggleDebugOpenHands={client.toggleDebugOpenHands}
          onLeaveRoom={client.leaveRoom}
        />
      )}
    </div>
  );
};
