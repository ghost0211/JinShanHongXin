import React from 'react';
import { getCardPoints, LEVEL_SEQUENCE } from '@jinshan/game-core';
import type { PlayerView, Seat } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';

interface SettlementModalProps {
  view: PlayerView;
  onNextRound: () => void;
  onLeaveRoom: () => void;
}

export const SettlementModal: React.FC<SettlementModalProps> = ({
  view,
  onNextRound,
  onLeaveRoom,
}) => {
  const s = view.settlement;
  if (!s) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h3>
            {s.matchWinner
              ? `恭喜 ${s.matchWinner} 队打完 A 赢得整场胜利！`
              : `第 ${s.roundNumber} 局结算 · ${s.bankerWon ? '庄家胜' : '闲家胜'}`}
          </h3>
          <span className="pill pill-gold">
            {s.mode === 'hongxin' ? '金山打红心' : '金山打黑心'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 8,
            }}
          >
            {s.mode === 'heixin' ? (
              <>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>庄家叫分目标</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{s.bidScore} 分</div>
                </div>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    底牌影响 {s.bottomKilled ? '（闲家抠底 ×2）' : '（庄家保底）'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.bottomKilled ? '#fca5a5' : '#6ee7b7' }}>
                    {s.bottomKilled ? `-${s.bottomBonusPoints} 分` : `+${s.bottomPointsRaw} 分`}
                  </div>
                </div>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>庄家结算得分</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold-strong)' }}>
                    {s.bankerNetScore} 分
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>桌面闲家抓分</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{s.tableChallengerPoints} 分</div>
                </div>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    底牌分 {s.bottomKilled ? '（抠底 ×2）' : '（庄家保底）'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: s.bottomKilled ? '#fca5a5' : undefined }}>
                    +{s.bottomBonusPoints} 分
                  </div>
                </div>
                <div className="card-panel" style={{ padding: 10 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>闲家结算总分</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--gold-strong)' }}>
                    {s.totalChallengerScore} 分
                  </div>
                </div>
              </>
            )}
          </div>

          {s.mode === 'hongxin' ? (
            <div className="card-panel" style={{ padding: 10 }}>
              <div>
                获胜阵营：<strong>{s.earningTeam} 队</strong> · 赢得{' '}
                <strong>{s.earnedSteps}</strong> 级
                {s.penaltyAbsorbed > 0
                  ? `（抵消 ${s.penaltyAbsorbed} 次反主惩罚后净升 ${s.actualLevelUp} 级）`
                  : `（净升 ${s.actualLevelUp} 级）`}
              </div>
              <div style={{ marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>
                  A队级别：<strong>{LEVEL_SEQUENCE[s.newLevels.A]}</strong>（惩罚 {s.newPenalties.A}）
                </span>
                <span>
                  B队级别：<strong>{LEVEL_SEQUENCE[s.newLevels.B]}</strong>（惩罚 {s.newPenalties.B}）
                </span>
                <span>下局庄家：座位 {s.nextDealer + 1}</span>
              </div>
            </div>
          ) : (
            <div className="card-panel" style={{ padding: 10 }}>
              <div>
                叫分：<strong>{s.bidScore}</strong> · 庄家净分：
                <strong>{s.bankerNetScore}</strong>
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 6,
                }}
              >
                {([0, 1, 2, 3] as Seat[]).map((seat) => {
                  const delta = s.scoreDeltas?.[seat] ?? 0;
                  const total = s.playerScores?.[seat] ?? 0;
                  return (
                    <div
                      key={seat}
                      style={{
                        padding: 6,
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.06)',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 11 }}>
                        座{seat + 1}
                        {seat === s.dealer ? '(庄)' : ''}
                      </div>
                      <div
                        style={{
                          fontWeight: 800,
                          color: delta >= 0 ? '#6ee7b7' : '#fda4af',
                        }}
                      >
                        {delta >= 0 ? `+${delta}` : delta}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        总 {total}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              亮出 10 张底牌（原分 {s.bottomPointsRaw} 分）
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {s.revealedBottom.map((c) => (
                <PlayingCard
                  key={c.id}
                  card={c}
                  trumpSuit={view.trumpSuit}
                  levelRank={view.levelRank}
                  size="sm"
                  hinted={getCardPoints(c) > 0}
                />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn" onClick={onLeaveRoom}>
              返回大厅
            </button>
            {!s.matchWinner && (
              <button type="button" className="btn btn-gold btn-lg" onClick={onNextRound}>
                继续下一局
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
