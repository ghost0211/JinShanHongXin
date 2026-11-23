import React, { useEffect, useState } from 'react';
import type { GameMode, RoomSummary, UserProfile } from '@jinshan/protocol';
import {
  isRunningInAndroidApk,
  type ConnectionStatus,
} from '../net/wsClient.js';
import type { MatchHistoryRow, SavedSession } from '../hooks/useGameClient.js';
import { RulesModal } from './RulesModal.js';
import { AuthModal } from './AuthModal.js';

interface LobbyScreenProps {
  connStatus: ConnectionStatus;
  serverUrl: string;
  playerName: string;
  currentUser: UserProfile | null;
  savedSession: SavedSession | null;
  roomsList: RoomSummary[];
  historyList: MatchHistoryRow[];
  leaderboard: UserProfile[];
  onSetPlayerName: (name: string) => void;
  onUpdateServerUrl: (url: string) => void;
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
  onSetPlayerName,
  onUpdateServerUrl,
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
}) => {
  const [mode, setMode] = useState<GameMode>('hongxin');
  const [joinCode, setJoinCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [serverInput, setServerInput] = useState(serverUrl);

  useEffect(() => {
    setServerInput(serverUrl);
  }, [serverUrl]);

  useEffect(() => {
    if (connStatus === 'connected') {
      onFetchRooms();
    }
  }, [connStatus, onFetchRooms]);

  const statusBadge =
    connStatus === 'connected'
      ? { text: '已连接', cls: 'pill-green' }
      : connStatus === 'connecting'
        ? { text: '连接中...', cls: 'pill-gold' }
        : { text: '未连接', cls: 'pill-red' };

  return (
    <div className="lobby-wrap">
      <div className="lobby-grid">
        <div className="card-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 className="lobby-title">金山打红心 · 打黑心</h1>
            <span className={`pill ${statusBadge.cls}`}>{statusBadge.text}</span>
          </div>
          <p className="lobby-subtitle">
            三副牌 162 张 · 手机/平板双排手牌 · 支持局域网联机与单人机器人调试
          </p>

          {/* User Account Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '7px 10px',
              marginBottom: 10,
              borderRadius: 10,
              background: currentUser
                ? 'rgba(39, 164, 116, 0.16)'
                : 'rgba(255, 255, 255, 0.06)',
              border: currentUser
                ? '1px solid rgba(111, 227, 181, 0.45)'
                : '1px solid rgba(255, 255, 255, 0.14)',
              fontSize: 12,
            }}
          >
            {currentUser ? (
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: '#a9f5d7' }}>{currentUser.nickname}</strong>{' '}
                <span style={{ color: 'var(--text-muted)' }}>
                  (@{currentUser.username}) · 红心 {currentUser.hongxinWins}/{currentUser.hongxinGames} · 黑心 {currentUser.heixinTotalScore}分
                </span>
              </div>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>
                游客身份（登录账号可自动保存个人战绩与排名）
              </span>
            )}
            <button
              type="button"
              className={`btn btn-xs ${currentUser ? '' : 'btn-gold'}`}
              onClick={() => setShowAuthModal(true)}
            >
              {currentUser ? '账号 / 改名' : '登录 / 注册'}
            </button>
          </div>

          {isRunningInAndroidApk() && connStatus !== 'connected' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 10px',
                marginBottom: 10,
                borderRadius: 10,
                background: 'rgba(211, 40, 54, 0.2)',
                border: '1px solid rgba(255, 118, 130, 0.5)',
                fontSize: 12,
              }}
            >
              <span>
                安卓客户端未连上服务器（当前：{serverUrl || '127.0.0.1:3001'}），请填写局域网服务端 IP
              </span>
              <button
                type="button"
                className="btn btn-gold btn-xs"
                onClick={() => setShowServerModal(true)}
              >
                配置服务器
              </button>
            </div>
          )}

          {savedSession && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 10px',
                marginBottom: 10,
                borderRadius: 10,
                background: 'rgba(244, 201, 107, 0.16)',
                border: '1px solid var(--gold)',
                fontSize: 12,
              }}
            >
              <span>检测到未结束对局（房号 {savedSession.roomId}）</span>
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

          <div className="mode-tabs">
            <button
              type="button"
              className={`mode-card ${mode === 'hongxin' ? 'is-active' : ''}`}
              onClick={() => setMode('hongxin')}
            >
              <h4>金山打红心（2打2）</h4>
              <p>2→A 升级 · 21张比牌反主 · 120及格 · 40/60跳级</p>
            </button>
            <button
              type="button"
              className={`mode-card ${mode === 'heixin' ? 'is-active' : ''}`}
              onClick={() => setMode('heixin')}
            >
              <h4>金山打黑心（1打3）</h4>
              <p>固定打10 · 100~300叫分 · 禁埋10 · 零和计分</p>
            </button>
          </div>

          {!currentUser && (
            <div className="field-row">
              <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
                游客昵称
              </span>
              <input
                className="input-box"
                value={playerName}
                maxLength={12}
                onChange={(e) => onSetPlayerName(e.target.value)}
                placeholder="输入昵称"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-gold btn-lg"
              style={{ flex: 1 }}
              disabled={connStatus !== 'connected'}
              onClick={() =>
                onCreateRoom({ mode, debugMode: false, fillBots: false })
              }
            >
              创建好友房
            </button>
            <button
              type="button"
              className="btn btn-emerald btn-lg"
              style={{ flex: 1 }}
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
              单人调试开局 (+3机器人)
            </button>
          </div>

          <div className="field-row" style={{ marginBottom: 0 }}>
            <input
              className="input-box"
              value={joinCode}
              maxLength={6}
              inputMode="numeric"
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, ''))}
              placeholder="输入 6 位房间号加入"
            />
            <button
              type="button"
              className="btn btn-lg"
              disabled={connStatus !== 'connected' || joinCode.length !== 6}
              onClick={() => onJoinRoom(joinCode)}
            >
              加入房间
            </button>
          </div>
        </div>

        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <strong style={{ color: 'var(--gold-strong)', fontSize: 15 }}>
              在线房间列表
            </strong>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-xs" onClick={onFetchRooms}>
                刷新
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  onFetchLeaderboard();
                  setShowLeaderboardModal(true);
                }}
              >
                排行榜
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  onFetchHistory();
                  setShowHistoryModal(true);
                }}
              >
                战绩
              </button>
              <button type="button" className="btn btn-xs" onClick={() => setShowRules(true)}>
                规则
              </button>
              <button type="button" className="btn btn-xs" onClick={() => setShowServerModal(true)}>
                服务器
              </button>
            </div>
          </div>

          <div className="room-list">
            {roomsList.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '16px 6px', textAlign: 'center' }}>
                当前暂无等待中的房间，点击左侧“创建好友房”或“单人调试开局”。
              </div>
            ) : (
              roomsList.map((r) => {
                const occupiedCount = r.seats.filter((s) => s.occupied).length;
                return (
                  <div key={r.roomId} className="room-list-item">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        房号 {r.roomId}{' '}
                        <span className="pill pill-gold">
                          {r.mode === 'hongxin' ? '打红心' : '打黑心'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {r.status === 'WAITING' ? '等待开局' : r.status === 'IN_GAME' ? '对局中' : '已结束'} · {occupiedCount}/4 座
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-gold"
                      disabled={r.status !== 'WAITING' || connStatus !== 'connected'}
                      onClick={() => onJoinRoom(r.roomId)}
                    >
                      加入
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

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

      {showServerModal && (
        <div className="modal-backdrop" onClick={() => setShowServerModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>服务器地址设置</h3>
              <button type="button" className="btn btn-xs" onClick={() => setShowServerModal(false)}>
                关闭
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              留空则自动连接当前网页同源服务器；安卓 APK 或跨设备连接局域网主机时，填写例如{' '}
              <code>http://192.168.1.88:3001</code>
            </p>
            <div className="field-row">
              <input
                className="input-box"
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                placeholder="例如 http://192.168.1.88:3001（留空默认同源）"
              />
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => {
                  onUpdateServerUrl(serverInput);
                  setShowServerModal(false);
                }}
              >
                保存并重连
              </button>
            </div>
          </div>
        </div>
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
              <h3>近期历史战绩（SQLite）</h3>
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
