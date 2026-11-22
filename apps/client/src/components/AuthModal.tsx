import React, { useState } from 'react';
import type { UserProfile } from '@jinshan/protocol';

interface AuthModalProps {
  currentUser: UserProfile | null;
  onLogin: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  onRegister: (
    username: string,
    password: string,
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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const res =
      tab === 'login'
        ? await onLogin(username, password)
        : await onRegister(username, password, nickname);
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
      <div
        className="modal-card"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{currentUser ? '我的账号与战绩' : '账号登录 / 注册'}</h3>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        {currentUser ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <div className="card-panel" style={{ padding: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--gold-strong)' }}>
                {currentUser.nickname}{' '}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                  (@{currentUser.username})
                </span>
              </div>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>金山打红心</div>
                  <div style={{ fontWeight: 800, marginTop: 2 }}>
                    {currentUser.hongxinWins} 胜 / {currentUser.hongxinGames} 局
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>金山打黑心</div>
                  <div style={{ fontWeight: 800, marginTop: 2 }}>
                    {currentUser.heixinWins} 胜 / {currentUser.heixinGames} 局 ·{' '}
                    <span style={{ color: 'var(--gold-strong)' }}>
                      {currentUser.heixinTotalScore} 分
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveNickname} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>修改牌桌显示昵称</label>
              <div className="field-row" style={{ marginBottom: 0 }}>
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
              </div>
            </form>

            {error && <div style={{ color: '#fda4af', fontSize: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-crimson"
                onClick={async () => {
                  await onLogout();
                  onClose();
                }}
              >
                退出登录
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitAuth} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="mode-tabs" style={{ marginBottom: 4 }}>
              <button
                type="button"
                className={`mode-card ${tab === 'login' ? 'is-active' : ''}`}
                onClick={() => {
                  setTab('login');
                  setError('');
                }}
              >
                <h4>账号登录</h4>
                <p>恢复历史战绩与积分</p>
              </button>
              <button
                type="button"
                className={`mode-card ${tab === 'register' ? 'is-active' : ''}`}
                onClick={() => {
                  setTab('register');
                  setError('');
                }}
              >
                <h4>注册新号</h4>
                <p>3 秒创建个人账号</p>
              </button>
            </div>

            <input
              className="input-box"
              value={username}
              maxLength={20}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名（2~20 位中英文/数字）"
              required
            />
            <input
              className="input-box"
              type="password"
              value={password}
              maxLength={64}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码（至少 4 位）"
              required
            />
            {tab === 'register' && (
              <input
                className="input-box"
                value={nickname}
                maxLength={16}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="牌桌昵称（选填，默认同用户名）"
              />
            )}

            {error && <div style={{ color: '#fda4af', fontSize: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                暂不登录（游客）
              </button>
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
