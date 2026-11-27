import React, { useEffect } from 'react';
import { getCardPoints, getSeatTeam, LEVEL_SEQUENCE } from '@jinshan/game-core';
import type { PlayerView, Seat } from '@jinshan/protocol';
import { PlayingCard } from './PlayingCard.js';
import { Icon } from './Icons.js';
import { shouldTriggerSettlementNextRound } from '../utils/shortcuts.js';

interface SettlementModalProps {
  view: PlayerView;
  shortcutBlocked?: boolean;
  onNextRound: () => void;
  onLeaveRoom: () => void;
}

/** 金山农民画风格的平涂小鱼（左右成对，寓意“年年有余”）。 */
const FolkFish: React.FC<{ flip?: boolean }> = ({ flip }) => (
  <svg
    className={`folk-fish ${flip ? 'is-flip' : ''}`}
    viewBox="0 0 72 40"
    aria-hidden="true"
  >
    <path className="ff-tail" d="M52 20 L68 8 Q63 20 68 32 Z" />
    <path className="ff-body" d="M6 20 C14 6 36 4 54 20 C36 36 14 34 6 20 Z" />
    <path className="ff-fin" d="M24 9 C28 2 38 3 40 10 Z" />
    <path className="ff-fin" d="M26 31 C30 37 36 37 38 31 Z" />
    <path className="ff-belly" d="M12 22 C20 30 34 30 44 24 C34 27 20 27 12 22 Z" />
    <path className="ff-scale" d="M24 13 q5 7 0 14 M32 12 q5 8 0 16 M40 14 q4 6 0 12" />
    <circle className="ff-eye" cx="14" cy="18" r="2.6" />
    <circle className="ff-pupil" cx="13.4" cy="17.6" r="1.1" />
  </svg>
);

const fmtDelta = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const SettlementModal: React.FC<SettlementModalProps> = ({
  view,
  shortcutBlocked = false,
  onNextRound,
  onLeaveRoom,
}) => {
  const s = view.settlement;

  useEffect(() => {
    if (!s || s.matchWinner || shortcutBlocked) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        shouldTriggerSettlementNextRound(e, {
          hasSettlement: Boolean(s),
          hasMatchWinner: Boolean(s.matchWinner),
          shortcutBlocked,
        })
      ) {
        e.preventDefault();
        onNextRound();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [s, shortcutBlocked, onNextRound]);

  if (!s) return null;

  const isHongxin = s.mode === 'hongxin';
  const viewerIsBanker = isHongxin
    ? getSeatTeam(view.viewerSeat) === s.bankerTeam
    : view.viewerSeat === s.dealer;
  const viewerWon = s.matchWinner
    ? getSeatTeam(view.viewerSeat) === s.matchWinner
    : viewerIsBanker === s.bankerWon;

  const outcome = s.matchWinner ? 'match' : s.bankerWon ? 'banker' : 'challenger';
  const bannerText = s.matchWinner ? '整场胜利' : s.bankerWon ? '庄家胜' : '闲家胜';
  const subline = s.matchWinner
    ? `${s.matchWinner} 队打过 A，赢得整场！${viewerWon ? '恭喜你方夺魁' : '下回再战'}`
    : viewerWon
      ? '你方赢下本局'
      : '你方本局惜败';

  const seatLabel = (seat: Seat) => `座位 ${seat + 1}`;

  return (
    <div className="modal-backdrop settle-backdrop">
      <div className={`modal-card settle-card is-${outcome} ${viewerWon ? 'is-viewer-win' : 'is-viewer-lose'}`}>
        <header className="settle-hero">
          <div className="settle-kicker">
            <span>第 {s.roundNumber} 局结算</span>
            <span className="settle-kicker-dot">·</span>
            <span>{isHongxin ? '金山打红心' : '金山打黑心'}</span>
          </div>
          <div className="settle-banner-row">
            <FolkFish />
            <div className="settle-banner" role="heading" aria-level={2}>
              {bannerText}
            </div>
            <FolkFish flip />
          </div>
          <div className={`settle-subline ${viewerWon ? 'is-win' : 'is-lose'}`}>{subline}</div>
        </header>

        <div className="settle-body">
          <div className="settle-main">
            <div className="settle-stats">
              {s.mode === 'heixin' ? (
                <>
                  <div className="settle-stat">
                    <span className="settle-stat-label">庄家叫分目标</span>
                    <span className="settle-stat-num">
                      {s.bidScore}
                      <small>分</small>
                    </span>
                  </div>
                  <div className={`settle-stat ${s.bottomKilled ? 'is-bad' : 'is-good'}`}>
                    <span className="settle-stat-label">
                      底牌 {s.bottomKilled ? '· 闲家抠底 ×2' : '· 庄家保底'}
                    </span>
                    <span className="settle-stat-num">
                      {s.bottomKilled ? `-${s.bottomBonusPoints}` : `+${s.bottomPointsRaw}`}
                      <small>分</small>
                    </span>
                  </div>
                  <div className="settle-stat is-key">
                    <span className="settle-stat-label">庄家结算得分</span>
                    <span className="settle-stat-num">
                      {s.bankerNetScore}
                      <small>分</small>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="settle-stat">
                    <span className="settle-stat-label">桌面闲家抓分</span>
                    <span className="settle-stat-num">
                      {s.tableChallengerPoints}
                      <small>分</small>
                    </span>
                  </div>
                  <div className={`settle-stat ${s.bottomKilled ? 'is-bad' : ''}`}>
                    <span className="settle-stat-label">
                      底牌分 {s.bottomKilled ? '· 抠底 ×2' : '· 庄家保底'}
                    </span>
                    <span className="settle-stat-num">
                      +{s.bottomBonusPoints}
                      <small>分</small>
                    </span>
                  </div>
                  <div className="settle-stat is-key">
                    <span className="settle-stat-label">闲家结算总分</span>
                    <span className="settle-stat-num">
                      {s.totalChallengerScore}
                      <small>分</small>
                    </span>
                  </div>
                </>
              )}
            </div>

            {isHongxin ? (
              <div className="settle-levels">
                <div className="settle-levels-head">
                  <span>
                    <strong>{s.earningTeam} 队</strong> 赢得 <strong className="settle-em">{s.earnedSteps}</strong> 级
                  </span>
                  <span className="settle-levels-note">
                    {s.penaltyAbsorbed > 0
                      ? `抵消 ${s.penaltyAbsorbed} 次反主惩罚后净升 ${s.actualLevelUp} 级`
                      : `净升 ${s.actualLevelUp} 级`}
                  </span>
                </div>
                <div className="settle-teams">
                  {(['A', 'B'] as const).map((team) => {
                    const prev = LEVEL_SEQUENCE[s.previousLevels[team]];
                    const next = LEVEL_SEQUENCE[s.newLevels[team]];
                    const mine = getSeatTeam(view.viewerSeat) === team;
                    return (
                      <div
                        key={team}
                        className={`settle-team ${team === s.earningTeam ? 'is-earning' : ''}`}
                      >
                        <div className="settle-team-name">
                          {team} 队
                          {team === s.bankerTeam && <span className="seal">庄</span>}
                          {mine && <span className="pill pill-blue">我方</span>}
                        </div>
                        <div className="settle-team-level">
                          {prev !== next && <span className="settle-level-prev">{prev}</span>}
                          {prev !== next && <span className="settle-level-arrow">→</span>}
                          <span className="settle-level-next">打 {next}</span>
                        </div>
                        <div className="settle-team-sub">反主惩罚 {s.newPenalties[team]} 次</div>
                      </div>
                    );
                  })}
                </div>
                <div className="settle-next-dealer">
                  下局庄家：<strong>{seatLabel(s.nextDealer)}</strong>
                  {s.nextDealer === view.viewerSeat ? '（我）' : ''}
                </div>
              </div>
            ) : (
              <div className="settle-quad-wrap">
                <div className="settle-quad-head">
                  叫分 <strong>{s.bidScore}</strong> · 庄家净分 <strong>{s.bankerNetScore}</strong>
                </div>
                <div className="settle-quad">
                  {([0, 1, 2, 3] as Seat[]).map((seat) => {
                    const delta = s.scoreDeltas?.[seat] ?? 0;
                    const total = s.playerScores?.[seat] ?? 0;
                    return (
                      <div
                        key={seat}
                        className={`settle-seat ${delta >= 0 ? 'is-up' : 'is-down'} ${seat === view.viewerSeat ? 'is-me' : ''}`}
                      >
                        <div className="settle-seat-name">
                          座{seat + 1}
                          {seat === s.dealer && <span className="seal">庄</span>}
                          {seat === view.viewerSeat && <span className="settle-me">我</span>}
                        </div>
                        <div className="settle-seat-delta">{fmtDelta(delta)}</div>
                        <div className="settle-seat-total">累计 {total}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="settle-bottom">
            <div className="settle-bottom-head">
              <span className="section-title">底牌</span>
              <span className="settle-bottom-meta">
                {s.revealedBottom.length} 张 · 原分 <strong>{s.bottomPointsRaw}</strong> 分
              </span>
            </div>
            <div className="settle-bottom-cards">
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
        </div>

        <div className="modal-footer settle-footer">
          <button type="button" className="btn btn-lg btn-ghost" onClick={onLeaveRoom}>
            <Icon name="exit" />
            返回大厅
          </button>
          {!s.matchWinner && (
            <button type="button" className="btn btn-gold btn-lg settle-next" onClick={onNextRound}>
              继续下一局
              <kbd className="btn-kbd">Enter</kbd>
              <Icon name="chevron-right" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
