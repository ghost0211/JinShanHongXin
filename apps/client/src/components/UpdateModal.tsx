import React, { useEffect, useRef, useState } from 'react';
import {
  buildDownloadCandidates,
  formatBytes,
  getOtaTaskStatus,
  openExternalDownloadUrl,
  reloadUpdatedApp,
  startOtaInstall,
  type OtaTaskStatus,
  type UpdateCheckResult,
} from '../utils/updater.js';
import { soundFX } from '../utils/sound.js';
import { Icon } from './Icons.js';

interface UpdateModalProps {
  checkResult: UpdateCheckResult;
  mirrorUrl: string;
  onClose: () => void;
  onIgnoreVersion: (version: string) => void;
}

const INITIAL_TASK: OtaTaskStatus = {
  state: 'idle',
  version: '',
  downloadedBytes: 0,
  totalBytes: 0,
  progress: 0,
  error: '',
};

export const UpdateModal: React.FC<UpdateModalProps> = ({
  checkResult,
  mirrorUrl,
  onClose,
  onIgnoreVersion,
}) => {
  const manifest = checkResult.manifest;
  const plan = checkResult.plan;
  const [task, setTask] = useState<OtaTaskStatus>(INITIAL_TASK);
  const [attemptIndex, setAttemptIndex] = useState(0);
  const candidatesRef = useRef<string[]>([]);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  if (!manifest || !plan) return null;

  const isBusy =
    task.state === 'downloading' ||
    task.state === 'verifying' ||
    task.state === 'extracting';
  const isReady = task.state === 'ready';
  const primarySize = formatBytes(plan.primaryAsset?.size);

  const stopPolling = () => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const launchOtaAttempt = async (urls: string[], idx: number) => {
    const asset = plan.primaryAsset;
    if (!asset || idx >= urls.length) return;

    setAttemptIndex(idx);
    setTask({
      state: 'downloading',
      version: manifest.version,
      downloadedBytes: 0,
      totalBytes: asset.size ?? 0,
      progress: 5,
      error: '',
    });

    const startRes = await startOtaInstall(manifest.version, urls[idx], asset.sha256 ?? '');
    if (!startRes.ok) {
      if (idx + 1 < urls.length) {
        void launchOtaAttempt(urls, idx + 1);
        return;
      }
      setTask({
        state: 'error',
        version: manifest.version,
        downloadedBytes: 0,
        totalBytes: asset.size ?? 0,
        progress: 0,
        error: startRes.error || '启动热更新失败',
      });
      return;
    }

    stopPolling();
    pollTimerRef.current = window.setInterval(() => {
      void getOtaTaskStatus().then((st) => {
        setTask(st);
        if (st.state === 'ready') {
          stopPolling();
        } else if (st.state === 'error') {
          stopPolling();
          if (idx + 1 < urls.length) {
            void launchOtaAttempt(urls, idx + 1);
          }
        }
      });
    }, 180);
  };

  const handleStartOta = () => {
    if (!plan.primaryAsset || isBusy) return;
    soundFX.playTap();
    const urls = buildDownloadCandidates(plan.primaryAsset, {
      mirrorUrl,
      relayBaseUrl: checkResult.relayBaseUrl,
      manifest,
    });
    candidatesRef.current = urls;
    void launchOtaAttempt(urls, 0);
  };

  const handleDownloadInstaller = (asset = plan.primaryAsset) => {
    soundFX.playTap();
    if (!asset) {
      void openExternalDownloadUrl(manifest.releaseUrl);
      return;
    }
    const urls = buildDownloadCandidates(asset, {
      mirrorUrl,
      relayBaseUrl: checkResult.relayBaseUrl,
      manifest,
    });
    void openExternalDownloadUrl(urls[0] || asset.url);
  };

  const progressText =
    task.state === 'downloading'
      ? `正在下载热更新包${
          attemptIndex > 0 ? '（自动切换备用线路）' : ''
        }${
          task.downloadedBytes > 0
            ? ` · ${formatBytes(task.downloadedBytes)}${
                task.totalBytes > 0 ? ` / ${formatBytes(task.totalBytes)}` : ''
              }`
            : ''
        }`
      : task.state === 'verifying'
        ? '正在校验 SHA-256 完整性…'
        : task.state === 'extracting'
          ? '正在解压并提交新版本…'
          : task.state === 'ready'
            ? `v${manifest.version} 已就绪，点击立即生效`
            : '';

  const modeBadge =
    plan.kind === 'ota-hot-update'
      ? `热更新${primarySize ? ` · ${primarySize}` : ''}`
      : plan.kind === 'native-install'
        ? `安装包更新${primarySize ? ` · ${primarySize}` : ''}`
        : '发现新版本';

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div className="modal-card update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>发现新版本 v{manifest.version}</h3>
            <span className={`pill ${plan.kind === 'ota-hot-update' ? 'pill-gold' : 'pill-green'}`}>
              {modeBadge}
            </span>
          </div>
          {!isBusy && (
            <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
              <Icon name="close" />
              关闭
            </button>
          )}
        </div>

        <div className="update-version-bar">
          <span className="update-ver-chip">
            当前 <strong>v{checkResult.current.effectiveVersion}</strong>
            {checkResult.current.otaActive ? '（热更）' : ''}
          </span>
          <span className="update-ver-arrow" aria-hidden="true">→</span>
          <span className="update-ver-chip is-new">
            最新 <strong>v{manifest.version}</strong>
          </span>
          <span className="update-ver-note">{plan.reason}</span>
        </div>

        <div className="update-notes-box" role="region" aria-label="更新说明">
          <div className="update-notes-label">更新内容</div>
          <pre className="update-notes-text">{manifest.notes}</pre>
        </div>

        {(isBusy || isReady) && (
          <div className={`update-progress-wrap ${isReady ? 'is-ready' : ''}`}>
            <div className="update-progress-head">
              <span>{progressText}</span>
              <strong>{Math.min(100, Math.max(0, task.progress))}%</strong>
            </div>
            <div className="update-progress-track">
              <div
                className="update-progress-fill"
                style={{ width: `${Math.min(100, Math.max(4, task.progress))}%` }}
              />
            </div>
          </div>
        )}

        {task.state === 'error' && (
          <div className="update-error-box">
            <span>热更新失败：{task.error}</span>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => void openExternalDownloadUrl(manifest.releaseUrl)}
            >
              前往发布页下载
            </button>
          </div>
        )}

        <div className="modal-footer">
          {!isBusy && !isReady && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                soundFX.playTap();
                onIgnoreVersion(manifest.version);
                onClose();
              }}
            >
              忽略此版本
            </button>
          )}
          {!isBusy && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void openExternalDownloadUrl(manifest.releaseUrl)}
            >
              发布页
            </button>
          )}
          <span className="modal-footer-spacer" />

          {plan.kind === 'ota-hot-update' && !isReady && (
            <button
              type="button"
              className="btn btn-gold"
              disabled={isBusy}
              onClick={handleStartOta}
            >
              {isBusy
                ? '更新中…'
                : task.state === 'error'
                  ? '重试热更新'
                  : `立即热更新${primarySize ? ` (${primarySize})` : ''}`}
            </button>
          )}

          {isReady && (
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => {
                soundFX.playTap();
                reloadUpdatedApp();
              }}
            >
              立即重启生效
            </button>
          )}

          {plan.kind === 'native-install' && (
            <>
              {plan.secondaryAsset && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleDownloadInstaller(plan.secondaryAsset)}
                >
                  绿色压缩包
                </button>
              )}
              <button
                type="button"
                className="btn btn-gold"
                onClick={() => handleDownloadInstaller(plan.primaryAsset)}
              >
                {checkResult.current.platform === 'android'
                  ? '下载新版 APK'
                  : '下载 Windows 安装包'}
              </button>
            </>
          )}

          {plan.kind === 'web-refresh' && (
            <button
              type="button"
              className="btn btn-gold"
              onClick={() => {
                soundFX.playTap();
                window.location.reload();
              }}
            >
              刷新页面
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
