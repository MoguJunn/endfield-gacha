import React from 'react';
import { Heart, Code, ExternalLink } from 'lucide-react';
import useSiteConfigStore from '../../stores/useSiteConfigStore';
import { APP_VERSION_LABEL } from '../../constants/appMeta';
import { useI18n } from '../../i18n/index.js';
import { resolveSiteLegalConfig } from '../../utils/siteLegalConfig.js';

/**
 * 全局页脚组件
 * 显示版权信息、制作者、项目链接、备案号和政策链接
 * 所有站点配置从 useSiteConfigStore 读取（管理面板可编辑）
 */
const Footer = React.memo(() => {
  const currentYear = new Date().getFullYear();
  const config = useSiteConfigStore(state => state.config);
  const { t } = useI18n();

  const siteVersion = config.site_version || APP_VERSION_LABEL;
  const authorName = config.author_name || '';
  const authorBilibili = config.author_bilibili || '';
  const githubUrl = config.github_url || '';
  const { icpNumber, icpUrl, policeNumber, policeUrl } = resolveSiteLegalConfig(config);

  return (
    <footer className="mt-8 py-6 border-t border-zinc-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-950">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-zinc-500">
          {/* 版权信息 */}
          <div className="flex items-center justify-center md:justify-start gap-1 flex-wrap text-center md:text-left">
            <span>{t('app.brand')} {siteVersion}</span>
            <span className="mx-2">|</span>
            <span>&copy; {currentYear}</span>
          </div>

          {/* 制作者信息 */}
          <div className="flex items-center gap-4 flex-wrap justify-center">
            {authorName && (
              <a
                href={authorBilibili || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-pink-500 transition-colors"
              >
                <Heart size={12} className="text-pink-500" />
                <span>{authorName}</span>
              </a>
            )}
            {githubUrl && (
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-zinc-300 transition-colors"
              >
                <Code size={12} />
                <span>GitHub</span>
                <ExternalLink size={10} />
              </a>
            )}
          </div>

          {/* 免责声明 + 政策链接 */}
          <div className="text-center md:text-right text-[10px] text-slate-400 dark:text-zinc-600">
            <div>{t('footer.disclaimer')}</div>
            <div className="mt-1 flex items-center justify-center md:justify-end gap-2 flex-wrap">
              <a href="/privacy" className="hover:text-slate-600 dark:hover:text-zinc-400 transition-colors underline">{t('about.privacyPolicy')}</a>
              <span>|</span>
              <a href="/terms" className="hover:text-slate-600 dark:hover:text-zinc-400 transition-colors underline">{t('about.terms')}</a>
              {icpNumber && (
                <>
                  <span>|</span>
                  <a
                    href={icpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-slate-600 dark:hover:text-zinc-400 transition-colors"
                  >
                    {icpNumber}
                  </a>
                </>
              )}
              {policeNumber && (
                <>
                  <span>|</span>
                  <a
                    href={policeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-slate-600 dark:hover:text-zinc-400 transition-colors"
                  >
                    {policeNumber}
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
});

Footer.displayName = 'Footer';

export default Footer;
