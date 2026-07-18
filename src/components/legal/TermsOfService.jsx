import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '../../i18n/index.js';
import TermsOfServiceEnglishContent from './TermsOfServiceEnglishContent';

/**
 * 用户服务协议页面
 */
export default function TermsOfService() {
  const { isEnglish, t } = useI18n();

  useEffect(() => {
    document.title = isEnglish ? 'Terms of Service | Endfield Gacha Analyzer' : '用户服务协议 | 终末地抽卡分析器';

    return () => {
      document.title = t('app.documentTitle');
    };
  }, [isEnglish, t]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 text-slate-800 dark:text-zinc-200">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <a
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-zinc-500 hover:text-endfield-yellow transition-colors mb-8"
        >
          <ArrowLeft size={16} />
          {isEnglish ? 'Back to Home' : '返回首页'}
        </a>

        {isEnglish ? (
          <>
            <h1 className="text-2xl font-bold mb-2">Terms of Service</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-500 mb-8">Last updated: July 19, 2026</p>
            <TermsOfServiceEnglishContent />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2">用户服务协议</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-500 mb-8">最后更新日期：2026年7月19日</p>
            <div className="space-y-6 text-sm leading-relaxed">
              <section>
                <h2 className="text-lg font-semibold mb-2">一、协议范围</h2>
                <p>
                  本协议是您与终末地抽卡分析器（以下简称"本工具"）之间关于使用本工具服务的法律协议。注册或使用本工具即表示您已阅读、理解并同意受本协议约束。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">二、服务说明</h2>
                <p>本工具是一款非官方的第三方抽卡数据分析工具，提供以下服务：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>游戏抽卡记录的导入与存储。</li>
                  <li>导入结果审阅、异常记录核对及抽卡记录的受控编辑与删除。</li>
                  <li>抽卡数据的统计分析与可视化展示。</li>
                  <li>抽卡模拟器功能。</li>
                  <li>跨设备数据同步。</li>
                  <li>全服匿名统计排行。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">三、免责声明</h2>
                <ul className="list-disc pl-6 space-y-1">
                  <li>本工具与《明日方舟：终末地》游戏官方（鹰角网络 / Gryphline / HyperGryph）无任何关联。</li>
                  <li>游戏内所有内容（包括角色名称、图像等）的版权归游戏官方所有。</li>
                  <li>本工具不保证数据分析结果的绝对准确性，分析结果仅供参考。</li>
                  <li>本工具不对因使用本工具而产生的任何直接或间接损失承担责任。</li>
                  <li>抽卡模拟器的模拟结果不代表游戏内的实际概率表现。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">四、用户行为规范</h2>
                <p>使用本工具时，您同意遵守以下规范：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>不得利用本工具进行任何违反法律法规的活动。</li>
                  <li>不得尝试未经授权访问其他用户的数据。</li>
                  <li>不得对本工具的服务器进行恶意攻击或滥用。</li>
                  <li>不得利用本工具传播违法违规信息。</li>
                  <li>不得通过自动化手段大量请求本工具的 API 接口。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">五、账号管理</h2>
                <ul className="list-disc pl-6 space-y-1">
                  <li>您有责任妥善保管账号密码，因密码泄露导致的损失由您自行承担。</li>
                  <li>每个邮箱地址只能注册一个账号。</li>
                  <li>我们有权对违反本协议的账号采取限制或封禁措施。</li>
                  <li>长期未使用的账号，我们保留在提前通知后清理相关数据的权利。</li>
                  <li>
                    您应在确认导入前核对待写入记录，并对主动保留、跳过、编辑或删除的数据选择负责；本工具会通过校验、审计和并发控制降低误操作风险，但不保证第三方来源数据绝对准确。
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">六、知识产权</h2>
                <p>
                  本工具的软件代码、界面设计、图标等（不包含游戏内素材）的知识产权归本工具开发者所有。本工具的源代码基于开源协议发布，具体请参见项目仓库中的许可证文件。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">七、服务变更与终止</h2>
                <ul className="list-disc pl-6 space-y-1">
                  <li>我们保留随时修改、暂停或终止部分或全部服务的权利。</li>
                  <li>服务终止前，我们会提前通过站内公告通知用户，并提供数据导出的机会。</li>
                  <li>因不可抗力（如自然灾害、政策法规变更等）导致服务中断的，我们不承担责任。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">八、协议修改</h2>
                <p>
                  我们可能会不时修改本协议。修改后的协议将在本页面公布，重大变更时我们会通过站内公告通知您。继续使用本工具即表示您同意修改后的协议。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">九、适用法律与争议解决</h2>
                <p>
                  本协议的订立、执行和解释适用中华人民共和国法律。因本协议引起的争议，双方应友好协商解决；协商不成的，任何一方均可向本工具运营者所在地人民法院提起诉讼。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">十、联系方式</h2>
                <p>如果您对本协议有任何疑问，可通过以下方式联系我们：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>站内工单系统</li>
                  <li>GitHub Issues</li>
                </ul>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
