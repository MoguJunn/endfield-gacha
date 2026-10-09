# Supabase 后台刷新锁竞争处理

已由 `864acd17` 随 PR #43 合入并发布于 v4.6.3；主线和自动部署检查已通过。下述双标签页结果是实现阶段验证，后续升级 SDK 时按同一合同复核。当前交付见 [近期状态](RECENT_DELIVERY_STATUS.md)。

## 现象与范围

`NavigatorLockAcquireTimeoutError: Acquiring an exclusive Navigator LockManager lock "lock:sb-…-auth-token" immediately failed` 可以在多标签页共享登录会话时出现。

当前锁定的 `@supabase/auth-js@2.106.2` 使用 `acquireTimeout=0` 尝试获取后台刷新锁。另一个标签页正在操作会话时，Web Locks 返回空锁，SDK 抛出此异常，再由后台刷新逻辑捕获并跳过本轮。Edge 和 Firefox 双标签页实验均确认 SDK 正常捕获，未复现登录中断或未处理 rejection；因此不能仅凭该报错断言登录失败。

应用只有一个共享客户端，未发现手动重复启动自动刷新的调用。本次调整消除预期竞争产生的异常，保留刷新和跨标签页互斥。

## 实现

`src/supabaseClient.js` 通过 `getBrowserAuthLock()` 配置浏览器认证锁。

- 仅后台刷新使用的零等待请求走原生 `navigator.locks.request()`，使用原锁名、exclusive 和 ifAvailable。
- 拿到锁才执行回调。空锁时直接返回，下一轮由 SDK 自动刷新调度重试。
- 正等待和无限等待继续调用官方 `navigatorLock()`；正常认证操作的等待、超时与异常处理保持 SDK 行为。
- 操作回调的真实异常继续传播，不安装全局错误过滤器。
- 不支持 Web Locks 时返回 undefined，使用 SDK 自身的平台默认行为。

零等待返回 undefined 是针对此 SDK 后台 tick 不使用返回值的适配，不是通用锁接口。升级 auth-js 时，应重新核对 `_acquireLock(0)` 的调用位置与返回值合同。

## 验证

在仓库根目录执行：

```sh
npx playwright install firefox
# Linux/macOS 还需安装 Chromium；Windows 默认使用已安装的 Edge。
npm run test:supabase-auth-lock:ui
npm run test:unit -- src/hooks/app/__tests__/useAppInitialization.test.jsx
npm run lint
npm run build
```

浏览器脚本将两个页面置于同一隔离浏览器上下文，用真实原生锁制造竞争，使用真实安装的 Supabase SDK 和本地模拟 token 响应。验证锁忙时不执行回调或刷新请求、锁释放后下一轮恰好刷新一次、普通操作排队等待、真实异常传播、退出登录后不再刷新、不支持锁的回退及没有页面未处理错误。

没有使用生产账号、Cookie 或认证写入。浏览器测试显式调用 SDK 的实际后台 tick，避免等待默认刷新间隔；升级 SDK 时也需核对该私有测试入口。
