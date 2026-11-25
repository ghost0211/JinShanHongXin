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
              <li>升级路线：<code>2 → 4 → 6 → 7 → 8 → 9 → 10 → J → Q → K → A</code>（打 A 守庄且抵消惩罚后净升 ≥1 级即获胜）。</li>
              <li><strong>边发牌边叫主</strong>：拿到合格箭牌（首局 2~3 张同花色 2，后续局任意 1 张级牌）即可随时抢先叫主；即使已有人叫主，38 张发牌动画仍会完整发完。</li>
              <li><strong>自由反主与让反</strong>：发完牌后若敌方持有不同花色箭牌，开启 10 秒抢点反主窗口（决出胜负后败方队友另给 5 秒）；<strong>反过主或被反过的玩家不可再次反主</strong>。</li>
              <li>首局可自选亮 2 张或 3 张 2，若实际手牌有 3 张则被反时照常比 21 张比牌；<strong>被反主方可选择「接受被反」（无惩罚）或「拒绝并比牌」</strong>。</li>
              <li>反主失败全队罚多打 1 次当前级牌；庄家埋底后锁死。计分（120 及格）：闲 0 分庄跳 3 级、&lt;40 分庄跳 2 级、40~115 庄升 1 级；闲 120 上台，180 起每 60 分升 1 级（先抵消惩罚）。</li>
            </ul>
          </div>

          <div>
            <strong>3. 金山打黑心（1 打 3 · 叫分）</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li>固定打 10 不升级，副参谋与打红心一致（同色 3），100~300 叫分抢庄，最高者坐庄并自选主花色，<strong>严禁把 10 埋入底牌</strong>。</li>
              <li>庄家抓分，末轮闲家赢墩触发抠底（仅算底牌 5/10/K ×2），庄家最终得分满叫分即庄家获胜，否则闲家获胜。</li>
            </ul>
          </div>

          <div>
            <strong>4. 跟牌、510K 与 A=1 规则</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
              <li><strong>自由跟牌与甩牌盖毙</strong>：除「有同门必跟同门」与「跟主牌 510K 未压/未抵须出最大主牌」外，<strong>无强制跟对子、三张或拖拉机要求</strong>；甩牌失败强出最小被管上组件；多人主牌盖毙副牌甩牌时，<strong>按单组张数最多的牌型定胜负（同牌型只比最大一组，打平先出为大；同张数不同结构并列全不输才算盖毙）</strong>。</li>
              <li><code>A=1</code>：非打 A 时，各花色 A 可当 1 与最小普通点连成拖拉机（如打 2 主 ♦ 时，♦AA♦44、♥AA♥44♥66 均可），不可首尾回绕。</li>
              <li><code>510K</code>（仅限同花色，可借非主 ♥5 及级牌 10/K）：单 510K 仅同门三张压；双 510K 仅 2 连三拖拉机压；三 510K 仅 3 连三拖拉机压，不相连三张/510K 仅抵消。</li>
              <li>跟<strong>主牌 510K</strong> 允许放弃压/抵，未抵消部分须出手中当前剩余最大的对应张数主牌。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
