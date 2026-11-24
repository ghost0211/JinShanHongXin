import React, { useEffect, useState } from 'react';
import type { TableSkin } from '../utils/settings.js';
import { JokerIllustration, PipLayout, SuitGlyph } from './CardArt.js';

interface SplashIntroProps {
  skin: TableSkin;
  onFinish: () => void;
}

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
      <div className="splash-frame" aria-hidden="true" />
      <div className="splash-aura" aria-hidden="true" />

      <div className="splash-stage">
        {/* Three-card animated fan: ♠10 (打黑心) + ♥5 (红五尊主) + 大王 */}
        <div className="splash-card-fan" aria-hidden="true">
          <div className="splash-card splash-card-left pcard is-black">
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

          <div className="splash-card splash-card-right pcard is-joker-bj">
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

          <div className="splash-card splash-card-hero pcard is-red is-red5-card">
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
          <div className="splash-ornament">
            <span className="splash-ornament-line" />
            <span className="splash-ornament-suit">♥</span>
            <span className="splash-ornament-line" />
          </div>
          <h1 className="splash-title">金山打红心</h1>
          <p className="splash-subtitle">红心升级 · 黑心叫分 · 三副牌 510K</p>
        </div>

        <div className="splash-progress">
          <div className="splash-progress-bar" />
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
      </button>
    </div>
  );
};
