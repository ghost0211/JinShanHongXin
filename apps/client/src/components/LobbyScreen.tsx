import React, { useEffect, useState } from 'react';
import type { GameMode, RoomSummary, UserProfile } from '@jinshan/protocol';
import {
  isRunningInAndroidApk,
  type ConnectionStatus,
} from '../net/wsClient.js';
import type { MatchHistoryRow, SavedSession } from '../hooks/useGameClient.js';
import { TABLE_SKIN_OPTIONS, type TableSkin } from '../utils/settings.js';
import { AuthModal } from './AuthModal.js';
import { SuitGlyph } from './CardArt.js';

interface LobbyScreenProps {
  connStatus: ConnectionStatus;
  serverUrl: string;
  playerName: string;
  currentUser: UserProfile | null;
  savedSession: SavedSession | null;
  roomsList: RoomSummary[];
  historyList: MatchHistoryRow[];
  leaderboard: UserProfile[];
  tableSkin: TableSkin;
  onSetPlayerName: (name: string) => void;
  onLogin: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (
    username: string,
    password: string,
    inviteCode: string,
    nickname?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onUpdateNickname: (nickname: string) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
  onCreateRoom: (opts: {
    mode: GameMode;
    debugMode: boolean;
    fillBots: boolean;
    autoStart?: boolean;
  }) => void;
  onJoinRoom: (roomId: string) => void;
  onReconnectSaved: () => void;
  onFetchRooms: () => void;
  onFetchHistory: () => void;
  onFetchLeaderboard: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  connStatus,
  serverUrl,
  playerName,
  currentUser,
  savedSession,
  roomsList,
  historyList,
  leaderboard,
  tableSkin,
  onSetPlayerName,
  onLogin,
  onRegister,
  onUpdateNickname,
  onLogout,
  onCreateRoom,
  onJoinRoom,
  onReconnectSaved,
  onFetchRooms,
  onFetchHistory,
  onFetchLeaderboard,
  onOpenSettings,
  onOpenRules,
}) => {
  const [mode, setMode] = useState<GameMode>('hongxin');
  const [joinCode, setJoinCode] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);

  useEffect(() => {
    if (connStatus === 'connected') {
      onFetchRooms();
    }
  }, [connStatus, onFetchRooms]);

  const statusMeta =
    connStatus === 'connected'
      ? { text: '在线', dot: 'is-online', cls: 'pill-green' }
      : connStatus === 'connecting'
        ? { text: '连接中', dot: 'is-connecting', cls: 'pill-gold' }
        : { text: '未连接', dot: 'is-offline', cls: 'pill-red' };

  const skinLabel =
    TABLE_SKIN_OPTIONS.find((s) => s.id === tableSkin)?.label ?? '经典翡翠';

  const avatarChar = (currentUser?.nickname || playerName || '牌').trim().slice(0, 1);

  return (
    <div className="lobby-shell">
      <div className="lobby-bg-ornament" aria-hidden="true" />

      {/* Top Brand & Navigation Bar */}
      <header className="lobby-topbar">
        <div className="lobby-brand">
          <img
            src="./icon-192.png"
            alt="金山打红心"
            className="lobby-brand-icon"
          />
          <div className="lobby-brand-text">
            <div className="lobby-brand-title-row">
              <h1 className="lobby-title">金山打红心</h1>
              <span className={`pill lobby-conn-pill ${statusMeta.cls}`}>
                <span className={`conn-dot ${statusMeta.dot}`} />
                {statusMeta.text}
              </span>
            </div>
            <span className="lobby-brand-sub">
              海派三副牌 · 红心升级 &amp; 黑心叫分 · {skinLabel}
            </span>
          </div>
        </div>

        <div className="lobby-topbar-right">
          <button
            type="button"
            className={`lobby-user-chip ${currentUser ? 'is-authed' : ''}`}
            onClick={() => setShowAuthModal(true)}
            title={currentUser ? '点击管理账号或修改昵称' : '点击登录或邀请码注册'}
          >
            <span className="lobby-avatar">{avatarChar}</span>
            <span className="lobby-user-meta">
              <strong>{currentUser ? currentUser.nickname : playerName || '游客'}</strong>
              <small>
                {currentUser
                  ? `红心 ${currentUser.hongxinWins}/${currentUser.hongxinGames} · 黑心 ${currentUser.heixinTotalScore}分`
                  : '游客 · 点击登录'}
              </small>
            </span>
          </button>

          <nav className="lobby-nav-actions" aria-label="大厅功能">
            <button
              type="button"
              className="btn btn-xs lobby-nav-btn"
              onClick={() => {
                onFetchLeaderboard();
                setShowLeaderboardModal(true);
              }}
            >
              排行榜
            </button>
            <button
              type="button"
              className="btn btn-xs lobby-nav-btn"
              onClick={() => {
                onFetchHistory();
                setShowHistoryModal(true);
              }}
            >
              战绩
            </button>
            <button
              type="button"
              className="btn btn-xs lobby-nav-btn"
              onClick={onOpenRules}
            >
              规则
            </button>
            <button
              type="button"
              className="btn btn-xs btn-gold lobby-nav-btn"
              onClick={onOpenSettings}
            >
              ⚙ 设置
            </button>
          </nav>
        </div>
      </header>

      {/* Main Responsive Parlor Stage */}
      <main className="lobby-wrap">
        <div className="lobby-grid">
          {/* Left Hero Column: Mode Picker & Launch Controls */}
          <section className="card-panel lobby-hero-panel">
            {isRunningInAndroidApk() && connStatus !== 'connected' && (
              <div className="lobby-alert is-danger">
                <span>
                  未连上联机服务器（当前：{serverUrl || '127.0.0.1:3001'}），请前往设置填写主机地址
                </span>
                <button
                  type="button"
                  className="btn btn-gold btn-xs"
                  onClick={onOpenSettings}
                >
                  去设置
                </button>
              </div>
            )}

            {savedSession && (
              <div className="lobby-alert is-gold">
                <span>
                  检测到未结束牌局（房号 <strong>{savedSession.roomId}</strong>），可随时回到牌桌
                </span>
                <button
                  type="button"
                  className="btn btn-gold btn-xs"
                  onClick={onReconnectSaved}
                  disabled={connStatus !== 'connected'}
                >
                  断线重连
                </button>
              </div>
            )}

            <div className="lobby-section-label">
              <span>选择玩法模式</span>
              <span className="lobby-section-hint">三副牌 162 张 · 完整 510K 规则</span>
            </div>

            <div className="mode-tabs">
              <button
                type="button"
                className={`mode-card is-hongxin ${mode === 'hongxin' ? 'is-active' : ''}`}
                onClick={() => setMode('hongxin')}
              >
                <div className="mode-card-emblem is-red">
                  <span className="mode-card-rank">5</span>
                  <SuitGlyph suit="H" className="mode-card-suit" />
                </div>
                <div className="mode-card-body">
                  <div className="mode-card-head">
                    <h4>金山打红心</h4>
                    <span className="pill pill-red">2 打 2</span>
                  </div>
                  <p>2→A 升级 · 21 张比牌反主 · 120 及格 · 40/60 跳级</p>
                </div>
                {mode === 'hongxin' && <span className="mode-card-check">✓</span>}
              </button>

              <button
                type="button"
                className={`mode-card is-heixin ${mode === 'heixin' ? 'is-active' : ''}`}
                onClick={() => setMode('heixin')}
              >
                <div className="mode-card-emblem is-black">
                  <span className="mode-card-rank is-ten">10</span>
                  <SuitGlyph suit="S" className="mode-card-suit" />
                </div>
                <div className="mode-card-body">
                  <div className="mode-card-head">
                    <h4>金山打黑心</h4>
                    <span className="pill pill-gold">1 打 3</span>
                  </div>
                  <p>固定打 10 · 100~300 叫分抢庄 · 禁埋 10 · 零和积分</p>
                </div>
                {mode === 'heixin' && <span className="mode-card-check">✓</span>}
              </button>
            </div>

            {!currentUser && (
              <div className="lobby-guest-row">
                <label className="lobby-guest-label" htmlFor="guest-name-input">
                  游客昵称
                </label>
                <input
                  id="guest-name-input"
                  className="input-box"
                  value={playerName}
                  maxLength={12}
                  onChange={(e) => onSetPlayerName(e.target.value)}
                  placeholder="输入牌桌显示昵称"
                />
              </div>
            )}

            <div className="lobby-cta-grid">
              <button
                type="button"
                className="btn btn-gold btn-lg lobby-cta-primary"
                disabled={connStatus !== 'connected'}
                onClick={() =>
                  onCreateRoom({
                    mode,
                    debugMode: true,
                    fillBots: true,
                    autoStart: true,
                  })
                }
              >
                <span className="cta-main">✦ 快速单人开局</span>
                <span className="cta-sub">配 3 名智能机器人 · 支持上帝视角</span>
              </button>

              <button
                type="button"
                className="btn btn-emerald btn-lg lobby-cta-secondary"
                disabled={connStatus !== 'connected'}
                onClick={() =>
                  onCreateRoom({ mode, debugMode: false, fillBots: false })
                }
              >
                <span className="cta-main">创建好友房</span>
                <span className="cta-sub">生成 6 位房号 · 邀请牌友联机</span>
              </button>
            </div>

            <div className="lobby-join-bar">
              <input
                className="input-box lobby-join-input"
                value={joinCode}
                maxLength={6}
                inputMode="numeric"
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                placeholder="输入 6 位房间号直接加入..."
              />
              <button
                type="button"
                className="btn btn-gold"
                disabled={connStatus !== 'connected' || joinCode.length !== 6}
                onClick={() => onJoinRoom(joinCode)}
              >
                加入房间
              </button>
            </div>
          </section>

          {/* Right Column: Live Rooms Parlor */}
          <section className="card-panel lobby-rooms-panel">
            <div className="lobby-rooms-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong className="lobby-panel-title">在线牌桌</strong>
                <span className="pill">{roomsList.length} 桌</span>
              </div>
              <button type="button" className="btn btn-xs" onClick={onFetchRooms}>
                ↻ 刷新
              </button>
            </div>

            <div className="room-list">
              {roomsList.length === 0 ? (
                <div className="lobby-rooms-empty">
                  <div className="empty-cards-icon" aria-hidden="true">
                    <span className="empty-card c1">♠</span>
                    <span className="empty-card c2">♥</span>
                    <span className="empty-card c3">♦</span>
                  </div>
                  <strong>当前暂无等待中的牌桌</strong>
                  <p>点左侧「快速单人开局」随时练手，或「创建好友房」邀牌友同桌。</p>
                </div>
              ) : (
                roomsList.map((r) => {
                  const occupiedCount = r.seats.filter((s) => s.occupied).length;
                  const canJoin = r.status === 'WAITING' && connStatus === 'connected';
                  return (
                    <div key={r.roomId} className="room-list-item">
                      <div className="room-item-main">
                        <div className="room-item-title">
                          <span className="room-code-tag">#{r.roomId}</span>
                          <span className={`pill ${r.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}>
                            {r.mode === 'hongxin' ? '打红心' : '打黑心'}
                          </span>
                          <span className="room-status-text">
                            {r.status === 'WAITING'
                              ? '等待开局'
                              : r.status === 'IN_GAME'
                                ? '对局中'
                                : '已结束'}
                          </span>
                        </div>
                        <div className="room-seat-dots">
                          {r.seats.map((s) => (
                            <span
                              key={s.seat}
                              className={`seat-dot ${s.occupied ? (s.isBot ? 'is-bot' : 'is-human') : ''}`}
                              title={s.occupied ? s.name : '空位'}
                            />
                          ))}
                          <span className="room-seat-count">{occupiedCount}/4 座</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        disabled={!canJoin}
                        onClick={() => onJoinRoom(r.roomId)}
                      >
                        {r.status === 'WAITING' ? '入座' : '进行中'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>

      {showAuthModal && (
        <AuthModal
          currentUser={currentUser}
          onLogin={onLogin}
          onRegister={onRegister}
          onUpdateNickname={onUpdateNickname}
          onLogout={onLogout}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {showLeaderboardModal && (
        <div className="modal-backdrop" onClick={() => setShowLeaderboardModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>玩家战绩排行榜</h3>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setShowLeaderboardModal(false)}
              >
                关闭
              </button>
            </div>
            {leaderboard.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                暂无注册玩家上榜，快来注册账号打一局吧！
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leaderboard.map((u, idx) => (
                  <div key={u.id} className="room-list-item">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        #{idx + 1} {u.nickname}{' '}
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                          (@{u.username})
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        红心：{u.hongxinWins}胜/{u.hongxinGames}局 · 黑心：{u.heixinWins}胜/{u.heixinGames}局
                      </div>
                    </div>
                    <span className="pill pill-gold">黑心 {u.heixinTotalScore} 分</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="modal-backdrop" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>近期历史战绩</h3>
              <button type="button" className="btn btn-xs" onClick={() => setShowHistoryModal(false)}>
                关闭
              </button>
            </div>
            {historyList.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无历史对局记录。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {historyList.map((m) => (
                  <div key={m.id} className="room-list-item">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        房号 {m.roomId} · {m.mode === 'hongxin' ? '打红心' : '打黑心'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        已打 {m.rounds.length} 局 · {m.winnerSummary ?? m.status}
                      </div>
                    </div>
                    <span className="pill">{m.createdAt.slice(0, 16)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
