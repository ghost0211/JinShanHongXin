import React, { useState } from 'react';
import type { UserProfile } from '@jinshan/protocol';
import { Icon } from './Icons.js';

interface AuthModalProps {
  currentUser: UserProfile | null;
  onLogin: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (
    username: string,
    password: string,
    inviteCode: string,
    nickname?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onUpdateNickname: (nickname: string) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  currentUser,
  onLogin,
  onRegister,
  onUpdateNickname,
  onLogout,
  onClose,
}) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(currentUser?.nickname ?? '');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const code = inviteCode.trim();
    if (tab === 'register' && !code) {
      setError('请输入管理员提供的注册邀请码');
      return;
    }
    setError('');
    setSubmitting(true);
    const res =
      tab === 'login'
        ? await onLogin(username, password)
        : await onRegister(username, password, code, nickname);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? '操作失败');
      return;
    }
    onClose();
  };

  const handleSaveNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res = await onUpdateNickname(nickname);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? '修改失败');
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{currentUser ? '我的账号与战绩' : '账号登录 / 注册'}</h3>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            关闭
          </button>
        </div>

        {currentUser ? (
          <div className="auth-body">
            <div className="auth-profile">
              <span className="auth-avatar" aria-hidden="true">
                {currentUser.nickname.slice(0, 1)}
              </span>
              <div className="auth-profile-meta">
                <strong>{currentUser.nickname}</strong>
                <small>@{currentUser.username}</small>
              </div>
            </div>
            <div className="auth-stats">
              <div className="auth-stat is-hongxin">
                <span className="auth-stat-label">金山打红心</span>
                <span className="auth-stat-val">
                  <b>{currentUser.hongxinWins}</b> 胜 / {currentUser.hongxinGames} 局
                </span>
              </div>
              <div className="auth-stat is-heixin">
                <span className="auth-stat-label">金山打黑心</span>
                <span className="auth-stat-val">
                  <b>{currentUser.heixinWins}</b> 胜 / {currentUser.heixinGames} 局
                </span>
                <span className="auth-stat-extra">累计 {currentUser.heixinTotalScore} 分</span>
              </div>
            </div>

            <form onSubmit={handleSaveNickname} className="auth-form">
              <label className="form-field">
                <span className="form-label">牌桌显示昵称</span>
                <span className="auth-inline">
                  <input
                    className="input-box"
                    value={nickname}
                    maxLength={16}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="输入新昵称"
                  />
                  <button type="submit" className="btn btn-gold" disabled={submitting}>
                    保存
                  </button>
                </span>
              </label>
            </form>

            {error && <div className="form-error">{error}</div>}

            <div className="modal-footer is-plain">
              <span className="modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-crimson"
                onClick={async () => {
                  await onLogout();
                  onClose();
                }}
              >
                <Icon name="exit" />
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitAuth} className="auth-body">
            <div className="segmented-control auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'login'}
                className={tab === 'login' ? 'is-active' : ''}
                onClick={() => {
                  setTab('login');
                  setInviteCode('');
                  setError('');
                }}
              >
                <span className="auth-tab-title">账号登录</span>
                <span className="auth-tab-desc">恢复历史战绩与积分</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'register'}
                className={tab === 'register' ? 'is-active' : ''}
                onClick={() => {
                  setTab('register');
                  setError('');
                }}
              >
                <span className="auth-tab-title">邀请码注册</span>
                <span className="auth-tab-desc">向管理员索取一次性邀请码</span>
              </button>
            </div>

            <label className="form-field">
              <span className="form-label">用户名</span>
              <input
                className="input-box"
                value={username}
                maxLength={20}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="2~20 位中英文 / 数字"
                required
              />
            </label>
            <label className="form-field">
              <span className="form-label">密码</span>
              <input
                className="input-box"
                type="password"
                value={password}
                maxLength={64}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 4 位"
                required
              />
            </label>
            {tab === 'register' && (
              <div className="auth-register-extra">
                <label className="form-field">
                  <span className="form-label">注册邀请码</span>
                  <input
                    className="input-box"
                    type="password"
                    value={inviteCode}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label="注册邀请码"
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="粘贴管理员提供的邀请码"
                    required
                  />
                </label>
                <label className="form-field">
                  <span className="form-label">
                    牌桌昵称 <small>选填</small>
                  </span>
                  <input
                    className="input-box"
                    value={nickname}
                    maxLength={16}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="默认同用户名"
                  />
                </label>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <div className="modal-footer is-plain">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                暂不登录（游客）
              </button>
              <span className="modal-footer-spacer" />
              <button type="submit" className="btn btn-gold btn-lg" disabled={submitting}>
                {submitting ? '提交中...' : tab === 'login' ? '登录' : '注册并登录'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
