import React, { useEffect, useMemo, useState } from 'react';
import { countBipai, getSeatTeam, STANDARD_SUITS } from '@jinshan/game-core';
import type { GameAction, PlayerView, RoomSummary, Seat } from '@jinshan/protocol';
import {
  getHintOptions,
  getLegalCallOptions,
  getLegalCounterOptions,
  getPatternLabel,
  getPhaseLabel,
  getSuitName,
  getSuitSymbol,
  previewSelection,
} from '../utils/cardHints.js';
import { HandArea } from './HandArea.js';
import { PlayingCard } from './PlayingCard.js';
import { SettlementModal } from './SettlementModal.js';
import { RulesModal } from './RulesModal.js';
import { LastTrickModal } from './LastTrickModal.js';
import { DebugDrawer } from './DebugDrawer.js';

interface GameTableProps {
  room: RoomSummary;
  view: PlayerView;
  muted: boolean;
  onToggleMute: () => void;
  onSendAction: (action: GameAction) => void;
  onSetAutoBot: (enabled: boolean) => void;
  onToggleDebugOpenHands: (enabled: boolean) => void;
  onLeaveRoom: () => void;
}

export const GameTable: React.FC<GameTableProps> = ({
  room,
  view,
  muted,
  onToggleMute,
  onSendAction,
  onSetAutoBot,
  onToggleDebugOpenHands,
  onLeaveRoom,
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [hintedIds, setHintedIds] = useState<number[]>([]);
  const [hintIdx, setHintIdx] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);

  const meSeat = view.viewerSeat;
  const rightSeat = ((meSeat + 1) % 4) as Seat;
  const topSeat = ((meSeat + 2) % 4) as Seat;
  const leftSeat = ((meSeat + 3) % 4) as Seat;
  const isMyTurn = view.currentTurn === meSeat;
  const meRoomSeat = room.seats[meSeat];

  useEffect(() => {
    const validIds = new Set(view.myHand.map((c) => c.id));
    setSelectedIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [view.myHand]);

  useEffect(() => {
    setSelectedIds([]);
    setHintedIds([]);
    setHintIdx(0);
  }, [view.phase, view.trickNumber, view.roundNumber]);

  const handleApplySelection = (ids: number[], mode: 'select' | 'deselect') => {
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

  const callOptions = useMemo(
    () => (view.phase === 'CALLING' && isMyTurn ? getLegalCallOptions(view) : []),
    [view, isMyTurn],
  );

  const counterOptions = useMemo(
    () =>
      view.phase === 'COUNTER_BIDDING' && isMyTurn
        ? getLegalCounterOptions(view)
        : [],
    [view, isMyTurn],
  );

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
    setHintIdx((i) => i + 1);
  };

  const handleConfirmBury = () => {
    if (!preview.valid) return;
    onSendAction({ type: 'BURY_BOTTOM', seat: meSeat, cardIds: selectedIds });
    setSelectedIds([]);
  };

  const handleConfirmPlay = () => {
    if (!preview.valid) return;
    onSendAction({ type: 'PLAY_CARDS', seat: meSeat, cardIds: selectedIds });
    setSelectedIds([]);
    setHintedIds([]);
  };

  const renderOpponentBadge = (seat: Seat, posClass: string) => {
    const info = room.seats[seat];
    const isTurn = view.currentTurn === seat;
    const isDealer = view.dealer === seat;
    const isTeammate =
      view.mode === 'hongxin' && getSeatTeam(seat) === getSeatTeam(meSeat);
    return (
      <div className={`seat-badge ${posClass} ${isTurn ? 'is-turn' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <strong style={{ fontSize: 12, color: isTurn ? 'var(--gold-strong)' : '#fff' }}>
            {info.name}
          </strong>
          {isDealer && <span className="pill pill-red">庄</span>}
          {!isDealer && isTeammate && <span className="pill pill-green">友</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
          <span>余 {view.handCounts[seat]} 张</span>
          {view.mode === 'heixin' ? (
            <span>{view.playerScores[seat]} 分</span>
          ) : (
            <span>{getSeatTeam(seat)}队</span>
          )}
        </div>
        {info.autoBot && !info.isBot && (
          <span className="pill pill-gold" style={{ alignSelf: 'flex-start' }}>
            托管中
          </span>
        )}
      </div>
    );
  };

  const trickBySeat = useMemo(() => {
    const map = new Map<Seat, (typeof view.currentTrick)[number]>();
    for (const p of view.currentTrick) {
      map.set(p.seat, p);
    }
    return map;
  }, [view.currentTrick]);

  const renderTrickSlot = (seat: Seat, slotClass: string) => {
    const play = trickBySeat.get(seat);
    if (!play) return null;
    return (
      <div className={slotClass} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <div className="trick-cards-row">
          {play.cards.map((c) => (
            <PlayingCard
              key={c.id}
              card={c}
              trumpSuit={view.trumpSuit}
              levelRank={view.levelRank}
              size="sm"
            />
          ))}
        </div>
        <span className="pill" style={{ fontSize: 10 }}>
          {getPatternLabel(play.parsed)}
        </span>
      </div>
    );
  };

  const latestEvent =
    view.events.length > 0 ? view.events[view.events.length - 1].message : '';

  const scorePct = Math.min(100, Math.round((view.challengerPoints / 300) * 100));

  return (
    <div className="table-root">
      {/* Top HUD */}
      <div className="table-hud">
        <div className="hud-group">
          <span className="pill pill-gold">
            {view.mode === 'hongxin' ? '打红心' : '打黑心'} · 第{view.roundNumber}局
          </span>
          <span className="pill">
            打 <strong>{view.levelRank}</strong>
          </span>
          <span className="pill pill-red">
            主：{view.trumpSuit ? `${getSuitSymbol(view.trumpSuit)}${getSuitName(view.trumpSuit)}` : '无主'}
          </span>
          <span className="pill">{getPhaseLabel(view.phase, view.mode)}</span>
        </div>

        <div className="hud-group">
          {view.mode === 'hongxin' ? (
            <>
              <span className="pill pill-green">
                A:{view.teams.A.levelRank}
                {view.teams.A.penaltyCount > 0 ? `(罚${view.teams.A.penaltyCount})` : ''}
              </span>
              <span className="pill">
                B:{view.teams.B.levelRank}
                {view.teams.B.penaltyCount > 0 ? `(罚${view.teams.B.penaltyCount})` : ''}
              </span>
            </>
          ) : (
            <span className="pill pill-gold">
              叫分:{view.bidState?.highestBid || '-'} · 我的分:{view.playerScores[meSeat]}
            </span>
          )}

          <div className="score-meter" title="闲家抓分进度（共300分）">
            <div className="score-meter-fill" style={{ width: `${scorePct}%` }} />
            {view.mode === 'hongxin' && (
              <>
                <div className="score-meter-tick" style={{ left: '13.3%' }} />
                <div className="score-meter-tick" style={{ left: '40%' }} />
                <div className="score-meter-tick" style={{ left: '60%' }} />
                <div className="score-meter-tick" style={{ left: '80%' }} />
              </>
            )}
            <div className="score-meter-label">
              {view.mode === 'hongxin'
                ? `闲分 ${view.challengerPoints} / 及格120`
                : `闲分 ${view.challengerPoints}`}
            </div>
          </div>
        </div>

        <div className="hud-group">
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => setShowLastTrick(true)}
            disabled={!view.lastTrick}
          >
            上一墩
          </button>
          <button
            type="button"
            className={`btn btn-xs ${meRoomSeat.autoBot ? 'btn-gold' : ''}`}
            onClick={() => onSetAutoBot(!meRoomSeat.autoBot)}
          >
            {meRoomSeat.autoBot ? '取消托管' : '托管'}
          </button>
          <button type="button" className="btn btn-xs" onClick={onToggleMute}>
            {muted ? '静音' : '音效'}
          </button>
          {room.debugMode && (
            <button
              type="button"
              className={`btn btn-xs ${room.debugOpenHands ? 'btn-emerald' : ''}`}
              onClick={() => {
                const next = !room.debugOpenHands;
                onToggleDebugOpenHands(next);
                setShowDebugDrawer(next);
              }}
            >
              上帝视角
            </button>
          )}
          <button type="button" className="btn btn-xs" onClick={() => setShowRules(true)}>
            规则
          </button>
          <button type="button" className="btn btn-xs btn-crimson" onClick={onLeaveRoom}>
            退出
          </button>
        </div>
      </div>

      {/* Arena: 3 Opponents + Center Trick Mat */}
      <div className="table-arena">
        {renderOpponentBadge(topSeat, 'seat-top')}
        {renderOpponentBadge(leftSeat, 'seat-left')}
        {renderOpponentBadge(rightSeat, 'seat-right')}

        <div className="trick-center">
          <div className="trick-grid">
            {renderTrickSlot(topSeat, 'trick-slot-top')}
            {renderTrickSlot(leftSeat, 'trick-slot-left')}
            {renderTrickSlot(rightSeat, 'trick-slot-right')}
            {renderTrickSlot(meSeat, 'trick-slot-bottom')}
          </div>
          {latestEvent && <div className="event-ribbon">{latestEvent}</div>}
        </div>
      </div>

      {/* Phase Contextual Action Bar */}
      <div className="action-bar">
        <div className="action-bar-group">
          <span className={`pill ${isMyTurn ? 'pill-gold' : ''}`}>
            我·座{meSeat + 1}
            {view.dealer === meSeat ? '【庄】' : ''}
            {isMyTurn ? '（轮到你）' : ''}
          </span>

          {view.phase === 'CALLING' && isMyTurn && (
            <>
              {callOptions.map((opt, idx) => (
                <button
                  key={`${opt.suit}-${opt.count}-${idx}`}
                  type="button"
                  className="btn btn-gold"
                  onClick={() =>
                    onSendAction({
                      type: 'CALL_TRUMP',
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
                onClick={() => onSendAction({ type: 'PASS_CALL', seat: meSeat })}
              >
                不叫
              </button>
            </>
          )}

          {view.phase === 'COUNTER_BIDDING' && (
            <>
              <span className="pill pill-gold">我的21张比牌：{myBipaiCount} 张</span>
              {isMyTurn && (
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
                    onClick={() =>
                      onSendAction({ type: 'PASS_COUNTER', seat: meSeat })
                    }
                  >
                    放弃反主
                  </button>
                </>
              )}
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
                    onClick={() =>
                      onSendAction({ type: 'BID_SCORE', seat: meSeat, score: s })
                    }
                  >
                    叫 {s} 分
                  </button>
                ))}
              {view.bidState.highestBid >= 100 &&
                view.bidState.highestBid + 5 <= 300 && (
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
                    +5 ({view.bidState.highestBid + 5})
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
                    className="btn btn-gold"
                    onClick={() =>
                      onSendAction({ type: 'CHOOSE_TRUMP', seat: meSeat, suit })
                    }
                  >
                    定{getSuitSymbol(suit)}
                    {getSuitName(suit)} ({cnt}张)
                  </button>
                );
              })}
            </>
          )}

          {view.phase === 'BURYING' && isMyTurn && (
            <>
              <span className={`pill ${preview.valid ? 'pill-green' : 'pill-red'}`}>
                {preview.valid ? preview.label : preview.error}
              </span>
              <button type="button" className="btn" onClick={handleHintClick}>
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
                className="btn btn-gold"
                disabled={!preview.valid}
                onClick={handleConfirmBury}
              >
                确认埋底
              </button>
            </>
          )}

          {view.phase === 'PLAYING' && isMyTurn && (
            <>
              {selectedIds.length > 0 && (
                <span className={`pill ${preview.valid ? 'pill-green' : 'pill-red'}`}>
                  {preview.valid ? preview.label : preview.error}
                </span>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSelectedIds([]);
                  setHintedIds([]);
                }}
                disabled={selectedIds.length === 0}
              >
                重选
              </button>
              <button type="button" className="btn btn-emerald" onClick={handleHintClick}>
                提示
              </button>
              <button
                type="button"
                className="btn btn-gold btn-lg"
                disabled={!preview.valid}
                onClick={handleConfirmPlay}
              >
                出牌 ({selectedIds.length})
              </button>
            </>
          )}

          {!isMyTurn &&
            view.phase !== 'ROUND_OVER' &&
            view.phase !== 'MATCH_OVER' && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                等待座位 {(view.currentTurn ?? 0) + 1} 操作...
              </span>
            )}
        </div>

        <div className="action-bar-group">
          {view.phase === 'PLAYING' && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              第 {view.trickNumber} 墩
            </span>
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
        onApplySelection={handleApplySelection}
      />

      {(view.phase === 'ROUND_OVER' || view.phase === 'MATCH_OVER') && (
        <SettlementModal
          view={view}
          onNextRound={() => onSendAction({ type: 'NEXT_ROUND' })}
          onLeaveRoom={onLeaveRoom}
        />
      )}

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showLastTrick && (
        <LastTrickModal view={view} onClose={() => setShowLastTrick(false)} />
      )}
      {showDebugDrawer && view.debugView && (
        <DebugDrawer view={view} onClose={() => setShowDebugDrawer(false)} />
      )}
    </div>
  );
};
