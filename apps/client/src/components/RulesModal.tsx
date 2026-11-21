import React from 'react';

interface RulesModalProps {
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ onClose }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>《金山打红心 · 打黑心》规则速查</h3>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={{ fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <strong>1. 牌具与常主排序（3 副牌 162 张，38 张手牌 + 10 张底牌）</strong>
            <div>
              主牌大小：<code>红心5（仅♥5）&gt; 大王 &gt; 小王 &gt; 正参谋（主色3）&gt; 副参谋（同色3）&gt; 正级牌 &gt; 副级牌（同阶先出为大）&gt; 主花色A..2</code>
            </div>
          </div>

          <div>
            <strong>2. 金山打红心（2 打 2 · 升级）</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li>升级路线：<code>2 → 4 → 6 → 7 → 8 → 9 → 10 → J → Q → K → A</code>（先打完 A 的庄家方胜）。</li>
              <li>首局打 2 需 2~3 张同花色 2 叫主抢庄；反主需 3 张 2（压 2 张直接抢庄，压 3 张比 21 张比牌）。</li>
              <li>后续局四家均可亮 1 张级牌定主（不换庄）；敌方可亮不同花色级牌比牌反主（必须严格多于叫主方）。</li>
              <li>反主失败全队罚多打 1 次当前级牌；队友仍可继续反主，之前惩罚保留；庄家埋底后锁死。</li>
              <li>计分（共 300 分，120 及格）：闲 0 分庄跳 3 级、&lt;40 分庄跳 2 级、40~115 庄升 1 级；闲家 120 上台，180 起每多 60 分升 1 级（先抵消反主惩罚）。</li>
            </ul>
          </div>

          <div>
            <strong>3. 金山打黑心（1 打 3 · 叫分）</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li>固定打 10 不升级，100~300 叫分抢庄，最高者坐庄并自选主花色，<strong>严禁把 10 埋入底牌</strong>。</li>
              <li>末轮任一闲家赢墩同样触发抠底（仅算底牌 5/10/K ×2），庄家需保住 <code>300 - 闲总分 ≥ 叫分</code>。</li>
            </ul>
          </div>

          <div>
            <strong>4. 特殊牌型与 510K / A=1</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li><code>A=1</code>：非打 A 时，各花色 A 可当 1 与最小普通点连成拖拉机（如打 2 主 ♦ 时，♦AA♦44、♥AA♥44♥66 均可），不可首尾回绕。</li>
              <li>跟三张 / 连三不强制用对子补齐；甩牌失败强出最小被管上组件。</li>
              <li><code>510K</code>（可借非主 ♥5 及级牌 10/K）：单 510K 仅同门三张压；双 510K 仅 2 连三拖拉机压；三 510K 仅 3 连三拖拉机压，不相连三张/510K 仅抵消。</li>
              <li>跟<strong>主牌 510K</strong> 时若无三张压或 510K 抵消，未抵消部分须出当前最大主牌补足。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
