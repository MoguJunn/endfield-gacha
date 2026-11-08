import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function replaceRequired(source, target, replacement) {
  if (!source.includes(target)) throw new Error(`regulation_theme_target_missing: ${target.slice(0, 90)}`);
  return source.replace(target, replacement);
}

export async function applyRegulationTheme(rootDir, lotteryRoot) {
  await copyFile(resolve(rootDir, 'src/lottery/RegulationHero.jsx'), resolve(lotteryRoot, 'src/components/RegulationHero.jsx'));
  await copyFile(resolve(rootDir, 'src/lottery/regulation.css'), resolve(lotteryRoot, 'src/regulation.css'));
  await copyFile(resolve(rootDir, 'src/assets/fonts/source-han/SourceHanSansCN-VF.ttf.woff2'), resolve(lotteryRoot, 'public/local-activity/fonts/SourceHanSansCN-VF.ttf.woff2'));
  await copyFile(resolve(rootDir, 'src/assets/fonts/source-han/LICENSE.txt'), resolve(lotteryRoot, 'public/local-activity/fonts/SourceHanSans-LICENSE.txt'));
  await copyFile(resolve(rootDir, 'shared/regulationLottery.js'), resolve(lotteryRoot, 'src/config/regulationLottery.js'));
  const appPath = resolve(lotteryRoot, 'src/App.jsx');
  let source = await readFile(appPath, 'utf8');
  source = source.replace("import './regulation.css';\n", '');
  if (!source.includes("import { RegulationHero, RegulationPrize }")) {
    source = `import { RegulationHero, RegulationPrize } from './components/RegulationHero.jsx';
import { REGULATION_CAMPAIGN_ID } from './config/regulationLottery.js';
${source}`;
    source = replaceRequired(source, '  const site = snapshot?.site || DEFAULT_SITE_CONFIG;', `  const site = snapshot?.site || DEFAULT_SITE_CONFIG;
  const isRegulation = !isArchive && snapshot?.campaign?.id === REGULATION_CAMPAIGN_ID;
  useEffect(() => {
    document.documentElement.dataset.lotteryEvent = isRegulation ? 'regulation' : '';
    document.title = site.hero.title;
    return () => { delete document.documentElement.dataset.lotteryEvent; };
  }, [isRegulation, site.hero.title]);`);
    source = replaceRequired(source,
      "<div className={`site-shell ${isArchive ? 'site-shell--archive' : ''}`}>",
      "<div className={`site-shell ${isArchive ? 'site-shell--archive' : ''} ${isRegulation ? 'site-shell--regulation' : ''}`}>");
    const heroStart = source.indexOf('          <div className="hero-copy">');
    const heroEnd = source.indexOf('          <section className="status-card">', heroStart);
    if (heroStart < 0 || heroEnd < 0) throw new Error('regulation_hero_slot_missing');
    source = `${source.slice(0, heroStart)}          {isRegulation
            ? <RegulationHero site={site} campaign={campaign} participantLabel={participantLabel} />
            : <>${source.slice(heroStart, heroEnd)}</>}

${source.slice(heroEnd)}`;
    source = replaceRequired(source,
      '          <div className="theme-selector" role="group" aria-label="页面主题">',
      '          {!isRegulation && <div className="theme-selector" role="group" aria-label="页面主题">');
    source = replaceRequired(source, '          </div>\n        </div>\n      </header>', '          </div>}\n        </div>\n      </header>');
    source = replaceRequired(source,
      "{activeTab.value === 'prizes' && <PrizePane prizes={site.prizes} prizePlan={snapshot?.campaign?.prizePlan} />}",
      `{activeTab.value === 'prizes' && (snapshot?.campaign?.id === REGULATION_CAMPAIGN_ID
          ? <RegulationPrize prize={site.prizes[0]} count={snapshot?.campaign?.prizePlan?.first ?? 0} />
          : <PrizePane prizes={site.prizes} prizePlan={snapshot?.campaign?.prizePlan} />)}`);
    source = replaceRequired(source,
      '活动开始前已经锁定，开奖后会公开原始信息供大家核对。',
      "{campaign?.seedCommitment ? '活动开始前已经锁定，开奖后会公开原始信息供大家核对。' : '活动开放前将固定核对码，准备完成后在此公布。'}");
  }
  // The historical revision notice belongs only to campaigns with invalidated results.
  source = source.replace(
    '<strong>活动已重新开放</strong><small>第一次开奖因奖品配置修正而作废；最终结果将在新截止时间后按新承诺与公共随机数完整重抽。</small>',
    "<strong>{invalidatedWinners.length ? '活动已重新开放' : '静候开奖'}</strong><small>{invalidatedWinners.length ? '第一次开奖因奖品配置修正而作废；最终结果将在新截止时间后按新承诺与公共随机数完整重抽。' : '截止后由活动方执行开奖，中奖结果及公开核对信息将在这里公布。'}</small>");
  await writeFile(appPath, source, 'utf8');
  const mainPath = resolve(lotteryRoot, 'src/main.jsx');
  let main = await readFile(mainPath, 'utf8');
  if (!main.includes("import './regulation.css'")) {
    main = replaceRequired(main, "import './styles.css';", "import './styles.css';\nimport './regulation.css';");
    await writeFile(mainPath, main, 'utf8');
  }
}
