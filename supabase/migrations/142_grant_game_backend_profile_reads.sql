-- 142: 确保小游戏后端 (service_role) 能读取 public_profiles
--
-- 小游戏站后端用 service_role 调 public_profiles 视图拼排行榜用户名。
-- public_profiles 是 security_invoker 视图（079），底层为 public_profile_cache。
-- 在自建实例上，service_role 默认对 public schema 拥有权限，但此处显式补授，
-- 保证跨实例 / 重置授权后仍可用。这是幂等的安全网，不改变既有对外行为。

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.public_profile_cache TO service_role;
    GRANT SELECT ON public.public_profiles TO service_role;
  END IF;
END $$;

-- 备注：拼图相关对象（puzzles 表、increment_puzzle_solve / review_puzzle /
-- update_puzzle_difficulty / delete_puzzle RPC）已由 archive/064-067 创建，
-- 自建实例已具备，本迁移无需重建。小游戏站后端通过 service_role 调用
-- increment_puzzle_solve，service_role 默认具备 EXECUTE 权限。
