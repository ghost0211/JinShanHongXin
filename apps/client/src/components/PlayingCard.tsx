import React from 'react';
import type {
  Card,
  GameMode,
  GamePhase,
  LevelRank,
  StandardSuit,
} from '@jinshan/protocol';
import { getCardPoints, isRedFive } from '@jinshan/game-core';
import { getCardRoleBadge, isRedSuit } from '../utils/cardHints.js';
import {
  AceIllustration,
  CourtIllustration,
  isNumberRank,
  JokerIllustration,
  PipLayout,
  SuitGlyph,
} from './CardArt.js';

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
  showBadges?: boolean;
  showPointPip?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

const JOKER_LETTERS = ['J', 'O', 'K', 'E', 'R'] as const;

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
  showBadges = true,
  showPointPip = true,
  style,
  onClick,
}) => {
  const isJoker = card.suit === 'J';
  const isBj = isJoker && card.rank === 'BJ';
  const isSj = isJoker && card.rank === 'SJ';
  const red = isRedSuit(card.suit);
  const redFive = isRedFive(card);
  const roleBadge = getCardRoleBadge(card, trumpSuit, levelRank);
  const pts = getCardPoints(card);
  const stdSuit: StandardSuit | null = card.suit === 'J' ? null : card.suit;

  const classes = [
    'pcard',
    size === 'sm' ? 'pcard-sm' : size === 'xs' ? 'pcard-xs' : 'pcard-md',
    red ? 'is-red' : 'is-black',
    isBj ? 'is-joker-bj' : '',
    isSj ? 'is-joker-sj' : '',
    redFive ? 'is-red5-card' : '',
    phase === 'DEALING' && interactive ? 'is-deal-in' : '',
    selected ? 'is-selected' : '',
    hinted ? 'is-hinted' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderCornerIndex = (posClass: string) => {
    if (isJoker) {
      return (
        <div className={`pcard-corner ${posClass} is-joker-corner`}>
          <span className="pcard-joker-crown" aria-hidden="true">
            {isBj ? '★' : '✦'}
          </span>
          <span className="pcard-joker-stack" aria-label={isBj ? '大王' : '小王'}>
            {JOKER_LETTERS.map((ch) => (
              <span key={ch}>{ch}</span>
            ))}
          </span>
        </div>
      );
    }

    return (
      <div className={`pcard-corner ${posClass}`}>
        <span className={`pcard-rank ${card.rank === '10' ? 'is-ten' : ''}`}>
          {card.rank}
        </span>
        {stdSuit && <SuitGlyph suit={stdSuit} className="pcard-corner-suit" />}
      </div>
    );
  };

  const renderFaceArt = () => {
    if (isJoker) {
      return <JokerIllustration isBig={isBj} compact={size !== 'md'} />;
    }
    if (!stdSuit) return null;

    if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      return (
        <CourtIllustration
          rank={card.rank}
          suit={stdSuit}
          compact={size !== 'md'}
        />
      );
    }

    if (card.rank === 'A') {
      return <AceIllustration suit={stdSuit} compact={size !== 'md'} />;
    }

    if (size === 'md' && isNumberRank(card.rank)) {
      return (
        <PipLayout
          rank={card.rank}
          suit={stdSuit}
          highlightCenter={redFive}
        />
      );
    }

    return (
      <div className="pcard-mini-center">
        <SuitGlyph suit={stdSuit} className="pcard-mini-suit" />
      </div>
    );
  };

  return (
    <div
      className={classes}
      style={style}
      data-card-id={interactive ? card.id : undefined}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      aria-pressed={interactive ? selected : undefined}
    >
      <div className="pcard-inner-frame" aria-hidden="true" />

      {renderCornerIndex('pcard-corner-tl')}

      {/* Point indicator placed in the always-visible left strip under corner suit */}
      {showPointPip && pts > 0 && (
        <span className="pcard-pts-pip" title={`${pts}分`} />
      )}

      {/* Main realistic poker face artwork */}
      <div className="pcard-face">{renderFaceArt()}</div>

      {/* Inverted bottom-right corner index (standard poker look) */}
      {size !== 'xs' && renderCornerIndex('pcard-corner-br')}

      {/* Left-bottom role tag so it remains visible even when overlapped in hand */}
      {size === 'md' && showBadges && roleBadge && (
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
