# Security Policy

## 受支持的范围

当前公开仓库只支持公开主链、公开 API、前端路由、数据库迁移和文档相关问题。

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
