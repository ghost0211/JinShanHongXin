import React, { useMemo, useState } from 'react';
import type { GameMode, RoomSeatInfo, RoomSummary, Seat } from '@jinshan/protocol';
import {
  buildLanJoinUrl,
  type LanHostStartResult,
} from '../net/androidLan.js';
import type { PlayMode } from '../hooks/useGameClient.js';
import { QrCodeSvg } from './QrCodeSvg.js';

interface WaitingRoomProps {
  room: RoomSummary;
  mySeat: Seat;
  playMode?: PlayMode;
  lanHostInfo?: LanHostStartResult | null;
  lanGuestCount?: number;
  onRefreshLanHost?: () => void;
  onSetMode: (mode: GameMode) => void;
  onSetSeatBot: (seat: Seat, isBot: boolean) => void;
  onSwapSeat: (targetSeat: Seat) => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
  onLeave: () => void;
  onCopyRoomId: (roomId: string) => void;
  onCopyText?: (text: string, label?: string) => void;
}

type RelativePosition = 'bottom' | 'top' | 'left' | 'right';

export const WaitingRoom: React.FC<WaitingRoomProps> = ({
  room,
  mySeat,
  playMode = 'online',
  lanHostInfo = null,
  lanGuestCount = 0,
  onRefreshLanHost,
  onSetMode,
  onSetSeatBot,
  onSwapSeat,
  onSetReady,
  onStartGame,
  onLeave,
  onCopyRoomId,
  onCopyText,
}) => {
  const isHost = mySeat === room.hostSeat;
  const isHongxin = room.mode === 'hongxin';
  const me = room.seats[mySeat];
  const emptySeats = room.seats.filter((s) => !s.occupied);
  const allOccupied = emptySeats.length === 0;
  const allOnline = room.seats.every((s) => s.isBot || s.connected);
  const allReady = room.seats.every(
    (s) => s.occupied && (s.isBot || s.seat === room.hostSeat || s.ready),
  );

  // Perspective-relative seats matching the actual GameTable orientation:
  // bottom = me, top = opposite (teammate in hongxin), right = next (下家), left = prev (上家)
  const topSeat = ((mySeat + 2) % 4) as Seat;
  const rightSeat = ((mySeat + 1) % 4) as Seat;
  const leftSeat = ((mySeat + 3) % 4) as Seat;

  const [selectedIp, setSelectedIp] = useState<string>('');
  const activeIp = useMemo(() => {
    if (!lanHostInfo) return '';
    if (selectedIp && lanHostInfo.ips.includes(selectedIp)) return selectedIp;
    return lanHostInfo.primaryIp || lanHostInfo.ips[0] || '';
  }, [lanHostInfo, selectedIp]);

  const lanJoinUrl = useMemo(() => {
    if (!lanHostInfo || !activeIp) return '';
    return buildLanJoinUrl(activeIp, lanHostInfo.port, room.roomId);
  }, [lanHostInfo, activeIp, room.roomId]);

  const modeBadgeLabel =
    playMode === 'offline'
      ? '单机离线'
      : playMode === 'lan'
        ? lanHostInfo
          ? '局域网房主'
          : '局域网面联'
        : null;

  const showLanSidebar = Boolean(lanHostInfo && isHost);

  const handleFillAllBots = () => {
    for (const s of emptySeats) {
      onSetSeatBot(s.seat, true);
    }
  };

  const renderSeatCard = (slot: RoomSeatInfo, pos: RelativePosition) => {
    const isMe = pos === 'bottom';
    const isAlly = isHongxin && (pos === 'bottom' || pos === 'top');
    const isOppositeAlly = isHongxin && pos === 'top';
    const isEnemy = isHongxin && (pos === 'left' || pos === 'right');

    const posLabel =
      pos === 'bottom'
        ? '我'
        : pos === 'top'
          ? isHongxin
            ? '对家 · 队友'
            : '对家'
          : pos === 'left'
            ? '上家'
            : '下家';

    const avatarText = !slot.occupied
      ? '+'
      : slot.isBot
        ? '🤖'
        : (slot.name || '玩').trim().slice(0, 1);

    const statusText = !slot.occupied
      ? '等待入座'
      : !slot.connected
        ? '离线保留'
        : slot.seat === room.hostSeat
          ? '房主已就绪'
          : slot.ready
            ? '已准备'
            : '未准备';

    const statusCls = !slot.occupied
      ? 'is-empty'
      : !slot.connected
        ? 'is-offline'
        : slot.ready || slot.seat === room.hostSeat
          ? 'is-ready'
          : 'is-waiting';

    return (
      <div
        key={slot.seat}
        className={`table-seat-card pos-${pos} ${isMe ? 'is-me' : ''} ${
          isAlly ? 'is-ally-team' : ''
        } ${isOppositeAlly ? 'is-teammate' : ''} ${isEnemy ? 'is-enemy-team' : ''} ${
          !slot.occupied ? 'is-empty-slot' : ''
        }`}
      >
        <div className="table-seat-top">
          <div className={`table-seat-avatar ${slot.isBot ? 'is-bot' : ''} ${!slot.occupied ? 'is-empty' : ''}`}>
            {avatarText}
          </div>

          <div className="table-seat-info">
            <div className="table-seat-badges">
              <span
                className={`pill table-role-pill ${
                  isMe
                    ? 'pill-gold'
                    : isOppositeAlly
                      ? 'pill-ally'
                      : isEnemy
                        ? 'pill-enemy'
                        : ''
                }`}
              >
                {isOppositeAlly ? '★ 队友' : posLabel}
              </span>
              {isHongxin && (
                <span className={`table-team-tag ${isAlly ? 'is-ally' : 'is-enemy'}`}>
                  {isAlly ? `我方 ${slot.team}队` : `对手 ${slot.team}队`}
                </span>
              )}
              {slot.seat === room.hostSeat && <span className="pill pill-gold">房主</span>}
            </div>

            <div className="table-seat-name-row">
              <strong className="table-seat-name">
                {slot.occupied ? slot.name : `空位 ${slot.seat + 1}`}
              </strong>
              <span className="table-seat-index">座{slot.seat + 1}</span>
            </div>

            <div className="table-seat-status">
              <span className={`seat-status-dot ${statusCls}`} />
              <span>{statusText}</span>
            </div>
          </div>
        </div>

        <div className="table-seat-actions">
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
  };

  return (
    <div className="waiting-wrap">
      {/* Compact Top Room Header */}
      <div className="card-panel waiting-header">
        <div className="waiting-header-left">
          <strong className="waiting-room-code">房号：{room.roomId}</strong>
          {playMode !== 'offline' && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => onCopyRoomId(room.roomId)}
            >
              复制房号
            </button>
          )}
          <span className="pill pill-gold">
            {isHongxin ? '金山打红心 (2v2)' : '金山打黑心 (1v3)'}
          </span>
          {modeBadgeLabel && <span className="pill pill-green">{modeBadgeLabel}</span>}
          {room.debugMode && <span className="pill pill-green">调试模式</span>}
        </div>

        <div className="waiting-header-right">
          {isHost && (
            <>
              <button
                type="button"
                className={`btn btn-xs ${isHongxin ? 'btn-gold' : ''}`}
                onClick={() => onSetMode('hongxin')}
              >
                打红心
              </button>
              <button
                type="button"
                className={`btn btn-xs ${!isHongxin ? 'btn-gold' : ''}`}
                onClick={() => onSetMode('heixin')}
              >
                打黑心
              </button>
            </>
          )}
          <button type="button" className="btn btn-xs btn-crimson" onClick={onLeave}>
            {lanHostInfo ? '关闭房间' : '离开房间'}
          </button>
        </div>
      </div>

      {/* Main Perspective Table + Optional LAN QR Side Card */}
      <div className={`waiting-stage ${showLanSidebar ? 'has-lan-side' : ''}`}>
        <section className="waiting-table-arena" aria-label="拟真牌桌座位布局">
          {/* Decorative felt table surface spanning center */}
          <div className={`waiting-table-felt ${isHongxin ? 'is-hongxin' : 'is-heixin'}`}>
            {isHongxin && (
              <div className="table-ally-axis" aria-hidden="true">
                <span className="ally-axis-cap is-top">▲ 队友</span>
                <span className="ally-axis-line" />
                <span className="ally-axis-cap is-bottom">▼ 我方</span>
              </div>
            )}

            <div className="table-center-hub">
              <div className="table-center-badge">
                {isHongxin ? (
                  <>
                    <strong>上下对家同队 · 2 打 2</strong>
                    <span>你（下方）与对面 {room.seats[topSeat].name} 并肩作战</span>
                  </>
                ) : (
                  <>
                    <strong>1 打 3 · 叫分抢庄</strong>
                    <span>各自抢庄 · 庄家独抗三家闲家</span>
                  </>
                )}
              </div>

              <div className="table-center-actions">
                {!isHost && (
                  <button
                    type="button"
                    className={`btn btn-lg ${me.ready ? '' : 'btn-emerald'}`}
                    onClick={() => onSetReady(!me.ready)}
                  >
                    {me.ready ? '取消准备' : '准备就绪'}
                  </button>
                )}

                {isHost && !allOccupied && (
                  <button
                    type="button"
                    className="btn btn-emerald"
                    onClick={handleFillAllBots}
                  >
                    + 一键补满机器人 ({emptySeats.length})
                  </button>
                )}

                {isHost && (
                  <button
                    type="button"
                    className="btn btn-gold btn-lg"
                    disabled={!allOccupied || !allOnline || !allReady}
                    onClick={onStartGame}
                  >
                    {!allOccupied
                      ? `还缺 ${emptySeats.length} 人`
                      : !allOnline
                        ? '等待离线重连'
                        : !allReady
                          ? '等待牌友准备'
                          : '✦ 开始对局'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 4 Perspective Seats */}
          {renderSeatCard(room.seats[topSeat], 'top')}
          {renderSeatCard(room.seats[leftSeat], 'left')}
          {renderSeatCard(room.seats[rightSeat], 'right')}
          {renderSeatCard(room.seats[mySeat], 'bottom')}
        </section>

        {showLanSidebar && lanHostInfo && (
          <aside className="card-panel lan-invite-side">
            <div className="lan-invite-head">
              <strong>📡 局域网邀请</strong>
              <span className="pill pill-green">UDP 广播中</span>
            </div>

            <div className="lan-qr-box">
              {lanJoinUrl ? (
                <QrCodeSvg value={lanJoinUrl} size={136} />
              ) : (
                <div className="lan-qr-placeholder">未检测到局域网 IP</div>
              )}
            </div>

            <div className="lan-side-meta">
              <span className="pill">已连客机 {lanGuestCount} 台</span>
              {onRefreshLanHost && (
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={onRefreshLanHost}
                >
                  ↻ 刷新IP
                </button>
              )}
            </div>

            {lanJoinUrl ? (
              <div className="lan-side-url-wrap">
                <code className="lan-url-code">{lanJoinUrl}</code>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() =>
                    onCopyText
                      ? onCopyText(lanJoinUrl, '局域网直连地址')
                      : onCopyRoomId(lanJoinUrl)
                  }
                >
                  复制直连链接
                </button>
              </div>
            ) : (
              <div className="lan-warn-text">
                未检测到 Wi-Fi 或手机热点 IP，请开启热点或连接同一 Wi-Fi 后点「刷新IP」
              </div>
            )}

            {lanHostInfo.ips.length > 1 && (
              <div className="lan-ip-chips">
                <span className="lan-ip-label">切换 IP：</span>
                {lanHostInfo.ips.map((ip) => (
                  <button
                    key={ip}
                    type="button"
                    className={`btn btn-xs ${ip === activeIp ? 'btn-gold' : ''}`}
                    onClick={() => setSelectedIp(ip)}
                  >
                    {ip}
                  </button>
                ))}
              </div>
            )}

            <p className="lan-invite-tip">
              安卓好友在「局域网」页自动发现入座；iPhone / 电脑浏览器直接扫码免装包进房；请保持房主在前台。
            </p>
          </aside>
        )}
      </div>
    </div>
  );
};
