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
import { isRunningInTauriDesktop } from '../utils/desktopBridge.js';
import type { HandLayoutMode, RightClickMode } from '../utils/settings.js';

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
  cardScale?: number;
  rightClickMode?: RightClickMode;
  doubleClickPlay?: boolean;
  onToggleLayout?: () => void;
  onReplaceSelection: (ids: number[]) => void;
  onDoubleClickCard?: (
    cardId: number,
    candidateSelection: readonly number[],
  ) => boolean;
  onClearSelection?: () => void;
}

interface DragState {
  active: boolean;
  rowIdx: number;
  startIdx: number;
  currentIdx: number;
  mode: 'select' | 'deselect';
  baseSelected: Set<number>;
  moved: boolean;
}

interface DragPreview {
  rowIdx: number;
  minIdx: number;
  maxIdx: number;
  mode: 'select' | 'deselect';
}

function getBaseResponsiveCardWidth(): number {
  if (typeof window === 'undefined') return 62;
  if (window.innerWidth >= 1280 && window.innerHeight >= 720) return 84;
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
  // Expose at least ~31%-54% of card width so left-strip rank/suit/badges stay clear
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
  cardScale = 1.0,
  rightClickMode = 'clear',
  doubleClickPlay = true,
  onToggleLayout,
  onReplaceSelection,
  onDoubleClickCard,
  onClearSelection,
}) => {
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth - 16 : 800,
  );
  const [baseCardWidth, setBaseCardWidth] = useState<number>(() =>
    getBaseResponsiveCardWidth(),
  );
  const [forceSingleRow, setForceSingleRow] = useState(
    () => defaultLayout === 'single',
  );
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  useEffect(() => {
    setForceSingleRow(defaultLayout === 'single');
  }, [defaultLayout]);

  const cardWidth = Math.round(baseCardWidth * cardScale);

  const dragRef = useRef<DragState>({
    active: false,
    rowIdx: 0,
    startIdx: 0,
    currentIdx: 0,
    mode: 'select',
    baseSelected: new Set(),
    moved: false,
  });

  const lastClickRef = useRef<{
    cardId: number;
    timeMs: number;
    wasSelectedBeforeClick: boolean;
    selectionBeforeClick: number[];
    selectionAfterClick: number[];
  } | null>(null);

  const lastDragCommitMsRef = useRef(0);

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

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const callbacksRef = useRef({
    onReplaceSelection,
    onDoubleClickCard,
    doubleClickPlay,
  });
  callbacksRef.current = {
    onReplaceSelection,
    onDoubleClickCard,
    doubleClickPlay,
  };

  useEffect(() => {
    const updateDims = () => {
      setBaseCardWidth(getBaseResponsiveCardWidth());
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

  const computeSelectionFromDrag = (drag: DragState): number[] => {
    const rowCards = rowsRef.current[drag.rowIdx];
    if (!rowCards) return Array.from(drag.baseSelected);
    const minIdx = Math.min(drag.startIdx, drag.currentIdx);
    const maxIdx = Math.max(drag.startIdx, drag.currentIdx);
    const next = new Set(drag.baseSelected);
    for (let i = minIdx; i <= maxIdx; i++) {
      const card = rowCards[i];
      if (!card) continue;
      if (drag.mode === 'select') next.add(card.id);
      else next.delete(card.id);
    }
    return Array.from(next);
  };

  useEffect(() => {
    const finishDrag = (cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag.active) return;
      drag.active = false;
      setDragPreview(null);
      if (cancelled) return;

      const nextSelection = computeSelectionFromDrag(drag);
      lastDragCommitMsRef.current = Date.now();

      if (!drag.moved) {
        const clickedCard = rowsRef.current[drag.rowIdx]?.[drag.startIdx];
        if (clickedCard) {
          lastClickRef.current = {
            cardId: clickedCard.id,
            timeMs: Date.now(),
            wasSelectedBeforeClick: drag.baseSelected.has(clickedCard.id),
            selectionBeforeClick: Array.from(drag.baseSelected),
            selectionAfterClick: nextSelection,
          };
        }
      } else {
        lastClickRef.current = null;
      }

      callbacksRef.current.onReplaceSelection(nextSelection);
    };

    const onPointerUp = () => finishDrag(false);
    const onPointerCancel = () => finishDrag(true);

    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    return () => {
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hintedSet = useMemo(() => new Set(hintedIds), [hintedIds]);

  const effectiveSelectedSet = useMemo(() => {
    if (!dragPreview) return selectedSet;
    const rowCards = rows[dragPreview.rowIdx];
    if (!rowCards) return selectedSet;
    const next = new Set(selectedSet);
    for (let i = dragPreview.minIdx; i <= dragPreview.maxIdx; i++) {
      const card = rowCards[i];
      if (!card) continue;
      if (dragPreview.mode === 'select') next.add(card.id);
      else next.delete(card.id);
    }
    return next;
  }, [selectedSet, dragPreview, rows]);

  const findRowCardIndexByX = (rowIdx: number, clientX: number): number | null => {
    const rowEl = rowRefs.current[rowIdx];
    if (!rowEl) return null;
    const cardEls = rowEl.querySelectorAll<HTMLElement>('[data-card-idx]');
    if (cardEls.length === 0) return null;

    // Check right-to-left because later cards visually overlap earlier cards on top
    for (let i = cardEls.length - 1; i >= 0; i--) {
      const rect = cardEls[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        const idx = Number(cardEls[i].dataset.cardIdx);
        return Number.isNaN(idx) ? null : idx;
      }
    }

    const firstRect = cardEls[0].getBoundingClientRect();
    if (clientX < firstRect.left) return 0;
    const lastRect = cardEls[cardEls.length - 1].getBoundingClientRect();
    if (clientX > lastRect.right) return cardEls.length - 1;
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const cardEl = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
    const slotEl = (e.target as HTMLElement).closest('[data-card-idx]') as HTMLElement | null;
    if (!cardEl || !slotEl) return;

    const id = Number(cardEl.dataset.cardId);
    const rowIdx = Number(slotEl.dataset.rowIdx);
    const cardIdx = Number(slotEl.dataset.cardIdx);
    if (Number.isNaN(id) || Number.isNaN(rowIdx) || Number.isNaN(cardIdx)) return;

    // Detect crisp mouse double-click before starting a second toggle gesture
    const now = Date.now();
    const prevClick = lastClickRef.current;
    if (
      e.pointerType === 'mouse' &&
      callbacksRef.current.doubleClickPlay &&
      callbacksRef.current.onDoubleClickCard &&
      prevClick &&
      prevClick.cardId === id &&
      now - prevClick.timeMs <= 340
    ) {
      const candidate = prevClick.wasSelectedBeforeClick
        ? prevClick.selectionBeforeClick
        : prevClick.selectionAfterClick;
      const handled = callbacksRef.current.onDoubleClickCard(id, candidate);
      if (handled) {
        lastClickRef.current = null;
        return;
      }
    }

    const dragMode: 'select' | 'deselect' = selectedSet.has(id)
      ? 'deselect'
      : 'select';

    dragRef.current = {
      active: true,
      rowIdx,
      startIdx: cardIdx,
      currentIdx: cardIdx,
      mode: dragMode,
      baseSelected: new Set(selectedIds),
      moved: false,
    };

    setDragPreview({
      rowIdx,
      minIdx: cardIdx,
      maxIdx: cardIdx,
      mode: dragMode,
    });
    soundFX.playTap();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;

    let hitIdx: number | null = null;
    const hit = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-card-idx]') as HTMLElement | null;

    if (hit && Number(hit.dataset.rowIdx) === drag.rowIdx) {
      const parsed = Number(hit.dataset.cardIdx);
      if (!Number.isNaN(parsed)) hitIdx = parsed;
    }

    if (hitIdx === null) {
      hitIdx = findRowCardIndexByX(drag.rowIdx, e.clientX);
    }

    if (hitIdx === null || hitIdx === drag.currentIdx) return;

    drag.currentIdx = hitIdx;
    drag.moved = true;
    setDragPreview({
      rowIdx: drag.rowIdx,
      minIdx: Math.min(drag.startIdx, hitIdx),
      maxIdx: Math.max(drag.startIdx, hitIdx),
      mode: drag.mode,
    });
    soundFX.playTap();
  };

  const handleZoneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastDragCommitMsRef.current < 180) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-card-id]') || target.closest('button')) return;
    if (selectedIds.length > 0 && onClearSelection) {
      onClearSelection();
      soundFX.playTap();
    }
  };

  const handleToggleClick = () => {
    if (onToggleLayout) {
      onToggleLayout();
    } else {
      setForceSingleRow((v) => !v);
    }
  };

  const isDesktop = isRunningInTauriDesktop();
  const countHint = isDesktop
    ? rightClickMode === 'play'
      ? `${cards.length} 张 · 拖动连选 · 双击/右键出牌 · 点空白清空`
      : `${cards.length} 张 · 拖动连选 · 双击快出 · 右键/点空白清空`
    : `${cards.length} 张 · 可滑动连选`;

  return (
    <div
      ref={zoneRef}
      className="hand-zone"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onClick={handleZoneClick}
    >
      {cards.length > 18 && (
        <div className="hand-meta-bar">
          <span className="hand-count">{countHint}</span>
          <button
            type="button"
            className="btn btn-xs btn-ghost"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleToggleClick}
            title="切换单排 / 双排手牌 (R)"
          >
            {forceSingleRow ? '双排' : '单排'}
            <kbd className="btn-kbd">R</kbd>
          </button>
        </div>
      )}

      {rows.map((rowCards, rowIdx) => {
        const overlap = computeRowOverlap(rowCards.length, containerWidth, cardWidth);
        return (
          <div
            key={rowIdx}
            ref={(el) => {
              rowRefs.current[rowIdx] = el;
            }}
            className={`hand-row ${rows.length > 1 ? 'is-multi-row' : ''}`}
            style={{ '--hand-overlap': `${overlap}px` } as React.CSSProperties}
          >
            {rowCards.map((card, cardIdx) => {
              const inDragSpan =
                dragPreview !== null &&
                dragPreview.rowIdx === rowIdx &&
                cardIdx >= dragPreview.minIdx &&
                cardIdx <= dragPreview.maxIdx;
              return (
                <div
                  key={card.id}
                  className={`hand-card-slot ${inDragSpan ? 'is-in-drag-span' : ''}`}
                  data-row-idx={rowIdx}
                  data-card-idx={cardIdx}
                  style={{ zIndex: cardIdx + 1 }}
                >
                  <PlayingCard
                    card={card}
                    trumpSuit={trumpSuit}
                    levelRank={levelRank}
                    mode={mode}
                    phase={phase}
                    selected={effectiveSelectedSet.has(card.id)}
                    hinted={hintedSet.has(card.id)}
                    showBadges={showCardBadges}
                    showPointPip={showPointPips}
                    interactive
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
