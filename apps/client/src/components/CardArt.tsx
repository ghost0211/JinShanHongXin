import React from 'react';
import type { Rank, StandardSuit } from '@jinshan/protocol';

interface SuitGlyphProps {
  suit: StandardSuit;
  className?: string;
}

export const SuitGlyph: React.FC<SuitGlyphProps> = ({ suit, className }) => {
  switch (suit) {
    case 'S':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2.2C9.1 5.9 3.6 10.3 3.6 14.3c0 2.7 2.1 4.6 4.5 4.6 1.5 0 2.7-.7 3.4-1.8-.2 1.8-.9 3.4-2.4 4.7h5.8c-1.5-1.3-2.2-2.9-2.4-4.7.7 1.1 1.9 1.8 3.4 1.8 2.4 0 4.5-1.9 4.5-4.6 0-4-5.5-8.4-8.4-12.1z"
          />
        </svg>
      );
    case 'H':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 21.4C10.9 20.4 3.2 14.3 3.2 8.9 3.2 5.7 5.6 3.4 8.5 3.4c1.6 0 2.9.8 3.5 2.1.6-1.3 1.9-2.1 3.5-2.1 2.9 0 5.3 2.3 5.3 5.5 0 5.4-7.7 11.5-8.8 12.5z"
          />
        </svg>
      );
    case 'C':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2.6a4.1 4.1 0 0 0-3.4 6.4 4.2 4.2 0 1 0-1.1 8.1c1.4 0 2.7-.6 3.5-1.6-.2 2.1-.9 4-2.2 5.7h6.4c-1.3-1.7-2-3.6-2.2-5.7.8 1 2.1 1.6 3.5 1.6a4.2 4.2 0 1 0-1.1-8.1A4.1 4.1 0 0 0 12 2.6z"
          />
        </svg>
      );
    case 'D':
      return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2.2c2.2 3.8 5.2 6.8 8.6 9.8-3.4 3-6.4 6-8.6 9.8-2.2-3.8-5.2-6.8-8.6-9.8 3.4-3 6.4-6 8.6-9.8z"
          />
        </svg>
      );
  }
};

export const JokerIllustration: React.FC<{ isBig: boolean; compact?: boolean }> = ({
  isBig,
  compact = false,
}) => {
  const primary = isBig ? '#c91f2e' : '#1e325c';
  const secondary = isBig ? '#e29e20' : '#4f72a8';
  const accent = isBig ? '#177c52' : '#7b98c4';
  const frameStroke = isBig ? '#d99b2a' : '#6f8ab5';
  const faceFill = isBig ? '#fff6e8' : '#f2f6fd';
  const bellFill = isBig ? '#f8ca4d' : '#cbd9ef';

  return (
    <svg
      viewBox="0 0 68 100"
      className={compact ? 'pcard-art-svg is-compact' : 'pcard-art-svg'}
      aria-hidden="true"
    >
      {/* Ornate inner border */}
      <rect
        x="4"
        y="4"
        width="60"
        height="92"
        rx="5"
        fill="none"
        stroke={frameStroke}
        strokeWidth="1.2"
        opacity="0.7"
      />
      <rect
        x="7"
        y="7"
        width="54"
        height="86"
        rx="3.5"
        fill="none"
        stroke={frameStroke}
        strokeWidth="0.6"
        strokeDasharray="2 1.5"
        opacity="0.55"
      />

      {/* Corner stars */}
      <circle cx="11" cy="11" r="1.4" fill={secondary} />
      <circle cx="57" cy="11" r="1.4" fill={secondary} />
      <circle cx="11" cy="89" r="1.4" fill={secondary} />
      <circle cx="57" cy="89" r="1.4" fill={secondary} />

      {/* Decorative top sun / crescent emblem */}
      {isBig ? (
        <g transform="translate(34, 15)">
          <circle r="3.4" fill={secondary} />
          <path
            d="M0-6.2V-4.4M0 4.4V6.2M-6.2 0H-4.4M4.4 0H6.2M-4.3-4.3L-3-3M3 3L4.3 4.3M4.3-4.3L3-3M-3 3L-4.3 4.3"
            stroke={primary}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <g transform="translate(34, 15)">
          <path
            d="M2.2-4.6A4.8 4.8 0 1 0 2.2 4.6 3.7 3.7 0 1 1 2.2-4.6z"
            fill={primary}
          />
          <circle cx="4.8" cy="-1.4" r="1.1" fill={secondary} />
        </g>
      )}

      {/* Jester three-pronged hat */}
      <path
        d="M34 33 C28 24, 19 22, 13 31 C17 30, 21 32, 24 37 Z"
        fill={primary}
        stroke="#221915"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path
        d="M34 33 C40 24, 49 22, 55 31 C51 30, 47 32, 44 37 Z"
        fill={accent}
        stroke="#221915"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path
        d="M24 38 C26 26, 30 20, 34 19 C38 20, 42 26, 44 38 Z"
        fill={secondary}
        stroke="#221915"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />

      {/* Hat bells */}
      <circle cx="12.5" cy="32" r="2.7" fill={bellFill} stroke="#221915" strokeWidth="0.8" />
      <circle cx="55.5" cy="32" r="2.7" fill={bellFill} stroke="#221915" strokeWidth="0.8" />
      <circle cx="34" cy="19" r="2.9" fill={bellFill} stroke="#221915" strokeWidth="0.8" />

      {/* Hat trim band */}
      <path
        d="M22 39 Q34 34 46 39 L45 43 Q34 39 23 43 Z"
        fill={primary}
        stroke="#221915"
        strokeWidth="0.8"
      />

      {/* Jester face */}
      <ellipse
        cx="34"
        cy="51.5"
        rx="11"
        ry="11.5"
        fill={faceFill}
        stroke="#221915"
        strokeWidth="1"
      />
      {/* Cheeks */}
      <circle cx="27.2" cy="53.5" r="2.1" fill={primary} opacity={isBig ? '0.25' : '0.14'} />
      <circle cx="40.8" cy="53.5" r="2.1" fill={primary} opacity={isBig ? '0.25' : '0.14'} />

      {/* Brows & expressive eyes */}
      <path
        d="M27.3 47.4 Q29.8 45.4 32 47.2 M36 47.2 Q38.2 45.4 40.7 47.4"
        fill="none"
        stroke="#221915"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
      <circle cx="29.8" cy="49.8" r="1.45" fill="#1b1b1d" />
      <circle cx="38.2" cy="49.8" r="1.45" fill="#1b1b1d" />
      <circle cx="30.2" cy="49.3" r="0.45" fill="#ffffff" />
      <circle cx="38.6" cy="49.3" r="0.45" fill="#ffffff" />

      {/* Nose & smile */}
      <circle cx="34" cy="52.6" r="1.8" fill={primary} />
      <path
        d={isBig ? 'M28.6 56.2 Q34 60.5 39.4 56.2' : 'M29.2 56.6 Q34 59.5 38.8 55.8'}
        fill="none"
        stroke={primary}
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Classic zig-zag jester ruffle collar */}
      <path
        d="M17 65 L24 61 L28 70 L34 62 L40 70 L44 61 L51 65 L47 76 L39 71 L34 79 L29 71 L21 76 Z"
        fill={primary}
        stroke="#221915"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path
        d="M24 61 L28 70 L34 62 L40 70 L44 61 L39 71 L34 79 L29 71 Z"
        fill={secondary}
        opacity="0.88"
      />
      {/* Collar pom-poms */}
      <circle cx="17" cy="65" r="1.7" fill={bellFill} stroke="#221915" strokeWidth="0.6" />
      <circle cx="51" cy="65" r="1.7" fill={bellFill} stroke="#221915" strokeWidth="0.6" />
      <circle cx="21" cy="76.5" r="1.7" fill={bellFill} stroke="#221915" strokeWidth="0.6" />
      <circle cx="47" cy="76.5" r="1.7" fill={bellFill} stroke="#221915" strokeWidth="0.6" />
      <circle cx="34" cy="79.5" r="1.9" fill={bellFill} stroke="#221915" strokeWidth="0.6" />

      {/* Bottom ribbon ornament */}
      <path
        d="M18 86 Q34 81.5 50 86"
        fill="none"
        stroke={frameStroke}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M34 82.6 L36.3 86 L34 89.4 L31.7 86 Z"
        fill={primary}
      />
    </svg>
  );
};

export const CourtIllustration: React.FC<{
  rank: 'J' | 'Q' | 'K';
  suit: StandardSuit;
  compact?: boolean;
}> = ({ rank, suit, compact = false }) => {
  const isRed = suit === 'H' || suit === 'D';
  const main = isRed ? '#c81e2c' : '#1b273b';
  const gold = '#d89b2b';
  const softBg = isRed ? 'rgba(200, 30, 44, 0.06)' : 'rgba(27, 39, 59, 0.06)';
  const accent = isRed ? '#e9b949' : '#5878a8';

  const suitPath =
    suit === 'S'
      ? 'M0-7.5C-2.4-4.4-6.8-0.8-6.8 2.4c0 2.1 1.6 3.6 3.5 3.6 1.2 0 2.1-.6 2.7-1.4-.2 1.4-.7 2.6-1.9 3.6h5c-1.2-1-1.7-2.2-1.9-3.6.6.8 1.5 1.4 2.7 1.4 1.9 0 3.5-1.5 3.5-3.6 0-3.2-4.4-6.8-6.8-9.9z'
      : suit === 'H'
        ? 'M0 7.6C-.9 6.8-6.8 2-6.8-2.2c0-2.5 1.9-4.3 4.2-4.3 1.2 0 2.2.6 2.6 1.6.4-1 1.4-1.6 2.6-1.6 2.3 0 4.2 1.8 4.2 4.3C6.8 2 .9 6.8 0 7.6z'
        : suit === 'C'
          ? 'M0-7.2a3.2 3.2 0 0 0-2.7 5 3.3 3.3 0 1 0-.9 6.3c1.1 0 2.1-.5 2.8-1.3-.2 1.6-.7 3.1-1.7 4.4h5c-1-1.3-1.5-2.8-1.7-4.4.7.8 1.7 1.3 2.8 1.3a3.3 3.3 0 1 0-.9-6.3 3.2 3.2 0 0 0-2.7-5z'
          : 'M0-7.8c1.7 3 4.1 5.4 6.8 7.8-2.7 2.4-5.1 4.8-6.8 7.8-1.7-3-4.1-5.4-6.8-7.8 2.7-2.4 5.1-4.8 6.8-7.8z';

  return (
    <svg
      viewBox="0 0 68 100"
      className={compact ? 'pcard-art-svg is-compact' : 'pcard-art-svg'}
      aria-hidden="true"
    >
      {/* Court card framed panel */}
      <rect
        x="8"
        y="10"
        width="52"
        height="80"
        rx="4"
        fill={softBg}
        stroke={gold}
        strokeWidth="1.2"
      />
      <rect
        x="11"
        y="13"
        width="46"
        height="74"
        rx="2.5"
        fill="none"
        stroke={main}
        strokeWidth="0.6"
        opacity="0.45"
      />

      {/* Decorative royal emblem per rank */}
      {rank === 'K' && (
        <g>
          {/* Crossed royal swords / scepter behind shield */}
          <line x1="18" y1="74" x2="50" y2="26" stroke={gold} strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
          <line x1="50" y1="74" x2="18" y2="26" stroke={gold} strokeWidth="1.8" strokeLinecap="round" opacity="0.7" />
          {/* Grand 5-point King Crown */}
          <path
            d="M19 36 L17 22 L26 28 L34 18 L42 28 L51 22 L49 36 Z"
            fill={gold}
            stroke={main}
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <rect x="19" y="35.5" width="30" height="4.2" rx="1.5" fill={main} />
          <circle cx="17" cy="21" r="1.8" fill={main} />
          <circle cx="34" cy="17" r="2.2" fill={main} />
          <circle cx="51" cy="21" r="1.8" fill={main} />
          {/* Royal cloak & shield */}
          <path
            d="M20 44 H48 V61 C48 70 41 76 34 79 C27 76 20 70 20 61 Z"
            fill="#ffffff"
            stroke={main}
            strokeWidth="1.2"
          />
          <path
            d="M22.5 46.5 H45.5 V60.5 C45.5 68 39.8 73.2 34 75.8 C28.2 73.2 22.5 68 22.5 60.5 Z"
            fill="none"
            stroke={gold}
            strokeWidth="0.9"
          />
          <g transform="translate(34, 59) scale(1.25)">
            <path d={suitPath} fill={main} />
          </g>
        </g>
      )}

      {rank === 'Q' && (
        <g>
          {/* Graceful arched Queen tiara */}
          <path
            d="M20 36 L19 25 Q26 29 29 22 Q34 15 39 22 Q42 29 49 25 L48 36 Z"
            fill={gold}
            stroke={main}
            strokeWidth="1.05"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="24" r="1.7" fill="#fff" stroke={main} strokeWidth="0.8" />
          <circle cx="29" cy="21" r="1.7" fill="#fff" stroke={main} strokeWidth="0.8" />
          <circle cx="34" cy="17.5" r="2.2" fill={main} />
          <circle cx="39" cy="21" r="1.7" fill="#fff" stroke={main} strokeWidth="0.8" />
          <circle cx="49" cy="24" r="1.7" fill="#fff" stroke={main} strokeWidth="0.8" />
          <rect x="20" y="35.5" width="28" height="3.8" rx="1.5" fill={main} />
          {/* Oval cameo medallion */}
          <ellipse
            cx="34"
            cy="59.5"
            rx="14.5"
            ry="18"
            fill="#ffffff"
            stroke={gold}
            strokeWidth="1.5"
          />
          <ellipse
            cx="34"
            cy="59.5"
            rx="11.5"
            ry="14.8"
            fill="none"
            stroke={main}
            strokeWidth="0.8"
            strokeDasharray="2.2 1.6"
          />
          <g transform="translate(34, 59.5) scale(1.22)">
            <path d={suitPath} fill={main} />
          </g>
          {/* Side floral dots */}
          <circle cx="16.5" cy="59.5" r="2.2" fill={accent} />
          <circle cx="51.5" cy="59.5" r="2.2" fill={accent} />
        </g>
      )}

      {rank === 'J' && (
        <g>
          {/* Knight plumed cap & halberd shaft */}
          <line x1="48" y1="20" x2="21" y2="79" stroke={gold} strokeWidth="2" strokeLinecap="round" />
          <path d="M47 18 L54 22 L49 29 L44 24 Z" fill={main} />
          {/* Feathered cap */}
          <path
            d="M21 35 C22 25, 31 20, 42 23 C45 24, 47 28, 46 35 Z"
            fill={main}
            stroke={gold}
            strokeWidth="1"
          />
          <path
            d="M36 22 C41 16, 49 15, 52 19 C48 20, 44 22, 42 25 Z"
            fill={gold}
          />
          <rect x="20" y="34" width="27" height="3.6" rx="1.5" fill={gold} />
          {/* Diamond knight crest */}
          <path
            d="M34 42 L48 59.5 L34 77 L20 59.5 Z"
            fill="#ffffff"
            stroke={main}
            strokeWidth="1.2"
          />
          <path
            d="M34 45.5 L44.5 59.5 L34 73.5 L23.5 59.5 Z"
            fill="none"
            stroke={gold}
            strokeWidth="0.8"
          />
          <g transform="translate(34, 59.5) scale(1.12)">
            <path d={suitPath} fill={main} />
          </g>
        </g>
      )}

      {/* Subtle corner mini pips inside court frame */}
      <g transform="translate(16.5, 81) scale(0.42)">
        <path d={suitPath} fill={main} opacity="0.7" />
      </g>
      <g transform="translate(51.5, 81) scale(0.42)">
        <path d={suitPath} fill={main} opacity="0.7" />
      </g>
    </svg>
  );
};

export const AceIllustration: React.FC<{ suit: StandardSuit; compact?: boolean }> = ({
  suit,
  compact = false,
}) => {
  const isSpade = suit === 'S';
  return (
    <div className={`pcard-ace-wrap ${isSpade ? 'is-spade-ace' : ''} ${compact ? 'is-compact' : ''}`}>
      {isSpade && !compact && (
        <svg viewBox="0 0 68 90" className="pcard-ace-filigree" aria-hidden="true">
          <circle
            cx="34"
            cy="45"
            r="22"
            fill="none"
            stroke="#d4a03a"
            strokeWidth="1"
            strokeDasharray="3 2"
            opacity="0.75"
          />
          <circle
            cx="34"
            cy="45"
            r="26"
            fill="none"
            stroke="#1b2430"
            strokeWidth="0.6"
            opacity="0.28"
          />
        </svg>
      )}
      <SuitGlyph suit={suit} className="pcard-ace-glyph" />
    </div>
  );
};

interface PipCoord {
  x: number;
  y: number;
  flip?: boolean;
}

const PIP_LAYOUTS: Record<'2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10', readonly PipCoord[]> = {
  '2': [
    { x: 50, y: 18 },
    { x: 50, y: 82, flip: true },
  ],
  '3': [
    { x: 50, y: 17 },
    { x: 50, y: 50 },
    { x: 50, y: 83, flip: true },
  ],
  '4': [
    { x: 30, y: 18 },
    { x: 70, y: 18 },
    { x: 30, y: 82, flip: true },
    { x: 70, y: 82, flip: true },
  ],
  '5': [
    { x: 30, y: 18 },
    { x: 70, y: 18 },
    { x: 50, y: 50 },
    { x: 30, y: 82, flip: true },
    { x: 70, y: 82, flip: true },
  ],
  '6': [
    { x: 30, y: 17 },
    { x: 70, y: 17 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 30, y: 83, flip: true },
    { x: 70, y: 83, flip: true },
  ],
  '7': [
    { x: 30, y: 16 },
    { x: 70, y: 16 },
    { x: 50, y: 33 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 30, y: 84, flip: true },
    { x: 70, y: 84, flip: true },
  ],
  '8': [
    { x: 30, y: 16 },
    { x: 70, y: 16 },
    { x: 50, y: 33 },
    { x: 30, y: 50 },
    { x: 70, y: 50 },
    { x: 50, y: 67, flip: true },
    { x: 30, y: 84, flip: true },
    { x: 70, y: 84, flip: true },
  ],
  '9': [
    { x: 30, y: 14 },
    { x: 70, y: 14 },
    { x: 30, y: 38 },
    { x: 70, y: 38 },
    { x: 50, y: 50 },
    { x: 30, y: 62, flip: true },
    { x: 70, y: 62, flip: true },
    { x: 30, y: 86, flip: true },
    { x: 70, y: 86, flip: true },
  ],
  '10': [
    { x: 30, y: 14 },
    { x: 70, y: 14 },
    { x: 50, y: 26 },
    { x: 30, y: 38 },
    { x: 70, y: 38 },
    { x: 30, y: 62, flip: true },
    { x: 70, y: 62, flip: true },
    { x: 50, y: 74, flip: true },
    { x: 30, y: 86, flip: true },
    { x: 70, y: 86, flip: true },
  ],
};

export function isNumberRank(
  rank: Rank,
): rank is '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' {
  return rank in PIP_LAYOUTS;
}

export const PipLayout: React.FC<{
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
  suit: StandardSuit;
  highlightCenter?: boolean;
}> = ({ rank, suit, highlightCenter = false }) => {
  const coords = PIP_LAYOUTS[rank];
  const dense = rank === '9' || rank === '10';
  return (
    <div className={`pcard-pips ${dense ? 'is-dense' : ''}`} aria-hidden="true">
      {coords.map((pt, idx) => {
        const isCenterRedFive = highlightCenter && pt.x === 50 && pt.y === 50;
        return (
          <span
            key={idx}
            className={`pcard-pip ${pt.flip ? 'is-flipped' : ''} ${
              isCenterRedFive ? 'is-red5-core' : ''
            }`}
            style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
          >
            <SuitGlyph suit={suit} className="pcard-pip-svg" />
          </span>
        );
      })}
    </div>
  );
};
