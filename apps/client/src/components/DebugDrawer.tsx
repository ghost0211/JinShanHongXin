import React from 'react';
import type { PlayerView, Seat } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { Icon } from './Icons.js';

interface DebugDrawerProps {
  view: PlayerView;
  onClose: () => void;
}

export const DebugDrawer: React.FC<DebugDrawerProps> = ({ view, onClose }) => {
  const dbg = view.debugView;
  if (!dbg) return null;

  return (
    <aside className="debug-drawer" aria-label="调试上帝视角">
      <header className="debug-head">
        <span className="debug-head-icon">
          <Icon name="eye" />
        </span>
        <div className="debug-head-text">
          <strong>上帝视角</strong>
          <small>调试用 · 四家明牌与 21 张比牌</small>
        </div>
        <button type="button" className="btn btn-xs btn-ghost" onClick={onClose}>
          <Icon name="close" />
          收起
        </button>
      </header>

      <div className="debug-body">
        {([0, 1, 2, 3] as Seat[]).map((s) => (
          <section
            key={s}
            className={`debug-seat ${s === view.viewerSeat ? 'is-me' : ''} ${s === view.dealer ? 'is-dealer' : ''}`}
          >
            <div className="debug-seat-head">
              <span className="debug-seat-name">
                座位 {s + 1}
                {s === view.viewerSeat && <span className="pill pill-blue">我</span>}
                {s === view.dealer && <span className="seal">庄</span>}
              </span>
              <span className="debug-seat-meta">
                手牌 <b>{dbg.allHands[s].length}</b>
                <i />
                比牌 <b className="is-gold">{dbg.bipaiCounts[s]}</b>
              </span>
            </div>
            <div className="debug-cards">
              {dbg.allHands[s].map((c) => (
                <PlayingCard
                  key={c.id}
                  card={c}
                  trumpSuit={view.trumpSuit}
                  levelRank={view.levelRank}
                  size="xs"
                />
              ))}
            </div>
          </section>
        ))}

        <section className="debug-seat is-bottom">
          <div className="debug-seat-head">
            <span className="debug-seat-name">当前底牌</span>
            <span className="debug-seat-meta">
              <b>{dbg.bottomCards.length}</b> 张
            </span>
          </div>
          <div className="debug-cards">
            {dbg.bottomCards.map((c) => (
              <PlayingCard
                key={c.id}
                card={c}
                trumpSuit={view.trumpSuit}
                levelRank={view.levelRank}
                size="xs"
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
};
