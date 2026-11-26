import React, { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../net/wsClient.js';
import {
  BGM_TRACK_OPTIONS,
  CARD_SCALE_STEP,
  clampCardScale,
  DEFAULT_APP_SETTINGS,
  MAX_CARD_SCALE,
  MIN_CARD_SCALE,
  TABLE_SKIN_OPTIONS,
  type AppSettings,
  type BgmTrackId,
  type TableSkin,
} from '../utils/settings.js';
import {
  isRunningInTauriDesktop,
  resetDesktopWindowSize,
} from '../utils/desktopBridge.js';
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
  const isDesktopApp = isRunningInTauriDesktop();
  const scalePct = Math.round(settings.cardScale * 100);

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

          {/* 出牌辅助 */}
          <section className="set-group">
            <h4 className="section-title">出牌辅助</h4>
            <div className="set-rows">
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

          {/* PC 键鼠与桌面操作 */}
          <section className="set-group is-wide">
            <div className="set-group-head">
              <h4 className="section-title">PC 键鼠与桌面操作</h4>
              <span className="pill pill-gold">按 F1 / ? 随时打开</span>
            </div>
            <div className="set-rows">
              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">右键点击牌桌行为</span>
                  <span className="set-row-desc">
                    {settings.rightClickMode === 'play'
                      ? '智能出牌：已选合法牌且轮到你时直接出牌/埋底，否则清空选牌'
                      : '保守清空：右键始终清空已选牌，避免误出'}
                  </span>
                </span>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={settings.rightClickMode === 'clear' ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({ rightClickMode: 'clear' });
                    }}
                  >
                    清空选牌
                  </button>
                  <button
                    type="button"
                    className={settings.rightClickMode === 'play' ? 'is-active' : ''}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({ rightClickMode: 'play' });
                    }}
                  >
                    直接出牌
                  </button>
                </div>
              </div>

              {renderToggleRow(
                '双击手牌快速出牌',
                '双击合法单张或已选好的合法牌型直接打出，无需移到出牌按钮',
                settings.doubleClickPlay,
                (v) => onUpdateSettings({ doubleClickPlay: v }),
              )}

              <div className="set-row">
                <span className="set-row-info">
                  <span className="set-row-title">
                    牌面缩放比例
                    <span className="set-row-value">{scalePct}%</span>
                  </span>
                  <span className="set-row-desc">
                    按 Ctrl + / - / 0 可随时调节，适配 1080p / 2K / 4K 屏幕
                  </span>
                </span>
                <div className="set-scale-controls">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    disabled={settings.cardScale <= MIN_CARD_SCALE}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({
                        cardScale: clampCardScale(settings.cardScale - CARD_SCALE_STEP),
                      });
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({ cardScale: 1.0 });
                    }}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    disabled={settings.cardScale >= MAX_CARD_SCALE}
                    onClick={() => {
                      soundFX.playTap();
                      onUpdateSettings({
                        cardScale: clampCardScale(settings.cardScale + CARD_SCALE_STEP),
                      });
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {isDesktopApp &&
                renderToggleRow(
                  '切屏时任务栏闪烁提醒',
                  '窗口在后台时轮到你操作，自动闪烁 Windows 任务栏并轻声提示',
                  settings.flashTaskbarOnTurn,
                  (v) => onUpdateSettings({ flashTaskbarOnTurn: v }),
                )}

              {renderToggleRow(
                '对局中退出 / 关窗二次确认',
                '防止对局进行中误点「退出」或窗口右上角关闭按钮',
                settings.confirmExitInGame,
                (v) => onUpdateSettings({ confirmExitInGame: v }),
              )}

              {isDesktopApp && (
                <div className="set-row">
                  <span className="set-row-info">
                    <span className="set-row-title">窗口默认尺寸</span>
                    <span className="set-row-desc">将桌面窗口恢复至 1280×800 并居中显示</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => void resetDesktopWindowSize()}
                  >
                    重置窗口
                  </button>
                </div>
              )}
            </div>

            <div className="shortcut-cheat-grid" aria-label="PC 键鼠快捷键速查">
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">左键拖动</kbd></span>
                <span>区间连选（回拖取消）</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">点空白 / 右键</kbd></span>
                <span>清空或快捷出牌</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">Enter</kbd> / <kbd className="kbd-chip">Space</kbd></span>
                <span>出牌 / 埋底 / 下一局</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">H</kbd> / <kbd className="kbd-chip">Esc</kbd></span>
                <span>提示 / 清空或关弹窗</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">1</kbd>–<kbd className="kbd-chip">5</kbd> · <kbd className="kbd-chip">N</kbd></span>
                <span>叫主 / 反主 / 叫分 / 不叫</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">按住 Tab</kbd> · <kbd className="kbd-chip">L</kbd></span>
                <span>速览 / 固定上一轮</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">S</kbd> · <kbd className="kbd-chip">B</kbd> · <kbd className="kbd-chip">R</kbd></span>
                <span>查分 / 看底牌 / 单双排</span>
              </div>
              <div className="shortcut-item">
                <span><kbd className="kbd-chip">T</kbd> · <kbd className="kbd-chip">M</kbd> · <kbd className="kbd-chip">F11</kbd></span>
                <span>托管 / 静音 / 全屏</span>
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !inGame) {
                    handleSaveServer();
                  }
                }}
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
