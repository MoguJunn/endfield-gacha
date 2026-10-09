# Endfield Gacha Analyzer

《明日方舟：终末地》抽卡记录分析工具，支持记录导入、个人分析、全服统计、抽卡模拟与备份导出，适配桌面和手机浏览器。

[![Version](https://img.shields.io/github/package-json/v/MoguJunn/endfield-gacha?filename=package.json)](https://github.com/MoguJunn/endfield-gacha/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![React](https://img.shields.io/badge/React-19-61DAFB.svg)
![Vite](https://img.shields.io/badge/Vite-7-646CFF.svg)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E.svg)

**在线使用：[ef-gacha.mogujun.icu](https://ef-gacha.mogujun.icu/)** · [问题反馈](https://github.com/MoguJunn/endfield-gacha/issues) · [贡献指南](CONTRIBUTING.md)

![首页预览](docs/screenshots/homepage.png)

截图展示页面布局，游戏版本与活动日期以网站和官方公告为准。

## 可以做什么

- **导入与管理记录**：导入官方记录，按账号、区服与卡池查看；处理异常提醒，精确编辑或删除记录，并导出备份。
- **查看个人分析**：了解抽数、出货、保底、资源与时间线，使用图鉴和分享卡回顾结果。
- **查看全服统计**：提供单池和五类合池观测，区分样本数、参与账号数和对象首次获得情况。指标含义见 [统计说明](docs/STATS_OBSERVATION_CONTRACT.md)。
- **规划与浏览日程**：使用抽卡模拟器，查看当前寻访、版本倒计时和官方版本导览；[独立日历](https://ef-cal.mogujun.icu/) 展示活动与卡池时间。

当前发布版本为 **v4.6.3**。新版桌面首页默认启用，也可以切换到经典主页。近期变化见 [发布记录](docs/RELEASE_4.6.3.md)，开发中的功能见 [项目进展](docs/RECENT_DELIVERY_STATUS.md)。

## 本地开发

需要 Node.js `>=22.17.0 <27`、npm `>=10`；仓库记录的包管理器版本是 `npm@11.2.0`。

```bash
git clone https://github.com/MoguJunn/endfield-gacha.git
cd endfield-gacha
npm ci
cp .env.contributor.example .env.local
npm run dev
```

默认模板启用本地内容沙盒，无需数据库密钥。卡池和角色目录从公共只读接口读取，离线时使用缓存或内置最小目录。

登录页可填入公开演示身份：`demo-admin@local.invalid` / `frontend-demo`。公告、卡池、角色等修改仅保存到当前浏览器，可以刷新保留或一键重置。真实登录、邮件、官方导入和生产写入在沙盒中关闭；该身份不能访问真实用户数据。

需要调试完整服务端功能时，请使用自己的隔离环境，参考 [开发与部署指南](docs/PROJECT_GUIDE.md)。

## 常用命令

```bash
npm test                 # 公共数据与基础功能验证
npm run test:unit        # 单元测试
npm run lint             # 代码检查
npm run build            # 主站和抽奖子应用构建
npm run perf:report      # 构建资源预算
```

## 进一步阅读

- [文档导航](docs/README.md)：按使用、贡献、架构和部署查找说明。
- [代码地图](docs/CODEMAP.md)与[架构](docs/ARCHITECTURE.md)：定位前端、API、缓存与后台计算入口。
- [仓库结构](docs/REPOSITORY_LAYOUT.md)：了解目录职责、配置和生成文件。
- [数据库指南](supabase/README.md)：新环境基线、前向迁移与手动 SQL 的使用范围。
- [安全报告](SECURITY.md)：报告漏洞及保护私有数据。

本仓库包含主站、API、数据库 schema、官方 BOT 与验证脚本。官方记录获取使用独立后端，`backend/` 只保留共享合同与测试所需代码，完整服务配置不在公开仓库中。

## 许可证

[MIT License](LICENSE)。本项目为粉丝自制工具，与游戏官方无关；游戏内容版权归 Gryphline / HyperGryph 所有。
