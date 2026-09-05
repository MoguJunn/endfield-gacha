# 桌面首页与导航 Demo

Last reviewed: 2026-09-05

## 状态与预览入口

本轮桌面 Demo 已完成本地实现并获用户验收，纳入 `v4.6.0` 发布范围。原主题分支 `feat/v4.5-desktop-home-demo` 保留阶段提交；进入 `release/v4.6.0` 时将首页与分析两个业务提交整理为一个前端主题提交，测试、文档及版本收口分别保留。正式站默认入口尚未切换，其他并行代码与此前文档候选不进入本次发布。交付与验证见 [RELEASE_4.6.0.md](RELEASE_4.6.0.md)。

本轮前端改动由 [Neptune-520](https://github.com/Neptune-520) 共同贡献，整合后的前端提交包含其 `Co-authored-by` 署名。

启动 Vite 开发服务器后，在其实际地址打开 `/?home-demo=unified`。该入口同时要求 `import.meta.env.DEV` 和 `home-demo=unified`；生产构建不能通过查询参数开启预览。“退出预览”回到 `/`。预览专用页面通过 DEV 条件懒加载，共享组件仍保留原入口所需的默认行为。

这是界面预览开关，不是认证或数据隔离开关。需要隔离的本地演示数据时，按 [PROJECT_GUIDE.md](PROJECT_GUIDE.md#本地开发) 启用贡献者内容沙盒；单独添加查询参数不会创建演示身份或改变现有权限。

本轮范围为桌面首页、导航、页面壳层和个人 / 全服统计入口。移动端现有入口与行为继续保留，移动首页预览不是本轮新增布局的验收对象。

## 已验收的界面合同

### 首页布局与尺寸

- 基准为 **1366×768、浏览器 100% 缩放**。顶栏、主内容和底栏使用同一套最大宽度 `1366px` 与水平留白；这里的“768P”表示视口基准，不是把内容宽度设成 `768px`。
- 维持黑白 / zinc / slate、终末地黄、工业细节和现有 Harmony 字体链。普通小标签使用现有正文字体，倒计时数字保留 Novecento；当前寻访采用大头像，不使用角色背景立绘。
- 上方引导区随可用高度扩展：低高度保留紧凑标题与操作，高度充足时采用左侧品牌 / 标题 / 说明、右侧主入口与两行快捷入口。指南、模拟器、机制、友链以及退出预览保持可用。
- 第一行左侧为当前寻访、右侧为原生社区抽奖；第二行为全宽轮换与版本区域，内部保留原生 `RotationScheduleCard` 和独立版本倒计时。当前寻访每页至多两组，支持翻页。
- 公告、网站通知、安全 / 社区和赞助等次要入口保持紧凑；完整日程、指南、机制、友链和活动详情通过相应弹窗展开。
- 首页使用 `100dvh` 壳层，**只限定卡片区高度，不限制整个首页最大高度**。卡片区常规为 `480px`，宽至少 `1600px` 且高至少 `900px` 时为 `500px`；剩余空间分配给引导区，底部保留正常的 `12px` 间距。
- `ResizeObserver` 观测首页容器：高度低于 `626px` 或宽度低于 `1180px` 时，使用“寻访与活动 / 轮换与版本”分区页签。阈值对应容器尺寸，不直接等同于浏览器视口尺寸；卡片内容仍可从分区进入。
- 引导区使用命名尺寸容器 `home-guidance`：达到 `160px` 时展开双栏与两行快捷入口，达到 `230px` 时增加说明和操作提示。后续调尺寸时应同时验证这两个状态与 768P 基线。

### 顶栏与身份

- “工单”是独立按钮，保留未读数、`99+` 上限、访问时间与进入后清除本地提示的行为。
- 主题菜单包含“跟随系统 / 浅色 / 深色”，复用现有主题状态与系统主题监听。
- 账号区域显示现有 `用户名#四位后缀` 及 `SUPER-ENDMIN / ENDMIN / GUEST` 身份。后缀仍由既有展示 helper 生成，没有新增数据库字段。
- 工具 / 帮助中打开弹窗的二级入口显示“弹窗”标记和相应 ARIA 语义；普通页面链接保留导航行为。
- `super_admin` 恢复独立管理入口；路由权限沿用现有判断。贡献者沙盒的管理页面仍是本地内容沙盒。

### 个人分析、全服统计与页面壳层

- `/dashboard?home-demo=unified`：个人卡池分析，继续使用原 `DesktopDashboardWorkspace`。
- `/dashboard?home-demo=unified&view=overview`：个人概览，通过 `SummaryView lockedDataSource="local"` 展示个人统计、资源与图鉴；登录及 `PersonalDataBoundary` 继续保护个人数据状态。
- `/summary?home-demo=unified`：全服统计，使用 `lockedDataSource="global"`，不再套用个人数据加载边界；个人数据失败不应阻塞公共统计。
- 两处概览隐藏相互切换数据源的旧控件，图鉴也遵循锁定来源。个人概览不会因无关的全服统计加载状态而停留在加载页；本轮没有改写统计公式、快照 schema 或跨账号汇总合同。
- “个人概览 / 卡池分析”二级导航可收起，并用现有存储工具持久化至 `gacha_desktop_personal_sidebar_collapsed`。视口宽至少 `1760px` 时，菜单位于主内容左侧外部，展开 `176px`、收起 `44px`，不挤占正文宽度；更窄桌面使用内容上方菜单。
- `DesktopPageMotion` 为预览桌面路由提供淡入 / 轻微上移动效，按 pathname 和个人 `view` 切换重置滚动；统计内部切页使用独立轻量动效。无关查询参数变化不触发整页重挂载，减少动态效果开启时停用装饰动画和平滑滚动。
- 统一宽度适用于预览桌面壳层；“无需纵向下滑”的验收仅针对首页，长统计、设置或管理页面仍可正常滚动。

### 统一公告与通知

`DesktopMessageCenter` 承接首页公告入口和右下角通知入口，以同一弹窗展示“网站通知 / 网站公告 / 游戏内公告 / 官网公告”四类内容。沿用已有通知数据与回调，保留已读、逐条移除、清空、复制脱敏诊断、继续动作和账号错误 / 警告自动打开行为。

`DesktopHomeDialog` 使用原生 `dialog` 与 portal，处理 Escape、焦点限制、关闭后焦点恢复及减少动态效果。消息合并只改变桌面展示，不改变公告来源权限、通知隐私边界或实际业务动作。

## 维护入口

- `src/GachaAnalyzer.jsx`、`src/components/app/DesktopAppRoutes.jsx`：预览开关、桌面壳层、路由与通知接线。
- `src/components/home/HomeLandingHeader.jsx`、`homeLandingDemo.css`：共享预览顶栏；本轮新增样式与交互按桌面分支限定。
- `src/components/home/DesktopHomeDemo.jsx`、`desktopHomeDemo.css`、`desktopHomeData.js`：首页布局、分区、卡池与版本配置适配。
- `src/components/home/VersionCountdownCard.jsx`、`versionCountdownCard.css`：独立版本倒计时。
- `src/components/home/DesktopMessageCenter.jsx`、`desktopMessageModel.js`、`DesktopHomeDialog.jsx`：消息分类、统一公告 / 通知弹窗与通用弹窗行为。
- `src/components/app/DesktopPersonalWorkspace.jsx`、`DesktopPageMotion.jsx`、`desktopPageLayout.css`：个人二级导航、宽度与页面动效。
- `src/components/SummaryView.jsx`、`src/hooks/summary/useSummaryViewState.js`、`src/components/summary/CharacterCatalogView.jsx`：锁定个人 / 全服数据源与图鉴入口。

版本组件只接收 `target / name / onSchedule / onAnnouncements / className`，不依赖特定版本立绘、页面 Store 或固定宣传素材。它自行维护秒级时钟，并通过 `data-version-state` 区分 `pending / upcoming / released`（待公布 / 即将开启 / 已上线）。主题通过 `--vc-surface / --vc-text / --vc-muted / --vc-accent / --vc-line / --vc-edge / --vc-tint` 覆盖；宿主负责选择经过校验的日期与版本名称，不应把历史默认日期显示成当前真实版本日程。

## 验证记录与后续边界

- 浏览器已覆盖中英文、亮暗主题、系统主题、游客与贡献者演示身份、长用户名、管理入口、工单未读、个人 / 全服数据源隔离、侧栏展开 / 收起及持久化、键盘 / 弹窗焦点和减少动态效果。
- 最新引导区调整已覆盖 `1366×768`、`1440×960`、`1920×1080`、`1366×850`、`1280×800`、`1100×650`、`1100×900`，包括窄窗两个分区、多卡池、英文活动文案以及紧凑布局高度临界点；无页面溢出，底部间距符合布局合同。
- 统计拆分阶段的 `useSummaryViewState`、`ResourceSummaryPanel`、`PersonalDataBoundary` 共 11 项测试，以及后续样式定向检查通过。2026-09-05 本地提交前重新运行仓库 `npm run lint` 和主站 `vite build`，均通过。
- 同次全量单测为 258 个文件通过、1 个文件失败，共 1383 项通过、1 项失败；失败在 `api/__tests__/siteOverview.test.js`，由本轮未纳入提交的 `homeVersionTimeline.js` 英文名变更与旧断言不一致引起。本轮消息中心 4 项测试通过。该全量结果来自含并行修改的工作树，不代表所有修改或隔离提交树的全量测试已通过。
- 提交前核对了暂存范围、补丁格式和文档引用；没有新增生产、数据库或远端检查，也没有构建独立抽奖子应用。

## 新增待办

`ONBOARDING-GUIDE-001`：优化首次使用教程与首页指南，当前只登记、待开始。要求与验收见 [ONBOARDING_GUIDE_PLAN.md](ONBOARDING_GUIDE_PLAN.md)；复用 `UX-011` 的真实完成条件及现有桌面入口，支持跳过、重看与失败恢复。

全站设计 token、移动壳层、完整动画生命周期、通知采纳、可访问性、统计口径说明和运营位配置化仍由各自任务推进。本 Demo 不代表这些任务整体完成，也不改变抽奖运营状态。若后续决定正式接入，应先确定默认入口和预览代码归属，再以最终变更完成 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 中相关检查，并更新正式截图；当前保留现有生产首页截图。
