# 抽奖主站运营边界

主站只承担身份、私有数据网关、开奖控制面、兑奖联系方式解密和到期清理。独立活动站不持有主站 Cookie、数据库 service role、联系方式 keyring 或开奖私有种子。

## 数据库版本

共享 Supabase 数据库必须按顺序应用独立活动站仓库的迁移 160–165：

- 160–161：活动、一次性 SSO、报名、事务化开奖和密文联系方式；
- 162：联系方式保留期、单条读取 / 删除、到期清理和访问审计；
- 163：多实例共享限流；
- 164：短期管理员 prepare / draw wrapper 和操作审计；
- 165：按活动授权的 `contact_read` / `contact_purge` capability 和授权变更审计。

先部署兼容新 RPC 的主站代码，再应用会撤销旧函数权限的迁移 164–165，最后部署活动站。回滚主站代码前不得重新开放旧 prepare / draw 或无 capability 的联系方式 RPC。

## 配置归属

只放在主站服务端：

- `LOTTERY_DRAW_SEED`
- `LOTTERY_CONTACT_ENCRYPTION_ACTIVE_KEY_ID`
- `LOTTERY_CONTACT_ENCRYPTION_KEYS_JSON`
- `SUPABASE_SECRET_KEY` / service role
- `CRON_SECRET`

主站与活动站服务端共同持有但不得进入浏览器：

- `LOTTERY_BACKEND_SECRET`

所有值必须与主站会话、OAuth、邮件和 CAPTCHA 密钥分离。`LOTTERY_DRAW_SEED` 和联系方式 keyring 不得发送到活动站。

## 准备与开奖

`/api/admin-summer-lottery-operations` 只接受当前主站超级管理员身份。写操作要求允许的 Origin、活动级精确确认词和数据库共享限流；数据库在同一事务中重新确认 actor 仍为 `super_admin`，并追加不含 seed 的操作审计。

活动站 `/api/admin/prepare`、`/api/admin/draw` 必须保持 404；普通数据网关收到 `prepare` / `draw` 必须返回 `action_not_allowed`。

## 兑奖最小权限

联系方式权限不从 `profiles.role` 自动继承。全局 `super_admin` 也必须显式获得目标活动 capability 才能读取或删除联系方式：

- `contact_read`：查看中奖目标并单条解密读取；
- `contact_purge`：执行指定中奖记录的隐私删除。

超级管理员在完整后台的“抽奖兑奖联系”面板按用户 UUID 授予或撤销。兑奖人员只使用：

- 桌面端：`/lottery-contacts`
- 移动端：`/m/lottery-contacts`

专用工作台不提供用户管理、站点配置、权限管理或开奖按钮。API 先校验主站身份与 capability，数据库 RPC 再按真实 entry 所属活动校验一次；撤权与正在执行的读取 / 删除通过行锁串行化。

## 联系方式生命周期

浏览器只会短暂收到当前单条明文。页面切到后台或显示满 60 秒后立即隐藏，不提供批量导出。单条读取、手工删除、到期清理以及 capability 授予 / 撤销均写入追加式审计。

每日 `/api/summer-lottery-contact-retention` 任务使用 `CRON_SECRET` 清除到期在线密文。在线删除不会追溯删除 WAL、备份、只读副本或人工导出；必须为这些副本配置独立过期周期，并为清理任务失败设置告警。

## 本地验收

在独立活动站仓库执行：

```powershell
npm run local:e2e
npm run db:test
npm run local:e2e:check
npm run local:e2e:draw
npm run local:e2e:contact
npm run local:e2e:verify
npm run local:e2e:stop
```

`local:e2e:contact` 使用普通 `profiles.role=user` 账号完成单条读取和删除，并断言测试超级管理员没有隐式联系方式权限。
