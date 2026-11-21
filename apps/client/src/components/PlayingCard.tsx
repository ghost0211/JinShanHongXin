import React from 'react';
import type { Card, GameMode, GamePhase, LevelRank, StandardSuit } from '@jinshan/protocol';
import { getCardPoints } from '@jinshan/game-core';
import { getCardRoleBadge, getSuitSymbol, isRedSuit } from '../utils/cardHints.js';

export interface PlayingCardProps {
  card: Card;
  trumpSuit: StandardSuit | null;
  levelRank: LevelRank;
  mode?: GameMode;
  phase?: GamePhase;
  size?: 'xs' | 'sm' | 'md';
  selected?: boolean;
  hinted?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

export const PlayingCard: React.FC<PlayingCardProps> = ({
  card,
  trumpSuit,
  levelRank,
  mode,
  phase,
  size = 'md',
  selected = false,
  hinted = false,
  interactive = false,
  onClick,
}) => {
  const isBj = card.suit === 'J' && card.rank === 'BJ';
  const isSj = card.suit === 'J' && card.rank === 'SJ';
  const red = isRedSuit(card.suit);
  const roleBadge = getCardRoleBadge(card, trumpSuit, levelRank);
  const forbiddenBury =
    mode === 'heixin' && phase === 'BURYING' && card.rank === '10';
  const pts = getCardPoints(card);

  const classes = [
    'pcard',
    size === 'sm' ? 'pcard-sm' : size === 'xs' ? 'pcard-xs' : '',
    red ? 'is-red' : '',
    isBj ? 'is-joker-bj' : '',
    isSj ? 'is-joker-sj' : '',
    selected ? 'is-selected' : '',
    hinted ? 'is-hinted' : '',
    forbiddenBury ? 'is-forbidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const displayRank =
    card.suit === 'J' ? (isBj ? '大' : '小') : card.rank;

  return (
    <div
      className={classes}
      data-card-id={interactive ? card.id : undefined}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? selected : undefined}
    >
      <div className="pcard-corner">
        <span className="pcard-rank">{displayRank}</span>
        {card.suit === 'J' ? (
          <span className="pcard-joker-label">王</span>
        ) : (
          <span className="pcard-suit">{getSuitSymbol(card.suit)}</span>
        )}
      </div>

      {pts > 0 && size !== 'xs' && <span className="pcard-pts-dot" title={`${pts}分`} />}

      <div className="pcard-center">
        {card.suit === 'J' ? (
          <span className="pcard-center-suit">{isBj ? '☀' : '☾'}</span>
        ) : (
          <span className="pcard-center-suit">{getSuitSymbol(card.suit)}</span>
        )}
      </div>

      {size === 'md' && forbiddenBury && (
        <span className="pcard-badge badge-ban">禁埋</span>
      )}
      {size === 'md' && !forbiddenBury && roleBadge && (
        <span
          className={`pcard-badge ${
            roleBadge.kind === 'red5' ? 'badge-red5' : ''
          }`}
        >
          {roleBadge.text}
        </span>
      )}
    </div>
  );
};
