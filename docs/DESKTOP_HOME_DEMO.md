# 桌面首页、导航与主页切换

新版桌面自 v4.6.0 起默认启用，经典主页仍可切换；v4.6.2 将响应式宽度扩展到各桌面页。本文定义布局和交互要求，适合修改页面的贡献者阅读。

## 主页偏好

首次访问使用新版。新版和经典主页都提供切换入口，偏好存入 `gacha_home_experience_v1`；旧 `/?home-demo=unified` 链接始终选择新版。切换回到 `/`，清理旧预览参数并保留其他查询参数。

主页偏好只选择界面，不创建演示身份或改变权限。本地演示数据由 [贡献者沙盒](PROJECT_GUIDE.md#贡献者内容沙盒) 提供。

## 布局与响应式

- 基准为 1366×768、100% 浏览器缩放。顶栏、正文和底栏共用宽度与水平留白，常规上限 `1366px`。
- 宽度至少 1920px 时共用 `clamp(1366px, 78vw, 1920px)`；至少 3000px 时为 `min(74vw, 2560px)`。经典入口和长内容页使用相同壳层。
- 首页用 `100dvh`，限制卡片区而非整个首页。常规卡片区 `480px`；宽至少 1600px 且高至少 900px 时为 `500px`，其余高度留给引导区，底部保留 `12px` 间距。
- 宽至少 1920px 且高至少 1000px 时，卡片区使用 `clamp(540px, 54dvh, 1280px)`；活动卡额外放大要求高至少 1200px，避免矮窗口裁切。
- `ResizeObserver` 以首页容器尺寸判断：高低于 `626px` 或宽低于 `1180px` 时，切为“寻访与活动／轮换与版本”分区。
- `home-guidance` 容器达到 `160px` 展开双栏和快捷入口，达到 `230px` 增加说明。调整阈值同时检查紧凑与展开状态。

首页第一行是当前寻访与社区活动，第二行是轮换和版本。当前寻访每页至多两组，保留翻页；指南、机制、友链和完整日程在弹窗中展开。长统计、设置与管理页允许滚动，首页的一屏目标不扩展到所有页面。

字体与颜色沿用现有 Harmony、Novecento 和主题变量；寻访使用对象头像，倒计时保持数字字体。窄窗、中英文、亮暗与减少动态效果均须可读。

## 导航与数据来源

- `/dashboard`：个人卡池分析。
- `/dashboard?view=overview`：在 `PersonalDataBoundary` 中以 `SummaryView lockedDataSource="local"` 显示个人概览。
- `/summary`：`lockedDataSource="global"`，全服统计不受个人数据加载失败阻塞。
- 图鉴遵循同一来源锁定，避免无关统计请求阻塞当前页面。

个人二级菜单持久保存收起状态；视口宽至少 `1760px` 时位于正文左侧，展开 `176px`、收起 `44px`，更窄桌面放在正文上方。菜单不得挤压正文或制造横向溢出。

顶栏提供工单未读数（最大 `99+`）、主题、账号和管理入口。用户名后缀由现有展示 helper 生成，管理权限继续由真实账号判断。弹窗链接具备标记和 ARIA 语义。

## 消息与动效

`DesktopMessageCenter` 统一网站通知、网站公告、游戏内公告和官网公告，保留已读、移除、清空、复制脱敏诊断、继续动作以及账号异常自动打开行为。

`DesktopHomeDialog` 使用原生 `dialog` 与 portal，支持 Escape、焦点限制和关闭后恢复。消息展示不改变数据权限和业务动作。

`DesktopPageMotion` 按 pathname 和个人 `view` 管理入场与滚动重置，无关查询变化不重挂载页面。减少动态效果时关闭装饰动画与平滑滚动。

## 版本组件

版本开启倒计时只接收 `target / name / onSchedule / onAnnouncements / className`，自行维护秒级时钟。`data-version-state` 区分 `pending / upcoming / released`；主题由 `--vc-surface / --vc-text / --vc-muted / --vc-accent / --vc-line / --vc-edge / --vc-tint` 控制，宿主提供经校验的日期和名称。

官方前瞻和版本导览在社区活动区独立维护。前瞻结束后显示 `VersionBriefingCard`，下一次前瞻配置生效时恢复倒计时；导览固定指向官网 `version_briefing/latest?source_from=official`。封面按中文版本名匹配官网公告，直连官方 CDN，失败时保留可用链接，奖励条件以官方说明为准。

## 代码与验证

主页选择在 `src/utils/homeExperience.js`，接线在 `GachaAnalyzer.jsx`／`DesktopAppRoutes.jsx`。首页与顶栏位于 `src/components/home/`，个人导航、动效与共用宽度在 `src/components/app/`，详细索引见 [CODEMAP](CODEMAP.md)。

修改后验证 1366×768 基线、大屏、矮窗口和分区临界尺寸，并检查主题、语言、主页偏好刷新、工单未读、数据来源隔离、键盘和焦点。版本组件还需覆盖未知日期、图片失败和前瞻切换。

首次指南仍是 [开发设计](ONBOARDING_GUIDE_PLAN.md)，不把预览按钮当作真实完成状态。历史发布见 [v4.6.0](RELEASE_4.6.0.md)。
