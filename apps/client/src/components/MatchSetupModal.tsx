import React, { useState } from 'react';
import type { BotDifficulty, DealSpeed, GameMode } from '@jinshan/protocol';
import {
  BOT_DIFFICULTY_OPTIONS,
  DEAL_SPEED_OPTIONS,
} from '../utils/settings.js';
import { soundFX } from '../utils/sound.js';
import { Icon } from './Icons.js';

export interface MatchSetupValues {
  mode: GameMode;
  dealSpeed: DealSpeed;
  allyBotDifficulty: BotDifficulty;
  opponentBotDifficulty: BotDifficulty;
  debugMode: boolean;
}

interface MatchSetupModalProps {
  title: string;
  subtitle?: string;
  confirmLabel: string;
  initialValues: MatchSetupValues;
  showModePicker?: boolean;
  showDebugToggle?: boolean;
  onConfirm: (values: MatchSetupValues) => void;
  onClose: () => void;
}

export const MatchSetupModal: React.FC<MatchSetupModalProps> = ({
  title,
  subtitle,
  confirmLabel,
  initialValues,
  showModePicker = true,
  showDebugToggle = true,
  onConfirm,
  onClose,
}) => {
  const [mode, setMode] = useState<GameMode>(initialValues.mode);
  const [dealSpeed, setDealSpeed] = useState<DealSpeed>(initialValues.dealSpeed);
  const [allyBotDifficulty, setAllyBotDifficulty] = useState<BotDifficulty>(
    initialValues.allyBotDifficulty,
  );
  const [opponentBotDifficulty, setOpponentBotDifficulty] = useState<BotDifficulty>(
    initialValues.opponentBotDifficulty,
  );
  const [debugMode, setDebugMode] = useState<boolean>(initialValues.debugMode);

  const activeDealSpeed =
    DEAL_SPEED_OPTIONS.find((d) => d.id === dealSpeed) ?? DEAL_SPEED_OPTIONS[4];
  const isHongxin = mode === 'hongxin';

  const handleSubmit = () => {
    soundFX.playTap();
    onConfirm({
      mode,
      dealSpeed,
      allyBotDifficulty,
      opponentBotDifficulty,
      debugMode,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card match-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>{title}</h3>
            <span className={`pill ${isHongxin ? 'pill-red' : 'pill-gold'}`}>
              {isHongxin ? '金山打红心 · 2V2' : '金山打黑心 · 1V3'}
            </span>
          </div>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            取消
          </button>
        </div>

        {subtitle && <p className="match-setup-subtitle">{subtitle}</p>}

        <div className="match-setup-grid">
          {showModePicker && (
            <div className="match-setup-card is-wide">
              <div className="match-setup-row">
                <span className="set-row-info">
                  <span className="set-row-title">本局玩法</span>
                  <span className="set-row-desc">
                    {isHongxin ? '对家同队 2V2 升级，支持抢庄/反主' : '1V3 叫分抢庄，独斗三家'}
                  </span>
                </span>
                <div className="segmented-control" role="radiogroup" aria-label="本局玩法">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isHongxin}
                    className={isHongxin ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      setMode('hongxin');
                    }}
                  >
                    打红心
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!isHongxin}
                    className={!isHongxin ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      setMode('heixin');
                    }}
                  >
                    打黑心
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 发牌速度 */}
          <div className="match-setup-card is-wide">
            <div className="match-setup-head">
              <span className="set-row-title">发牌速度</span>
              <span className="match-setup-val">
                <strong>{activeDealSpeed.label}</strong>
                <small>{activeDealSpeed.desc}</small>
              </span>
            </div>
            <div className="segmented-control is-five" role="radiogroup" aria-label="发牌速度">
              {DEAL_SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={dealSpeed === opt.id}
                  className={dealSpeed === opt.id ? 'is-active' : ''}
                  onClick={() => {
                    soundFX.playTap();
                    setDealSpeed(opt.id);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 队友 / 对手机器人独立难度 */}
          <div className="match-setup-card">
            <div className="match-setup-row">
              <span className="set-row-info">
                <span className="set-row-title">队友机器人</span>
                <span className="set-row-desc">
                  {isHongxin ? '与房主同队的机器人强度' : '与房主同阵营的机器人强度'}
                </span>
              </span>
              <div className="segmented-control" role="radiogroup" aria-label="队友机器人难度">
                {BOT_DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={allyBotDifficulty === opt.id}
                    className={allyBotDifficulty === opt.id ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      setAllyBotDifficulty(opt.id);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="match-setup-card">
            <div className="match-setup-row">
              <span className="set-row-info">
                <span className="set-row-title">对手机器人</span>
                <span className="set-row-desc">敌方阵营的机器人强度</span>
              </span>
              <div className="segmented-control" role="radiogroup" aria-label="对手机器人难度">
                {BOT_DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={opponentBotDifficulty === opt.id}
                    className={opponentBotDifficulty === opt.id ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      setOpponentBotDifficulty(opt.id);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {showDebugToggle && (
            <div className="match-setup-card is-wide">
              <label className="match-setup-row is-clickable">
                <span className="set-row-info">
                  <span className="set-row-title">上帝视角调试模式</span>
                  <span className="set-row-desc">允许对局中随时切换查看四家明牌与底牌</span>
                </span>
                <span className={`toggle-switch ${debugMode ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={debugMode}
                    onChange={(e) => {
                      soundFX.playTap();
                      setDebugMode(e.target.checked);
                    }}
                  />
                  <span className="toggle-thumb" />
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="match-setup-foot-note">本局参数对房间内所有玩家生效，并自动记住上次配置</span>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-gold" onClick={handleSubmit}>
            <Icon name="play" />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
