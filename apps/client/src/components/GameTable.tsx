import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  countBipai,
  getCardPoints,
  getSeatTeam,
  sortHandForDisplay,
  STANDARD_SUITS,
} from '@jinshan/game-core';
import type {
  Card,
  GameAction,
  PlayerView,
  RoomSummary,
  Seat,
  SeatCallDisplay,
} from '@jinshan/protocol';
import {
  getHintOptions,
  getLegalCallOptions,
  getLegalCounterOptions,
  getMandatoryFollowSelection,
  getPhaseLabel,
  getSuitName,
  getSuitSymbol,
  getTrickPlayLabel,
  isRedSuit,
  previewSelection,
} from '../utils/cardHints.js';
import { HandArea } from './HandArea.js';
import { BottomDeckStack, OpponentHandFan } from './OpponentHandFan.js';
import { PlayingCard } from './PlayingCard.js';
import { SuitGlyph } from './CardArt.js';
import { SettlementModal } from './SettlementModal.js';
import { LastTrickModal } from './LastTrickModal.js';
import { ScoreDetailModal } from './ScoreDetailModal.js';
import { DebugDrawer } from './DebugDrawer.js';
import { Icon } from './Icons.js';
import type { AppSettings } from '../utils/settings.js';
import type { PlayMode } from '../hooks/useGameClient.js';

function avatarChar(name: string): string {
  return (name || '').trim().slice(0, 1) || '牌';
}

interface GameTableProps {
  room: RoomSummary;
  view: PlayerView;
  settings: AppSettings;
  playMode?: PlayMode;
  onOpenSettings: () => void;
  onSendAction: (action: GameAction) => void;
  onSetAutoBot: (enabled: boolean) => void;
  onToggleDebugOpenHands: (enabled: boolean) => void;
  onLeaveRoom: () => void;
}

export const GameTable: React.FC<GameTableProps> = ({
  room,
  view,
  settings,
  playMode = 'online',
  onOpenSettings,
  onSendAction,
  onSetAutoBot,
  onToggleDebugOpenHands,
  onLeaveRoom,
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [hintedIds, setHintedIds] = useState<number[]>([]);
  const [hintIdx, setHintIdx] = useState(0);
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [showScoreDetail, setShowScoreDetail] = useState(false);
  const [showBottomModal, setShowBottomModal] = useState(false);
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);
  const [inspectTrickSeat, setInspectTrickSeat] = useState<Seat | null>(null);
  const [autoSelectNote, setAutoSelectNote] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isTrickPaused, setIsTrickPaused] = useState(false);
  const lastAutoSelectKeyRef = useRef<string | null>(null);

  const meSeat = view.viewerSeat;
  const rightSeat = ((meSeat + 1) % 4) as Seat;
  const topSeat = ((meSeat + 2) % 4) as Seat;
  const leftSeat = ((meSeat + 3) % 4) as Seat;
  const isMyTurn = view.currentTurn === meSeat;
  const meRoomSeat = room.seats[meSeat];

  useEffect(() => {
    if (!view.phaseDeadlineMs) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 200);
    return () => clearInterval(timer);
  }, [view.phaseDeadlineMs]);

  useEffect(() => {
    if (
      view.phase === 'PLAYING' &&
      view.currentTrick.length === 0 &&
      view.trickPauseMs &&
      view.trickPauseMs > 0
    ) {
      setIsTrickPaused(true);
      const timer = window.setTimeout(() => {
        setIsTrickPaused(false);
      }, view.trickPauseMs);
      return () => clearTimeout(timer);
    }
    setIsTrickPaused(false);
  }, [view.phase, view.roundNumber, view.trickNumber, view.currentTrick.length, view.trickPauseMs]);

  const countdownSec = useMemo(() => {
    if (!view.phaseDeadlineMs) return null;
    return Math.max(0, Math.ceil((view.phaseDeadlineMs - nowMs) / 1000));
  }, [view.phaseDeadlineMs, nowMs]);

  useEffect(() => {
    const validIds = new Set(view.myHand.map((c) => c.id));
    setSelectedIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [view.myHand]);

  useEffect(() => {
    setSelectedIds([]);
    setHintedIds([]);
    setHintIdx(0);
    setAutoSelectNote(null);
    setInspectTrickSeat(null);
    setShowBottomModal(false);
  }, [view.phase, view.trickNumber, view.roundNumber]);

  const turnAutoKey =
    view.phase === 'PLAYING' &&
    view.currentTurn === meSeat &&
    view.currentTrick.length > 0
      ? `${view.roundNumber}:${view.trickNumber}:${view.currentTrick.length}:${view.currentTurn}`
      : null;

  useEffect(() => {
    if (!turnAutoKey || !settings.autoSelectMandatory) {
      lastAutoSelectKeyRef.current = null;
      setAutoSelectNote(null);
      return;
    }
    if (lastAutoSelectKeyRef.current === turnAutoKey) {
      return;
    }
    lastAutoSelectKeyRef.current = turnAutoKey;
    const mandatory = getMandatoryFollowSelection(view);
    if (mandatory) {
      setSelectedIds(mandatory.cardIds);
      setHintedIds([]);
      setAutoSelectNote(mandatory.reason);
    } else {
      setAutoSelectNote(null);
    }
  }, [turnAutoKey, view, settings.autoSelectMandatory]);

  const handleApplySelection = (ids: number[], mode: 'select' | 'deselect') => {
    setAutoSelectNote(null);
    setSelectedIds((prev) => {
      const set = new Set(prev);
      for (const id of ids) {
        if (mode === 'select') set.add(id);
        else set.delete(id);
      }
      return Array.from(set);
    });
  };

  const preview = useMemo(
    () => previewSelection(view, selectedIds),
    [view, selectedIds],
  );

  const canCallNow =
    view.mode === 'hongxin' &&
    view.callState.callerSeat === null &&
    (view.phase === 'DEALING' ||
      (view.phase === 'CALLING' && !view.callState.passedSeats.includes(meSeat)));

  const callOptions = useMemo(
    () => (canCallNow ? getLegalCallOptions(view) : []),
    [view, canCallNow],
  );

  const canCounterNow =
    view.phase === 'COUNTER_BIDDING' &&
    view.callState.eligibleCounterSeats.includes(meSeat);

  const counterOptions = useMemo(
    () => (canCounterNow ? getLegalCounterOptions(view) : []),
    [view, canCounterNow],
  );

  const isMyCounterResponse =
    view.phase === 'COUNTER_RESPONSE' &&
    view.callState.callerSeat === meSeat &&
    view.callState.pendingCounter !== null;

  const myBipaiCount = useMemo(
    () => countBipai(view.myHand, view.levelRank),
    [view.myHand, view.levelRank],
  );

  const handleHintClick = () => {
    const options = getHintOptions(view);
    if (options.length === 0) return;
    const chosen = options[hintIdx % options.length];
    setSelectedIds(chosen);
    setHintedIds(chosen);
    setAutoSelectNote(null);
    setHintIdx((i) => i + 1);
  };

  const handleConfirmBury = () => {
    if (!preview.valid) return;
    onSendAction({ type: 'BURY_BOTTOM', seat: meSeat, cardIds: selectedIds });
    setSelectedIds([]);
  };

  const handleConfirmPlay = () => {
    if (!preview.valid || isTrickPaused) return;
    onSendAction({ type: 'PLAY_CARDS', seat: meSeat, cardIds: selectedIds });
    setSelectedIds([]);
    setHintedIds([]);
    setAutoSelectNote(null);
  };

  const getCallDisplayMeta = (display: SeatCallDisplay) => {
    switch (display.kind) {
      case 'CALL':
        return { text: '叫主', pillClass: 'pill-gold' };
      case 'COUNTER':
        return { text: '反主', pillClass: 'pill-red' };
      case 'COUNTER_SUCCESS':
        return { text: '反主成功', pillClass: 'pill-red' };
      case 'COUNTER_ACCEPTED':
        return { text: '让反成主', pillClass: 'pill-green' };
      case 'COUNTER_FAILED':
        return { text: '反主失败', pillClass: 'call-pill-muted' };
    }
  };

  const renderCallDisplaySlot = (seat: Seat, slotClass: string) => {
    const display = view.callState.seatCallDisplays?.[seat];
    if (!display) return null;
    const meta = getCallDisplayMeta(display);
    const suitSym = getSuitSymbol(display.suit);
    const suitNm = getSuitName(display.suit);
    const red = isRedSuit(display.suit);
    const isFinalCaller = view.callState.callerSeat === seat;

    return (
      <div
        className={`${slotClass} call-display-wrap ${
          display.kind === 'COUNTER_FAILED' ? 'is-failed' : ''
        } ${isFinalCaller ? 'is-active-caller' : ''}`}
      >
        {display.cards.length > 0 && (
          <div
            className="trick-cards-row call-cards-row"
            style={{ '--trick-overlap': '-20px' } as React.CSSProperties}
          >
            {display.cards.map((c, idx) => (
              <PlayingCard
                key={c.id}
                card={c}
                trumpSuit={view.trumpSuit}
                levelRank={view.levelRank}
                size="sm"
                style={{ zIndex: idx + 1 }}
              />
            ))}
          </div>
        )}
        <span className={`pill call-suit-pill ${meta.pillClass}`}>
          <span>{meta.text}</span>
          <strong className={`call-suit-emblem ${red ? 'is-red-suit' : ''}`}>
            {suitSym}
            {suitNm}
          </strong>
        </span>
      </div>
    );
  };

  const renderOpponentSeat = (
    seat: Seat,
    side: 'top' | 'left' | 'right',
  ) => {
    const info = room.seats[seat];
    const isTurn = view.currentTurn === seat;
    const isDealer = view.dealer === seat;
    const isTeammate =
      view.mode === 'hongxin' && getSeatTeam(seat) === getSeatTeam(meSeat);
    const handCount = view.handCounts[seat];
    const isTrumpCaller =
      view.callState.callerSeat === seat && view.trumpSuit !== null;

    const relLabel =
      side === 'top' ? '对家' : side === 'left' ? '上家' : '下家';

    const badgeEl = (
      <div
        className={`seat-badge ${isTurn ? 'is-turn' : ''} ${
          isTeammate ? 'is-teammate' : view.mode === 'hongxin' ? 'is-opponent' : ''
        }`}
      >
        <div className="seat-avatar-wrap">
          <span className={`seat-avatar ${info.isBot ? 'is-bot' : ''}`}>
            {info.isBot ? <Icon name="robot" className="seat-avatar-icon" /> : avatarChar(info.name)}
          </span>
          {isDealer && <span className="seal seat-seal">庄</span>}
        </div>
        <div className="seat-plate">
          <div className="seat-badge-row">
            <strong className={`seat-name ${isTurn ? 'is-turn' : ''}`}>{info.name}</strong>
            {isTrumpCaller && view.trumpSuit && (
              <span
                className={`seat-tag is-trump ${isRedSuit(view.trumpSuit) ? 'is-red-suit' : ''}`}
                title="本局定主玩家"
              >
                主{getSuitSymbol(view.trumpSuit)}
              </span>
            )}
            {info.autoBot && !info.isBot && <span className="seat-tag">托管</span>}
            {!info.connected && !info.isBot && <span className="seat-tag is-off">离线</span>}
          </div>
          <div className="seat-badge-sub">
            <span className="seat-rel">
              {isTeammate ? '队友' : relLabel}
              {view.mode === 'hongxin' ? ` · ${getSeatTeam(seat)}队` : ''}
            </span>
            {view.mode === 'heixin' && (
              <span className="seat-score">{view.playerScores[seat]}分</span>
            )}
          </div>
        </div>
      </div>
    );

    return (
      <div className={`seat-zone seat-${side} ${isTurn ? 'is-turn' : ''}`}>
        {badgeEl}
        <OpponentHandFan count={handCount} side={side} isTurn={isTurn} />
      </div>
    );
  };

  // Keep previous trick's 4 plays visible on table until the first card of the next trick is played
  const isShowingLastTrick =
    view.currentTrick.length === 0 &&
    view.lastTrick !== null &&
    (view.phase === 'PLAYING' ||
      view.phase === 'ROUND_OVER' ||
      view.phase === 'MATCH_OVER');

  const activeTrickPlays = useMemo(
    () =>
      isShowingLastTrick && view.lastTrick
        ? view.lastTrick.plays
        : view.currentTrick,
    [view.currentTrick, view.lastTrick, isShowingLastTrick],
  );

  const trickBySeat = useMemo(() => {
    const map = new Map<Seat, (typeof view.currentTrick)[number]>();
    for (const p of activeTrickPlays) {
      map.set(p.seat, p);
    }
    return map;
  }, [activeTrickPlays]);

  const activeLeadSeat = activeTrickPlays[0]?.seat ?? null;

  const splitCardsIntoRows = (cards: readonly Card[], rowCount: number): Card[][] => {
    if (rowCount <= 1 || cards.length <= 1) return [[...cards]];
    const rows: Card[][] = [];
    const perRow = Math.ceil(cards.length / rowCount);
    for (let i = 0; i < cards.length; i += perRow) {
      rows.push(cards.slice(i, i + perRow));
    }
    return rows;
  };

  const renderTrickSlot = (
    seat: Seat,
    slotClass: string,
    placement: 'top' | 'bottom' | 'left' | 'right',
  ) => {
    const play = trickBySeat.get(seat);
    if (!play) return null;

    const sortedCards = sortHandForDisplay(
      play.cards,
      view.trumpSuit,
      view.levelRank,
    );
    const count = sortedCards.length;
    const isSide = placement === 'left' || placement === 'right';

    // Adaptive sizing + row wrapping so large plays (6~24+ cards) NEVER collide with top/bottom nameplates.
    // Top & bottom slots share tight vertical space in landscape phones -> stay single-row up to 12 cards!
    // Left & right slots span both vertical rows -> wrap to 2 rows earlier to keep horizontal margin clean.
    let cardSize: 'sm' | 'xs' = 'sm';
    let rowCount = 1;
    let overlapRatio = -0.44;

    if (count <= 5) {
      cardSize = 'sm';
      rowCount = 1;
      overlapRatio = count <= 4 ? -0.42 : -0.5;
    } else if (count === 6) {
      cardSize = 'sm';
      rowCount = isSide ? 2 : 1;
      overlapRatio = isSide ? -0.44 : -0.54;
    } else if (!isSide && count <= 12) {
      cardSize = 'xs';
      rowCount = 1;
      overlapRatio = count <= 8 ? -0.44 : count <= 10 ? -0.48 : -0.54;
    } else if (isSide && count <= 12) {
      cardSize = count <= 10 ? 'sm' : 'xs';
      rowCount = 2;
      overlapRatio = cardSize === 'sm' ? -0.54 : -0.48;
    } else {
      cardSize = 'xs';
      rowCount = !isSide ? 2 : count <= 18 ? 2 : 3;
      overlapRatio = !isSide
        ? count <= 18
          ? -0.52
          : -0.58
        : -0.52;
    }

    const rows = splitCardsIntoRows(sortedCards, rowCount);
    const cardWVar = cardSize === 'xs' ? 'var(--card-xs-w)' : 'var(--card-sm-w)';
    const cardHVar = cardSize === 'xs' ? 'var(--card-xs-h)' : 'var(--card-sm-h)';
    const rowOverlapRatio =
      rowCount >= 3 ? -0.58 : !isSide ? -0.56 : -0.48;

    const isTrickWinner =
      isShowingLastTrick && view.lastTrick?.winnerSeat === seat;
    const isLead = activeLeadSeat === seat;
    const labelText = getTrickPlayLabel(play.parsed, count, isLead);

    return (
      <div
        className={`${slotClass} trick-slot-wrap ${
          isShowingLastTrick ? 'is-completed-trick' : ''
        } ${isTrickWinner ? 'is-trick-winner' : ''} ${
          count >= 6 ? 'is-inspectable' : ''
        }`}
        onClick={count >= 6 ? () => setInspectTrickSeat(seat) : undefined}
        title={count >= 6 ? '点击放大查看全部牌面' : undefined}
      >
        <div
          className={`trick-cards-stack ${rowCount > 1 ? 'is-multi-row' : ''}`}
          style={
            {
              '--trick-overlap': `calc(${cardWVar} * ${overlapRatio})`,
              '--trick-row-overlap': `calc(${cardHVar} * ${rowOverlapRatio})`,
            } as React.CSSProperties
          }
        >
          {rows.map((rowCards, rowIdx) => (
            <div key={rowIdx} className="trick-cards-row">
              {rowCards.map((c, idx) => (
                <PlayingCard
                  key={c.id}
                  card={c}
                  trumpSuit={view.trumpSuit}
                  levelRank={view.levelRank}
                  size={cardSize}
                  style={{ zIndex: rowIdx * 20 + idx + 1 }}
                />
              ))}
            </div>
          ))}
        </div>
        <span className={`pill trick-pattern-tag ${isTrickWinner ? 'pill-gold' : ''}`}>
          {isTrickWinner ? '★赢 ' : ''}
          {labelText}
        </span>
      </div>
    );
  };

  const latestEvent =
    view.events.length > 0 ? view.events[view.events.length - 1].message : '';

  const heixinBidTarget = view.bidState?.highestBid || 0;
  const capturedPoints =
    view.mode === 'hongxin' ? view.challengerPoints : view.bankerPoints;
  const escapedPoints =
    view.mode === 'hongxin' ? view.bankerPoints : view.challengerPoints;
  const scorePct =
    view.mode === 'hongxin'
      ? Math.min(100, Math.round((capturedPoints / 300) * 100))
      : heixinBidTarget > 0
        ? Math.min(100, Math.round((capturedPoints / heixinBidTarget) * 100))
        : 0;
  const escapedPct = Math.min(
    Math.max(0, 100 - scorePct),
    Math.round((escapedPoints / 300) * 100),
  );

  const currentTurnName =
    view.currentTurn !== null && view.currentTurn !== undefined
      ? room.seats[view.currentTurn]?.name ?? `座位 ${view.currentTurn + 1}`
      : '';
  const isMyActionNow =
    isMyTurn || canCounterNow || isMyCounterResponse || (canCallNow && callOptions.length > 0);
  const isCallPhase =
    view.phase === 'DEALING' ||
    view.phase === 'CALLING' ||
    view.phase === 'COUNTER_BIDDING' ||
    view.phase === 'COUNTER_RESPONSE' ||
    view.phase === 'BURYING' ||
    view.phase === 'BIDDING' ||
    view.phase === 'CHOOSE_TRUMP';
  const trumpRed = view.trumpSuit ? isRedSuit(view.trumpSuit) : false;
  const calledSuit = view.callState.calledSuit;
  const showCallSuitDock =
    view.mode === 'hongxin' &&
    (view.phase === 'DEALING' || view.phase === 'CALLING') &&
    (calledSuit !== null ||
      (canCallNow && (callOptions.length > 0 || view.phase === 'CALLING')));
  const meTeammateLabel =
    view.mode === 'hongxin' ? `${getSeatTeam(meSeat)}队` : view.dealer === meSeat ? '庄家' : '闲家';

  const statusText = (() => {
    if (view.phase === 'DEALING' && !(canCallNow && callOptions.length > 0)) {
      if (view.mode === 'heixin') return `正在发牌 ${view.dealtCount}/38`;
      return view.callState.callerSeat !== null
        ? `已有人叫主，发完牌进入反主 ${view.dealtCount}/38`
        : `发牌中 ${view.dealtCount}/38 · 拿到箭牌可随时亮主`;
    }
    if (view.phase === 'CALLING' && !canCallNow) return '已选择不叫，等待其他玩家叫主…';
    if (view.phase === 'COUNTER_BIDDING' && !canCounterNow) {
      return view.callState.counterAttempts === 0
        ? '等待敌方决定是否反主（先点先得）…'
        : '等待败方队友决定是否再反主…';
    }
    if (view.phase === 'COUNTER_RESPONSE' && view.callState.pendingCounter && !isMyCounterResponse) {
      return `等待 ${room.seats[view.callState.callerSeat ?? 0].name} 决定让反或比牌…`;
    }
    if (
      !isMyTurn &&
      view.phase !== 'DEALING' &&
      view.phase !== 'CALLING' &&
      view.phase !== 'COUNTER_BIDDING' &&
      view.phase !== 'COUNTER_RESPONSE' &&
      view.phase !== 'ROUND_OVER' &&
      view.phase !== 'MATCH_OVER'
    ) {
      return `等待 ${currentTurnName} ${view.phase === 'PLAYING' ? '出牌' : '操作'}…`;
    }
    return null;
  })();

  return (
    <div
      className={`table-root mode-${view.mode} ${isMyActionNow ? 'is-my-action' : ''}`}
      data-table-skin={settings.tableSkin}
    >
      {/* Top HUD */}
      <header className="table-hud">
        <div className="hud-group hud-match">
          <span className={`hud-mode ${view.mode === 'hongxin' ? 'is-hongxin' : 'is-heixin'}`}>
            <span className="hud-mode-suit">{view.mode === 'hongxin' ? '♥' : '♠'}</span>
            <span className="hud-mode-text">
              <strong>{view.mode === 'hongxin' ? '打红心' : '打黑心'}</strong>
              <small>
                第{view.roundNumber}局{playMode !== 'online' ? ` · ${playMode === 'offline' ? '单机' : '局域网'}` : ''}
              </small>
            </span>
          </span>
          <span className="hud-chip" title="本局级牌">
            <small>级</small>
            <strong className="hud-chip-num">{view.levelRank}</strong>
          </span>
          <span className={`hud-chip hud-trump ${trumpRed ? 'is-red-suit' : ''}`} title="本局主花色">
            <small>主</small>
            {view.trumpSuit ? (
              <strong className="hud-trump-suit">
                {getSuitSymbol(view.trumpSuit)}
                <span className="hud-trump-name">{getSuitName(view.trumpSuit)}</span>
              </strong>
            ) : (
              <strong className="hud-trump-none">无</strong>
            )}
          </span>
          <span className="hud-phase">
            {getPhaseLabel(view.phase, view.mode)}
            {view.phase === 'PLAYING' ? ` · 第${view.trickNumber}墩` : ''}
          </span>
        </div>

        <div className="hud-group hud-score">
          {view.mode === 'hongxin' ? (
            <span className="hud-levels" title="两队当前级别">
              <span className={getSeatTeam(meSeat) === 'A' ? 'is-mine' : ''}>
                A<b>{view.teams.A.levelRank}</b>
                {view.teams.A.penaltyCount > 0 && <i>罚{view.teams.A.penaltyCount}</i>}
              </span>
              <span className={getSeatTeam(meSeat) === 'B' ? 'is-mine' : ''}>
                B<b>{view.teams.B.levelRank}</b>
                {view.teams.B.penaltyCount > 0 && <i>罚{view.teams.B.penaltyCount}</i>}
              </span>
            </span>
          ) : (
            <span className="hud-levels" title="叫分 / 我的总分">
              <span>
                叫<b>{view.bidState?.highestBid || '-'}</b>
              </span>
              <span className="is-mine">
                我<b>{view.playerScores[meSeat]}</b>
              </span>
            </span>
          )}

          <button
            type="button"
            className="score-meter is-clickable"
            onClick={() => setShowScoreDetail(true)}
            title={
              view.mode === 'hongxin'
                ? `闲家已拿 ${capturedPoints} 分（及格 120），庄家已跑 ${escapedPoints} 分，点击查看详情`
                : `庄家已拿 ${capturedPoints} 分（目标 ${heixinBidTarget || '-'}），闲家已跑 ${escapedPoints} 分，点击查看详情`
            }
          >
            <span className="score-meter-track">
              <span className="score-meter-fill" style={{ width: `${scorePct}%` }} />
              {escapedPct > 0 && (
                <span className="score-meter-escaped" style={{ width: `${escapedPct}%` }} />
              )}
              {view.mode === 'hongxin' && (
                <>
                  <span className="score-meter-tick" style={{ left: '13.3%' }} />
                  <span className="score-meter-tick is-pass" style={{ left: '40%' }} />
                  <span className="score-meter-tick" style={{ left: '60%' }} />
                  <span className="score-meter-tick" style={{ left: '80%' }} />
                </>
              )}
            </span>
            <span className="score-meter-label">
              <span className="score-meter-main">
                {view.mode === 'hongxin' ? '闲' : '庄'}
                <b>{capturedPoints}</b>/{view.mode === 'hongxin' ? 120 : heixinBidTarget || '-'}
              </span>
              <span className="score-meter-sub">跑 {escapedPoints}</span>
              <span className="score-meter-hint">查分</span>
            </span>
          </button>
        </div>

        <div className="hud-group hud-tools">
          <button
            type="button"
            className="hud-btn"
            onClick={() => setShowLastTrick(true)}
            disabled={!view.lastTrick}
          >
            <Icon name="history" />
            <span>上一轮</span>
          </button>
          <button
            type="button"
            className={`hud-btn ${meRoomSeat.autoBot ? 'is-on' : ''}`}
            onClick={() => onSetAutoBot(!meRoomSeat.autoBot)}
          >
            <Icon name="robot" />
            <span>{meRoomSeat.autoBot ? '取消托管' : '托管'}</span>
          </button>
          {room.debugMode && (
            <button
              type="button"
              className={`hud-btn ${room.debugOpenHands ? 'is-on' : ''}`}
              onClick={() => {
                const next = !room.debugOpenHands;
                onToggleDebugOpenHands(next);
                setShowDebugDrawer(next);
              }}
            >
              <Icon name="eye" />
              <span>上帝视角</span>
            </button>
          )}
          <button type="button" className="hud-btn is-icon-only" onClick={onOpenSettings} aria-label="设置">
            <Icon name="gear" />
            <span>设置</span>
          </button>
          <button type="button" className="hud-btn is-icon-only is-danger" onClick={onLeaveRoom} aria-label="退出">
            <Icon name="exit" />
            <span>退出</span>
          </button>
        </div>
      </header>

      {/* Arena: 3 opponents + centre trick mat */}
      <div className="table-arena">
        <div className="table-mat" aria-hidden="true">
          <span className="table-mat-emblem" />
        </div>
        {renderOpponentSeat(topSeat, 'top')}
        {renderOpponentSeat(leftSeat, 'left')}
        {renderOpponentSeat(rightSeat, 'right')}

        <div className="trick-center">
          {isCallPhase ? (
            <div className="call-stage-grid">
              {renderCallDisplaySlot(topSeat, 'call-slot-top')}
              {renderCallDisplaySlot(leftSeat, 'call-slot-left')}
              <div className="call-slot-center">
                {view.phase === 'DEALING' ? (
                  <div className="dealing-center-box">
                    <BottomDeckStack
                      count={Math.max(1, Math.min(10, Math.ceil((38 - view.dealtCount) / 4) + 2))}
                      label={`发牌中 ${view.dealtCount} / 38`}
                    />
                  </div>
                ) : view.phase === 'COUNTER_RESPONSE' && view.callState.pendingCounter ? (
                  <div className="counter-response-banner">
                    <div className="counter-response-title">
                      <span className="seal">反</span>
                      {room.seats[view.callState.pendingCounter.seat].name} 发起反主
                      <strong className={isRedSuit(view.callState.pendingCounter.suit) ? 'is-red-suit' : ''}>
                        {getSuitSymbol(view.callState.pendingCounter.suit)}
                        {getSuitName(view.callState.pendingCounter.suit)}
                      </strong>
                    </div>
                    <div className="counter-response-sub">
                      等待 {room.seats[view.callState.callerSeat ?? 0].name} 选择让反或比牌
                      {countdownSec !== null ? `（${countdownSec}s）` : ''}
                    </div>
                  </div>
                ) : view.phase === 'BURYING' ? (
                  <div className="center-notice">
                    <span className="seal">庄</span>
                    {room.seats[view.dealer ?? 0].name} 正在埋底…
                  </div>
                ) : view.bottomCount > 0 ? (
                  <BottomDeckStack count={view.bottomCount} />
                ) : null}
              </div>
              {renderCallDisplaySlot(rightSeat, 'call-slot-right')}
              {!(showCallSuitDock && view.callState.callerSeat === meSeat) &&
                renderCallDisplaySlot(meSeat, 'call-slot-bottom')}
            </div>
          ) : (
            <div className="trick-grid">
              {renderTrickSlot(topSeat, 'trick-slot-top', 'top')}
              {renderTrickSlot(leftSeat, 'trick-slot-left', 'left')}
              {renderTrickSlot(rightSeat, 'trick-slot-right', 'right')}
              {renderTrickSlot(meSeat, 'trick-slot-bottom', 'bottom')}
            </div>
          )}
          {latestEvent && (
            <div className="event-ribbon" key={latestEvent}>
              {latestEvent}
            </div>
          )}
        </div>
      </div>

      <div className="table-dock">
      {/* Phase contextual action bar */}
      <div className={`action-bar ${showCallSuitDock ? 'has-call-dock' : ''}`}>
        <div className="action-bar-group action-status">
          <span className={`me-chip ${isMyActionNow ? 'is-turn' : ''}`}>
            <span className="me-chip-avatar">{avatarChar(meRoomSeat.name || '我')}</span>
            <span className="me-chip-text">
              <strong>{isMyTurn || isMyCounterResponse ? '轮到你' : '我'}</strong>
              <small>{meTeammateLabel}</small>
            </span>
            {view.dealer === meSeat && <span className="seal">庄</span>}
            {view.callState.callerSeat === meSeat && view.trumpSuit && (
              <span className={`seat-tag is-trump ${trumpRed ? 'is-red-suit' : ''}`}>
                主{getSuitSymbol(view.trumpSuit)}
              </span>
            )}
          </span>

          {meRoomSeat.autoBot && (
            <button type="button" className="autobot-banner" onClick={() => onSetAutoBot(false)}>
              <Icon name="robot" />
              托管代打中 · 点此取消
            </button>
          )}

          {countdownSec !== null &&
            (view.phase === 'CALLING' ||
              view.phase === 'COUNTER_BIDDING' ||
              view.phase === 'COUNTER_RESPONSE') && (
              <span className={`countdown-pill ${countdownSec <= 3 ? 'is-urgent' : ''}`}>
                <Icon name="clock" />
                {countdownSec}s
              </span>
            )}

          {(view.phase === 'COUNTER_BIDDING' ||
            (view.phase === 'COUNTER_RESPONSE' && view.callState.pendingCounter)) && (
            <span className="pill pill-gold">21张比牌 {myBipaiCount}</span>
          )}

          {view.phase === 'BURYING' && isMyTurn && (
            <span className={`pill ${preview.valid ? 'pill-green' : 'pill-red'}`}>
              {preview.valid ? preview.label : preview.error}
            </span>
          )}

          {view.phase === 'PLAYING' && isMyTurn && autoSelectNote && (
            <span className="pill pill-blue auto-select-pill">{autoSelectNote}</span>
          )}
          {view.phase === 'PLAYING' && isMyTurn && selectedIds.length > 0 && (
            <span className={`pill ${preview.valid ? 'pill-green' : 'pill-red'}`}>
              {preview.valid ? preview.label : preview.error}
            </span>
          )}

          {!showCallSuitDock && statusText && <span className="action-hint">{statusText}</span>}
        </div>

        {showCallSuitDock && (
          calledSuit !== null ? (
            <div
              className="call-suit-dock"
              role="status"
              aria-live="polite"
              aria-label={`已亮主 ${getSuitName(calledSuit)}`}
            >
              <div
                className={`call-suit-btn is-called-highlight ${isRedSuit(calledSuit) ? 'is-red-suit' : 'is-black-suit'}`}
              >
                <span className="call-suit-glyph-wrap">
                  <SuitGlyph suit={calledSuit} className="call-suit-glyph" />
                </span>
                <span className="call-suit-meta">
                  <strong>{getSuitName(calledSuit)}主</strong>
                  <small>{view.callState.callerSeat === meSeat ? '你已亮主' : '已亮主'}</small>
                </span>
              </div>
            </div>
          ) : (
            <div className="call-suit-dock" role="group" aria-label="亮主花色选择">
              {callOptions.map((opt, idx) => (
                <button
                  key={`${opt.suit}-${opt.count}-${idx}`}
                  type="button"
                  className={`call-suit-btn is-callable ${isRedSuit(opt.suit) ? 'is-red-suit' : 'is-black-suit'}`}
                  title={opt.label}
                  onClick={() =>
                    onSendAction({
                      type: 'CALL_TRUMP',
                      seat: meSeat,
                      suit: opt.suit,
                      cardIds: opt.cardIds,
                    })
                  }
                >
                  <span className="call-suit-glyph-wrap">
                    <SuitGlyph suit={opt.suit} className="call-suit-glyph" />
                  </span>
                  <span className="call-suit-meta">
                    <strong>{view.isFirstRound ? `${opt.count}张2` : `亮${view.levelRank}`}</strong>
                  </span>
                </button>
              ))}
              {view.phase === 'CALLING' && canCallNow && (
                <button
                  type="button"
                  className="btn call-suit-pass-btn"
                  onClick={() => onSendAction({ type: 'PASS_CALL', seat: meSeat })}
                >
                  不叫
                </button>
              )}
            </div>
          )
        )}

        <div className="action-bar-group action-buttons">
          {view.phase === 'PLAYING' &&
            view.dealer === meSeat &&
            view.revealedBottom &&
            view.revealedBottom.length > 0 && (
              <button
                type="button"
                className="btn btn-xs btn-ghost"
                onClick={() => setShowBottomModal(true)}
              >
                <Icon name="layers" />
                看底牌
              </button>
            )}

          {view.phase === 'COUNTER_BIDDING' && canCounterNow && (
            <>
              {counterOptions.map((opt) => (
                <button
                  key={opt.suit}
                  type="button"
                  className="btn btn-crimson"
                  onClick={() =>
                    onSendAction({
                      type: 'COUNTER_BID',
                      seat: meSeat,
                      suit: opt.suit,
                      cardIds: opt.cardIds,
                    })
                  }
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => onSendAction({ type: 'PASS_COUNTER', seat: meSeat })}
              >
                放弃反主
              </button>
            </>
          )}

          {view.phase === 'COUNTER_RESPONSE' && view.callState.pendingCounter && isMyCounterResponse && (
            <>
              <button
                type="button"
                className="btn btn-emerald"
                onClick={() => onSendAction({ type: 'ACCEPT_COUNTER', seat: meSeat })}
              >
                接受被反（改打{getSuitSymbol(view.callState.pendingCounter.suit)}
                {getSuitName(view.callState.pendingCounter.suit)}）
              </button>
              <button
                type="button"
                className="btn btn-crimson"
                onClick={() => onSendAction({ type: 'DEFEND_COUNTER', seat: meSeat })}
              >
                拒绝并比牌
              </button>
            </>
          )}

          {view.phase === 'BIDDING' && view.bidState && isMyTurn && (
            <>
              {[100, 120, 150, 180, 200, 250, 300]
                .filter((s) => s > view.bidState!.highestBid)
                .slice(0, 4)
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn btn-gold"
                    onClick={() => onSendAction({ type: 'BID_SCORE', seat: meSeat, score: s })}
                  >
                    叫 {s}
                  </button>
                ))}
              {view.bidState.highestBid >= 100 && view.bidState.highestBid + 5 <= 300 && (
                <button
                  type="button"
                  className="btn btn-emerald"
                  onClick={() =>
                    onSendAction({
                      type: 'BID_SCORE',
                      seat: meSeat,
                      score: view.bidState!.highestBid + 5,
                    })
                  }
                >
                  +5（{view.bidState.highestBid + 5}）
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => onSendAction({ type: 'PASS_BID', seat: meSeat })}
              >
                不叫
              </button>
            </>
          )}

          {view.phase === 'CHOOSE_TRUMP' && isMyTurn && (
            <>
              {STANDARD_SUITS.map((suit) => {
                const cnt = view.myHand.filter((c) => c.suit === suit).length;
                return (
                  <button
                    key={suit}
                    type="button"
                    className={`btn btn-suit ${isRedSuit(suit) ? 'is-red-suit' : ''}`}
                    onClick={() => onSendAction({ type: 'CHOOSE_TRUMP', seat: meSeat, suit })}
                  >
                    <span className="btn-suit-glyph">{getSuitSymbol(suit)}</span>
                    {getSuitName(suit)}
                    <small>{cnt}张</small>
                  </button>
                );
              })}
            </>
          )}

          {view.phase === 'BURYING' && isMyTurn && (
            <>
              <button type="button" className="btn" onClick={handleHintClick}>
                <Icon name="bulb" />
                智能选底
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setSelectedIds([])}
                disabled={selectedIds.length === 0}
              >
                清空
              </button>
              <button
                type="button"
                className="btn btn-gold btn-lg"
                disabled={!preview.valid}
                onClick={handleConfirmBury}
              >
                确认埋底
              </button>
            </>
          )}

          {view.phase === 'PLAYING' && isMyTurn && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSelectedIds([]);
                  setHintedIds([]);
                  setAutoSelectNote(null);
                }}
                disabled={selectedIds.length === 0}
              >
                <Icon name="undo" />
                重选
              </button>
              <button type="button" className="btn btn-emerald" onClick={handleHintClick}>
                <Icon name="bulb" />
                提示
              </button>
              <button
                type="button"
                className="btn btn-gold btn-lg btn-play"
                disabled={!preview.valid || isTrickPaused}
                onClick={handleConfirmPlay}
              >
                {isTrickPaused ? '稍候…' : selectedIds.length > 0 ? `出牌 · ${selectedIds.length}` : '出牌'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Responsive Hand Zone */}
      <HandArea
        cards={view.myHand}
        trumpSuit={view.trumpSuit}
        levelRank={view.levelRank}
        mode={view.mode}
        phase={view.phase}
        selectedIds={selectedIds}
        hintedIds={hintedIds}
        defaultLayout={settings.handLayout}
        showCardBadges={settings.showCardBadges}
        showPointPips={settings.showPointPips}
        onApplySelection={handleApplySelection}
      />
      </div>

      {(view.phase === 'ROUND_OVER' || view.phase === 'MATCH_OVER') && (
        <SettlementModal
          view={view}
          onNextRound={() => onSendAction({ type: 'NEXT_ROUND' })}
          onLeaveRoom={onLeaveRoom}
        />
      )}

      {showScoreDetail && (
        <ScoreDetailModal view={view} onClose={() => setShowScoreDetail(false)} />
      )}
      {showLastTrick && (
        <LastTrickModal
          room={room}
          view={view}
          onClose={() => setShowLastTrick(false)}
        />
      )}
      {inspectTrickSeat !== null && trickBySeat.has(inspectTrickSeat) && (
        <div
          className="modal-backdrop"
          onClick={() => setInspectTrickSeat(null)}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {room.seats[inspectTrickSeat]?.name ?? `座位 ${inspectTrickSeat + 1}`} 本轮出牌详情（
                {trickBySeat.get(inspectTrickSeat)!.cards.length} 张）
              </h3>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setInspectTrickSeat(null)}
              >
                <Icon name="close" />
                关闭
              </button>
            </div>
            <div className="modal-subtitle">
              {getTrickPlayLabel(
                trickBySeat.get(inspectTrickSeat)!.parsed,
                trickBySeat.get(inspectTrickSeat)!.cards.length,
                activeLeadSeat === inspectTrickSeat,
              )}
            </div>
            <div className="cards-wrap">
              {sortHandForDisplay(
                trickBySeat.get(inspectTrickSeat)!.cards,
                view.trumpSuit,
                view.levelRank,
              ).map((card) => (
                <PlayingCard
                  key={card.id}
                  card={card}
                  trumpSuit={view.trumpSuit}
                  levelRank={view.levelRank}
                  size="sm"
                />
              ))}
            </div>
          </div>
        </div>
      )}
      {showBottomModal &&
        view.dealer === meSeat &&
        view.revealedBottom &&
        view.revealedBottom.length > 0 && (
          <div
            className="modal-backdrop"
            onClick={() => setShowBottomModal(false)}
          >
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>
                  庄家底牌（共 {view.revealedBottom.length} 张 · 含{' '}
                  {view.revealedBottom.reduce((sum, c) => sum + getCardPoints(c), 0)} 分）
                </h3>
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => setShowBottomModal(false)}
                >
                  <Icon name="close" />
                  关闭
                </button>
              </div>
              <div className="cards-wrap">
                {sortHandForDisplay(
                  view.revealedBottom,
                  view.trumpSuit,
                  view.levelRank,
                ).map((card) => (
                  <PlayingCard
                    key={card.id}
                    card={card}
                    trumpSuit={view.trumpSuit}
                    levelRank={view.levelRank}
                    size="sm"
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      {showDebugDrawer && view.debugView && (
        <DebugDrawer view={view} onClose={() => setShowDebugDrawer(false)} />
      )}
    </div>
  );
};
