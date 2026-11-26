import React from 'react';
import { getCardPoints } from '@jinshan/game-core';
import type { Card, PlayerView } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { Icon } from './Icons.js';

interface ScoreDetailModalProps {
  view: PlayerView;
  onClose: () => void;
}

const TOTAL_POINTS = 300;

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
  const remainingPoints = Math.max(0, TOTAL_POINTS - capStats.total - escStats.total);

  const isHongxin = view.mode === 'hongxin';
  const capturedTitle = isHongxin ? '已抓分牌 · 闲家得分' : '已抓分牌 · 庄家得分';
  const escapedTitle = isHongxin ? '已跑分牌 · 庄家护分' : '已跑分牌 · 闲家跑分';

  const pct = (n: number) => `${(n / TOTAL_POINTS) * 100}%`;

  const renderSection = (
    title: string,
    stats: ReturnType<typeof summarizePointCards>,
    cards: readonly Card[],
    accentClass: string,
    emptyText: string,
  ) => (
    <section className={`score-group ${accentClass}`}>
      <div className="score-group-head">
        <div className="score-group-title">
          <strong>{title}</strong>
          <span className="score-group-chips">
            <span>K×{stats.kCount}</span>
            <span>10×{stats.tenCount}</span>
            <span>5×{stats.fiveCount}</span>
            <span className="is-count">共 {cards.length} 张</span>
          </span>
        </div>
        <span className="score-group-total">
          {stats.total}
          <small>分</small>
        </span>
      </div>
      {cards.length === 0 ? (
        <div className="modal-empty is-inline">{emptyText}</div>
      ) : (
        <div className="score-group-cards">
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
    </section>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card score-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>本局查分</h3>
            <span className="pill">总分 {TOTAL_POINTS}</span>
          </div>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            关闭
          </button>
        </div>

        <div className="score-summary">
          <div className="score-tile is-captured">
            <span className="score-tile-label">{isHongxin ? '闲家已抓' : '庄家已抓'}</span>
            <span className="score-tile-num">
              {capStats.total}
              <small>分</small>
            </span>
          </div>
          <div className="score-tile is-escaped">
            <span className="score-tile-label">{isHongxin ? '庄家已跑' : '闲家已跑'}</span>
            <span className="score-tile-num">
              {escStats.total}
              <small>分</small>
            </span>
          </div>
          <div className="score-tile is-remaining">
            <span className="score-tile-label">未出 + 底牌</span>
            <span className="score-tile-num">
              {remainingPoints}
              <small>分</small>
            </span>
          </div>
        </div>
        <div className="score-meter-bar" aria-hidden="true">
          <span className="is-captured" style={{ width: pct(capStats.total) }} />
          <span className="is-escaped" style={{ width: pct(escStats.total) }} />
        </div>

        <div className="score-groups">
          {renderSection(capturedTitle, capStats, captured, 'is-captured', '暂未抓到分牌。')}
          {renderSection(escapedTitle, escStats, escaped, 'is-escaped', '暂无已跑分牌。')}
        </div>
      </div>
    </div>
  );
};
