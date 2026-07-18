import React, { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ACCOUNT_RECOVERY_QQ_GROUP } from '../../constants/community';
import { useI18n } from '../../i18n/index.js';
import PrivacyPolicyEnglishContent from './PrivacyPolicyEnglishContent';

/**
 * 隐私政策页面
 */
export default function PrivacyPolicy() {
  const { isEnglish, t } = useI18n();

  useEffect(() => {
    document.title = isEnglish ? 'Privacy Policy | Endfield Gacha Analyzer' : '隐私政策 | 终末地抽卡分析器';

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
            <h1 className="text-2xl font-bold mb-2">Privacy Policy</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-500 mb-8">Last updated: July 19, 2026</p>
            <PrivacyPolicyEnglishContent />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2">隐私政策</h1>
            <p className="text-sm text-slate-500 dark:text-zinc-500 mb-8">最后更新日期：2026年7月19日</p>
            <div className="space-y-6 text-sm leading-relaxed">
              <section>
                <h2 className="text-lg font-semibold mb-2">一、引言</h2>
                <p>
                  终末地抽卡分析器（以下简称"本工具"）是一款非官方的第三方抽卡数据分析工具，与游戏官方无关。我们重视您的隐私保护，本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">二、信息收集</h2>
                <p>为提供数据分析服务，我们可能收集以下信息：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>
                    <strong>账号信息</strong>：注册时提供的电子邮箱地址和用户名。
                  </li>
                  <li>
                    <strong>游戏数据</strong>：通过您主动导入的游戏内抽卡记录数据，包括抽卡时间、角色名称、稀有度等。
                  </li>
                  <li>
                    <strong>导入审阅与变更记录</strong>
                    ：导入期间短期保存的暂存记录、问题标记和选择结果，以及您编辑、删除或确认异常记录时产生的最小化审计信息。
                  </li>
                  <li>
                    <strong>设备信息</strong>：浏览器类型、操作系统等基本设备信息，用于优化用户体验。
                  </li>
                  <li>
                    <strong>使用数据</strong>：页面访问记录、功能使用情况等匿名统计数据。
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">三、信息使用</h2>
                <p>我们收集的信息仅用于以下目的：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>提供抽卡数据分析和统计服务。</li>
                  <li>实现跨设备数据同步功能。</li>
                  <li>在正式写入前提供导入审阅、异常核对、受控编辑和删除，并维护数据一致性与安全审计。</li>
                  <li>生成匿名化的全服统计数据（如平均出货抽数排行）。</li>
                  <li>处理账号恢复申请、人工核验与临时密码发放等账号安全事务。</li>
                  <li>改进和优化本工具的功能和性能。</li>
                  <li>发送与服务相关的通知（如系统维护通知）。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">四、信息存储与安全</h2>
                <ul className="list-disc pl-6 space-y-1">
                  <li>您的数据存储在经过安全认证的云服务平台（Supabase）上。</li>
                  <li>我们采用行级安全策略（RLS）确保用户只能访问自己的数据。</li>
                  <li>密码经过加密处理存储，我们无法查看您的明文密码。</li>
                  <li>数据传输全程使用 HTTPS 加密协议。</li>
                  <li>
                    导入审阅任务设有过期时间；服务端只保存审阅访问凭证的哈希，不保存原始官方登录
                    token。必要的历史变更审计按安全与数据完整性要求最小化保留。
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">五、信息共享</h2>
                <p>我们不会向任何第三方出售、交易或转让您的个人信息。以下情况除外：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>经过匿名化处理的统计数据（如全服平均出货）。</li>
                  <li>法律法规要求或政府部门依法要求提供的情况。</li>
                </ul>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">六、Cookie 与本地存储</h2>
                <p>
                  本工具会使用浏览器本地存储（localStorage）保存必要的界面状态和缓存快照，并使用会话存储（sessionStorage）在当前浏览器会话中恢复尚未完成的官方导入审阅。这些数据仅保留在您的设备上，用于改善加载速度和跨页面体验，不会因为写入浏览器存储而自动上传到服务器。
                </p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>
                    <strong>界面偏好</strong>：主题模式、当前查看的卡池、当前游戏账号、桌面端 /
                    移动端偏好、验证码模式与分享主题。
                  </li>
                  <li>
                    <strong>模拟器本地状态</strong>：按用户与游戏账号隔离的模拟器保底、资源设置、情报书和演出开关。
                  </li>
                  <li>
                    <strong>只读缓存快照</strong>：站点配置、公开
                    bootstrap、角色缓存和部分全服统计快照，用于离线回退与减少重复请求。
                  </li>
                  <li>
                    <strong>导入审阅会话</strong>
                    ：短期任务标识、访问凭证和来源信息，用于刷新页面后恢复当前审阅；任务完成、拒绝、过期或退出会话后会被清理。
                  </li>
                </ul>
                <p className="mt-2">
                  抽卡记录、云同步后的卡池数据和账号资料并不会因为写入 localStorage
                  而替代服务器存储；登录用户的主数据仍以 Supabase 中的受限数据为准。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">七、人机验证与安全风控</h2>
                <p>
                  为降低自动化注册、密码重置滥用、账号恢复滥用和邮件发送防刷风险，本工具可能在注册、密码重置、账号恢复等安全敏感流程中使用
                  Cloudflare Turnstile 或等价的人机验证 / 工作量证明机制。Turnstile
                  可能处理与验证请求有关的技术信息，例如浏览器环境、设备与网络信号、验证结果、访问时间、IP
                  地址和必要的安全 Cookie，用于判断请求是否来自真实用户并防止滥用。
                </p>
                <p className="mt-2">
                  当启用 Cloudflare Turnstile 时，该服务由 Cloudflare 提供并受 Cloudflare 的相关条款约束。您可以阅读{' '}
                  <a
                    href="https://www.cloudflare.com/cloudflare-customer-dpa/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-endfield-yellow hover:underline"
                  >
                    Cloudflare 数据处理附录
                  </a>
                  、
                  <a
                    href="https://www.cloudflare.com/privacypolicy/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-endfield-yellow hover:underline"
                  >
                    Cloudflare 隐私政策
                  </a>
                  以及{' '}
                  <a
                    href="https://www.cloudflare.com/website-terms/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-endfield-yellow hover:underline"
                  >
                    Cloudflare 网站条款
                  </a>
                  了解其数据处理规则。我们不会在自己的数据库中保存原始 Turnstile token 或 Cloudflare
                  secret，仅保存脱敏后的风险摘要、验证状态和必要的安全审计记录。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">八、用户权利</h2>
                <p>您拥有以下权利：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>
                    <strong>访问权</strong>：查看您存储在本工具中的所有个人数据。
                  </li>
                  <li>
                    <strong>更正权</strong>：修改您的账号信息。
                  </li>
                  <li>
                    <strong>删除权</strong>：普通用户可在设置页自助注销自己的账号；若无法登录，也可提交账号恢复 /
                    注销申请，由超管人工核验处理。
                  </li>
                  <li>
                    <strong>导出权</strong>：导出您的抽卡记录数据。JSON / CSV
                    导出用于备份和再导入，可能包含卡池、时间、游戏账号等结构化记录字段。
                  </li>
                  <li>
                    <strong>分享控制权</strong>
                    ：站内分享卡和分享文本采用脱敏口径，默认不包含账号、UID、精确时间戳与原始抽卡明细。
                  </li>
                </ul>
                <p className="mt-2">
                  如需行使上述权利，请优先使用站内设置页、导出功能或工单系统；账号恢复与临时密码领取当前通过 QQ 群{' '}
                  <strong>{ACCOUNT_RECOVERY_QQ_GROUP}</strong> 配合超管人工处理。
                </p>
                <p className="mt-2">
                  普通用户自助注销成功后，当前账号、抽卡记录、自建卡池、未完成导入任务、异常标记、历史变更审计、工单与工单回复会按数据库关联规则一起删除；后续重新计算的全服统计不再继续包含这些抽卡记录。已经导出的文件、已分享到站外的图片
                  / 文本，以及基于安全、反滥用或法定义务最小必要保留的账号恢复处理记录，不属于站内可回收范围。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">九、未成年人保护</h2>
                <p>
                  本工具不针对未满14周岁的未成年人提供服务。如果您是未满14周岁的未成年人，请在监护人的陪同下使用本工具。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">十、隐私政策更新</h2>
                <p>
                  我们可能会不时更新本隐私政策。更新后的政策将在本页面公布，重大变更时我们会通过站内公告通知您。继续使用本工具即表示您同意更新后的隐私政策。
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold mb-2">十一、联系我们</h2>
                <p>如果您对本隐私政策有任何疑问或建议，可通过以下方式联系我们：</p>
                <ul className="list-disc pl-6 mt-2 space-y-1">
                  <li>站内工单系统</li>
                  <li>QQ 群：{ACCOUNT_RECOVERY_QQ_GROUP}（账号恢复、临时密码与使用问题）</li>
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
