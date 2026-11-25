import React from 'react';

interface OpponentHandFanProps {
  count: number;
  side: 'top' | 'left' | 'right';
  isTurn?: boolean;
}

/**
 * Compact fanned card-back stack. The exact count is shown on a badge, so we
 * only render a handful of backs (more cards = slightly wider fan) instead of
 * one DOM node per card. This keeps the seats tidy on small phone screens.
 */
export const OpponentHandFan: React.FC<OpponentHandFanProps> = ({
  count,
  side,
  isTurn = false,
}) => {
  const clamped = Math.max(0, Math.min(48, count));
  if (clamped === 0) {
    return (
      <div className={`opp-fan opp-fan-${side} is-empty`}>
        <span className="opp-count-pill">已出完</span>
      </div>
    );
  }

  // 1..7 visible backs, spread grows with remaining count
  const visible = Math.max(1, Math.min(7, Math.ceil(clamped / 6)));
  const spread = visible <= 1 ? 0 : Math.min(36, 10 + visible * 4);
  const step = visible <= 1 ? 0 : spread / (visible - 1);

  return (
    <div
      className={`opp-fan opp-fan-${side} ${isTurn ? 'is-turn' : ''}`}
      aria-label={`剩余 ${count} 张牌`}
    >
      <div className="opp-fan-cards">
        {Array.from({ length: visible }, (_, idx) => {
          const angle = visible <= 1 ? 0 : -spread / 2 + idx * step;
          return (
            <div
              key={idx}
              className="card-back-mini opp-fan-card"
              style={{ transform: `rotate(${angle}deg)`, zIndex: idx + 1 }}
            />
          );
        })}
      </div>
      <span className="opp-count-badge">{count}</span>
    </div>
  );
};

export const BottomDeckStack: React.FC<{ count: number; label?: string }> = ({
  count,
  label,
}) => {
  const visual = Math.max(1, Math.min(8, count));
  return (
    <div className="bottom-deck-stack" aria-label={label ?? `底牌 ${count} 张`}>
      <div className="bottom-deck-cards">
        {Array.from({ length: visual }, (_, idx) => (
          <div
            key={idx}
            className="card-back-mini bottom-deck-card"
            style={{
              left: idx * 2.5,
              top: -idx * 1.2,
              zIndex: idx + 1,
            }}
          />
        ))}
      </div>
      <span className="bottom-deck-label">{label ?? `底牌 ${count} 张`}</span>
    </div>
  );
};
