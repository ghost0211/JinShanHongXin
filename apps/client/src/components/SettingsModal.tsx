import React, { useEffect, useState } from 'react';
import type { ConnectionStatus } from '../net/wsClient.js';
import {
  TABLE_SKIN_OPTIONS,
  type AppSettings,
  type TableSkin,
} from '../utils/settings.js';
import { soundFX } from '../utils/sound.js';

interface SettingsModalProps {
  settings: AppSettings;
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

  const handleSelectSkin = (skin: TableSkin) => {
    soundFX.playTap();
    onUpdateSettings({ tableSkin: skin });
  };

  const handleSaveServer = () => {
    onUpdateServerUrl(serverInput);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  const renderToggleRow = (
    title: string,
    desc: string,
    checked: boolean,
    onChange: (next: boolean) => void,
  ) => (
    <label className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-title">{title}</span>
        <span className="settings-row-desc">{desc}</span>
      </div>
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
    </label>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3>游戏设置</h3>
            <span className="pill">v0.1.0</span>
          </div>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="settings-body">
          {/* Section 1: Theme & Visuals */}
          <section className="settings-section">
            <h4 className="settings-section-title">外观与牌桌主题</h4>
            <div className="skin-grid">
              {TABLE_SKIN_OPTIONS.map((skin) => {
                const active = settings.tableSkin === skin.id;
                return (
                  <button
                    key={skin.id}
                    type="button"
                    className={`skin-card ${active ? 'is-active' : ''}`}
                    onClick={() => handleSelectSkin(skin.id)}
                  >
                    <span
                      className="skin-card-swatch"
                      style={{
                        background: skin.swatch,
                        borderColor: skin.accent,
                      }}
                    />
                    <span className="skin-card-meta">
                      <strong>{skin.label}</strong>
                      <small>{skin.desc}</small>
                    </span>
                    {active && <span className="skin-card-check">✓</span>}
                  </button>
                );
              })}
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-title">手牌默认排布</span>
                <span className="settings-row-desc">
                  多于 18 张手牌时的默认展示方式（牌桌内仍可随时切换）
                </span>
              </div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={settings.handLayout === 'double' ? 'is-active' : ''}
                  onClick={() => {
                    soundFX.playTap();
                    onUpdateSettings({ handLayout: 'double' });
                  }}
                >
                  双排(主/副)
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
              '牌面角标提示（红5 / 正副参谋 / 级牌）',
              '在手牌左下角标注主牌身份，方便快速辨认大主',
              settings.showCardBadges,
              (v) => onUpdateSettings({ showCardBadges: v }),
            )}
            {renderToggleRow(
              '分牌金色圆点标记',
              '在 5、10、K 牌面左侧显示金色小圆点以便数分',
              settings.showPointPips,
              (v) => onUpdateSettings({ showPointPips: v }),
            )}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-title">开机启动动画</span>
                <span className="settings-row-desc">打开游戏时播放红五三牌开场动画</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!inGame && onReplaySplash && (
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => {
                      onClose();
                      onReplaySplash();
                    }}
                  >
                    预览
                  </button>
                )}
                <label className={`toggle-switch ${settings.splashEnabled ? 'is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={settings.splashEnabled}
                    onChange={(e) => {
                      soundFX.playTap();
                      onUpdateSettings({ splashEnabled: e.target.checked });
                    }}
                  />
                  <span className="toggle-thumb" />
                </label>
              </div>
            </div>
          </section>

          {/* Section 2: Audio & Haptics */}
          <section className="settings-section">
            <h4 className="settings-section-title">音效与触感</h4>
            {renderToggleRow(
              '游戏音效',
              '拟真出牌纸张摩擦音、拖拉机连击音与提示音',
              settings.soundEnabled,
              (v) => onUpdateSettings({ soundEnabled: v }),
            )}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-title">
                  音效音量（{settings.soundVolume}%）
                </span>
                <span className="settings-row-desc">调节出牌与提示音效响度</span>
              </div>
              <input
                type="range"
                className="settings-slider"
                min={0}
                max={100}
                step={2}
                disabled={!settings.soundEnabled}
                value={settings.soundVolume}
                onChange={(e) =>
                  onUpdateSettings({ soundVolume: Number(e.target.value) })
                }
                onPointerUp={() => soundFX.playTap()}
              />
            </div>
            {renderToggleRow(
              '选牌震动反馈（安卓设备）',
              '滑动或点击选牌时提供轻微触觉反馈',
              settings.hapticsEnabled,
              (v) => onUpdateSettings({ hapticsEnabled: v }),
            )}
          </section>

          {/* Section 3: Gameplay Assists */}
          <section className="settings-section">
            <h4 className="settings-section-title">出牌辅助</h4>
            {renderToggleRow(
              '必出牌自动预选',
              '同门剩余张数不足或跟主牌 510K 必出大主时自动帮你选中',
              settings.autoSelectMandatory,
              (v) => onUpdateSettings({ autoSelectMandatory: v }),
            )}
            {renderToggleRow(
              '隐藏竖屏横幅提醒',
              '竖屏浏览时不再顶部弹出建议横屏提示条',
              settings.hidePortraitBanner,
              (v) => onUpdateSettings({ hidePortraitBanner: v }),
            )}
          </section>

          {/* Section 4: Connection & Rules */}
          <section className="settings-section">
            <div className="settings-section-head">
              <h4 className="settings-section-title" style={{ margin: 0 }}>
                联机服务器
              </h4>
              <span className={`pill ${statusMeta.cls}`}>{statusMeta.text}</span>
            </div>
            <p className="settings-row-desc" style={{ margin: '0 0 6px' }}>
              留空默认连接同源服务器；安卓 APK 或局域网跨设备联机时可填写主机地址（如{' '}
              <code>http://192.168.2.192:3001</code>）
            </p>
            <div className="field-row" style={{ marginBottom: 4 }}>
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
            {inGame && (
              <div className="settings-row-desc">
                对局进行中暂不可切换服务器，请先退出牌桌再修改。
              </div>
            )}

            <div className="settings-footer-actions">
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  onClose();
                  onOpenRules();
                }}
              >
                查看完整游戏规则
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => {
                  soundFX.playTap();
                  onUpdateSettings({
                    tableSkin: 'classic',
                    soundEnabled: true,
                    soundVolume: 82,
                    hapticsEnabled: true,
                    splashEnabled: true,
                    handLayout: 'double',
                    showCardBadges: true,
                    showPointPips: true,
                    autoSelectMandatory: true,
                    hidePortraitBanner: false,
                  });
                }}
              >
                恢复默认设置
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
