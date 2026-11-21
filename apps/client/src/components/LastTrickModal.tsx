import React from 'react';
import type { PlayerView } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { getPatternLabel } from '../utils/cardHints.js';

interface LastTrickModalProps {
  view: PlayerView;
  onClose: () => void;
}

export const LastTrickModal: React.FC<LastTrickModalProps> = ({ view, onClose }) => {
  const trick = view.lastTrick;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>上一墩回顾</h3>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        {!trick ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            暂无已结束的牌墩。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--gold-strong)' }}>
              第 {trick.trickNumber} 墩 · 座位 {trick.leadSeat + 1} 领出 ·{' '}
              <strong>座位 {trick.winnerSeat + 1} 赢墩</strong>
              {trick.points > 0 ? `（含 ${trick.points} 分）` : ''}
              {trick.killedByTrump ? ' · 主牌毙牌' : ''}
            </div>

            {trick.plays.map((p) => (
              <div
                key={p.seat}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background:
                    p.seat === trick.winnerSeat
                      ? 'rgba(244, 201, 107, 0.14)'
                      : 'rgba(255, 255, 255, 0.05)',
                  border:
                    p.seat === trick.winnerSeat
                      ? '1px solid var(--gold)'
                      : '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ fontSize: 12 }}>
                  座位 {p.seat + 1}
                  {p.seat === view.viewerSeat ? '（我）' : ''}
                  {p.seat === trick.winnerSeat ? ' ★赢家' : ''}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {getPatternLabel(p.parsed)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {p.cards.map((card) => (
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
