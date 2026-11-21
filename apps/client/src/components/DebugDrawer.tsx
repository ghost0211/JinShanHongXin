import React from 'react';
import type { PlayerView, Seat } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';

interface DebugDrawerProps {
  view: PlayerView;
  onClose: () => void;
}

export const DebugDrawer: React.FC<DebugDrawerProps> = ({ view, onClose }) => {
  const dbg = view.debugView;
  if (!dbg) return null;

  return (
    <div className="debug-panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          borderBottom: '1px solid rgba(56, 189, 248, 0.3)',
          paddingBottom: 6,
        }}
      >
        <strong style={{ color: '#7dd3fc', fontSize: 13 }}>
          调试上帝视角（21张比牌 & 四家明牌）
        </strong>
        <button type="button" className="btn btn-xs" onClick={onClose}>
          收起
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {([0, 1, 2, 3] as Seat[]).map((s) => (
          <div key={s}>
            <div style={{ marginBottom: 3, color: '#e2e8f0' }}>
              座位 {s + 1}
              {s === view.viewerSeat ? '（我）' : ''}
              {s === view.dealer ? '【庄】' : ''} · 手牌 {dbg.allHands[s].length} 张 ·
              <span style={{ color: '#fcd34d' }}> 比牌 {dbg.bipaiCounts[s]} 张</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
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
          </div>
        ))}

        <div>
          <div style={{ marginBottom: 3, color: '#fca5a5' }}>
            当前底牌（{dbg.bottomCards.length} 张）
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
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
        </div>
      </div>
    </div>
  );
};
