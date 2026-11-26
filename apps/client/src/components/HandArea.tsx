import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTrump } from '@jinshan/game-core';
import type {
  Card,
  GameMode,
  GamePhase,
  LevelRank,
  StandardSuit,
} from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { soundFX } from '../utils/sound.js';

import type { HandLayoutMode } from '../utils/settings.js';

interface HandAreaProps {
  cards: readonly Card[];
  trumpSuit: StandardSuit | null;
  levelRank: LevelRank;
  mode: GameMode;
  phase: GamePhase;
  selectedIds: readonly number[];
  hintedIds: readonly number[];
  defaultLayout?: HandLayoutMode;
  showCardBadges?: boolean;
  showPointPips?: boolean;
  onApplySelection: (ids: number[], mode: 'select' | 'deselect') => void;
}

function getResponsiveCardWidth(): number {
  if (typeof window === 'undefined') return 62;
  if (window.innerWidth >= 920 && window.innerHeight >= 540) return 76;
  if (window.innerHeight <= 450) return 52;
  return 62;
}

function computeRowOverlap(
  rowCount: number,
  containerWidth: number,
  cardWidth: number,
): number {
  if (rowCount <= 1) return 0;
  // Expose at least ~34%-54% of card width so left-strip rank/suit/badges stay clear
  const ideal = -Math.round(cardWidth * 0.46);
  const minOverlap = -Math.round(cardWidth * 0.69);
  const maxStep = Math.floor((containerWidth - cardWidth - 16) / (rowCount - 1));
  const target = maxStep - cardWidth;
  return Math.min(ideal, Math.max(minOverlap, target));
}

export const HandArea: React.FC<HandAreaProps> = ({
  cards,
  trumpSuit,
  levelRank,
  mode,
  phase,
  selectedIds,
  hintedIds,
  defaultLayout = 'double',
  showCardBadges = true,
  showPointPips = true,
  onApplySelection,
}) => {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth - 16 : 800,
  );
  const [cardWidth, setCardWidth] = useState<number>(() => getResponsiveCardWidth());
  const [forceSingleRow, setForceSingleRow] = useState(
    () => defaultLayout === 'single',
  );

  useEffect(() => {
    setForceSingleRow(defaultLayout === 'single');
  }, [defaultLayout]);

  const dragRef = useRef<{
    active: boolean;
    mode: 'select' | 'deselect';
    visited: Set<number>;
  }>({ active: false, mode: 'select', visited: new Set() });

  useEffect(() => {
    const updateDims = () => {
      setCardWidth(getResponsiveCardWidth());
      if (zoneRef.current) {
        setContainerWidth(zoneRef.current.clientWidth);
      }
    };
    updateDims();
    const ro = new ResizeObserver(updateDims);
    if (zoneRef.current) ro.observe(zoneRef.current);
    window.addEventListener('resize', updateDims);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateDims);
    };
  }, []);

  useEffect(() => {
    const stopDrag = () => {
      dragRef.current.active = false;
    };
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    return () => {
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hintedSet = useMemo(() => new Set(hintedIds), [hintedIds]);

  const { rows } = useMemo(() => {
    if (forceSingleRow || cards.length <= 18) {
      return { rows: [cards] };
    }
    const trumps = cards.filter((c) => isTrump(c, trumpSuit, levelRank));
    const nonTrumps = cards.filter((c) => !isTrump(c, trumpSuit, levelRank));
    if (trumps.length === 0 || nonTrumps.length === 0) {
      return { rows: [cards] };
    }
    return { rows: [trumps, nonTrumps] };
  }, [cards, trumpSuit, levelRank, forceSingleRow]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
    if (!el) return;
    const id = Number(el.dataset.cardId);
    if (Number.isNaN(id)) return;
    const dragMode: 'select' | 'deselect' = selectedSet.has(id)
      ? 'deselect'
      : 'select';
    dragRef.current = {
      active: true,
      mode: dragMode,
      visited: new Set([id]),
    };
    soundFX.playTap();
    onApplySelection([id], dragMode);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-card-id]') as HTMLElement | null;
    if (!hit) return;
    const id = Number(hit.dataset.cardId);
    if (Number.isNaN(id) || dragRef.current.visited.has(id)) return;
    dragRef.current.visited.add(id);
    soundFX.playTap();
    onApplySelection([id], dragRef.current.mode);
  };

  return (
    <div
      ref={zoneRef}
      className="hand-zone"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      {cards.length > 18 && (
        <div className="hand-meta-bar">
          <span className="hand-count">{cards.length} 张 · 可滑动连选</span>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setForceSingleRow((v) => !v)}
          >
            {forceSingleRow ? '双排' : '单排'}
          </button>
        </div>
      )}

      {rows.map((rowCards, rowIdx) => {
        const overlap = computeRowOverlap(rowCards.length, containerWidth, cardWidth);
        return (
          <div
            key={rowIdx}
            className={`hand-row ${rows.length > 1 ? 'is-multi-row' : ''}`}
            style={{ '--hand-overlap': `${overlap}px` } as React.CSSProperties}
          >
            {rowCards.map((card, cardIdx) => (
              <PlayingCard
                key={card.id}
                card={card}
                trumpSuit={trumpSuit}
                levelRank={levelRank}
                mode={mode}
                phase={phase}
                selected={selectedSet.has(card.id)}
                hinted={hintedSet.has(card.id)}
                showBadges={showCardBadges}
                showPointPip={showPointPips}
                interactive
                // Strictly preserve physical left-to-right stacking even when selected
                style={{ zIndex: cardIdx + 1 }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};
