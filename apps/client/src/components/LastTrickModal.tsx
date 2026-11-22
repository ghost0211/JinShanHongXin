import React from 'react';
import { sortHandForDisplay } from '@jinshan/game-core';
import type { PlayerView, RoomSummary } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { getTrickPlayLabel } from '../utils/cardHints.js';

interface LastTrickModalProps {
  room: RoomSummary;
  view: PlayerView;
  onClose: () => void;
}

const ORDER_LABELS = ['领出', '跟2', '跟3', '尾家'] as const;

export const LastTrickModal: React.FC<LastTrickModalProps> = ({
  room,
  view,
  onClose,
}) => {
  const trick = view.lastTrick;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>上一轮出牌回顾</h3>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        {!trick ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            暂无已结束的上一轮出牌记录。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--gold-strong)' }}>
              第 {trick.trickNumber} 轮 · {room.seats[trick.leadSeat]?.name ?? `座位 ${trick.leadSeat + 1}`} 领出 ·{' '}
              <strong>
                {room.seats[trick.winnerSeat]?.name ?? `座位 ${trick.winnerSeat + 1}`} 赢下本轮
              </strong>
              {trick.points > 0 ? `（含 ${trick.points} 分）` : ''}
              {trick.killedByTrump ? ' · 主牌毙牌' : ''}
            </div>

            {trick.plays.map((p, idx) => {
              const seatInfo = room.seats[p.seat];
              const isWinner = p.seat === trick.winnerSeat;
              return (
                <div
                  key={p.seat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: isWinner
                      ? 'rgba(244, 201, 107, 0.14)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: isWinner
                      ? '1px solid var(--gold)'
                      : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className={`pill ${idx === 0 ? 'pill-gold' : ''}`}>
                        {ORDER_LABELS[idx] ?? `第${idx + 1}手`}
                      </span>
                      <strong>
                        {seatInfo?.name ?? `座位 ${p.seat + 1}`}
                        {p.seat === view.viewerSeat ? '（我）' : ''}
                      </strong>
                      {isWinner && <span className="pill pill-gold">★赢家</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                      座位 {p.seat + 1} · {getTrickPlayLabel(p.parsed, p.cards.length, idx === 0)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
