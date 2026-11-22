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
  saveServerUrl,
  type ConnectionStatus,
} from '../net/wsClient.js';
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

const SESSION_KEY = 'jinshan_session';
const NAME_KEY = 'jinshan_player_name';
const AUTH_TOKEN_KEY = 'jinshan_auth_token';

function loadSavedSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
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

function loadAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function useGameClient() {
  const [serverUrl, setServerUrl] = useState<string>(() => getSavedServerUrl());
  const [playerName, setPlayerNameState] = useState<string>(() => loadPlayerName());
  const [authToken, setAuthTokenState] = useState<string | null>(() => loadAuthToken());
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [session, setSession] = useState<SavedSession | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSavedSession());
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [roomsList, setRoomsList] = useState<RoomSummary[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [muted, setMuted] = useState<boolean>(() => soundFX.isMuted());

  const clientRef = useRef<ManagedWsClient | null>(null);
  const sessionRef = useRef<SavedSession | null>(session);
  sessionRef.current = session;
  const authTokenRef = useRef<string | null>(authToken);
  authTokenRef.current = authToken;
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

  const refreshMe = useCallback(
    async (tokenOverride?: string | null) => {
      const token = tokenOverride !== undefined ? tokenOverride : authTokenRef.current;
      if (!token) {
        setCurrentUser(null);
        return;
      }
      try {
        const base = resolveHttpBase(serverUrl);
        const res = await fetch(`${base}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          saveAuthToken(null);
          setAuthTokenState(null);
          setCurrentUser(null);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { user: UserProfile };
        setCurrentUser(data.user);
        setPlayerName(data.user.nickname);
      } catch {
        // server unreachable; keep cached token for retry
      }
    },
    [serverUrl, setPlayerName],
  );

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const client = new ManagedWsClient(serverUrl);
    clientRef.current = client;

    const unsubStatus = client.onStatus((status) => {
      setConnStatus(status);
      if (status === 'connected') {
        void refreshMe();
        if (sessionRef.current) {
          client.send({
            type: 'RECONNECT',
            roomId: sessionRef.current.roomId,
            playerId: sessionRef.current.playerId,
          });
        }
      }
    });

    const unsubMsg = client.onMessage((msg) => {
      switch (msg.type) {
        case 'ROOM_JOINED': {
          const nextSess: SavedSession = {
            roomId: msg.roomId,
            playerId: msg.playerId,
            seat: msg.seat,
          };
          setSession(nextSess);
          setSavedSession(nextSess);
          saveSession(nextSess);
          setRoom(msg.room);
          break;
        }
        case 'ROOM_UPDATED': {
          setRoom(msg.room);
          break;
        }
        case 'GAME_STATE': {
          setView((prev) => {
            if (
              (msg.view.phase === 'ROUND_OVER' || msg.view.phase === 'MATCH_OVER') &&
              prev?.phase !== msg.view.phase
            ) {
              void refreshMe();
            }
            if (
              prev &&
              msg.view.phase === 'DEALING' &&
              msg.view.dealtCount > prev.dealtCount &&
              msg.view.dealtCount % 2 === 1
            ) {
              soundFX.playTap();
            }
            if (prev && msg.view.events.length > prev.events.length) {
              const newEvents = msg.view.events.slice(prev.events.length);
              const lastEv = newEvents[newEvents.length - 1];
              const hasCardPlayed = newEvents.some((e) => e.type === 'CARD_PLAYED');
              if (lastEv?.type === 'SLING_FAILED') {
                pushToast(lastEv.message, true);
              } else if (lastEv?.type === 'COUNTER_FAILED') {
                pushToast(lastEv.message, true);
              } else if (
                lastEv?.type === 'COUNTER_SUCCESS' ||
                lastEv?.type === 'COUNTER_ACCEPTED'
              ) {
                soundFX.playSuccess();
                pushToast(lastEv.message);
              } else if (
                lastEv?.type === 'TRUMP_CALLED' ||
                lastEv?.type === 'COUNTER_PROPOSED'
              ) {
                soundFX.playSpecial();
                pushToast(lastEv.message);
              } else if (hasCardPlayed) {
                const lastPlay =
                  msg.view.currentTrick[msg.view.currentTrick.length - 1] ??
                  msg.view.lastTrick?.plays[3];
                if (
                  lastPlay?.parsed.patternType === 'F510K' ||
                  lastPlay?.parsed.patternType === 'TRACTOR' ||
                  lastPlay?.parsed.patternType === 'TRIPLE_TRACTOR'
                ) {
                  soundFX.playSpecial();
                } else {
                  soundFX.playCards();
                }
              }
            }
            return msg.view;
          });
          break;
        }
        case 'ACTION_ERROR': {
          pushToast(msg.message, true);
          if (msg.code === 'ROOM_NOT_FOUND' && !room) {
            saveSession(null);
            setSavedSession(null);
          }
          break;
        }
      }
    });

    client.connect(serverUrl);
    return () => {
      unsubStatus();
      unsubMsg();
      client.dispose();
    };
  }, [serverUrl, pushToast, refreshMe]);

  const registerUser = useCallback(
    async (
      username: string,
      password: string,
      nickname?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const base = resolveHttpBase(serverUrl);
        const res = await fetch(`${base}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, nickname }),
        });
        const data = (await res.json()) as {
          token?: string;
          user?: UserProfile;
          error?: string;
        };
        if (!res.ok || !data.token || !data.user) {
          return { ok: false, error: data.error ?? '注册失败' };
        }
        saveAuthToken(data.token);
        setAuthTokenState(data.token);
        setCurrentUser(data.user);
        setPlayerName(data.user.nickname);
        pushToast(`欢迎加入，${data.user.nickname}！`);
        return { ok: true };
      } catch {
        return { ok: false, error: '无法连接服务器，请检查网络或服务器地址' };
      }
    },
    [serverUrl, setPlayerName, pushToast],
  );

  const loginUser = useCallback(
    async (
      username: string,
      password: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const base = resolveHttpBase(serverUrl);
        const res = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = (await res.json()) as {
          token?: string;
          user?: UserProfile;
          error?: string;
        };
        if (!res.ok || !data.token || !data.user) {
          return { ok: false, error: data.error ?? '登录失败' };
        }
        saveAuthToken(data.token);
        setAuthTokenState(data.token);
        setCurrentUser(data.user);
        setPlayerName(data.user.nickname);
        pushToast(`欢迎回来，${data.user.nickname}！`);
        return { ok: true };
      } catch {
        return { ok: false, error: '无法连接服务器，请检查网络或服务器地址' };
      }
    },
    [serverUrl, setPlayerName, pushToast],
  );

  const updateUserNickname = useCallback(
    async (nickname: string): Promise<{ ok: boolean; error?: string }> => {
      const token = authTokenRef.current;
      if (!token) return { ok: false, error: '请先登录' };
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
        if (!res.ok || !data.user) {
          return { ok: false, error: data.error ?? '修改失败' };
        }
        setCurrentUser(data.user);
        setPlayerName(data.user.nickname);
        pushToast('昵称已更新');
        return { ok: true };
      } catch {
        return { ok: false, error: '网络错误' };
      }
    },
    [serverUrl, setPlayerName, pushToast],
  );

  const logoutUser = useCallback(async () => {
    const token = authTokenRef.current;
    if (token) {
      try {
        const base = resolveHttpBase(serverUrl);
        await fetch(`${base}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore
      }
    }
    saveAuthToken(null);
    setAuthTokenState(null);
    setCurrentUser(null);
    pushToast('已退出登录');
  }, [serverUrl, pushToast]);

  const fetchRooms = useCallback(async () => {
    try {
      const base = resolveHttpBase(serverUrl);
      const res = await fetch(`${base}/api/rooms`);
      if (!res.ok) return;
      const data = (await res.json()) as { rooms: RoomSummary[] };
      setRoomsList(data.rooms);
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
      setHistoryList(data.matches);
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
      setLeaderboard(data.users);
    } catch {
      pushToast('获取排行榜失败，请检查服务器连接', true);
    }
  }, [serverUrl, pushToast]);

  const updateServerUrl = useCallback((nextUrl: string) => {
    saveServerUrl(nextUrl);
    setServerUrl(nextUrl.trim().replace(/\/+$/, ''));
  }, []);

  const toggleMute = useCallback(() => {
    const next = !soundFX.isMuted();
    soundFX.setMuted(next);
    setMuted(next);
  }, []);

  const createRoom = useCallback(
    (opts: { mode: GameMode; debugMode: boolean; fillBots: boolean; autoStart?: boolean }) => {
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
    if (!savedSession) return;
    clientRef.current?.send({
      type: 'RECONNECT',
      roomId: savedSession.roomId,
      playerId: savedSession.playerId,
    });
  }, [savedSession]);

  const leaveRoom = useCallback(() => {
    setRoom(null);
    setView(null);
    setSession(null);
    setSavedSession(null);
    saveSession(null);
    clientRef.current?.connect();
  }, []);

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
