import React, { useEffect, useState } from 'react';
import type {
  BotDifficulty,
  DealSpeed,
  GameMode,
  RoomSummary,
  UserProfile,
} from '@jinshan/protocol';
import type { DiscoveredLanHost } from '../net/androidLan.js';
import {
  isRunningInNativeShell,
  isRunningInTauriDesktop,
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
import {
  BOT_DIFFICULTY_OPTIONS,
  DEAL_SPEED_OPTIONS,
  TABLE_SKIN_OPTIONS,
  type TableSkin,
} from '../utils/settings.js';
import { soundFX } from '../utils/sound.js';
import { AuthModal } from './AuthModal.js';
import { SuitGlyph } from './CardArt.js';
import { Icon } from './Icons.js';
import { MatchSetupModal, type MatchSetupValues } from './MatchSetupModal.js';

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
  defaultMatchSetup: {
    dealSpeed: DealSpeed;
    allyBotDifficulty: BotDifficulty;
    opponentBotDifficulty: BotDifficulty;
  };
  onSaveMatchSetupDefaults: (patch: {
    dealSpeed: DealSpeed;
    allyBotDifficulty: BotDifficulty;
    opponentBotDifficulty: BotDifficulty;
  }) => void;
  onSetPlayMode: (mode: PlayMode) => void;
  onStartLanHost: (opts: {
    mode: GameMode;
    debugMode?: boolean;
    allyBotDifficulty?: BotDifficulty;
    opponentBotDifficulty?: BotDifficulty;
    dealSpeed?: DealSpeed;
  }) => void;
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
    allyBotDifficulty?: BotDifficulty;
    opponentBotDifficulty?: BotDifficulty;
    dealSpeed?: DealSpeed;
  }) => void;
  onJoinRoom: (roomId: string) => void;
  onReconnectSaved: () => void;
  onFetchRooms: () => void;
  onFetchHistory: () => void;
  onFetchLeaderboard: () => void;
  onOpenSettings: () => void;
  onOpenRules: () => void;
}

/** 民俗风空状态小插画：三张扇形牌 + 海浪 + 太阳花 / 信号波 */
const LobbyEmptyArt: React.FC<{ variant?: 'cards' | 'lan' }> = ({ variant = 'cards' }) => (
  <svg className="lobby-empty-art" viewBox="0 0 160 96" aria-hidden="true">
    {variant === 'lan' ? (
      <g className="lea-arc" fill="none" strokeWidth="2.2" strokeLinecap="round">
        <path d="M58 22a32 32 0 0 1 44 0" />
        <path d="M66 30a20 20 0 0 1 28 0" />
        <path d="M73.5 37.5a9 9 0 0 1 13 0" />
      </g>
    ) : (
      <g className="lea-sun">
        <circle cx="122" cy="20" r="7" />
        <g className="lea-petal">
          <ellipse cx="122" cy="8" rx="3" ry="4.5" />
          <ellipse cx="122" cy="32" rx="3" ry="4.5" />
          <ellipse cx="110" cy="20" rx="4.5" ry="3" />
          <ellipse cx="134" cy="20" rx="4.5" ry="3" />
        </g>
        <circle className="lea-sun-core" cx="122" cy="20" r="3.4" />
      </g>
    )}
    <g transform="translate(80 58)">
      <g transform="rotate(-18) translate(-17 -30)">
        <rect className="lea-card" width="34" height="46" rx="4" />
        <path
          className="lea-black"
          transform="translate(9 12) scale(0.68)"
          d="M12 2.2C9.1 5.9 3.6 10.3 3.6 14.3c0 2.7 2.1 4.6 4.5 4.6 1.5 0 2.7-.7 3.4-1.8-.2 1.8-.9 3.4-2.4 4.7h5.8c-1.5-1.3-2.2-2.9-2.4-4.7.7 1.1 1.9 1.8 3.4 1.8 2.4 0 4.5-1.9 4.5-4.6 0-4-5.5-8.4-8.4-12.1z"
        />
      </g>
      <g transform="rotate(16) translate(-17 -30)">
        <rect className="lea-card" width="34" height="46" rx="4" />
        <path
          className="lea-red"
          transform="translate(9 12) scale(0.68)"
          d="M12 2.2c2.2 3.8 5.2 6.8 8.6 9.8-3.4 3-6.4 6-8.6 9.8-2.2-3.8-5.2-6.8-8.6-9.8 3.4-3 6.4-6 8.6-9.8z"
        />
      </g>
      <g transform="translate(-17 -34)">
        <rect className="lea-card" width="34" height="46" rx="4" />
        <path
          className="lea-red"
          transform="translate(8 11) scale(0.75)"
          d="M12 21.4C10.9 20.4 3.2 14.3 3.2 8.9 3.2 5.7 5.6 3.4 8.5 3.4c1.6 0 2.9.8 3.5 2.1.6-1.3 1.9-2.1 3.5-2.1 2.9 0 5.3 2.3 5.3 5.5 0 5.4-7.7 11.5-8.8 12.5z"
        />
      </g>
    </g>
    <g className="lea-wave" fill="none" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 88c8-9 16-9 24 0s16 9 24 0 16-9 24 0 16 9 24 0 16-9 24 0 16 9 24 0" />
      <path d="M20 94c6-6 12-6 18 0M56 94c6-6 12-6 18 0M92 94c6-6 12-6 18 0M128 94c6-6 12-6 18 0" />
    </g>
  </svg>
);

const SeatDots: React.FC<{ room: RoomSummary }> = ({ room }) => {
  const occupiedCount = room.seats.filter((s) => s.occupied).length;
  return (
    <div className="room-seat-dots">
      {room.seats.map((s) => (
        <span
          key={s.seat}
          className={`seat-dot ${s.occupied ? (s.isBot ? 'is-bot' : 'is-human') : ''}`}
          title={s.occupied ? s.name : '空位'}
        />
      ))}
      <span className="room-seat-count">{occupiedCount}/4 座</span>
    </div>
  );
};

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
  defaultMatchSetup,
  onSaveMatchSetupDefaults,
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
  const [pendingSetup, setPendingSetup] = useState<{
    kind: 'offline-quick' | 'offline-waiting' | 'lan-host' | 'online-quick' | 'online-room';
    title: string;
    subtitle: string;
    confirmLabel: string;
    defaultDebug: boolean;
  } | null>(null);

  useEffect(() => {
    const anyModal =
      showAuthModal ||
      showHistoryModal ||
      showLeaderboardModal ||
      pendingSetup !== null;
    if (!anyModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAuthModal(false);
        setShowHistoryModal(false);
        setShowLeaderboardModal(false);
        setPendingSetup(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAuthModal, showHistoryModal, showLeaderboardModal, pendingSetup]);

  const openSetupModal = (
    kind: 'offline-quick' | 'offline-waiting' | 'lan-host' | 'online-quick' | 'online-room',
  ) => {
    soundFX.playTap();
    if (kind === 'offline-quick') {
      setPendingSetup({
        kind,
        title: '单机人机 · 本局参数',
        subtitle: '确认发牌速度与队友/对手机器人强度后立即开局',
        confirmLabel: '开始对局',
        defaultDebug: offlineDebugMode,
      });
    } else if (kind === 'offline-waiting') {
      setPendingSetup({
        kind,
        title: '单机候客室 · 本局参数',
        subtitle: '先设置本局参数，进入候客室后可自由换座再开局',
        confirmLabel: '进入候客室',
        defaultDebug: offlineDebugMode,
      });
    } else if (kind === 'lan-host') {
      setPendingSetup({
        kind,
        title: '创建局域网房间 · 本局参数',
        subtitle: '房间参数对所有扫码/直连加入的牌友共同生效，候客室内仍可随时调整',
        confirmLabel: '创建局域网房间',
        defaultDebug: false,
      });
    } else if (kind === 'online-quick') {
      setPendingSetup({
        kind,
        title: '在线人机开局 · 本局参数',
        subtitle: '确认发牌速度与机器人难度后立即配齐 3 名 AI 开局',
        confirmLabel: '开始对局',
        defaultDebug: true,
      });
    } else {
      setPendingSetup({
        kind,
        title: '创建好友房 · 本局参数',
        subtitle: '由房主统一设定本房间发牌速度与补位机器人强度，所有玩家共享',
        confirmLabel: '创建房间',
        defaultDebug: false,
      });
    }
  };

  const handleConfirmMatchSetup = (values: MatchSetupValues) => {
    const req = pendingSetup;
    setPendingSetup(null);
    if (!req) return;
    setMode(values.mode);
    if (req.kind === 'offline-quick' || req.kind === 'offline-waiting') {
      setOfflineDebugMode(values.debugMode);
    }
    onSaveMatchSetupDefaults({
      dealSpeed: values.dealSpeed,
      allyBotDifficulty: values.allyBotDifficulty,
      opponentBotDifficulty: values.opponentBotDifficulty,
    });
    if (req.kind === 'lan-host') {
      onStartLanHost({
        mode: values.mode,
        debugMode: values.debugMode,
        allyBotDifficulty: values.allyBotDifficulty,
        opponentBotDifficulty: values.opponentBotDifficulty,
        dealSpeed: values.dealSpeed,
      });
      return;
    }
    onCreateRoom({
      mode: values.mode,
      debugMode: values.debugMode,
      fillBots: req.kind !== 'online-room',
      autoStart: req.kind === 'offline-quick' || req.kind === 'online-quick',
      allyBotDifficulty: values.allyBotDifficulty,
      opponentBotDifficulty: values.opponentBotDifficulty,
      dealSpeed: values.dealSpeed,
    });
  };

  const dealSpeedLabel =
    DEAL_SPEED_OPTIONS.find((d) => d.id === defaultMatchSetup.dealSpeed)?.label ?? '极速';
  const allyDiffLabel =
    BOT_DIFFICULTY_OPTIONS.find((d) => d.id === defaultMatchSetup.allyBotDifficulty)?.label ?? '强';
  const oppDiffLabel =
    BOT_DIFFICULTY_OPTIONS.find((d) => d.id === defaultMatchSetup.opponentBotDifficulty)?.label ?? '强';

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

  const statusMeta: { text: string; dot: 'is-online' | 'is-connecting' | 'is-offline' | 'is-idle' } =
    playMode === 'offline'
      ? { text: '纯离线就绪', dot: 'is-online' }
      : playMode === 'lan'
        ? lanRole === 'guest'
          ? connStatus === 'connected'
            ? { text: '已连局域网房主', dot: 'is-online' }
            : connStatus === 'connecting'
              ? { text: '连接房主中', dot: 'is-connecting' }
              : { text: '房主未响应', dot: 'is-offline' }
          : { text: '局域网离线', dot: 'is-idle' }
        : connStatus === 'connected'
          ? { text: '在线', dot: 'is-online' }
          : connStatus === 'connecting'
            ? { text: '连接中', dot: 'is-connecting' }
            : { text: '未连接', dot: 'is-offline' };

  const skinLabel =
    TABLE_SKIN_OPTIONS.find((s) => s.id === tableSkin)?.label ?? TABLE_SKIN_OPTIONS[0].label;

  const displayNick =
    playMode === 'online' && currentUser
      ? currentUser.nickname
      : playerName || '金山牌友';
  const avatarChar = displayNick.trim().slice(0, 1) || '牌';

  const switchPlayMode = (next: PlayMode) => {
    soundFX.playTap();
    onSetPlayMode(next);
  };

  const modeLabel = (m: GameMode) => (m === 'hongxin' ? '打红心' : '打黑心');

  const renderModeCard = (m: GameMode) => {
    const isRed = m === 'hongxin';
    const active = mode === m;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className={`mode-card ${isRed ? 'is-hongxin' : 'is-heixin'} ${active ? 'is-active' : ''}`}
        onClick={() => setMode(m)}
      >
        <span className="mode-card-wave" aria-hidden="true" />
        <span className="mode-card-watermark" aria-hidden="true">
          <SuitGlyph suit={isRed ? 'H' : 'S'} className="mode-card-watermark-svg" />
        </span>
        <span className="mode-card-fan" aria-hidden="true">
          <span className="mode-card-fan-back" />
          <span className="mode-card-emblem">
            <span className={`mode-card-rank ${isRed ? '' : 'is-ten'}`}>{isRed ? '5' : '10'}</span>
            <SuitGlyph suit={isRed ? 'H' : 'S'} className="mode-card-suit" />
          </span>
        </span>
        <span className="mode-card-body">
          <span className="mode-card-title-row">
            <span className="mode-card-title">{isRed ? '金山打红心' : '金山打黑心'}</span>
          </span>
          <span className="mode-card-meta">
            <span className="mode-vs-badge">{isRed ? '2V2' : '1V3'}</span>
            <span className="mode-card-desc">{isRed ? '对家同队 · 升级' : '叫分抢庄 · 独斗'}</span>
          </span>
        </span>
        {active && (
          <span className="mode-card-check seal is-gold" aria-hidden="true">
            选
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="lobby-shell">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="lobby-topbar">
        <div className="lobby-brand">
          <span className="lobby-seal" aria-hidden="true">
            <span>金山</span>
            <span>红心</span>
          </span>
          <div className="lobby-brand-text">
            <div className="lobby-brand-title-row">
              <h1 className="lobby-title">金山打红心</h1>
              <span className={`lobby-conn ${statusMeta.dot}`}>
                <i className="lobby-conn-dot" />
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
              className={`lobby-user-chip ${currentUser ? 'is-authed' : 'is-guest'}`}
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
                    ? `本机 ${localStats.hongxinWins + localStats.heixinWins} 胜 · 纯离线`
                    : '局域网面联 · 免登录'}
                </small>
              </span>
            </div>
          )}

          <nav className="lobby-nav-actions" aria-label="大厅功能">
            {playMode === 'online' && (
              <button
                type="button"
                className="lobby-nav-btn"
                onClick={() => {
                  onFetchLeaderboard();
                  setShowLeaderboardModal(true);
                }}
              >
                <Icon name="trophy" />
                <span>排行榜</span>
              </button>
            )}
            <button
              type="button"
              className="lobby-nav-btn"
              onClick={() => {
                onFetchHistory();
                setShowHistoryModal(true);
              }}
            >
              <Icon name="scroll" />
              <span>{playMode === 'online' ? '战绩' : '本机战绩'}</span>
            </button>
            <button type="button" className="lobby-nav-btn" onClick={onOpenRules}>
              <Icon name="book" />
              <span>规则</span>
            </button>
            <button
              type="button"
              className="lobby-nav-btn is-gold"
              onClick={onOpenSettings}
              title="游戏设置与 PC 快捷键 (F1)"
            >
              <Icon name="gear" />
              <span>设置</span>
              <kbd className="btn-kbd">F1</kbd>
            </button>
          </nav>
        </div>
      </header>

      {/* ── Main stage ──────────────────────────────────────────── */}
      <main className="lobby-wrap">
        <div className="lobby-stage">
          {/* Bookmark-style vertical play-mode tabs */}
          <aside className="lobby-rail" role="tablist" aria-label="联网模式切换">
            {(
              [
                { id: 'offline', icon: 'robot', label: '单机人机', sub: '纯离线' },
                { id: 'lan', icon: 'wifi', label: '局域网', sub: '同网直连' },
                { id: 'online', icon: 'globe', label: '在线联机', sub: '服务器' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={playMode === t.id}
                className={`lobby-rail-tab ${playMode === t.id ? 'is-active' : ''}`}
                onClick={() => switchPlayMode(t.id)}
              >
                <Icon name={t.icon} className="lobby-rail-icon" />
                <span className="lobby-rail-copy">
                  <strong>{t.label}</strong>
                  <small>{t.sub}</small>
                </span>
              </button>
            ))}
          </aside>

          <div className="lobby-grid">
            {/* ── Hero: mode picker & launch ─────────────────────── */}
            <section className="card-panel lobby-hero-panel">
              <div className="lobby-hero-top">
                {playMode === 'offline' && (
                  <div className="lobby-mode-banner is-offline">
                    <div className="lobby-mode-banner-text">
                      <strong>单机人机 · 纯离线运行</strong>
                      <span>本地 AI 引擎，无网或飞行模式也能秒开</span>
                    </div>
                    <span className="pill pill-green">0 延迟</span>
                  </div>
                )}

                {playMode === 'lan' && (
                  <div className="lobby-mode-banner is-lan">
                    <div className="lobby-mode-banner-text">
                      <strong>局域网面联 · 同 Wi-Fi / 热点直连</strong>
                      <span>房主开房生成二维码并广播，好友扫码免装包入座</span>
                    </div>
                    <span className="pill pill-gold">免服务器</span>
                  </div>
                )}

                {playMode === 'online' &&
                  isRunningInNativeShell() &&
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
                      <span>注册账号累计战绩、排行榜比拼，6 位房号跨网邀友</span>
                    </div>
                    <span className="pill pill-green">在线</span>
                  </div>
                )}

                {playMode === 'online' && connStatus !== 'connected' && !isRunningInNativeShell() && !savedSession && (
                  <div className="lobby-mode-banner is-online is-pending">
                    <div className="lobby-mode-banner-text">
                      <strong>在线联机大厅</strong>
                      <span>
                        {connStatus === 'connecting' ? '正在连接服务器…' : '服务器暂未连接，可在设置中配置地址'}
                      </span>
                    </div>
                    <span className={`pill ${connStatus === 'connecting' ? 'pill-gold' : 'pill-red'}`}>
                      {connStatus === 'connecting' ? '连接中' : '未连接'}
                    </span>
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
                  <span>选择玩法</span>
                  <span className="lobby-section-hint">三副牌 162 张 · 完整 510K 规则</span>
                </div>

                <div className="mode-tabs" role="radiogroup" aria-label="玩法">
                  {renderModeCard('hongxin')}
                  {renderModeCard('heixin')}
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

              {/* Mode-specific actions, anchored at the bottom */}
              <div className="lobby-hero-bottom">
                {playMode === 'offline' && (
                  <>
                    <div className="offline-quick-opts">
                      <span className="offline-opt-text">
                        上次配置：发牌 <strong>{dealSpeedLabel}</strong> · 队友AI{' '}
                        <strong>{allyDiffLabel}</strong> · 对手AI <strong>{oppDiffLabel}</strong>
                      </span>
                      <span className="pill offline-opt-pill">自动记录本机战绩</span>
                    </div>

                    <div className="lobby-cta-grid">
                      <button
                        type="button"
                        className="btn btn-gold btn-lg lobby-cta-primary"
                        disabled={connStatus !== 'connected'}
                        onClick={() => openSetupModal('offline-quick')}
                      >
                        <span className="cta-main">
                          <Icon name="play" className="cta-icon" />
                          开始人机对战
                        </span>
                        <span className="cta-sub">确认本局参数 · {modeLabel(mode)}秒开</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-lg lobby-cta-secondary"
                        disabled={connStatus !== 'connected'}
                        onClick={() => openSetupModal('offline-waiting')}
                      >
                        <span className="cta-main">
                          <Icon name="users" className="cta-icon" />
                          进入候客室选座
                        </span>
                        <span className="cta-sub">先换座位再开局</span>
                      </button>
                    </div>
                  </>
                )}

                {playMode === 'lan' && (
                  <>
                    {lanHostSupported ? (
                      <div className="lobby-cta-grid lobby-cta-single">
                        <button
                          type="button"
                          className="btn btn-gold btn-lg lobby-cta-primary lobby-cta-full"
                          onClick={() => openSetupModal('lan-host')}
                        >
                          <span className="cta-main">
                            <Icon name="wifi" className="cta-icon" />
                            创建局域网房间（我当房主）
                          </span>
                          <span className="cta-sub">
                            设定本局参数 + 生成二维码广播 · 缺人补机器人
                          </span>
                        </button>
                      </div>
                    ) : (
                      <div className="lan-browser-hint">
                        <Icon name="wifi" className="lan-browser-hint-icon" />
                        <div>
                          <strong>浏览器端可作为客机加入</strong>
                          <span>
                            {isRunningInTauriDesktop()
                              ? 'Windows 客户端可直接输入房主 IP 加入局域网房（内置开房当前支持安卓 APK）。'
                              : '仅安卓 APK 可当房主；请输入房主屏幕上显示的 IP，或直接扫码加入。'}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="lobby-join-bar">
                      <input
                        className="input-box lobby-join-input"
                        value={lanIpInput}
                        onChange={(e) => setLanIpInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && lanRole !== 'guest' && lanIpInput.trim()) {
                            onConnectLanManual(lanIpInput);
                          }
                        }}
                        placeholder="房主 IP，如 192.168.43.1:3001"
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && joinCode.length === 6) {
                              onJoinRoom(joinCode);
                            }
                          }}
                          placeholder="或输入 6 位房号直接入座"
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
                        onClick={() => openSetupModal('online-quick')}
                      >
                        <span className="cta-main">
                          <Icon name="play" className="cta-icon" />
                          快速人机开局
                        </span>
                        <span className="cta-sub">确认本局参数 · 配 3 名机器人</span>
                      </button>

                      <button
                        type="button"
                        className="btn btn-lg lobby-cta-secondary"
                        disabled={connStatus !== 'connected'}
                        onClick={() => openSetupModal('online-room')}
                      >
                        <span className="cta-main">
                          <Icon name="plus" className="cta-icon" />
                          创建好友房
                        </span>
                        <span className="cta-sub">设定本局参数 · 6 位房号邀牌友</span>
                      </button>
                    </div>

                    <div className="lobby-join-bar">
                      <input
                        className="input-box lobby-join-input"
                        value={joinCode}
                        maxLength={6}
                        inputMode="numeric"
                        onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && connStatus === 'connected' && joinCode.length === 6) {
                            onJoinRoom(joinCode);
                          }
                        }}
                        placeholder="输入 6 位房间号"
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

            {/* ── Side panel: per-mode records / rooms ──────────── */}
            {playMode === 'offline' && (
              <section className="card-panel lobby-rooms-panel">
                <div className="lobby-rooms-head">
                  <div className="lobby-rooms-head-title">
                    <h2 className="section-title lobby-panel-title">本机战绩</h2>
                    <span className="pill pill-green">{localStats.totalMatches} 场</span>
                  </div>
                  {localHistory.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={onClearLocalStats}
                    >
                      清空
                    </button>
                  )}
                </div>

                <div className="local-stats-grid">
                  <div className="local-stat-tile is-red">
                    <span className="local-stat-label">红心胜场</span>
                    <strong className="local-stat-val">
                      {localStats.hongxinWins}
                      <small>/{localStats.hongxinRounds}</small>
                    </strong>
                  </div>
                  <div className="local-stat-tile is-ink">
                    <span className="local-stat-label">黑心胜场</span>
                    <strong className="local-stat-val">
                      {localStats.heixinWins}
                      <small>/{localStats.heixinRounds}</small>
                    </strong>
                  </div>
                  <div className="local-stat-tile is-gold">
                    <span className="local-stat-label">黑心净分</span>
                    <strong
                      className={`local-stat-val ${localStats.heixinTotalScore < 0 ? 'is-neg' : ''}`}
                    >
                      {localStats.heixinTotalScore >= 0 ? '+' : ''}
                      {localStats.heixinTotalScore}
                    </strong>
                  </div>
                </div>

                <div className="room-list">
                  {localHistory.length === 0 ? (
                    <div className="lobby-rooms-empty">
                      <LobbyEmptyArt />
                      <strong>本地 AI 已就绪</strong>
                      <p>无需联网，规则与机器人都在本机运行。打完一局，战绩会记在这里。</p>
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
                                {modeLabel(m.mode)}
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
                  <div className="lobby-rooms-head-title">
                    <h2 className="section-title lobby-panel-title">
                      {lanRole === 'guest' ? '房主当前牌桌' : '附近牌桌'}
                    </h2>
                    <span className="pill">
                      {lanRole === 'guest'
                        ? `${roomsList.length} 桌`
                        : `${discoveredLanHosts.length} 个主机`}
                    </span>
                  </div>
                  {lanRole === 'guest' && (
                    <button type="button" className="btn btn-xs btn-ghost" onClick={onFetchRooms}>
                      <Icon name="refresh" />
                      刷新
                    </button>
                  )}
                </div>

                <div className="room-list">
                  {lanRole === 'guest' ? (
                    roomsList.length === 0 ? (
                      <div className="lobby-rooms-empty">
                        <LobbyEmptyArt variant="lan" />
                        <strong>
                          {connStatus === 'connected'
                            ? '房主尚未建立等待中的牌桌'
                            : '正在连接局域网房主…'}
                        </strong>
                        <p>
                          当前目标：{lanTargetUrl || window.location.host}。请确认与房主在同一 Wi-Fi 或同一手机热点下。
                        </p>
                      </div>
                    ) : (
                      roomsList.map((r) => {
                        const canJoin = r.status === 'WAITING' && connStatus === 'connected';
                        return (
                          <div key={r.roomId} className="room-list-item">
                            <div className="room-item-main">
                              <div className="room-item-title">
                                <span className="room-code-tag">#{r.roomId}</span>
                                <span
                                  className={`pill ${r.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                                >
                                  {modeLabel(r.mode)}
                                </span>
                                <span className="room-status-text">
                                  {r.status === 'WAITING' ? '等待开局' : '对局中'}
                                </span>
                              </div>
                              <SeatDots room={r} />
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
                      <LobbyEmptyArt variant="lan" />
                      <strong>
                        {lanHostSupported
                          ? '正在扫描附近局域网牌桌…'
                          : '扫码或输入房主 IP 即可加入'}
                      </strong>
                      <ol className="lan-guide-steps">
                        <li>所有手机连同一 Wi-Fi，或由房主开热点</li>
                        <li>房主点「创建局域网房间」，安卓端此处自动出现</li>
                        <li>iPhone / 电脑扫房主二维码，无需安装</li>
                      </ol>
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
                              {modeLabel(host.mode)}
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
                  <div className="lobby-rooms-head-title">
                    <h2 className="section-title lobby-panel-title">在线牌桌</h2>
                    <span className="pill">{roomsList.length} 桌</span>
                  </div>
                  <button type="button" className="btn btn-xs btn-ghost" onClick={onFetchRooms}>
                    <Icon name="refresh" />
                    刷新
                  </button>
                </div>

                <div className="room-list">
                  {roomsList.length === 0 ? (
                    <div className="lobby-rooms-empty">
                      <LobbyEmptyArt />
                      <strong>暂无等待中的牌桌</strong>
                      <p>点「快速单人开局」随时练手，或「创建好友房」邀牌友同桌。</p>
                    </div>
                  ) : (
                    roomsList.map((r) => {
                      const canJoin = r.status === 'WAITING' && connStatus === 'connected';
                      return (
                        <div key={r.roomId} className="room-list-item">
                          <div className="room-item-main">
                            <div className="room-item-title">
                              <span className="room-code-tag">#{r.roomId}</span>
                              <span
                                className={`pill ${r.mode === 'hongxin' ? 'pill-red' : 'pill-gold'}`}
                              >
                                {modeLabel(r.mode)}
                              </span>
                              <span className="room-status-text">
                                {r.status === 'WAITING'
                                  ? '等待开局'
                                  : r.status === 'IN_GAME'
                                    ? '对局中'
                                    : '已结束'}
                              </span>
                            </div>
                            <SeatDots room={r} />
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
          <div className="modal-card lobby-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>玩家战绩排行榜</h3>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setShowLeaderboardModal(false)}
              >
                <Icon name="close" />
                关闭
              </button>
            </div>
            {leaderboard.length === 0 ? (
              <div className="lobby-modal-empty">暂无注册玩家上榜，快来注册账号打一局吧！</div>
            ) : (
              <div className="lobby-modal-list">
                {leaderboard.map((u, idx) => (
                  <div key={u.id} className="room-list-item lobby-rank-row">
                    <span className={`lobby-rank-no ${idx < 3 ? `is-top is-top-${idx + 1}` : ''}`}>
                      {idx + 1}
                    </span>
                    <div className="lobby-modal-row-main">
                      <div className="lobby-modal-row-title">
                        {u.nickname} <span className="lobby-modal-row-handle">(@{u.username})</span>
                      </div>
                      <div className="lobby-modal-row-sub">
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
          <div className="modal-card lobby-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{playMode === 'online' ? '近期历史战绩' : '本机离线历史战绩'}</h3>
              <button type="button" className="btn btn-xs" onClick={() => setShowHistoryModal(false)}>
                <Icon name="close" />
                关闭
              </button>
            </div>
            {historyList.length === 0 ? (
              <div className="lobby-modal-empty">暂无历史对局记录。</div>
            ) : (
              <div className="lobby-modal-list">
                {historyList.map((m) => (
                  <div key={m.id} className="room-list-item">
                    <div className="lobby-modal-row-main">
                      <div className="lobby-modal-row-title">
                        房号 {m.roomId} · {modeLabel(m.mode)}
                      </div>
                      <div className="lobby-modal-row-sub">
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
      {pendingSetup && (
        <MatchSetupModal
          title={pendingSetup.title}
          subtitle={pendingSetup.subtitle}
          confirmLabel={pendingSetup.confirmLabel}
          initialValues={{
            mode,
            dealSpeed: defaultMatchSetup.dealSpeed,
            allyBotDifficulty: defaultMatchSetup.allyBotDifficulty,
            opponentBotDifficulty: defaultMatchSetup.opponentBotDifficulty,
            debugMode: pendingSetup.defaultDebug,
          }}
          onConfirm={handleConfirmMatchSetup}
          onClose={() => setPendingSetup(null)}
        />
      )}
    </div>
  );
};
