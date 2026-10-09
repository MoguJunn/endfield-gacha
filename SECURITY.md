# Security Policy

## 受支持的范围

当前公开仓库只支持公开主链、公开 API、前端路由、数据库迁移和文档相关问题。

贡献者模板中的 `demo-admin@local.invalid` / `frontend-demo` 是公开的 synthetic 本地身份，不是生产凭据。它只在 Vite DEV 的显式沙盒模式下解锁管理 UI，不对应 Supabase 用户、Bearer token 或 HttpOnly Session，内容修改只写入当前浏览器的版本化 `localStorage`。如果该身份能够访问真实认证、私有 API 或生产写入口，应按安全漏洞报告。

## 不要公开提交的内容

- access token、refresh token、session、API key、`OAUTH_STATE_SECRET`、`APP_SESSION_SECRET`
- `AUTH_IDENTITY_HASH_KEY_CURRENT/PREVIOUS`、OAuth Client Secret 或可复用的 provider identity 映射材料
- Supabase `service_role` / `sb_secret` 类密钥
- 真实用户数据、UID、邮箱、邮箱归属记录、账号恢复信息、临时密码及其 issue/expiry metadata
- 私有后端地址、代理配置、内部调试脚本输出
- 可直接复现的攻击 payload、绕过样例或验证码破解细节

## 如何报告

- 优先使用 GitHub 的私密漏洞报告渠道
- 如果无法私密提交，请先在 issue 中只写最小必要信息，并避免附带敏感值
- 说明受影响的路由、时间、浏览器、权限等级和可见后果

## 我们会优先看什么

- 身份校验绕过
- 用户数据泄露
- 公共缓存越权或错误复用
- 管理接口未授权访问
- 生产环境直连敏感后端的回退路径
- 贡献者沙盒在生产构建中可被激活，或 synthetic 管理身份能触发真实认证 / 写入
- 公共 `site_config`、卡池 DTO / RPC、Markdown、远程媒体或图片代理泄露私有字段、绕过主机白名单或访问内网资源
- 个人分析快照跨 owner 泄露，或 schema version 与实际 payload 能力不一致

## 公共内容边界

- 普通浏览器只能读取显式公开的 `site_config` 键和卡池列；卡池创建者认证 UUID、用户名与角色不属于公共合同。
- 远程内容只允许可信 HTTPS 主机。公告 Markdown、卡池 banner、头像和官方图片代理必须执行 URL / 主机净化；图片代理还须逐跳校验重定向、端口、超时、响应体上限、MIME 与文件魔数。
- 本地沙盒持久化数据是不可信输入，读取时须做 schema、数量、字符串长度、总容量和原型键校验。
- 个人分析与历史响应保持 `no-store`；`simulatorInheritance` 只保留需要的紧凑字段，不携带原始用户、账号、区服、批次或审计字段。
- 私钥、数据库备份、历史导出与本机任务记录不得进入 Git、Vercel 或 Docker 上传上下文；`.gitignore` 不能清除已经跟踪的文件，提交前须核对实际差异。文件范围见 [仓库内容规范](docs/REPOSITORY_LAYOUT.md)。
