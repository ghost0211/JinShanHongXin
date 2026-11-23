import React from 'react';
import type { GameMode, RoomSummary, Seat } from '@jinshan/protocol';

interface WaitingRoomProps {
  room: RoomSummary;
  mySeat: Seat;
  onSetMode: (mode: GameMode) => void;
  onSetSeatBot: (seat: Seat, isBot: boolean) => void;
  onSwapSeat: (targetSeat: Seat) => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
  onLeave: () => void;
  onCopyRoomId: (roomId: string) => void;
}

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  room,
  mySeat,
  onSetMode,
  onSetSeatBot,
  onSwapSeat,
  onSetReady,
  onStartGame,
  onLeave,
  onCopyRoomId,
}) => {
  const isHost = mySeat === room.hostSeat;
  const me = room.seats[mySeat];
  const allOccupied = room.seats.every((s) => s.occupied);
  const allOnline = room.seats.every((s) => s.isBot || s.connected);
  const allReady = room.seats.every(
    (s) => s.occupied && (s.isBot || s.seat === room.hostSeat || s.ready),
  );

  return (
    <div className="waiting-wrap">
      <div
        className="card-panel"
        style={{
          maxWidth: 820,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 16, color: 'var(--gold-strong)' }}>
            房号：{room.roomId}
          </strong>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => onCopyRoomId(room.roomId)}
          >
            复制房号
          </button>
          <span className="pill pill-gold">
            {room.mode === 'hongxin' ? '金山打红心 (2v2)' : '金山打黑心 (1v3)'}
          </span>
          {room.debugMode && <span className="pill pill-green">调试模式</span>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {isHost && (
            <>
              <button
                type="button"
                className={`btn btn-xs ${room.mode === 'hongxin' ? 'btn-gold' : ''}`}
                onClick={() => onSetMode('hongxin')}
              >
                打红心
              </button>
              <button
                type="button"
                className={`btn btn-xs ${room.mode === 'heixin' ? 'btn-gold' : ''}`}
                onClick={() => onSetMode('heixin')}
              >
                打黑心
              </button>
            </>
          )}
          <button type="button" className="btn btn-xs btn-crimson" onClick={onLeave}>
            离开房间
          </button>
        </div>
      </div>

      <div className="waiting-seats">
        {room.seats.map((slot) => {
          const isMe = slot.seat === mySeat;
          return (
            <div key={slot.seat} className={`seat-box ${isMe ? 'is-me' : ''}`}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span>
                    座位 {slot.seat + 1} · {slot.name}
                  </span>
                  {slot.seat === room.hostSeat && <span className="pill pill-gold">房主</span>}
                  {isMe && <span className="pill pill-green">我</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {room.mode === 'hongxin' ? `${slot.team} 队（与座${((slot.seat + 2) % 4) + 1}对家）` : '1 打 3 个人积分'} ·{' '}
                  {!slot.occupied ? '空位' : !slot.connected ? '离线（保留座位）' : slot.ready ? '已准备' : '未准备'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isMe && (!slot.occupied || slot.isBot) && (
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => onSwapSeat(slot.seat)}
                  >
                    换到此座
                  </button>
                )}
                {isHost && !slot.occupied && (
                  <button
                    type="button"
                    className="btn btn-xs btn-emerald"
                    onClick={() => onSetSeatBot(slot.seat, true)}
                  >
                    +机器人
                  </button>
                )}
                {isHost && slot.isBot && (
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => onSetSeatBot(slot.seat, false)}
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          maxWidth: 820,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        {!isHost && (
          <button
            type="button"
            className={`btn btn-lg ${me.ready ? '' : 'btn-emerald'}`}
            onClick={() => onSetReady(!me.ready)}
          >
            {me.ready ? '取消准备' : '准备'}
          </button>
        )}
        {isHost && (
          <button
            type="button"
            className="btn btn-gold btn-lg"
            disabled={!allOccupied || !allOnline || !allReady}
            onClick={onStartGame}
          >
            {!allOccupied ? '请先添满 4 个座位（可加机器人）' : !allOnline ? '等待离线玩家重连' : !allReady ? '等待其他玩家准备' : '开始对局'}
          </button>
        )}
      </div>
    </div>
  );
};
