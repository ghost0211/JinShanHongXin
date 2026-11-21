import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GameAction,
  GameMode,
  PlayerView,
  RoomSummary,
  Seat,
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

export function useGameClient() {
  const [serverUrl, setServerUrl] = useState<string>(() => getSavedServerUrl());
  const [playerName, setPlayerNameState] = useState<string>(() => loadPlayerName());
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected');
  const [session, setSession] = useState<SavedSession | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSavedSession());
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [roomsList, setRoomsList] = useState<RoomSummary[]>([]);
  const [historyList, setHistoryList] = useState<MatchHistoryRow[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [muted, setMuted] = useState<boolean>(() => soundFX.isMuted());

  const clientRef = useRef<ManagedWsClient | null>(null);
  const sessionRef = useRef<SavedSession | null>(session);
  sessionRef.current = session;
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

  useEffect(() => {
    const client = new ManagedWsClient(serverUrl);
    clientRef.current = client;

    const unsubStatus = client.onStatus((status) => {
      setConnStatus(status);
      if (status === 'connected' && sessionRef.current) {
        client.send({
          type: 'RECONNECT',
          roomId: sessionRef.current.roomId,
          playerId: sessionRef.current.playerId,
        });
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
            if (prev && msg.view.events.length > prev.events.length) {
              const lastEv = msg.view.events[msg.view.events.length - 1];
              if (lastEv?.type === 'SLING_FAILED') {
                pushToast(lastEv.message, true);
              } else if (lastEv?.type === 'COUNTER_FAILED') {
                pushToast(lastEv.message, true);
              } else if (lastEv?.type === 'COUNTER_SUCCESS') {
                soundFX.playSuccess();
              } else if (lastEv?.type === 'CARD_PLAYED') {
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
        playerName,
        mode: opts.mode,
        debugMode: opts.debugMode,
        fillBots: opts.fillBots,
        autoStart: opts.autoStart,
      });
    },
    [playerName],
  );

  const joinRoom = useCallback(
    (roomId: string) => {
      clientRef.current?.send({
        type: 'JOIN_ROOM',
        roomId: roomId.trim(),
        playerName,
      });
    },
    [playerName],
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
    // Reconnect fresh WS so server removes old lobby slot cleanly
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
    session,
    savedSession,
    room,
    view,
    roomsList,
    historyList,
    toasts,
    muted,
    toggleMute,
    pushToast,
    fetchRooms,
    fetchHistory,
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
