import React, { useEffect, useState } from 'react';

interface OpponentHandFanProps {
  count: number;
  side: 'top' | 'left' | 'right';
  isTurn?: boolean;
}

interface FanMetrics {
  topCardW: number;
  topCardH: number;
  topMaxSpan: number;
  sideCardW: number;
  sideCardH: number;
  sideMaxSpan: number;
}

function getFanMetrics(): FanMetrics {
  if (typeof window === 'undefined') {
    return {
      topCardW: 26,
      topCardH: 36,
      topMaxSpan: 240,
      sideCardW: 36,
      sideCardH: 24,
      sideMaxSpan: 170,
    };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= 900 && h >= 540) {
    return {
      topCardW: 28,
      topCardH: 40,
      topMaxSpan: Math.min(280, Math.round(w * 0.28)),
      sideCardW: 40,
      sideCardH: 28,
      sideMaxSpan: Math.min(220, Math.round(h * 0.34)),
    };
  }
  if (h <= 450) {
    return {
      topCardW: 19,
      topCardH: 27,
      topMaxSpan: Math.min(156, Math.round(w * 0.22)),
      sideCardW: 27,
      sideCardH: 19,
      sideMaxSpan: Math.min(108, Math.round(h * 0.28)),
    };
  }
  return {
    topCardW: 23,
    topCardH: 33,
    topMaxSpan: Math.min(210, Math.round(w * 0.25)),
    sideCardW: 33,
    sideCardH: 23,
    sideMaxSpan: Math.min(158, Math.round(h * 0.3)),
  };
}

export const OpponentHandFan: React.FC<OpponentHandFanProps> = ({
  count,
  side,
  isTurn = false,
}) => {
  const [metrics, setMetrics] = useState<FanMetrics>(getFanMetrics);

  useEffect(() => {
    const onResize = () => setMetrics(getFanMetrics());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const clamped = Math.max(0, Math.min(48, count));
  if (clamped === 0) {
    return (
      <div className={`opp-fan opp-fan-${side} is-empty`}>
        <span className="opp-count-pill">已出完</span>
      </div>
    );
  }

  const isHorizontal = side === 'top';
  const cardW = isHorizontal ? metrics.topCardW : metrics.sideCardW;
  const cardH = isHorizontal ? metrics.topCardH : metrics.sideCardH;
  const maxSpan = isHorizontal ? metrics.topMaxSpan : metrics.sideMaxSpan;
  const cardMain = isHorizontal ? cardW : cardH;
  const idealStep = isHorizontal ? Math.round(cardW * 0.32) : Math.round(cardH * 0.3);
  const step =
    clamped <= 1
      ? 0
      : Math.min(idealStep, Math.max(2, (maxSpan - cardMain) / (clamped - 1)));
  const totalMain = Math.round(cardMain + (clamped - 1) * step);

  return (
    <div
      className={`opp-fan opp-fan-${side} ${isTurn ? 'is-turn' : ''}`}
      style={{
        width: isHorizontal ? totalMain : cardW,
        height: isHorizontal ? cardH : totalMain,
      }}
      aria-label={`剩余 ${count} 张牌`}
    >
      {Array.from({ length: clamped }, (_, idx) => {
        const offset = Math.round(idx * step);
        const posStyle: React.CSSProperties = isHorizontal
          ? { left: offset, top: 0, width: cardW, height: cardH, zIndex: idx + 1 }
          : { left: 0, top: offset, width: cardW, height: cardH, zIndex: idx + 1 };
        return (
          <div
            key={idx}
            className={`card-back-mini ${isHorizontal ? '' : 'is-rotated'}`}
            style={posStyle}
          />
        );
      })}
      <span className="opp-count-badge">{count}</span>
    </div>
  );
};

export const BottomDeckStack: React.FC<{ count: number; label?: string }> = ({
  count,
  label,
}) => {
  const visual = Math.max(1, Math.min(10, count));
  return (
    <div className="bottom-deck-stack" aria-label={label ?? `底牌 ${count} 张`}>
      <div className="bottom-deck-cards">
        {Array.from({ length: visual }, (_, idx) => (
          <div
            key={idx}
            className="card-back-mini bottom-deck-card"
            style={{
              left: idx * 3,
              top: -Math.floor(idx / 2),
              zIndex: idx + 1,
            }}
          />
        ))}
      </div>
      <span className="pill pill-gold" style={{ fontSize: 10 }}>
        {label ?? `底牌 ${count} 张`}
      </span>
    </div>
  );
};
