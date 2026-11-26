import React from 'react';
import { Icon } from './Icons.js';

interface RulesModalProps {
  onClose: () => void;
}

const TRUMP_ORDER = [
  { k: '♥5', note: '仅红心5', hot: true },
  { k: '大王' },
  { k: '小王' },
  { k: '正参谋', note: '主色 3' },
  { k: '副参谋', note: '同色 3' },
  { k: '正级牌' },
  { k: '副级牌', note: '同阶先出为大' },
  { k: '主花色 A…2' },
];

const LEVEL_ROUTE = ['2', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const RulesModal: React.FC<RulesModalProps> = ({ onClose }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3>规则速查</h3>
            <span className="pill">金山打红心 · 打黑心</span>
          </div>
          <button type="button" className="btn btn-xs btn-ghost modal-close" onClick={onClose}>
            <Icon name="close" />
            关闭
          </button>
        </div>

        <div className="rules-doc">
          <section className="rules-section is-wide">
            <h4 className="rules-h">
              <span className="rules-num">壹</span>
              牌具与常主排序
            </h4>
            <p className="rules-lead">
              3 副牌共 162 张：每人 <b>38</b> 张手牌，留 <b>10</b> 张底牌。主牌从大到小：
            </p>
            <ol className="rules-chain">
              {TRUMP_ORDER.map((t) => (
                <li key={t.k} className={t.hot ? 'is-hot' : ''}>
                  <span>{t.k}</span>
                  {t.note && <small>{t.note}</small>}
                </li>
              ))}
            </ol>
          </section>

          <section className="rules-section">
            <h4 className="rules-h">
              <span className="rules-num">贰</span>
              金山打红心
              <span className="pill pill-red">2 打 2 · 升级</span>
            </h4>
            <div className="rules-sub">升级路线</div>
            <ol className="rules-route">
              {LEVEL_ROUTE.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
            <p className="rules-note">打 A 守庄且抵消惩罚后净升 ≥ 1 级即获胜。</p>
            <ul className="rules-list">
              <li>
                <b>边发牌边叫主</b>：拿到合格箭牌（首局 2~3 张同花色 2，后续局任意 1 张级牌）即可随时抢先叫主；即使已有人叫主，38 张仍会完整发完。
              </li>
              <li>
                <b>自由反主与让反</b>：发完牌后若敌方持有不同花色箭牌，开启 10 秒抢点反主窗口（决出胜负后败方队友另给 5 秒）；
                <em>反过主或被反过的玩家不可再次反主</em>。
              </li>
              <li>
                首局可自选亮 2 张或 3 张 2，若实际手牌有 3 张则被反时照常比 21 张比牌；
                <em>被反主方可选择「接受被反」（无惩罚）或「拒绝并比牌」</em>。
              </li>
              <li>反主失败全队罚多打 1 次当前级牌；庄家埋底后锁死。</li>
            </ul>
            <div className="rules-sub">计分（120 分及格）</div>
            <table className="rules-table">
              <tbody>
                <tr>
                  <th>闲家 0 分</th>
                  <td>庄家升 3 级</td>
                </tr>
                <tr>
                  <th>闲家 &lt; 40 分</th>
                  <td>庄家升 2 级</td>
                </tr>
                <tr>
                  <th>40 ~ 115 分</th>
                  <td>庄家升 1 级</td>
                </tr>
                <tr className="is-turn">
                  <th>闲家 120 分</th>
                  <td>闲家上台</td>
                </tr>
                <tr className="is-turn">
                  <th>180 分起</th>
                  <td>每 60 分闲家多升 1 级（先抵消惩罚）</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rules-section">
            <h4 className="rules-h">
              <span className="rules-num">叁</span>
              金山打黑心
              <span className="pill">1 打 3 · 叫分</span>
            </h4>
            <ul className="rules-list">
              <li>固定打 10，不升级；副参谋与打红心一致（同色 3）。</li>
              <li>
                <b>100 ~ 300 叫分抢庄</b>，最高者坐庄并自选主花色，<em>严禁把 10 埋入底牌</em>。
              </li>
              <li>庄家抓分；末轮闲家赢墩触发抠底（仅算底牌 5 / 10 / K，×2）。</li>
              <li>
                庄家最终得分 <b>满叫分即庄家获胜</b>，否则闲家获胜。
              </li>
            </ul>

            <h4 className="rules-h is-spaced">
              <span className="rules-num">肆</span>
              跟牌、510K 与 A=1
            </h4>
            <ul className="rules-list">
              <li>
                <b>自由跟牌与甩牌盖毙</b>：除「有同门必跟同门」与「跟主牌 510K 未压/未抵须出最大主牌」外，
                <em>无强制跟对子、三张或拖拉机要求</em>；甩牌失败强出最小被管上组件。
              </li>
              <li>
                多人主牌盖毙副牌甩牌时，<em>按单组张数最多的牌型定胜负</em>（同牌型只比最大一组，打平先出为大；同张数不同结构并列全不输才算盖毙）。
              </li>
              <li>
                <code>A=1</code>：非打 A 时，各花色 A 可当 1 与最小普通点连成拖拉机（如打 2 主 ♦ 时，♦AA♦44、♥AA♥44♥66 均可），不可首尾回绕。
              </li>
              <li>
                <code>510K</code>（仅限同花色，可借非主 ♥5 及级牌 10/K）：单 510K 仅同门三张压；双 510K 仅 2 连三拖拉机压；三 510K 仅 3 连三拖拉机压；不相连三张 / 510K 仅抵消。
              </li>
              <li>
                跟<b>主牌 510K</b> 允许放弃压/抵，未抵消部分须出手中当前剩余最大的对应张数主牌。
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};
