import React from 'react';
import { sortHandForDisplay } from '@jinshan/game-core';
import type { PlayerView, RoomSummary } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { Icon } from './Icons.js';
import { getTrickPlayLabel } from '../utils/cardHints.js';

interface LastTrickModalProps {
  room: RoomSummary;
  view: PlayerView;
  onClose: () => void;
}

const ORDER_LABELS = ['领出', '跟二', '跟三', '尾家'] as const;

export const LastTrickModal: React.FC<LastTrickModalProps> = ({
  room,
  view,
  onClose,
}) => {
  const trick = view.lastTrick;
  const nameOf = (seat: number) => room.seats[seat]?.name ?? `座位 ${seat + 1}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card trick-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>上一轮回顾</h3>
            {trick && <span className="pill">第 {trick.trickNumber} 轮</span>}
          </div>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            关闭
          </button>
        </div>

        {!trick ? (
          <div className="modal-empty">
            <Icon name="cards" className="modal-empty-icon" />
            暂无已结束的上一轮出牌记录。
          </div>
        ) : (
          <>
            <div className="trick-summary">
              <span>
                <b>{nameOf(trick.leadSeat)}</b> 领出
              </span>
              <span className="trick-summary-sep" />
              <span className="trick-summary-win">
                <b>{nameOf(trick.winnerSeat)}</b> 赢下本轮
              </span>
              {trick.points > 0 && <span className="pill pill-gold">含 {trick.points} 分</span>}
              {trick.killedByTrump && <span className="pill pill-red">主牌毙牌</span>}
            </div>

            <ol className="trick-list">
              {trick.plays.map((p, idx) => {
                const isWinner = p.seat === trick.winnerSeat;
                const isMe = p.seat === view.viewerSeat;
                return (
                  <li
                    key={p.seat}
                    className={`trick-row ${isWinner ? 'is-winner' : ''} ${isMe ? 'is-me' : ''}`}
                  >
                    <div className="trick-row-info">
                      <div className="trick-row-name">
                        <span className={`trick-order ${idx === 0 ? 'is-lead' : ''}`}>
                          {ORDER_LABELS[idx] ?? `第${idx + 1}手`}
                        </span>
                        <strong>
                          {nameOf(p.seat)}
                          {isMe ? '（我）' : ''}
                        </strong>
                        {isWinner && <span className="seal is-gold">胜</span>}
                      </div>
                      <div className="trick-row-sub">
                        座位 {p.seat + 1} · {getTrickPlayLabel(p.parsed, p.cards.length, idx === 0)}
                      </div>
                    </div>
                    <div className="trick-row-cards">
                      {sortHandForDisplay(p.cards, view.trumpSuit, view.levelRank).map((card) => (
                        <PlayingCard
                          key={card.id}
                          card={card}
                          trumpSuit={view.trumpSuit}
                          levelRank={view.levelRank}
                          size="sm"
                        />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
};
