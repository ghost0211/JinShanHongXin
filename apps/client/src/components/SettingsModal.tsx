import React, { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../net/wsClient.js';
import {
  BGM_TRACK_OPTIONS,
  BOT_DIFFICULTY_OPTIONS,
  DEAL_SPEED_OPTIONS,
  DEFAULT_APP_SETTINGS,
  TABLE_SKIN_OPTIONS,
  type AppSettings,
  type BgmTrackId,
  type BotDifficulty,
  type DealSpeed,
  type TableSkin,
} from '../utils/settings.js';
import { bgmPlayer } from '../utils/bgm.js';
import { soundFX } from '../utils/sound.js';
import { SuitGlyph } from './CardArt.js';
import { Icon } from './Icons.js';

import type { PlayMode } from '../hooks/useGameClient.js';

interface SettingsModalProps {
  settings: AppSettings;
  playMode?: PlayMode;
  serverUrl: string;
  connStatus: ConnectionStatus;
  inGame?: boolean;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onUpdateServerUrl: (url: string) => void;
  onReplaySplash?: () => void;
  onOpenRules: () => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  playMode = 'online',
  serverUrl,
  connStatus,
  inGame = false,
  onUpdateSettings,
  onUpdateServerUrl,
  onReplaySplash,
  onOpenRules,
  onClose,
}) => {
  const [serverInput, setServerInput] = useState(serverUrl);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setServerInput(serverUrl);
  }, [serverUrl]);

  const statusMeta =
    connStatus === 'connected'
      ? { text: '已连接', cls: 'pill-green' }
      : connStatus === 'connecting'
        ? { text: '连接中...', cls: 'pill-gold' }
        : { text: '未连接', cls: 'pill-red' };

  const activeBgmTrack =
    BGM_TRACK_OPTIONS.find((t) => t.id === settings.bgmTrack) ?? BGM_TRACK_OPTIONS[0];
  const activeDealSpeed =
    DEAL_SPEED_OPTIONS.find((d) => d.id === settings.dealSpeed) ?? DEAL_SPEED_OPTIONS[4];

  const handleSelectSkin = (skin: TableSkin) => {
    soundFX.playTap();
    onUpdateSettings({ tableSkin: skin });
  };

  const handleSelectBgmTrack = (track: BgmTrackId) => {
    soundFX.playTap();
    onUpdateSettings({ bgmTrack: track, bgmEnabled: true });
    bgmPlayer.unlock();
  };

  const handleSaveServer = () => {
    onUpdateServerUrl(serverInput);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const renderToggle = (checked: boolean, onChange: (next: boolean) => void) => (
    <span className={`toggle-switch ${checked ? 'is-on' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          soundFX.playTap();
          onChange(e.target.checked);
        }}
      />
      <span className="toggle-thumb" />
    </span>
  );

  const renderToggleRow = (
    title: string,
    desc: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ) => (
    <label className="set-row is-clickable">
      <span className="set-row-info">
        <span className="set-row-title">{title}</span>
        <span className="set-row-desc">{desc}</span>
      </span>
      {renderToggle(checked, onChange)}
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>游戏设置</h3>
            <span className="pill">v0.1.0</span>
          </div>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            关闭
          </button>
        </div>

        <div className="settings-grid">
          {/* 牌桌外观 */}
          <section className="set-group is-wide">
            <h4 className="section-title">牌桌外观</h4>
            <div className="skin-picker">
              {TABLE_SKIN_OPTIONS.map((skin) => {
                const active = settings.tableSkin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    className={`skin-option ${active ? 'is-active' : ''}`}
                    aria-pressed={active}
                    onClick={() => handleSelectSkin(skin.id)}
                  >
                    <span
                      className="skin-option-table"
                      data-table-skin={skin.id}
                      style={{ '--swatch': skin.swatch } as React.CSSProperties}
                      aria-hidden="true"
                    >
                      <span className="skin-option-felt" />
                      <span className="skin-mini-back is-a" />
                      <span className="skin-mini-back is-b" />
                      <span className="skin-mini-card">
                        <b>5</b>
                        <SuitGlyph suit="H" className="skin-mini-suit" />
                      </span>
                    </span>
                    <span className="skin-option-meta">
                      <strong>{skin.label}</strong>
                      <small>{skin.desc}</small>
                    </span>
                    {active && (
                      <span className="skin-option-check" aria-hidden="true">
                        <Icon name="check" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="set-rows">
              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">手牌默认排布</span>
                  <span className="set-row-desc">多于 18 张手牌时的默认展示方式（牌桌内仍可随时切换）</span>
                </span>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={settings.handLayout === 'double' ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({ handLayout: 'double' });
                    }}
                  >
                    双排（主/副）
                  </button>
                  <button
                    type="button"
                    className={settings.handLayout === 'single' ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({ handLayout: 'single' });
                    }}
                  >
                    单排
                  </button>
                </div>
              </div>

              {renderToggleRow(
                '牌面角标提示',
                '在手牌左侧标注红5 / 正副参谋 / 级牌身份，方便辨认大主',
                settings.showCardBadges,
                (v) => onUpdateSettings({ showCardBadges: v }),
              )}
              {renderToggleRow(
                '分牌金色圆点',
                '在 5、10、K 牌面左侧显示金色小圆点，便于数分',
                settings.showPointPips,
                (v) => onUpdateSettings({ showPointPips: v }),
              )}
              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">开屏动画</span>
                  <span className="set-row-desc">打开游戏时播放落印与三牌展开的开场动画</span>
                </span>
                <span className="set-row-controls">
                  {!inGame && onReplaySplash && (
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost"
                      onClick={() => {
                        onClose();
                        onReplaySplash();
                      }}
                    >
                      <Icon name="play" />
                      预览
                    </button>
                  )}
                  {renderToggle(settings.splashEnabled, (v) => onUpdateSettings({ splashEnabled: v }))}
                </span>
              </div>
            </div>
          </section>

          {/* 背景音乐 */}
          <section className="set-group is-wide">
            <div className="set-group-head">
              <h4 className="section-title">背景音乐</h4>
              <span className={`pill ${settings.bgmEnabled ? 'pill-gold' : ''}`}>
                {settings.bgmEnabled ? `播放中 · ${activeBgmTrack.label}` : '已关闭'}
              </span>
            </div>
            <div className="set-rows">
              {renderToggleRow(
                '开启背景音乐',
                '离线内置牌室配乐，切到后台自动暂停',
                settings.bgmEnabled,
                (v) => {
                  onUpdateSettings({ bgmEnabled: v });
                  if (v) bgmPlayer.unlock();
                },
              )}
              <div className={`set-row is-stacked ${settings.bgmEnabled ? '' : 'is-disabled'}`}>
                <span className="set-row-info">
                  <span className="set-row-title">
                    音乐音量
                    <span className="set-row-value">{settings.bgmVolume}%</span>
                  </span>
                </span>
                <input
                  type="range"
                  className="set-slider"
                  min={0}
                  max={100}
                  step={2}
                  disabled={!settings.bgmEnabled}
                  value={settings.bgmVolume}
                  style={{ '--val': `${settings.bgmVolume}%` } as React.CSSProperties}
                  onChange={(e) => onUpdateSettings({ bgmVolume: Number(e.target.value) })}
                />
              </div>
            </div>
            <div
              className={`bgm-track-picker ${settings.bgmEnabled ? '' : 'is-muted'}`}
              role="radiogroup"
              aria-label="选择背景音乐"
            >
              {BGM_TRACK_OPTIONS.map((track) => {
                const active = settings.bgmEnabled && settings.bgmTrack === track.id;
                const selected = settings.bgmTrack === track.id;
                return (
                  <button
                    key={track.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`bgm-track-option ${active ? 'is-active' : selected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectBgmTrack(track.id)}
                  >
                    <span className="bgm-track-head">
                      <span className="bgm-track-icon" aria-hidden="true">♪</span>
                      <strong>{track.label}</strong>
                      <span className="bgm-track-sub">{track.subtitle}</span>
                    </span>
                    <small className="bgm-track-desc">{track.desc}</small>
                    {active && (
                      <span className="skin-option-check bgm-track-check" aria-hidden="true">
                        <Icon name="check" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* 音效与触感 */}
          <section className="set-group">
            <h4 className="section-title">音效与触感</h4>
            <div className="set-rows">
              {renderToggleRow(
                '游戏音效',
                '出牌纸张声、拖拉机连击音与提示音',
                settings.soundEnabled,
                (v) => onUpdateSettings({ soundEnabled: v }),
              )}
              <div className={`set-row is-stacked ${settings.soundEnabled ? '' : 'is-disabled'}`}>
                <span className="set-row-info">
                  <span className="set-row-title">
                    音效音量
                    <span className="set-row-value">{settings.soundVolume}%</span>
                  </span>
                </span>
                <input
                  type="range"
                  className="set-slider"
                  min={0}
                  max={100}
                  step={2}
                  disabled={!settings.soundEnabled}
                  value={settings.soundVolume}
                  style={{ '--val': `${settings.soundVolume}%` } as React.CSSProperties}
                  onChange={(e) => onUpdateSettings({ soundVolume: Number(e.target.value) })}
                  onPointerUp={() => soundFX.playTap()}
                />
              </div>
              {renderToggleRow(
                '选牌震动反馈',
                '安卓设备上滑动或点击选牌时轻微震动',
                settings.hapticsEnabled,
                (v) => onUpdateSettings({ hapticsEnabled: v }),
              )}
            </div>
          </section>

          {/* 出牌与发牌 */}
          <section className="set-group">
            <h4 className="section-title">出牌与发牌</h4>
            <div className="set-rows">
              <div className="set-row is-stacked">
                <span className="set-row-info">
                  <span className="set-row-title">
                    发牌速度
                    <span className="set-row-value">{activeDealSpeed.label}</span>
                  </span>
                  <span className="set-row-desc">
                    {activeDealSpeed.desc}（房主修改即时生效）
                  </span>
                </span>
                <div className="segmented-control is-five" role="radiogroup" aria-label="发牌速度">
                  {DEAL_SPEED_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={settings.dealSpeed === opt.id}
                      className={settings.dealSpeed === opt.id ? 'is-active' : ''}
                      onClick={() => {
                        soundFX.playTap();
                        onUpdateSettings({ dealSpeed: opt.id as DealSpeed });
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {renderToggleRow(
                '必出牌自动预选',
                '同门不足或跟主牌 510K 必出大主时自动帮你选中',
                settings.autoSelectMandatory,
                (v) => onUpdateSettings({ autoSelectMandatory: v }),
              )}
              {renderToggleRow(
                '隐藏竖屏提醒',
                '竖屏浏览时不再在顶部提示“建议横屏”',
                settings.hidePortraitBanner,
                (v) => onUpdateSettings({ hidePortraitBanner: v }),
              )}
            </div>
          </section>

          {/* 机器人难度 */}
          <section className="set-group is-wide">
            <div className="set-group-head">
              <h4 className="section-title">机器人难度</h4>
              <span className="pill">低 · 中 · 强 可独立设置</span>
            </div>
            <div className="set-rows">
              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">队友机器人</span>
                  <span className="set-row-desc">与你同队（含打黑心同阵营闲家）的机器人强度</span>
                </span>
                <div className="segmented-control">
                  {BOT_DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={settings.allyBotDifficulty === opt.id ? 'is-active' : ''}
                      onClick={() => {
                        soundFX.playTap();
                        onUpdateSettings({ allyBotDifficulty: opt.id as BotDifficulty });
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">对手机器人</span>
                  <span className="set-row-desc">敌方阵营机器人强度（房主修改后对局内即时生效）</span>
                </span>
                <div className="segmented-control">
                  {BOT_DIFFICULTY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={settings.opponentBotDifficulty === opt.id ? 'is-active' : ''}
                      onClick={() => {
                        soundFX.playTap();
                        onUpdateSettings({ opponentBotDifficulty: opt.id as BotDifficulty });
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 在线联机服务器 */}
          <section className="set-group is-wide">
            <div className="set-group-head">
              <h4 className="section-title">在线联机服务器</h4>
              <span className={`pill ${playMode === 'offline' ? 'pill-green' : statusMeta.cls}`}>
                {playMode === 'offline'
                  ? '当前：纯离线模式'
                  : playMode === 'lan'
                    ? '当前：局域网模式'
                    : statusMeta.text}
              </span>
            </div>
            <p className="set-note">
              仅「在线联机」模式使用；单机人机与局域网面联完全离线、无需填写。跨设备联机时可填写主机地址（如{' '}
              <code>http://192.168.2.192:3001</code>）。
            </p>
            <div className="set-server-row">
              <input
                className="input-box"
                value={serverInput}
                onChange={(e) => setServerInput(e.target.value)}
                placeholder="例如 http://192.168.2.192:3001"
                disabled={inGame}
              />
              <button
                type="button"
                className="btn btn-gold"
                disabled={inGame}
                onClick={handleSaveServer}
              >
                {savedNotice ? '已保存' : '保存重连'}
              </button>
            </div>
            {inGame && <p className="set-note is-warn">对局进行中暂不可切换服务器，请先退出牌桌再修改。</p>}
          </section>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onClose();
              onOpenRules();
            }}
          >
            <Icon name="book" />
            完整游戏规则
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              soundFX.playTap();
              onUpdateSettings({ ...DEFAULT_APP_SETTINGS });
            }}
          >
            <Icon name="refresh" />
            恢复默认
          </button>
          <span className="modal-footer-spacer" />
          <button type="button" className="btn btn-gold" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
