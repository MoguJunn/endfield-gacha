# 临时自托管主站

Vercel暂停时可以运行同一套网页和API。使用 `scripts/serve-standalone.mjs`，不将Vite开发服务器或preview作为公网生产入口。原路由处理函数继续负责鉴权、Origin检查和私有响应禁止缓存；HTTP适配层处理JSON／表单、原始请求体、Cookie数组、重定向及16MiB请求体上限。仅 `dist` 对外提供静态文件，不公开源码或环境文件。

## 构建和运行

在开发机完成正常生产构建及抽奖子页构建，再运行：

```sh
node scripts/build-standalone.mjs .agent-tmp/standalone-release
```

输出包含分块API、网页、分享字体和playwright-core，不包含环境文件。打包保留字面量动态导入，首次请求只加载对应API。脚本会复制已经生成的分享渲染模块；构建主站前应运行既有prebuild步骤。

自托管构建设置 `VITE_VERCEL_OBSERVABILITY=false`，关闭仅由Vercel提供的访问统计与测速脚本，避免脚本地址落到SPA页面并产生语法错误。该变量未设置时保留既有Vercel部署行为。

运行容器使用 `scripts/standalone.Dockerfile`。Node进程以普通用户运行，默认只监听 `127.0.0.1:3180`；通过现有OpenResty在HTTPS下反向代理。部署时设置只读根文件系统、只读发布目录、`/tmp`临时卷、CPU和内存限制、日志轮转及重启策略。分享图按 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用系统Chromium。没有配置该变量时，Vercel和本地原有选择逻辑保留。

生产配置放在服务器 `/etc/endfield/web.env`，权限0600，通过Docker的env-file注入，不复制到构建目录。复用现有数据库与会话签名密钥；本地开发OAuth回调不能直接用在公网。浏览器可见的Supabase地址和验证码站点键来自正式配置；服务端可以通过本机数据库网关连接。不要使用临时计算回退，保持 `PERSONAL_ANALYSIS_TRANSIENT_FALLBACK=false`。

静态资源由OpenResty直接读取发布目录，`/api/`转发本机Node。禁止统一缓存API；公共API使用其原有缓存合同，个人和认证API保持no-store。反向代理必须覆盖用户提交的转发地址与协议头；外层CDN使用HTTPS回源时可直接沿用接入协议。官方导入仍由现有CN／INTL后端执行，可将同源代理路径转发到现有CN入口，由它按区服转发。

## 切换与验证

先在新容器上检查 `/healthz`、公共启动数据、版本清单、未登录拒绝、真实测试账号登录、当前owner个人分析、移动／桌面页面与官方导入代理健康。验证码必须允许备用域名，第三方登录的回调也必须由provider允许；原域名保持不变时仍需核对现有生产回调配置。

切换前备份DNS或CDN回源记录和OpenResty配置。先通过指定IP和Host的请求验证证书及虚拟站点，再将正式或备用域名解析到新入口。保留原回源值，恢复Vercel后可原样切回；服务恢复后需确认Vercel最新优化提交真正完成部署。

网页容器不运行cron，不重复启动数据库分析Worker。原Vercel定时任务如需在暂停期间接管，应逐项核对现有外部Worker后再安装独立定时器。证书需续期，临时签发不能当作永久自动续签已经配置。

验证：`node node_modules/vitest/vitest.mjs run api/__tests__/standaloneServer.test.js`。测试覆盖请求体、Cookie／重定向、页面回退、静态文件边界与异常信息隐藏；线上还需按上面步骤做真实读写边界验证。
