import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GameAction,
  GameMode,
  PlayerView,
  RoomSummary,
  Seat,
  UserProfile,
} from '@jinshan/protocol';
import {
  buildLanHostBridgeWsUrl,
  getNativeLanHostStatus,
  isNativeLanHostSupported,
  pollDiscoveredLanHosts,
  startNativeLanDiscovery,
  startNativeLanHost,
  stopNativeLanDiscovery,
  stopNativeLanHost,
  type DiscoveredLanHost,
  type LanHostStartResult,
} from '../net/androidLan.js';
import {
  LocalWorkerTransport,
  type LanBridgeStatus,
} from '../net/localTransport.js';
import {
  getSavedServerUrl,
  isRunningInAndroidApk,
  ManagedWsClient,
  resolveHttpBase,
  resolveWsUrl,
  saveServerUrl,
  type ConnectionStatus,
  type GameTransport,
} from '../net/wsClient.js';
import { latestNewPlay, newRecentGameEvents } from '../utils/cardAudio.js';
import {
  clearLocalHistory,
  loadLocalHistory,
  recordLocalRound,
  summarizeLocalStats,
  type LocalMatchHistoryRow,
} from '../utils/localHistory.js';
import { soundFX } from '../utils/sound.js';

export type PlayMode = 'offline' | 'lan' | 'online';
export type LanRole = 'idle' | 'host' | 'guest';

export interface SavedSession {
  roomId: string;
  playerId: string;
  seat: Seat;
}

export interface ToastMessage {
  id: number;
  text: string;
  isError?: boolean;
}

export interface MatchHistoryRow {
  id: number;
  roomId: string;
  mode: GameMode;
  status: string;
  winnerSummary: string | null;
  createdAt: string;
  rounds: Array<{
    roundNumber: number;
    dealerSeat: number;
    challengerTotal: number;
    bankerWon: boolean;
  }>;
}

const SESSION_KEY = 'jinshan_session_v2';
const NAME_KEY = 'jinshan_player_name';
const AUTH_TOKEN_KEY = 'jinshan_auth_token_v2';
const PLAY_MODE_KEY = 'jinshan_play_mode_v1';
const LAN_TARGET_KEY = 'jinshan_lan_target_v1';

interface InitialLaunchIntent {
  playMode: PlayMode;
  lanRole: LanRole;
  lanTargetUrl: string;
  autoJoinRoomId: string | null;
  explicitQuery: boolean;
}

function resolveInitialLaunchIntent(savedServerUrl: string): InitialLaunchIntent {
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search);
      const lanParam = params.get('lan');
      const roomParam = params.get('room');
      const serverParam = params.get('server');
      const validRoom = roomParam && /^\d{6}$/.test(roomParam) ? roomParam : null;

      if (lanParam === '1' || lanParam === 'true' || validRoom) {
        return {
          playMode: 'lan',
          lanRole: 'guest',
          lanTargetUrl: serverParam ? serverParam.trim() : '',
          autoJoinRoomId: validRoom,
          explicitQuery: true,
        };
      }
      if (serverParam) {
        return {
          playMode: 'online',
          lanRole: 'idle',
          lanTargetUrl: '',
          autoJoinRoomId: null,
          explicitQuery: true,
        };
      }

      const savedMode = localStorage.getItem(PLAY_MODE_KEY);
      if (savedMode === 'offline' || savedMode === 'lan' || savedMode === 'online') {
        return {
          playMode: savedMode,
          lanRole: 'idle',
          lanTargetUrl: localStorage.getItem(LAN_TARGET_KEY) ?? '',
          autoJoinRoomId: null,
          explicitQuery: false,
        };
      }
    } catch {
      // ignore storage/URL errors
    }
  }

  // First launch inside Android APK with no custom server URL -> default to pure offline!
  if (isRunningInAndroidApk() && !savedServerUrl) {
    return {
      playMode: 'offline',
      lanRole: 'idle',
      lanTargetUrl: '',
      autoJoinRoomId: null,
      explicitQuery: false,
    };
  }

  return {
    playMode: 'online',
    lanRole: 'idle',
    lanTargetUrl: '',
    autoJoinRoomId: null,
    explicitQuery: false,
  };
}

export function normalizeLanAddress(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)) {
    return resolveHttpBase(trimmed);
  }
  // If user typed just an IPv4 like "192.168.43.1", default to port 3001
  if (!trimmed.includes(':')) {
    return `http://${trimmed}:3001`;
  }
  return `http://${trimmed}`;
}

function scopedKey(key: string, serverUrl: string): string {
  return `${key}:${resolveWsUrl(serverUrl)}`;
}

function loadSavedSession(serverUrl: string): SavedSession | null {
  try {
    const raw = localStorage.getItem(scopedKey(SESSION_KEY, serverUrl));
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

function saveSession(serverUrl: string, session: SavedSession | null): void {
  try {
    const key = scopedKey(SESSION_KEY, serverUrl);
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || '金山牌友';
  } catch {
    return '金山牌友';
  }
}

function loadAuthToken(serverUrl: string): string | null {
  try {
    // Old, unscoped credentials must never be forwarded to another server.
    localStorage.removeItem('jinshan_auth_token');
    localStorage.removeItem('jinshan_session');
    return localStorage.getItem(scopedKey(AUTH_TOKEN_KEY, serverUrl));
  } catch {
    return null;
  }
}

function saveAuthToken(serverUrl: string, token: string | null): void {
  try {
    const key = scopedKey(AUTH_TOKEN_KEY, serverUrl);
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useGameClient() {
  const [serverUrl, setServerUrl] = useState<string>(() => getSavedServerUrl());
  const [initialIntent] = useState<InitialLaunchIntent>(() =>
    resolveInitialLaunchIntent(serverUrl),
  );
  const [playMode, setPlayModeState] = useState<PlayMode>(initialIntent.playMode);
  const [lanRole, setLanRole] = useState<LanRole>(initialIntent.lanRole);
  const [lanTargetUrl, setLanTargetUrl] = useState<string>(initialIntent.lanTargetUrl);
  const [lanHostInfo, setLanHostInfo] = useState<LanHostStartResult | null>(null);
  const [lanBridgeStatus, setLanBridgeStatus] = useState<LanBridgeStatus>({
    connected: false,
    peerCount: 0,
  });
  const [discoveredLanHosts, setDiscoveredLanHosts] = useState<DiscoveredLanHost[]>([]);
  const [lanHostSupported] = useState<boolean>(() => isNativeLanHostSupported());

  const [playerName, setPlayerNameState] = useState<string>(() => loadPlayerName());
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [session, setSession] = useState<SavedSession | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() =>
    loadSavedSession(serverUrl),
  );
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [roomsList, setRoomsList] = useState<RoomSummary[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryRow[]>([]);
  const [localHistory, setLocalHistory] = useState<LocalMatchHistoryRow[]>(() =>
    loadLocalHistory(),
  );
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [muted, setMuted] = useState<boolean>(() => soundFX.isMuted());

  const clientRef = useRef<GameTransport | null>(null);
  const localTransportRef = useRef<LocalWorkerTransport | null>(null);
  const sessionRef = useRef<SavedSession | null>(null);
  const roomRef = useRef<RoomSummary | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const reconnectingRef = useRef(false);
  const leavingRef = useRef(false);
  const serverUrlRef = useRef(serverUrl);
  const playModeRef = useRef<PlayMode>(playMode);
  const lanRoleRef = useRef<LanRole>(lanRole);
  const lanTargetUrlRef = useRef<string>(lanTargetUrl);
  const playerNameRef = useRef<string>(playerName);
  const authGeneration = useRef(0);
  const [initialAuthToken] = useState(() => loadAuthToken(serverUrl));
  const authTokenRef = useRef<string | null>(initialAuthToken);
  const toastIdRef = useRef(1);
  const pendingLanHostCreateRef = useRef<{
    mode: GameMode;
    debugMode: boolean;
    fillBots: boolean;
    autoStart?: boolean;
  } | null>(null);
  const pendingLanAutoJoinRef = useRef<string | null>(initialIntent.autoJoinRoomId);

  playModeRef.current = playMode;
  lanRoleRef.current = lanRole;
  lanTargetUrlRef.current = lanTargetUrl;
  playerNameRef.current = playerName;

  const localStats = useMemo(() => summarizeLocalStats(localHistory), [localHistory]);

  const pushToast = useCallback((text: string, isError = false) => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev.slice(-3), { id, text, isError }]);
    if (isError) soundFX.playError();
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  const setPlayerName = useCallback((name: string) => {
    setPlayerNameState(name);
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // ignore
    }
  }, []);

  const clearActiveRoom = useCallback(() => {
    sessionRef.current = null;
    roomRef.current = null;
    viewRef.current = null;
    soundFX.stopCardSounds();
    setSession(null);
    setRoom(null);
    setView(null);
  }, []);

  const forgetSavedRoom = useCallback(() => {
    saveSession(serverUrlRef.current, null);
    setSavedSession(null);
  }, []);

  // Auto-detect when a browser page was served directly by an Android LAN Host APK
  useEffect(() => {
    if (initialIntent.explicitQuery || isRunningInAndroidApk()) return;
    if (typeof window === 'undefined') return;
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { lanHost?: boolean } | null) => {
        if (cancelled || !data?.lanHost) return;
        setPlayModeState('lan');
        setLanTargetUrl('');
        setLanRole('guest');
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [initialIntent.explicitQuery]);

  const activeHttpUrl =
    playMode === 'lan' && lanRole === 'guest' ? lanTargetUrl : serverUrl;

  const refreshMe = useCallback(async () => {
    if (playModeRef.current !== 'online') return;
    const token = authTokenRef.current;
    if (!token || serverUrlRef.current !== serverUrl) return;
    const generation = authGeneration.current;
    const isCurrent = () =>
      playModeRef.current === 'online' &&
      serverUrlRef.current === serverUrl &&
      authGeneration.current === generation &&
      authTokenRef.current === token;
    try {
      const base = resolveHttpBase(serverUrl);
      const res = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!isCurrent()) return;
      if (res.status === 401) {
        authTokenRef.current = null;
        saveAuthToken(serverUrl, null);
        setCurrentUser(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { user: UserProfile };
      if (isCurrent()) setCurrentUser(data.user);
    } catch {
      // Keep the token for retry when the server is unreachable.
    }
  }, [serverUrl]);

  const fetchRooms = useCallback(async () => {
    const mode = playModeRef.current;
    if (mode === 'offline') {
      setRoomsList([]);
      return;
    }
    if (mode === 'lan' && lanRoleRef.current !== 'guest') {
      return;
    }
    const target = mode === 'lan' ? lanTargetUrlRef.current : serverUrlRef.current;
    try {
      const base = resolveHttpBase(target);
      const res = await fetch(`${base}/api/rooms`);
      if (!res.ok) return;
      const data = (await res.json()) as { rooms: RoomSummary[] };
      if (playModeRef.current === mode) setRoomsList(data.rooms);
    } catch {
      // ignore fetch errors while disconnected
    }
  }, []);

  const reconnectRoom = useCallback((client: GameTransport, target: SavedSession) => {
    if (reconnectingRef.current || leavingRef.current) return;
    reconnectingRef.current = client.send({
      type: 'RECONNECT',
      roomId: target.roomId,
      playerId: target.playerId,
      authToken:
        playModeRef.current === 'online' ? (authTokenRef.current ?? undefined) : undefined,
    });
  }, []);

  // Poll UDP-discovered LAN hosts on Android APK while in LAN idle view
  useEffect(() => {
    if (playMode !== 'lan' || lanRole !== 'idle' || !lanHostSupported) {
      return;
    }
    startNativeLanDiscovery();
    const refresh = () => {
      setDiscoveredLanHosts(pollDiscoveredLanHosts().filter((h) => !h.isSelf));
    };
    refresh();
    const timer = window.setInterval(refresh, 1200);
    return () => {
      clearInterval(timer);
      stopNativeLanDiscovery();
    };
  }, [playMode, lanRole, lanHostSupported]);

  // Periodically refresh LAN host guest count & IP list while hosting
  useEffect(() => {
    if (playMode !== 'lan' || lanRole !== 'host' || !lanHostInfo) return;
    const timer = window.setInterval(() => {
      const status = getNativeLanHostStatus();
      if (status && status.running) {
        setLanHostInfo((prev) =>
          prev
            ? {
                ...prev,
                ips: status.ips,
                primaryIp: status.primaryIp || prev.primaryIp,
              }
            : prev,
        );
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [playMode, lanRole, lanHostInfo !== null]);

  // Core transport effect: switches cleanly between Offline Worker, LAN Host Worker, LAN Guest WS, and Online WS
  useEffect(() => {
    const mode = playMode;
    const role = lanRole;
    const targetUrl = mode === 'lan' ? lanTargetUrl : serverUrl;

    // LAN idle view has no active game transport (only UDP discovery)
    if (mode === 'lan' && role === 'idle') {
      clientRef.current = null;
      localTransportRef.current = null;
      setConnStatus('disconnected');
      setRoomsList([]);
      return;
    }

    let transport: GameTransport;
    let isLocalWorker = false;

    if (mode === 'offline' || (mode === 'lan' && role === 'host')) {
      const bridgeUrl =
        mode === 'lan' && role === 'host' && lanHostInfo
          ? buildLanHostBridgeWsUrl(lanHostInfo.port, lanHostInfo.hostToken)
          : undefined;
      const localTransport = new LocalWorkerTransport(
        {
          onRoomsChanged: (rooms) => {
            if (playModeRef.current === mode) {
              setRoomsList(rooms);
            }
          },
          onRoundRecorded: (event) => {
            const seat = sessionRef.current?.seat ?? 0;
            const updated = recordLocalRound(event, seat);
            setLocalHistory(updated);
          },
          onLanBridgeStatus: (status) => {
            setLanBridgeStatus(status);
          },
        },
        bridgeUrl,
      );
      localTransportRef.current = localTransport;
      transport = localTransport;
      isLocalWorker = true;
    } else {
      localTransportRef.current = null;
      transport = new ManagedWsClient(targetUrl, () => {
        clearActiveRoom();
        if (playModeRef.current === 'online') setSavedSession(null);
        pushToast('该座位已在另一连接打开');
      });
    }

    clientRef.current = transport;

    const unsubStatus = transport.onStatus((status) => {
      setConnStatus(status);
      if (status === 'connected') {
        if (mode === 'online') {
          void refreshMe();
          if (sessionRef.current) reconnectRoom(transport, sessionRef.current);
        } else if (mode === 'lan' && role === 'host') {
          const pending = pendingLanHostCreateRef.current;
          if (pending && !sessionRef.current) {
            pendingLanHostCreateRef.current = null;
            transport.send({
              type: 'CREATE_ROOM',
              playerName: playerNameRef.current || '金山房主',
              mode: pending.mode,
              debugMode: pending.debugMode,
              fillBots: pending.fillBots,
              autoStart: pending.autoStart,
            });
          }
        } else if (mode === 'lan' && role === 'guest') {
          void fetchRooms();
          if (sessionRef.current) {
            reconnectRoom(transport, sessionRef.current);
          } else if (pendingLanAutoJoinRef.current) {
            const roomId = pendingLanAutoJoinRef.current;
            pendingLanAutoJoinRef.current = null;
            transport.send({
              type: 'JOIN_ROOM',
              roomId,
              playerName: playerNameRef.current || '金山牌友',
            });
          }
        }
      } else if (status === 'disconnected') {
        reconnectingRef.current = false;
        leavingRef.current = false;
      }
    });

    const unsubMsg = transport.onMessage((msg) => {
      if (playModeRef.current !== mode) return;
      if (mode === 'online' && serverUrlRef.current !== serverUrl) return;
      if (leavingRef.current && msg.type !== 'ROOM_LEFT') return;

      switch (msg.type) {
        case 'ROOM_JOINED': {
          const nextSess: SavedSession = {
            roomId: msg.roomId,
            playerId: msg.playerId,
            seat: msg.seat,
          };
          const switchedRoom = roomRef.current?.roomId !== msg.roomId;
          if (reconnectingRef.current || switchedRoom) {
            viewRef.current = null;
            soundFX.stopCardSounds();
            if (switchedRoom) setView(null);
          }
          reconnectingRef.current = false;
          sessionRef.current = nextSess;
          roomRef.current = msg.room;
          setSession(nextSess);
          if (mode === 'online') {
            setSavedSession(nextSess);
            saveSession(serverUrl, nextSess);
          }
          setRoom(msg.room);
          break;
        }
        case 'ROOM_UPDATED': {
          if (sessionRef.current?.roomId === msg.room.roomId) {
            roomRef.current = msg.room;
            setRoom(msg.room);
          }
          break;
        }
        case 'ROOM_LEFT': {
          leavingRef.current = false;
          clearActiveRoom();
          break;
        }
        case 'GAME_STATE': {
          if (!sessionRef.current) break;
          const prev = viewRef.current;
          const next = msg.view;
          viewRef.current = next;
          setView(next);
          if (
            mode === 'online' &&
            (next.phase === 'ROUND_OVER' || next.phase === 'MATCH_OVER') &&
            prev?.phase !== next.phase
          ) {
            void refreshMe();
          }
          if (!prev) break;
          if (
            next.phase === 'DEALING' &&
            next.dealtCount > prev.dealtCount &&
            next.dealtCount % 2 === 1
          ) {
            soundFX.playTap();
          }
          const lastPlay = latestNewPlay(prev, next);
          if (lastPlay) soundFX.playCards(lastPlay, next.viewerSeat);
          const announcement = newRecentGameEvents(prev, next).findLast((event) =>
            [
              'SLING_FAILED',
              'COUNTER_FAILED',
              'COUNTER_SUCCESS',
              'COUNTER_ACCEPTED',
              'TRUMP_CALLED',
              'COUNTER_PROPOSED',
            ].includes(event.type),
          );
          if (announcement?.type === 'SLING_FAILED' || announcement?.type === 'COUNTER_FAILED') {
            pushToast(announcement.message, true);
          } else if (
            announcement?.type === 'COUNTER_SUCCESS' ||
            announcement?.type === 'COUNTER_ACCEPTED'
          ) {
            soundFX.playSuccess();
            pushToast(announcement.message);
          } else if (announcement) {
            soundFX.playSpecial();
            pushToast(announcement.message);
          }
          break;
        }
        case 'ACTION_ERROR': {
          pushToast(msg.message, true);
          if (reconnectingRef.current) {
            reconnectingRef.current = false;
            clearActiveRoom();
            if (
              mode === 'online' &&
              (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'RECONNECT_EXPIRED')
            ) {
              forgetSavedRoom();
            }
          }
          if (mode === 'online' && msg.code === 'UNAUTHORIZED') void refreshMe();
          break;
        }
      }
    });

    transport.connect();
    return () => {
      clientRef.current = null;
      if (isLocalWorker) {
        localTransportRef.current = null;
      }
      unsubStatus();
      unsubMsg();
      transport.dispose();
    };
  }, [
    playMode,
    lanRole,
    lanTargetUrl,
    lanHostInfo?.port,
    lanHostInfo?.hostToken,
    serverUrl,
    pushToast,
    refreshMe,
    fetchRooms,
    reconnectRoom,
    clearActiveRoom,
    forgetSavedRoom,
  ]);

  const stopLanHostCleanup = useCallback(() => {
    stopNativeLanHost();
    setLanHostInfo(null);
    setLanBridgeStatus({ connected: false, peerCount: 0 });
    pendingLanHostCreateRef.current = null;
  }, []);

  const setPlayMode = useCallback(
    (nextMode: PlayMode) => {
      if (nextMode === playModeRef.current) return;
      if (lanRoleRef.current === 'host') {
        stopLanHostCleanup();
      }
      reconnectingRef.current = false;
      leavingRef.current = false;
      pendingLanAutoJoinRef.current = null;
      clearActiveRoom();
      setRoomsList([]);
      setLanRole('idle');
      setPlayModeState(nextMode);
      try {
        localStorage.setItem(PLAY_MODE_KEY, nextMode);
      } catch {
        // ignore
      }
    },
    [clearActiveRoom, stopLanHostCleanup],
  );

  const startLanHostRoom = useCallback(
    (opts: { mode: GameMode; debugMode?: boolean }) => {
      const displayName = playerNameRef.current.trim() || '金山房主';
      const result = startNativeLanHost(3001, displayName);
      if (!result.ok) {
        pushToast(result.error || '启动局域网房主失败', true);
        return;
      }
      clearActiveRoom();
      pendingLanHostCreateRef.current = {
        mode: opts.mode,
        debugMode: opts.debugMode ?? false,
        fillBots: false,
        autoStart: false,
      };
      setPlayModeState('lan');
      setLanHostInfo(result);
      setLanRole('host');
      if (result.primaryIp) {
        pushToast(`局域网房主已开启：${result.primaryIp}:${result.port}`);
      } else {
        pushToast(`局域网房主已监听端口 ${result.port}，请开启热点或连接 Wi-Fi`);
      }
    },
    [clearActiveRoom, pushToast],
  );

  const refreshLanHostInfo = useCallback(() => {
    const status = getNativeLanHostStatus();
    if (!status || !status.running) {
      pushToast('局域网房主未运行', true);
      return;
    }
    setLanHostInfo((prev) => ({
      ok: true,
      port: status.port,
      hostToken: status.hostToken || prev?.hostToken || '',
      ips: status.ips,
      primaryIp: status.primaryIp || status.ips[0] || '',
    }));
    if (status.primaryIp) {
      pushToast(`已刷新本机地址：${status.primaryIp}:${status.port}`);
    } else {
      pushToast('仍未检测到局域网 IP，请确认已开启热点或连上 Wi-Fi', true);
    }
  }, [pushToast]);

  const joinDiscoveredLanHost = useCallback(
    (host: DiscoveredLanHost) => {
      clearActiveRoom();
      pendingLanAutoJoinRef.current =
        host.status === 'WAITING' && /^\d{6}$/.test(host.roomId) ? host.roomId : null;
      setPlayModeState('lan');
      setLanTargetUrl(host.url);
      try {
        localStorage.setItem(LAN_TARGET_KEY, host.url);
      } catch {
        // ignore
      }
      setLanRole('guest');
      pushToast(`正在连接房主 ${host.hostName} (${host.ip}:${host.port})...`);
    },
    [clearActiveRoom, pushToast],
  );

  const connectLanManual = useCallback(
    (rawAddr: string) => {
      const normalized = normalizeLanAddress(rawAddr);
      if (!normalized) {
        pushToast('请输入房主 IP 地址（如 192.168.43.1:3001）', true);
        return;
      }
      clearActiveRoom();
      pendingLanAutoJoinRef.current = null;
      setPlayModeState('lan');
      setLanTargetUrl(normalized);
      try {
        localStorage.setItem(LAN_TARGET_KEY, normalized);
      } catch {
        // ignore
      }
      setLanRole('guest');
      pushToast(`正在连接局域网主机 ${normalized}...`);
    },
    [clearActiveRoom, pushToast],
  );

  const disconnectLanGuest = useCallback(() => {
    clearActiveRoom();
    pendingLanAutoJoinRef.current = null;
    setRoomsList([]);
    setLanRole('idle');
  }, [clearActiveRoom]);

  const submitCredentials = useCallback(
    async (
      operation: 'register' | 'login',
      credentials: {
        username: string;
        password: string;
        inviteCode?: string;
        nickname?: string;
      },
    ): Promise<{ ok: boolean; error?: string }> => {
      const generation = ++authGeneration.current;
      const isCurrent = () =>
        serverUrlRef.current === serverUrl && authGeneration.current === generation;
      try {
        const res = await fetch(`${resolveHttpBase(serverUrl)}/api/auth/${operation}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
        const data = (await res.json()) as {
          token?: string;
          user?: UserProfile;
          error?: string;
        };
        if (!isCurrent()) return { ok: false, error: '登录状态已变化，请重试' };
        if (!res.ok || !data.token || !data.user) {
          return {
            ok: false,
            error: data.error ?? (operation === 'login' ? '登录失败' : '注册失败'),
          };
        }
        authTokenRef.current = data.token;
        saveAuthToken(serverUrl, data.token);
        setCurrentUser(data.user);
        pushToast(`${operation === 'login' ? '欢迎回来' : '欢迎加入'}，${data.user.nickname}！`);
        return { ok: true };
      } catch {
        return { ok: false, error: '无法连接服务器，请检查网络或服务器地址' };
      }
    },
    [serverUrl, pushToast],
  );

  const registerUser = useCallback(
    (username: string, password: string, inviteCode: string, nickname?: string) =>
      submitCredentials('register', { username, password, inviteCode, nickname }),
    [submitCredentials],
  );
  const loginUser = useCallback(
    (username: string, password: string) =>
      submitCredentials('login', { username, password }),
    [submitCredentials],
  );

  const updateUserNickname = useCallback(
    async (nickname: string): Promise<{ ok: boolean; error?: string }> => {
      const token = authTokenRef.current;
      if (!token) return { ok: false, error: '请先登录' };
      const generation = ++authGeneration.current;
      try {
        const base = resolveHttpBase(serverUrl);
        const res = await fetch(`${base}/api/auth/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ nickname }),
        });
        const data = (await res.json()) as { user?: UserProfile; error?: string };
        if (
          serverUrlRef.current !== serverUrl ||
          authGeneration.current !== generation ||
          authTokenRef.current !== token
        ) {
          return { ok: false, error: '登录状态已变化，请重试' };
        }
        if (!res.ok || !data.user) {
          return { ok: false, error: data.error ?? '修改失败' };
        }
        setCurrentUser(data.user);
        pushToast('昵称已更新');
        return { ok: true };
      } catch {
        return { ok: false, error: '网络错误' };
      }
    },
    [serverUrl, pushToast],
  );

  const logoutUser = useCallback(async () => {
    const token = authTokenRef.current;
    ++authGeneration.current;
    authTokenRef.current = null;
    saveAuthToken(serverUrl, null);
    setCurrentUser(null);
    if (token) {
      try {
        const res = await fetch(`${resolveHttpBase(serverUrl)}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error();
      } catch {
        if (serverUrlRef.current === serverUrl) {
          pushToast('已从本机退出，但未能确认服务端会话已注销', true);
        }
        return;
      }
    }
    if (serverUrlRef.current === serverUrl) pushToast('已退出登录');
  }, [serverUrl, pushToast]);

  const fetchHistory = useCallback(async () => {
    if (playModeRef.current !== 'online') {
      const local = loadLocalHistory();
      setLocalHistory(local);
      setHistoryList(local);
      return;
    }
    try {
      const base = resolveHttpBase(serverUrl);
      const res = await fetch(`${base}/api/history`);
      if (!res.ok) return;
      const data = (await res.json()) as { matches: MatchHistoryRow[] };
      if (serverUrlRef.current === serverUrl) setHistoryList(data.matches);
    } catch {
      pushToast('获取历史战绩失败，请检查服务器连接', true);
    }
  }, [serverUrl, pushToast]);

  const fetchLeaderboard = useCallback(async () => {
    if (playModeRef.current !== 'online') {
      setLeaderboard([]);
      return;
    }
    try {
      const base = resolveHttpBase(serverUrl);
      const res = await fetch(`${base}/api/leaderboard`);
      if (!res.ok) return;
      const data = (await res.json()) as { users: UserProfile[] };
      if (serverUrlRef.current === serverUrl) setLeaderboard(data.users);
    } catch {
      pushToast('获取排行榜失败，请检查服务器连接', true);
    }
  }, [serverUrl, pushToast]);

  const clearLocalStats = useCallback(() => {
    clearLocalHistory();
    setLocalHistory([]);
    if (playModeRef.current !== 'online') {
      setHistoryList([]);
    }
    pushToast('已清空本机离线战绩');
  }, [pushToast]);

  const updateServerUrl = useCallback(
    (nextUrl: string) => {
      const next = nextUrl.trim().replace(/\/+$/, '');
      if (next === serverUrlRef.current) return;
      serverUrlRef.current = next;
      saveServerUrl(next);
      if (playModeRef.current === 'online') {
        clientRef.current?.dispose();
        clearActiveRoom();
      }
      ++authGeneration.current;
      authTokenRef.current = loadAuthToken(next);
      reconnectingRef.current = false;
      leavingRef.current = false;
      setSavedSession(loadSavedSession(next));
      setCurrentUser(null);
      setRoomsList([]);
      setHistoryList([]);
      setLeaderboard([]);
      setServerUrl(next);
    },
    [clearActiveRoom],
  );

  const toggleMute = useCallback(() => {
    const next = !soundFX.isMuted();
    soundFX.setMuted(next);
    setMuted(next);
  }, []);

  const createRoom = useCallback(
    (opts: { mode: GameMode; debugMode: boolean; fillBots: boolean; autoStart?: boolean }) => {
      if (leavingRef.current || reconnectingRef.current) return;
      const isOnline = playModeRef.current === 'online';
      clientRef.current?.send({
        type: 'CREATE_ROOM',
        playerName: (isOnline ? currentUser?.nickname : null) ?? playerName,
        authToken: isOnline ? (authTokenRef.current ?? undefined) : undefined,
        mode: opts.mode,
        debugMode: opts.debugMode,
        fillBots: opts.fillBots,
        autoStart: opts.autoStart,
      });
    },
    [playerName, currentUser],
  );

  const joinRoom = useCallback(
    (roomId: string) => {
      if (leavingRef.current || reconnectingRef.current) return;
      const isOnline = playModeRef.current === 'online';
      clientRef.current?.send({
        type: 'JOIN_ROOM',
        roomId: roomId.trim(),
        playerName: (isOnline ? currentUser?.nickname : null) ?? playerName,
        authToken: isOnline ? (authTokenRef.current ?? undefined) : undefined,
      });
    },
    [playerName, currentUser],
  );

  const reconnectSaved = useCallback(() => {
    if (savedSession && clientRef.current) reconnectRoom(clientRef.current, savedSession);
  }, [savedSession, reconnectRoom]);

  const leaveRoom = useCallback(() => {
    const status = roomRef.current?.status;
    if (leavingRef.current || !status) return;
    const mode = playModeRef.current;

    if (mode === 'offline') {
      clientRef.current?.send({ type: 'LEAVE_ROOM' });
      localTransportRef.current?.resetRooms();
      reconnectingRef.current = false;
      clearActiveRoom();
      return;
    }

    if (mode === 'lan' && lanRoleRef.current === 'host') {
      clientRef.current?.send({ type: 'LEAVE_ROOM' });
      stopLanHostCleanup();
      reconnectingRef.current = false;
      clearActiveRoom();
      setLanRole('idle');
      pushToast('已关闭局域网房间');
      return;
    }

    leavingRef.current = clientRef.current?.send({ type: 'LEAVE_ROOM' }) ?? false;
    reconnectingRef.current = false;
    if (mode === 'online' && status !== 'IN_GAME') forgetSavedRoom();
    clearActiveRoom();
  }, [clearActiveRoom, forgetSavedRoom, stopLanHostCleanup, pushToast]);

  const setRoomMode = useCallback((mode: GameMode) => {
    clientRef.current?.send({ type: 'SET_ROOM_MODE', mode });
  }, []);

  const setSeatBot = useCallback((seat: Seat, isBot: boolean) => {
    clientRef.current?.send({ type: 'SET_SEAT_BOT', seat, isBot });
  }, []);

  const swapSeat = useCallback((targetSeat: Seat) => {
    clientRef.current?.send({ type: 'SWAP_SEAT', targetSeat });
  }, []);

  const setReady = useCallback((ready: boolean) => {
    clientRef.current?.send({ type: 'SET_READY', ready });
  }, []);

  const startGame = useCallback(() => {
    clientRef.current?.send({ type: 'START_GAME' });
  }, []);

  const sendAction = useCallback((action: GameAction) => {
    clientRef.current?.send({ type: 'GAME_ACTION', action });
  }, []);

  const setAutoBot = useCallback((enabled: boolean) => {
    clientRef.current?.send({ type: 'SET_AUTO_BOT', enabled });
  }, []);

  const toggleDebugOpenHands = useCallback((enabled: boolean) => {
    clientRef.current?.send({ type: 'TOGGLE_DEBUG_OPEN_HANDS', enabled });
  }, []);

  return {
    playMode,
    setPlayMode,
    lanRole,
    lanHostSupported,
    lanHostInfo,
    lanBridgeStatus,
    lanTargetUrl,
    activeHttpUrl,
    discoveredLanHosts,
    startLanHostRoom,
    refreshLanHostInfo,
    joinDiscoveredLanHost,
    connectLanManual,
    disconnectLanGuest,
    connStatus,
    serverUrl,
    updateServerUrl,
    playerName,
    setPlayerName,
    currentUser,
    registerUser,
    loginUser,
    updateUserNickname,
    logoutUser,
    session,
    savedSession: playMode === 'online' ? savedSession : null,
    room,
    view,
    roomsList,
    historyList: playMode === 'online' ? historyList : localHistory,
    localHistory,
    localStats,
    clearLocalStats,
    leaderboard,
    toasts,
    muted,
    toggleMute,
    pushToast,
    fetchRooms,
    fetchHistory,
    fetchLeaderboard,
    createRoom,
    joinRoom,
    reconnectSaved,
    leaveRoom,
    setRoomMode,
    setSeatBot,
    swapSeat,
    setReady,
    startGame,
    sendAction,
    setAutoBot,
    toggleDebugOpenHands,
  };
}
