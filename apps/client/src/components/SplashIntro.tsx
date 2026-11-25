import React, { useEffect, useState } from 'react';
import type { TableSkin } from '../utils/settings.js';
import { JokerIllustration, PipLayout, SuitGlyph } from './CardArt.js';

interface SplashIntroProps {
  skin: TableSkin;
  onFinish: () => void;
}

const TITLE_CHARS = ['金', '山', '打', '红', '心'] as const;

export const SplashIntro: React.FC<SplashIntroProps> = ({ skin, onFinish }) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const fadeDelay = reduced ? 450 : 1750;
    const endDelay = reduced ? 650 : 2200;

    const t1 = window.setTimeout(() => setExiting(true), fadeDelay);
    const t2 = window.setTimeout(() => onFinish(), endDelay);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onFinish]);

  const handleSkip = () => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(() => onFinish(), 260);
  };

  return (
    <div
      className={`splash-overlay ${exiting ? 'is-exiting' : ''}`}
      data-table-skin={skin}
      onClick={handleSkip}
      role="presentation"
    >
      <div className="splash-wash" aria-hidden="true" />
      <div className="splash-frame" aria-hidden="true">
        <span className="splash-frame-corner is-tl" />
        <span className="splash-frame-corner is-tr" />
        <span className="splash-frame-corner is-bl" />
        <span className="splash-frame-corner is-br" />
      </div>
      <div className="splash-waves" aria-hidden="true" />

      <div className="splash-stage">
        {/* Three-card fan: ♠10 (打黑心) · 大王 · ♥5 (红五尊主) */}
        <div className="splash-cards" aria-hidden="true">
          <div className="splash-card is-left pcard">
            <div className="pcard-inner-frame" />
            <div className="pcard-corner pcard-corner-tl">
              <span className="pcard-rank is-ten">10</span>
              <SuitGlyph suit="S" className="pcard-corner-suit" />
            </div>
            <div className="pcard-face">
              <PipLayout rank="10" suit="S" />
            </div>
            <div className="pcard-corner pcard-corner-br">
              <span className="pcard-rank is-ten">10</span>
              <SuitGlyph suit="S" className="pcard-corner-suit" />
            </div>
          </div>

          <div className="splash-card is-right pcard is-joker-bj">
            <div className="pcard-inner-frame" />
            <div className="pcard-corner pcard-corner-tl is-joker-corner">
              <span className="pcard-joker-crown">★</span>
              <span className="pcard-joker-stack">
                <span>J</span>
                <span>O</span>
                <span>K</span>
                <span>E</span>
                <span>R</span>
              </span>
            </div>
            <div className="pcard-face">
              <JokerIllustration isBig />
            </div>
          </div>

          <div className="splash-card is-hero pcard is-red is-red5-card">
            <div className="pcard-inner-frame" />
            <div className="pcard-corner pcard-corner-tl">
              <span className="pcard-rank">5</span>
              <SuitGlyph suit="H" className="pcard-corner-suit" />
            </div>
            <div className="pcard-face">
              <PipLayout rank="5" suit="H" highlightCenter />
            </div>
            <div className="pcard-corner pcard-corner-br">
              <span className="pcard-rank">5</span>
              <SuitGlyph suit="H" className="pcard-corner-suit" />
            </div>
            <span className="pcard-badge badge-red5">红5</span>
            <div className="splash-sheen" />
          </div>
        </div>

        <div className="splash-brand">
          <div className="splash-title-row">
            <h1 className="splash-title" aria-label="金山打红心">
              {TITLE_CHARS.map((ch, i) => (
                <span
                  key={ch + i}
                  className={`splash-char ${ch === '红' ? 'is-red' : ''}`}
                  style={{ '--i': i } as React.CSSProperties}
                  aria-hidden="true"
                >
                  {ch}
                </span>
              ))}
            </h1>
            <span className="splash-seal" aria-hidden="true">
              <span>金</span>
              <span>山</span>
            </span>
          </div>
          <div className="splash-rule" aria-hidden="true">
            <span />
            <i>◆</i>
            <span />
          </div>
          <p className="splash-subtitle">红心升级 · 黑心叫分 · 三副牌 510K</p>
        </div>

        <div className="splash-progress" aria-hidden="true">
          <span className="splash-progress-bar" />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-xs btn-ghost splash-skip"
        onClick={(e) => {
          e.stopPropagation();
          handleSkip();
        }}
      >
        跳过
        <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6l6 6-6 6M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
};
