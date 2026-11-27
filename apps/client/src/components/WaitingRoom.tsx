import React, { useEffect, useMemo, useState } from 'react';
import type {
  BotDifficulty,
  DealSpeed,
  GameMode,
  RoomSeatInfo,
  RoomSummary,
  Seat,
} from '@jinshan/protocol';
import {
  buildLanJoinUrl,
  type LanHostStartResult,
} from '../net/androidLan.js';
import type { PlayMode } from '../hooks/useGameClient.js';
import { BOT_DIFFICULTY_OPTIONS, DEAL_SPEED_OPTIONS } from '../utils/settings.js';
import { Icon } from './Icons.js';
import { MatchSetupModal } from './MatchSetupModal.js';
import { QrCodeSvg } from './QrCodeSvg.js';

interface WaitingRoomProps {
  room: RoomSummary;
  mySeat: Seat;
  playMode?: PlayMode;
  hasExternalModal?: boolean;
  lanHostInfo?: LanHostStartResult | null;
  lanGuestCount?: number;
  onRefreshLanHost?: () => void;
  onSetMode: (mode: GameMode) => void;
  onSetDealSpeed: (dealSpeed: DealSpeed) => void;
  onSetBotDifficulty: (allyDifficulty: BotDifficulty, opponentDifficulty: BotDifficulty) => void;
  onSaveMatchSetupDefaults?: (patch: {
    dealSpeed: DealSpeed;
    allyBotDifficulty: BotDifficulty;
    opponentBotDifficulty: BotDifficulty;
  }) => void;
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
  hasExternalModal = false,
  lanHostInfo = null,
  lanGuestCount = 0,
  onRefreshLanHost,
  onSetMode,
  onSetDealSpeed,
  onSetBotDifficulty,
  onSaveMatchSetupDefaults,
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
  const [showSetupModal, setShowSetupModal] = useState(false);

  useEffect(() => {
    if (hasExternalModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (showSetupModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowSetupModal(false);
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        onCopyRoomId(room.roomId);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
          return;
        }
        if (isHost) {
          if (allOccupied && allOnline && allReady) {
            e.preventDefault();
            onStartGame();
          }
        } else {
          e.preventDefault();
          onSetReady(!me.ready);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    hasExternalModal,
    showSetupModal,
    isHost,
    allOccupied,
    allOnline,
    allReady,
    me.ready,
    room.roomId,
    onCopyRoomId,
    onStartGame,
    onSetReady,
  ]);

  const dealSpeedLabel =
    DEAL_SPEED_OPTIONS.find((d) => d.id === room.dealSpeed)?.label ?? '极速';
  const allyDiffLabel =
    BOT_DIFFICULTY_OPTIONS.find((d) => d.id === room.allyBotDifficulty)?.label ?? '强';
  const oppDiffLabel =
    BOT_DIFFICULTY_OPTIONS.find((d) => d.id === room.opponentBotDifficulty)?.label ?? '强';
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
    const isSeatHost = slot.seat === room.hostSeat;

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

    const statusText = !slot.occupied
      ? '等待入座'
      : !slot.connected
        ? '离线保留'
        : isSeatHost
          ? '房主已就绪'
          : slot.ready
            ? '已准备'
            : '未准备';

    const statusCls = !slot.occupied
      ? 'is-empty'
      : !slot.connected
        ? 'is-offline'
        : slot.ready || isSeatHost
          ? 'is-ready'
          : 'is-waiting';

    const teamCls = isMe ? 'is-me' : isOppositeAlly ? 'is-ally' : isEnemy ? 'is-enemy' : 'is-neutral';

    const canSwap = !isMe && (!slot.occupied || slot.isBot);
    const canAddBot = isHost && !slot.occupied;
    const canRemoveBot = isHost && slot.isBot;

    return (
      <div
        key={slot.seat}
        className={`waiting-seat pos-${pos} ${teamCls} ${!slot.occupied ? 'is-empty-slot' : ''}`}
      >
        <div className="waiting-seat-badge">
          <div className="waiting-seat-avatar-wrap">
            <div
              className={`waiting-seat-avatar ${slot.isBot ? 'is-bot' : ''} ${
                !slot.occupied ? 'is-empty' : ''
              }`}
            >
              {!slot.occupied ? (
                <Icon name="plus" className="waiting-seat-avatar-icon" />
              ) : slot.isBot ? (
                <Icon name="robot" className="waiting-seat-avatar-icon" />
              ) : (
                (slot.name || '玩').trim().slice(0, 1)
              )}
            </div>
            <span className={`waiting-seat-dot ${statusCls}`} aria-hidden="true" />
            {isSeatHost && <span className="seal waiting-seat-seal">房主</span>}
          </div>

          <div className="waiting-seat-plate">
            <div className="waiting-seat-name-row">
              <strong className="waiting-seat-name">
                {slot.occupied ? slot.name : `空位 ${slot.seat + 1}`}
              </strong>
              <span className="waiting-seat-index">座{slot.seat + 1}</span>
            </div>
            <div className="waiting-seat-tags">
              <span className={`waiting-role-tag ${teamCls}`}>{posLabel}</span>
              {isHongxin && (
                <span className={`waiting-team-tag ${isAlly ? 'is-ally' : 'is-enemy'}`}>
                  {isAlly ? `我方 ${slot.team}队` : `对手 ${slot.team}队`}
                </span>
              )}
            </div>
            <div className={`waiting-seat-status ${statusCls}`}>{statusText}</div>
          </div>
        </div>

        {(canSwap || canAddBot || canRemoveBot) && (
          <div className="waiting-seat-actions">
            {canSwap && (
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => onSwapSeat(slot.seat)}
              >
                换到此座
              </button>
            )}
            {canAddBot && (
              <button
                type="button"
                className="btn btn-xs btn-emerald"
                onClick={() => onSetSeatBot(slot.seat, true)}
              >
                +机器人
              </button>
            )}
            {canRemoveBot && (
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => onSetSeatBot(slot.seat, false)}
              >
                移除
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="waiting-wrap">
      {/* Room header */}
      <header className="waiting-header">
        <div className="waiting-header-left">
          <div className="waiting-room-code">
            <span className="waiting-room-code-label">房号</span>
            <strong>{room.roomId}</strong>
          </div>
          {playMode !== 'offline' && (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => onCopyRoomId(room.roomId)}
              title="复制房号 (C)"
            >
              <Icon name="copy" />
              复制房号
              <kbd className="btn-kbd">C</kbd>
            </button>
          )}
          <span className={`pill ${isHongxin ? 'pill-red' : 'pill-gold'}`}>
            {isHongxin ? '金山打红心 · 2V2' : '金山打黑心 · 1V3'}
          </span>
          {modeBadgeLabel && <span className="pill pill-green">{modeBadgeLabel}</span>}
          {room.debugMode && <span className="pill pill-blue">调试模式</span>}
        </div>

        <div className="waiting-header-right">
          {isHost && (
            <>
              <div className="segmented-control waiting-mode-switch" role="radiogroup" aria-label="玩法">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isHongxin}
                  className={isHongxin ? 'is-active' : ''}
                  onClick={() => onSetMode('hongxin')}
                >
                  打红心
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isHongxin}
                  className={!isHongxin ? 'is-active' : ''}
                  onClick={() => onSetMode('heixin')}
                >
                  打黑心
                </button>
              </div>
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => setShowSetupModal(true)}
              >
                <Icon name="gear" />
                本局参数
              </button>
            </>
          )}
          <button type="button" className="btn btn-xs btn-crimson" onClick={onLeave}>
            <Icon name="exit" />
            {lanHostInfo ? '关闭房间' : '离开房间'}
          </button>
        </div>
      </header>

      {/* Lacquer table with four seats + optional LAN invite side card */}
      <div className={`waiting-stage ${showLanSidebar ? 'has-lan-side' : ''}`}>
        <section
          className={`waiting-arena ${isHongxin ? 'is-hongxin' : 'is-heixin'}`}
          aria-label="拟真牌桌座位布局"
        >
          <div className="waiting-felt" aria-hidden="true">
            <span className="waiting-felt-medal" />
            {isHongxin && <span className="waiting-ally-axis" />}
          </div>

          <div className="waiting-center">
            <div className="waiting-center-badge">
              {isHongxin ? (
                <>
                  <strong>上下对家同队 · 2 打 2</strong>
                  <span>你与对面 {room.seats[topSeat].name || '队友'} 并肩作战</span>
                </>
              ) : (
                <>
                  <strong>1 打 3 · 叫分抢庄</strong>
                  <span>各自抢庄，庄家独抗三家</span>
                </>
              )}
              <div className="waiting-rules-strip" title="本房间共享参数">
                <span>发牌 {dealSpeedLabel}</span>
                <i>·</i>
                <span>队友AI {allyDiffLabel}</span>
                <i>·</i>
                <span>对手AI {oppDiffLabel}</span>
              </div>
            </div>

            <div className="waiting-center-actions">
              {!isHost && (
                <button
                  type="button"
                  className={`btn btn-lg ${me.ready ? '' : 'btn-emerald'}`}
                  onClick={() => onSetReady(!me.ready)}
                >
                  {me.ready ? '取消准备' : '准备就绪'}
                  <kbd className="btn-kbd">Enter</kbd>
                </button>
              )}

              {isHost && (
                <button
                  type="button"
                  className="btn btn-gold btn-lg waiting-start-btn"
                  disabled={!allOccupied || !allOnline || !allReady}
                  onClick={onStartGame}
                >
                  {!allOccupied ? (
                    `还缺 ${emptySeats.length} 人`
                  ) : !allOnline ? (
                    '等待离线重连'
                  ) : !allReady ? (
                    '等待牌友准备'
                  ) : (
                    <>
                      <Icon name="play" />
                      开始对局
                      <kbd className="btn-kbd">Enter</kbd>
                    </>
                  )}
                </button>
              )}

              {isHost && !allOccupied && (
                <button
                  type="button"
                  className="btn btn-emerald"
                  onClick={handleFillAllBots}
                >
                  <Icon name="robot" />
                  一键补满机器人 ({emptySeats.length})
                </button>
              )}
            </div>
          </div>

          {renderSeatCard(room.seats[topSeat], 'top')}
          {renderSeatCard(room.seats[leftSeat], 'left')}
          {renderSeatCard(room.seats[rightSeat], 'right')}
          {renderSeatCard(room.seats[mySeat], 'bottom')}
        </section>

        {showLanSidebar && lanHostInfo && (
          <aside className="card-panel lan-invite-side">
            <div className="lan-invite-head">
              <h2 className="section-title">局域网邀请</h2>
              <span className="pill pill-green">
                <i className="lan-live-dot" />
                UDP 广播中
              </span>
            </div>

            <div className="lan-qr-box">
              {lanJoinUrl ? (
                <QrCodeSvg value={lanJoinUrl} size={136} className="lan-qr-svg" />
              ) : (
                <div className="lan-qr-placeholder">未检测到局域网 IP</div>
              )}
            </div>

            <div className="lan-side-meta">
              <span className="pill">已连客机 {lanGuestCount} 台</span>
              {onRefreshLanHost && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={onRefreshLanHost}
                >
                  <Icon name="refresh" />
                  刷新IP
                </button>
              )}
            </div>

            {lanJoinUrl ? (
              <div className="lan-side-url-wrap">
                <code className="lan-url-code" title={lanJoinUrl}>
                  {lanJoinUrl}
                </code>
                <button
                  type="button"
                  className="btn btn-xs btn-gold"
                  onClick={() =>
                    onCopyText
                      ? onCopyText(lanJoinUrl, '局域网直连地址')
                      : onCopyRoomId(lanJoinUrl)
                  }
                >
                  <Icon name="copy" />
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
                <span className="lan-ip-label">切换 IP</span>
                {lanHostInfo.ips.map((ip) => (
                  <button
                    key={ip}
                    type="button"
                    className={`btn btn-xs ${ip === activeIp ? 'btn-gold' : 'btn-ghost'}`}
                    onClick={() => setSelectedIp(ip)}
                  >
                    {ip}
                  </button>
                ))}
              </div>
            )}

            <p className="lan-invite-tip">
              安卓 / Windows 好友在「局域网」页自动发现入座；iPhone / 浏览器扫码免装包进房；请保持房主运行。
            </p>
          </aside>
        )}
      </div>

      {showSetupModal && isHost && (
        <MatchSetupModal
          title="调整本局参数"
          subtitle="修改后立即同步给房间内所有玩家"
          confirmLabel="保存本局参数"
          initialValues={{
            mode: room.mode,
            dealSpeed: room.dealSpeed,
            allyBotDifficulty: room.allyBotDifficulty,
            opponentBotDifficulty: room.opponentBotDifficulty,
            debugMode: room.debugMode,
          }}
          showModePicker={true}
          showDebugToggle={false}
          onConfirm={(vals) => {
            if (vals.mode !== room.mode) onSetMode(vals.mode);
            if (vals.dealSpeed !== room.dealSpeed) onSetDealSpeed(vals.dealSpeed);
            if (
              vals.allyBotDifficulty !== room.allyBotDifficulty ||
              vals.opponentBotDifficulty !== room.opponentBotDifficulty
            ) {
              onSetBotDifficulty(vals.allyBotDifficulty, vals.opponentBotDifficulty);
            }
            onSaveMatchSetupDefaults?.({
              dealSpeed: vals.dealSpeed,
              allyBotDifficulty: vals.allyBotDifficulty,
              opponentBotDifficulty: vals.opponentBotDifficulty,
            });
            setShowSetupModal(false);
          }}
          onClose={() => setShowSetupModal(false)}
        />
      )}
    </div>
  );
};
