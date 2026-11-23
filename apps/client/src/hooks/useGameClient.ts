import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameAction,
  GameMode,
  PlayerView,
  RoomSummary,
  Seat,
  UserProfile,
} from '@jinshan/protocol';
import {
  getSavedServerUrl,
  ManagedWsClient,
  resolveHttpBase,
  resolveWsUrl,
  saveServerUrl,
  type ConnectionStatus,
} from '../net/wsClient.js';
import { latestNewPlay, newRecentGameEvents } from '../utils/cardAudio.js';
import { soundFX } from '../utils/sound.js';

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
  const [playerName, setPlayerNameState] = useState<string>(() => loadPlayerName());
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [session, setSession] = useState<SavedSession | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSavedSession(serverUrl));
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [roomsList, setRoomsList] = useState<RoomSummary[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [muted, setMuted] = useState<boolean>(() => soundFX.isMuted());

  const clientRef = useRef<ManagedWsClient | null>(null);
  const sessionRef = useRef<SavedSession | null>(null);
  const roomRef = useRef<RoomSummary | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const reconnectingRef = useRef(false);
  const leavingRef = useRef(false);
  const serverUrlRef = useRef(serverUrl);
  const authGeneration = useRef(0);
  const [initialAuthToken] = useState(() => loadAuthToken(serverUrl));
  const authTokenRef = useRef<string | null>(initialAuthToken);
  const toastIdRef = useRef(1);

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
    saveSession(serverUrl, null);
    setSavedSession(null);
  }, [serverUrl]);

  const refreshMe = useCallback(async () => {
    const token = authTokenRef.current;
    if (!token || serverUrlRef.current !== serverUrl) return;
    const generation = authGeneration.current;
    const isCurrent = () => serverUrlRef.current === serverUrl &&
      authGeneration.current === generation && authTokenRef.current === token;
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

  const reconnectRoom = useCallback((client: ManagedWsClient, target: SavedSession) => {
    if (reconnectingRef.current || leavingRef.current) return;
    reconnectingRef.current = client.send({
      type: 'RECONNECT',
      roomId: target.roomId,
      playerId: target.playerId,
      authToken: authTokenRef.current ?? undefined,
    });
  }, []);

  useEffect(() => {
    const client = new ManagedWsClient(serverUrl, () => {
      clearActiveRoom();
      // Another tab may have just saved this seat in the shared localStorage.
      setSavedSession(null);
      pushToast('该座位已在另一连接打开');
    });
    clientRef.current = client;

    const unsubStatus = client.onStatus((status) => {
      setConnStatus(status);
      if (status === 'connected') {
        void refreshMe();
        if (sessionRef.current) reconnectRoom(client, sessionRef.current);
      } else if (status === 'disconnected') {
        reconnectingRef.current = false;
        leavingRef.current = false;
      }
    });

    const unsubMsg = client.onMessage((msg) => {
      if (serverUrlRef.current !== serverUrl || (leavingRef.current && msg.type !== 'ROOM_LEFT')) return;
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
          setSavedSession(nextSess);
          saveSession(serverUrl, nextSess);
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
          // Handle each accepted snapshot once, outside a React state updater.
          const prev = viewRef.current;
          const next = msg.view;
          viewRef.current = next;
          setView(next);
          if ((next.phase === 'ROUND_OVER' || next.phase === 'MATCH_OVER') && prev?.phase !== next.phase) {
            void refreshMe();
          }
          if (!prev) break; // Do not replay the history bundled with a reconnect.
          if (next.phase === 'DEALING' && next.dealtCount > prev.dealtCount && next.dealtCount % 2 === 1) {
            soundFX.playTap();
          }
          const lastPlay = latestNewPlay(prev, next);
          if (lastPlay) soundFX.playCards(lastPlay, next.viewerSeat);
          const announcement = newRecentGameEvents(prev, next).findLast((event) =>
            ['SLING_FAILED', 'COUNTER_FAILED', 'COUNTER_SUCCESS', 'COUNTER_ACCEPTED', 'TRUMP_CALLED', 'COUNTER_PROPOSED']
              .includes(event.type));
          if (announcement?.type === 'SLING_FAILED' || announcement?.type === 'COUNTER_FAILED') {
            pushToast(announcement.message, true);
          } else if (announcement?.type === 'COUNTER_SUCCESS' || announcement?.type === 'COUNTER_ACCEPTED') {
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
            if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'RECONNECT_EXPIRED') forgetSavedRoom();
          }
          if (msg.code === 'UNAUTHORIZED') void refreshMe();
          break;
        }
      }
    });

    client.connect(serverUrl);
    return () => {
      clientRef.current = null;
      unsubStatus();
      unsubMsg();
      client.dispose();
    };
  }, [serverUrl, pushToast, refreshMe, reconnectRoom, clearActiveRoom, forgetSavedRoom]);

  const submitCredentials = useCallback(async (
    operation: 'register' | 'login',
    credentials: { username: string; password: string; inviteCode?: string; nickname?: string },
  ): Promise<{ ok: boolean; error?: string }> => {
    const generation = ++authGeneration.current;
    const isCurrent = () => serverUrlRef.current === serverUrl && authGeneration.current === generation;
    try {
      const res = await fetch(`${resolveHttpBase(serverUrl)}/api/auth/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = (await res.json()) as { token?: string; user?: UserProfile; error?: string };
      if (!isCurrent()) return { ok: false, error: '登录状态已变化，请重试' };
      if (!res.ok || !data.token || !data.user) {
        return { ok: false, error: data.error ?? (operation === 'login' ? '登录失败' : '注册失败') };
      }
      authTokenRef.current = data.token;
      saveAuthToken(serverUrl, data.token);
      setCurrentUser(data.user);
      pushToast(`${operation === 'login' ? '欢迎回来' : '欢迎加入'}，${data.user.nickname}！`);
      return { ok: true };
    } catch {
      return { ok: false, error: '无法连接服务器，请检查网络或服务器地址' };
    }
  }, [serverUrl, pushToast]);

  const registerUser = useCallback((username: string, password: string, inviteCode: string, nickname?: string) =>
    submitCredentials('register', { username, password, inviteCode, nickname }), [submitCredentials]);
  const loginUser = useCallback((username: string, password: string) =>
    submitCredentials('login', { username, password }), [submitCredentials]);

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
        if (serverUrlRef.current !== serverUrl || authGeneration.current !== generation || authTokenRef.current !== token) {
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
        if (serverUrlRef.current === serverUrl) pushToast('已从本机退出，但未能确认服务端会话已注销', true);
        return;
      }
    }
    if (serverUrlRef.current === serverUrl) pushToast('已退出登录');
  }, [serverUrl, pushToast]);

  const fetchRooms = useCallback(async () => {
    try {
      const base = resolveHttpBase(serverUrl);
      const res = await fetch(`${base}/api/rooms`);
      if (!res.ok) return;
      const data = (await res.json()) as { rooms: RoomSummary[] };
      if (serverUrlRef.current === serverUrl) setRoomsList(data.rooms);
    } catch {
      // ignore fetch errors while disconnected
    }
  }, [serverUrl]);

  const fetchHistory = useCallback(async () => {
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

  const updateServerUrl = useCallback((nextUrl: string) => {
    const next = nextUrl.trim().replace(/\/+$/, '');
    if (next === serverUrlRef.current) return;
    serverUrlRef.current = next;
    saveServerUrl(next);
    clientRef.current?.dispose();
    ++authGeneration.current;
    authTokenRef.current = loadAuthToken(next);
    reconnectingRef.current = false;
    leavingRef.current = false;
    clearActiveRoom();
    setSavedSession(loadSavedSession(next));
    setCurrentUser(null);
    setRoomsList([]);
    setHistoryList([]);
    setLeaderboard([]);
    setServerUrl(next);
  }, [clearActiveRoom]);

  const toggleMute = useCallback(() => {
    const next = !soundFX.isMuted();
    soundFX.setMuted(next);
    setMuted(next);
  }, []);

  const createRoom = useCallback(
    (opts: { mode: GameMode; debugMode: boolean; fillBots: boolean; autoStart?: boolean }) => {
      if (leavingRef.current || reconnectingRef.current) return;
      clientRef.current?.send({
        type: 'CREATE_ROOM',
        playerName: currentUser?.nickname ?? playerName,
        authToken: authTokenRef.current ?? undefined,
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
      clientRef.current?.send({
        type: 'JOIN_ROOM',
        roomId: roomId.trim(),
        playerName: currentUser?.nickname ?? playerName,
        authToken: authTokenRef.current ?? undefined,
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
    leavingRef.current = clientRef.current?.send({ type: 'LEAVE_ROOM' }) ?? false;
    reconnectingRef.current = false;
    if (status !== 'IN_GAME') forgetSavedRoom();
    clearActiveRoom();
  }, [clearActiveRoom, forgetSavedRoom]);

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
    savedSession,
    room,
    view,
    roomsList,
    historyList,
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
