import React, { useEffect, useState } from 'react';
import type { GameMode, RoomSummary, UserProfile } from '@jinshan/protocol';
import type { DiscoveredLanHost } from '../net/androidLan.js';
import {
  isRunningInAndroidApk,
  type ConnectionStatus,
} from '../net/wsClient.js';
import type {
  LanRole,
  MatchHistoryRow,
  PlayMode,
  SavedSession,
} from '../hooks/useGameClient.js';
import type {
  LocalMatchHistoryRow,
  LocalStatsSummary,
} from '../utils/localHistory.js';
import { TABLE_SKIN_OPTIONS, type TableSkin } from '../utils/settings.js';
import { soundFX } from '../utils/sound.js';
import { AuthModal } from './AuthModal.js';
import { SuitGlyph } from './CardArt.js';

interface LobbyScreenProps {
  playMode: PlayMode;
  lanRole: LanRole;
  lanHostSupported: boolean;
  lanTargetUrl: string;
  discoveredLanHosts: DiscoveredLanHost[];
  localHistory: LocalMatchHistoryRow[];
  localStats: LocalStatsSummary;
  connStatus: ConnectionStatus;
  serverUrl: string;
  playerName: string;
  currentUser: UserProfile | null;
  savedSession: SavedSession | null;
  roomsList: RoomSummary[];
  historyList: MatchHistoryRow[];
  leaderboard: UserProfile[];
  tableSkin: TableSkin;
  onSetPlayMode: (mode: PlayMode) => void;
  onStartLanHost: (opts: { mode: GameMode; debugMode?: boolean }) => void;
  onJoinDiscoveredLanHost: (host: DiscoveredLanHost) => void;
  onConnectLanManual: (addr: string) => void;
  onDisconnectLanGuest: () => void;
  onClearLocalStats: () => void;
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
  playMode,
  lanRole,
  lanHostSupported,
  lanTargetUrl,
  discoveredLanHosts,
  localHistory,
  localStats,
  connStatus,
  serverUrl,
  playerName,
  currentUser,
  savedSession,
  roomsList,
  historyList,
  leaderboard,
  tableSkin,
  onSetPlayMode,
  onStartLanHost,
  onJoinDiscoveredLanHost,
  onConnectLanManual,
  onDisconnectLanGuest,
  onClearLocalStats,
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
  const [offlineDebugMode, setOfflineDebugMode] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [lanIpInput, setLanIpInput] = useState(() =>
    lanTargetUrl.replace(/^https?:\/\//i, ''),
  );
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);

  useEffect(() => {
    if (lanTargetUrl) {
      setLanIpInput(lanTargetUrl.replace(/^https?:\/\//i, ''));
    }
  }, [lanTargetUrl]);

  useEffect(() => {
    if (
      connStatus === 'connected' &&
      (playMode === 'online' || (playMode === 'lan' && lanRole === 'guest'))
    ) {
      onFetchRooms();
    }
  }, [connStatus, playMode, lanRole, onFetchRooms]);

  const statusMeta =
    playMode === 'offline'
      ? { text: '纯离线就绪', dot: 'is-online', cls: 'pill-green' }
      : playMode === 'lan'
        ? lanRole === 'guest'
          ? connStatus === 'connected'
            ? { text: '已连局域网房主', dot: 'is-online', cls: 'pill-green' }
            : connStatus === 'connecting'
              ? { text: '连接房主中', dot: 'is-connecting', cls: 'pill-gold' }
              : { text: '房主未响应', dot: 'is-offline', cls: 'pill-red' }
          : { text: '局域网离线', dot: 'is-online', cls: 'pill-gold' }
        : connStatus === 'connected'
          ? { text: '在线', dot: 'is-online', cls: 'pill-green' }
          : connStatus === 'connecting'
            ? { text: '连接中', dot: 'is-connecting', cls: 'pill-gold' }
            : { text: '未连接', dot: 'is-offline', cls: 'pill-red' };

  const skinLabel =
    TABLE_SKIN_OPTIONS.find((s) => s.id === tableSkin)?.label ?? '经典翡翠';

  const displayNick =
    playMode === 'online' && currentUser
      ? currentUser.nickname
      : playerName || '金山牌友';
  const avatarChar = displayNick.trim().slice(0, 1) || '牌';

  const switchPlayMode = (next: PlayMode) => {
    soundFX.playTap();
    onSetPlayMode(next);
  };

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
          {playMode === 'online' ? (
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
          ) : (
            <div className="lobby-user-chip is-local-only">
              <span className="lobby-avatar">{avatarChar}</span>
              <span className="lobby-user-meta">
                <strong>{displayNick}</strong>
                <small>
                  {playMode === 'offline'
                    ? `本机战绩 ${localStats.hongxinWins + localStats.heixinWins} 胜 · 纯离线`
                    : '局域网面联 · 免登录'}
                </small>
              </span>
            </div>
          )}

          <nav className="lobby-nav-actions" aria-label="大厅功能">
            {playMode === 'online' && (
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
            )}
            <button
              type="button"
              className="btn btn-xs lobby-nav-btn"
              onClick={() => {
                onFetchHistory();
                setShowHistoryModal(true);
              }}
            >
              {playMode === 'online' ? '战绩' : '本机战绩'}
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
        <div className="lobby-stage">
          {/* Left Vertical Play-Mode Tab Rail */}
          <aside className="play-mode-rail" role="tablist" aria-label="联网模式切换">
            <button
              type="button"
              role="tab"
              aria-selected={playMode === 'offline'}
              className={`play-mode-tab ${playMode === 'offline' ? 'is-active' : ''}`}
              onClick={() => switchPlayMode('offline')}
            >
              <span className="play-mode-icon">🤖</span>
              <span className="play-mode-copy">
                <strong>单机人机</strong>
                <small>纯离线</small>
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={playMode === 'lan'}
              className={`play-mode-tab ${playMode === 'lan' ? 'is-active' : ''}`}
              onClick={() => switchPlayMode('lan')}
            >
              <span className="play-mode-icon">📡</span>
              <span className="play-mode-copy">
                <strong>局域网</strong>
                <small>同网直连</small>
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={playMode === 'online'}
              className={`play-mode-tab ${playMode === 'online' ? 'is-active' : ''}`}
              onClick={() => switchPlayMode('online')}
            >
              <span className="play-mode-icon">🌐</span>
              <span className="play-mode-copy">
                <strong>在线联机</strong>
                <small>服务器</small>
              </span>
            </button>
          </aside>

          <div className="lobby-grid">
          {/* Left Hero Column: Mode Picker & Launch Controls */}
          <section className="card-panel lobby-hero-panel">
            <div className="lobby-hero-top">
              {playMode === 'offline' && (
                <div className="lobby-mode-banner is-offline">
                  <div className="lobby-mode-banner-text">
                    <strong>单机人机模式 · 纯离线运行</strong>
                    <span>本地 Web Worker + 蒙特卡洛高智商 AI，无网或飞行模式秒开畅玩</span>
                  </div>
                  <span className="pill pill-green">0 延迟</span>
                </div>
              )}

              {playMode === 'lan' && (
                <div className="lobby-mode-banner is-lan">
                  <div className="lobby-mode-banner-text">
                    <strong>局域网面联 · 同 Wi-Fi / 热点直连</strong>
                    <span>房主开房自动生成离线二维码与 UDP 广播，好友扫码免装包入座</span>
                  </div>
                  <span className="pill pill-gold">免服务器</span>
                </div>
              )}

              {playMode === 'online' &&
                isRunningInAndroidApk() &&
                connStatus !== 'connected' && (
                  <div className="lobby-alert is-danger">
                    <span>
                      未连上在线服务器（{serverUrl || '127.0.0.1:3001'}），可切至「单机人机 / 局域网」直接玩，或在设置中配置主机地址
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

              {playMode === 'online' && connStatus === 'connected' && !savedSession && (
                <div className="lobby-mode-banner is-online">
                  <div className="lobby-mode-banner-text">
                    <strong>在线联机大厅 · 服务器已连接</strong>
                    <span>支持注册账号累计战绩、排行榜比拼与 6 位房号跨网邀友</span>
                  </div>
                  <span className="pill pill-green">在线</span>
                </div>
              )}

              {playMode === 'online' && savedSession && (
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
                <span>选择玩法规则</span>
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

              {(playMode !== 'online' || !currentUser) && (
                <div className="lobby-guest-row">
                  <label className="lobby-guest-label" htmlFor="guest-name-input">
                    {playMode === 'online' ? '游客昵称' : '本机昵称'}
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
            </div>

            {/* Bottom-anchored Mode-specific Actions */}
            <div className="lobby-hero-bottom">
              {playMode === 'offline' && (
                <>
                  <div className="offline-quick-opts">
                    <label className="offline-opt-toggle">
                      <input
                        type="checkbox"
                        checked={offlineDebugMode}
                        onChange={(e) => setOfflineDebugMode(e.target.checked)}
                      />
                      <span>允许对局中开启「上帝视角」看各家手牌</span>
                    </label>
                    <span className="pill">自动记录本机战绩</span>
                  </div>

                  <div className="lobby-cta-grid">
                    <button
                      type="button"
                      className="btn btn-gold btn-lg lobby-cta-primary"
                      disabled={connStatus !== 'connected'}
                      onClick={() =>
                        onCreateRoom({
                          mode,
                          debugMode: offlineDebugMode,
                          fillBots: true,
                          autoStart: true,
                        })
                      }
                    >
                      <span className="cta-main">✦ 立即单机开局</span>
                      <span className="cta-sub">配 3 名本地智能 AI · 秒开一局</span>
                    </button>

                    <button
                      type="button"
                      className="btn btn-emerald btn-lg lobby-cta-secondary"
                      disabled={connStatus !== 'connected'}
                      onClick={() =>
                        onCreateRoom({
                          mode,
                          debugMode: offlineDebugMode,
                          fillBots: true,
                          autoStart: false,
                        })
                      }
                    >
                      <span className="cta-main">进入候客室选座</span>
                      <span className="cta-sub">拟真牌桌自由换座后再开局</span>
                    </button>
                  </div>
                </>
              )}

              {playMode === 'lan' && (
                <>
                  <div className="lobby-cta-grid lobby-cta-single">
                    {lanHostSupported ? (
                      <button
                        type="button"
                        className="btn btn-gold btn-lg lobby-cta-primary lobby-cta-full"
                        onClick={() => onStartLanHost({ mode, debugMode: false })}
                      >
                        <span className="cta-main">📡 创建局域网房间（我当房主）</span>
                        <span className="cta-sub">
                          生成离线二维码 + UDP 自动广播 · 支持 iPhone/安卓扫码免装包加入 · 缺人随时补机器人
                        </span>
                      </button>
                    ) : (
                      <div className="lan-browser-hint">
                        <strong>浏览器端可作为客机加入局域网牌桌</strong>
                        <span>
                          受浏览器安全限制，仅安卓 APK 可作为局域网房主；请在下方输入安卓房主屏幕显示的 IP 地址，或直接扫码加入。
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="lobby-join-bar">
                    <input
                      className="input-box lobby-join-input"
                      value={lanIpInput}
                      onChange={(e) => setLanIpInput(e.target.value)}
                      placeholder="手动输入房主 IP（如 192.168.43.1:3001）..."
                    />
                    {lanRole === 'guest' ? (
                      <button
                        type="button"
                        className="btn btn-crimson"
                        onClick={onDisconnectLanGuest}
                      >
                        断开主机
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-emerald"
                        disabled={!lanIpInput.trim()}
                        onClick={() => onConnectLanManual(lanIpInput)}
                      >
                        连接主机
                      </button>
                    )}
                  </div>

                  {lanRole === 'guest' && connStatus === 'connected' && (
                    <div className="lobby-join-bar">
                      <input
                        className="input-box lobby-join-input"
                        value={joinCode}
                        maxLength={6}
                        inputMode="numeric"
                        onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="或输入 6 位房号直接入座..."
                      />
                      <button
                        type="button"
                        className="btn btn-gold"
                        disabled={joinCode.length !== 6}
                        onClick={() => onJoinRoom(joinCode)}
                      >
                        加入房间
                      </button>
                    </div>
                  )}
                </>
              )}

              {playMode === 'online' && (
                <>
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
                </>
              )}
            </div>
          </section>

          {/* Right Column: Mode-Specific Parlor Panel */}
          {playMode === 'offline' && (
            <section className="card-panel lobby-rooms-panel">
              <div className="lobby-rooms-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong className="lobby-panel-title">本机离线战绩</strong>
                  <span className="pill pill-green">{localStats.totalMatches} 场</span>
                </div>
                {localHistory.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={onClearLocalStats}
                  >
                    清空
                  </button>
                )}
              </div>

              <div className="local-stats-grid">
                <div className="local-stat-tile">
                  <span className="local-stat-label">红心胜场</span>
                  <strong className="local-stat-val">
                    {localStats.hongxinWins} / {localStats.hongxinRounds}
                  </strong>
                </div>
                <div className="local-stat-tile">
                  <span className="local-stat-label">黑心胜场</span>
                  <strong className="local-stat-val">
                    {localStats.heixinWins} / {localStats.heixinRounds}
                  </strong>
                </div>
                <div className="local-stat-tile">
                  <span className="local-stat-label">黑心净分</span>
                  <strong className="local-stat-val">
                    {localStats.heixinTotalScore >= 0 ? '+' : ''}
                    {localStats.heixinTotalScore}
                  </strong>
                </div>
              </div>

              <div className="room-list">
                {localHistory.length === 0 ? (
                  <div className="lobby-rooms-empty">
                    <div className="empty-cards-icon" aria-hidden="true">
                      <span className="empty-card c1">♠</span>
                      <span className="empty-card c2">♥</span>
                      <span className="empty-card c3">♦</span>
                    </div>
                    <strong>本地 AI 引擎已就绪</strong>
                    <p>
                      无需服务器与互联网，所有规则与蒙特卡洛机器人均在设备本地 Web Worker 中流畅运行。
                    </p>
                  </div>
                ) : (
                  localHistory.slice(0, 8).map((m) => {
                    const winCount = m.rounds.filter((r) => r.myWon).length;
                    return (
                      <div key={m.id} className="room-list-item">
                        <div className="room-item-main">
                          <div className="room-item-title">
                            <span
                              className={`pill ${m.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                            >
                              {m.mode === 'hongxin' ? '打红心' : '打黑心'}
                            </span>
                            <span className="room-status-text">
                              {m.rounds.length} 局 · 胜 {winCount} 局
                            </span>
                          </div>
                          <div className="room-seat-count">
                            {m.winnerSummary ?? '已存档'} · {m.createdAt.slice(5, 16)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {playMode === 'lan' && (
            <section className="card-panel lobby-rooms-panel">
              <div className="lobby-rooms-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong className="lobby-panel-title">
                    {lanRole === 'guest' ? '房主当前牌桌' : '附近局域网房间'}
                  </strong>
                  <span className="pill">
                    {lanRole === 'guest'
                      ? `${roomsList.length} 桌`
                      : `${discoveredLanHosts.length} 个主机`}
                  </span>
                </div>
                {lanRole === 'guest' && (
                  <button type="button" className="btn btn-xs" onClick={onFetchRooms}>
                    ↻ 刷新
                  </button>
                )}
              </div>

              <div className="room-list">
                {lanRole === 'guest' ? (
                  roomsList.length === 0 ? (
                    <div className="lobby-rooms-empty">
                      <strong>
                        {connStatus === 'connected'
                          ? '房主尚未建立等待中的牌桌'
                          : '正在连接局域网房主...'}
                      </strong>
                      <p>
                        当前目标：{lanTargetUrl || window.location.host}。请确认与房主在同一 Wi-Fi 或同一手机热点下。
                      </p>
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
                              <span
                                className={`pill ${r.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                              >
                                {r.mode === 'hongxin' ? '打红心' : '打黑心'}
                              </span>
                              <span className="room-status-text">
                                {r.status === 'WAITING' ? '等待开局' : '对局中'}
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
                  )
                ) : discoveredLanHosts.length === 0 ? (
                  <div className="lobby-rooms-empty">
                    <div className="empty-cards-icon" aria-hidden="true">
                      <span className="empty-card c1">📡</span>
                      <span className="empty-card c2">♥</span>
                      <span className="empty-card c3">♠</span>
                    </div>
                    <strong>
                      {lanHostSupported
                        ? '正在自动扫描附近局域网牌桌...'
                        : '扫码或输入房主 IP 即可加入'}
                    </strong>
                    <div className="lan-guide-steps">
                      <span>1. 所有手机连同一 Wi-Fi，或由房主开启个人热点</span>
                      <span>2. 房主点左侧「创建局域网房间」，其他安卓端此处自动出现</span>
                      <span>3. iPhone / 电脑直接扫码房主二维码，无需安装 App</span>
                    </div>
                  </div>
                ) : (
                  discoveredLanHosts.map((host) => (
                    <div key={`${host.ip}:${host.port}`} className="room-list-item lan-host-item">
                      <div className="room-item-main">
                        <div className="room-item-title">
                          <span className="room-code-tag">{host.hostName}</span>
                          <span
                            className={`pill ${host.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                          >
                            {host.mode === 'hongxin' ? '打红心' : '打黑心'}
                          </span>
                          <span className="room-status-text">
                            {host.status === 'WAITING' ? '等待入座' : '对局中'}
                          </span>
                        </div>
                        <div className="room-seat-count">
                          {host.ip}:{host.port}
                          {host.roomId ? ` · #${host.roomId}` : ''} · {host.occupied}/
                          {host.maxSeats} 座
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-xs btn-gold"
                        disabled={host.status !== 'WAITING'}
                        onClick={() => onJoinDiscoveredLanHost(host)}
                      >
                        {host.status === 'WAITING' ? '一键加入' : '进行中'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {playMode === 'online' && (
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
                            <span
                              className={`pill ${r.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                            >
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
          )}
          </div>
        </div>
      </main>

      {showAuthModal && playMode === 'online' && (
        <AuthModal
          currentUser={currentUser}
          onLogin={onLogin}
          onRegister={onRegister}
          onUpdateNickname={onUpdateNickname}
          onLogout={onLogout}
          onClose={() => setShowAuthModal(false)}
        />
      )}

      {showLeaderboardModal && playMode === 'online' && (
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
              <h3>{playMode === 'online' ? '近期历史战绩' : '本机离线历史战绩'}</h3>
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
