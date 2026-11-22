import React from 'react';
import { getCardPoints } from '@jinshan/game-core';
import type { Card, PlayerView } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';

interface ScoreDetailModalProps {
  view: PlayerView;
  onClose: () => void;
}

function summarizePointCards(cards: readonly Card[]): {
  total: number;
  kCount: number;
  tenCount: number;
  fiveCount: number;
} {
  let total = 0;
  let kCount = 0;
  let tenCount = 0;
  let fiveCount = 0;
  for (const c of cards) {
    total += getCardPoints(c);
    if (c.rank === 'K') kCount += 1;
    else if (c.rank === '10') tenCount += 1;
    else if (c.rank === '5') fiveCount += 1;
  }
  return { total, kCount, tenCount, fiveCount };
}

export const ScoreDetailModal: React.FC<ScoreDetailModalProps> = ({
  view,
  onClose,
}) => {
  const captured = view.capturedPointCards;
  const escaped = view.escapedPointCards;

  const capStats = summarizePointCards(captured);
  const escStats = summarizePointCards(escaped);
  const remainingPoints = Math.max(0, 300 - capStats.total - escStats.total);

  const isHongxin = view.mode === 'hongxin';
  const capturedTitle = isHongxin ? '已抓分数的牌（闲家得分）' : '已抓分数的牌（庄家得分）';
  const escapedTitle = isHongxin ? '已跑分数的牌（庄家护分）' : '已跑分数的牌（闲家跑分）';

  const renderSection = (
    title: string,
    stats: ReturnType<typeof summarizePointCards>,
    cards: readonly Card[],
    accentClass: string,
    emptyText: string,
  ) => (
    <div className={`score-detail-section ${accentClass}`}>
      <div className="score-detail-section-head">
        <div>
          <strong>{title}</strong>
          <div className="score-detail-breakdown">
            K×{stats.kCount} · 10×{stats.tenCount} · 5×{stats.fiveCount}（共 {cards.length} 张）
          </div>
        </div>
        <span className="pill pill-gold">{stats.total} 分</span>
      </div>
      {cards.length === 0 ? (
        <div className="score-detail-empty">{emptyText}</div>
      ) : (
        <div className="score-detail-cards">
          {cards.map((card) => (
            <PlayingCard
              key={card.id}
              card={card}
              trumpSuit={view.trumpSuit}
              levelRank={view.levelRank}
              size="sm"
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>本局查分详情（总分 300 分）</h3>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="score-detail-summary">
          <div className="score-detail-tile is-captured">
            <span className="score-detail-tile-label">
              {isHongxin ? '闲家已抓分' : '庄家已抓分'}
            </span>
            <strong className="score-detail-tile-val">{capStats.total} 分</strong>
          </div>
          <div className="score-detail-tile is-escaped">
            <span className="score-detail-tile-label">
              {isHongxin ? '庄家已跑分' : '闲家已跑分'}
            </span>
            <strong className="score-detail-tile-val">{escStats.total} 分</strong>
          </div>
          <div className="score-detail-tile is-remaining">
            <span className="score-detail-tile-label">未出 + 底牌剩余</span>
            <strong className="score-detail-tile-val">{remainingPoints} 分</strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {renderSection(
            capturedTitle,
            capStats,
            captured,
            'is-captured',
            '暂未抓到分牌。',
          )}
          {renderSection(
            escapedTitle,
            escStats,
            escaped,
            'is-escaped',
            '暂无已跑分牌。',
          )}
        </div>
      </div>
    </div>
  );
};
