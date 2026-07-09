-- 143: 小游戏目录初始 seed
--
-- 与 endfield-games/api/_lib/gameRules.js 的 FALLBACK_GAMES 白名单保持一致。
-- puzzle-protocol 为站内原生拼图（制作 + 游玩），reaction-grid 为轻量验证玩法。
-- 后续新玩法（UNO / 挖矿 / 放置）接入时在此追加，并同步 gameRules.js 白名单。

INSERT INTO public.game_catalog (game_id, title, summary, status, rules_version, sort_order, leaderboard_enabled)
VALUES
  ('puzzle-protocol', '拼图协议', '拼图创作、挑战和分享的统一入口。', 'active', 'v1', 10, TRUE),
  ('reaction-grid', '反应矩阵', '用于验证成绩提交与排行链路的轻量玩法。', 'active', 'v1', 20, TRUE)
ON CONFLICT (game_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      rules_version = EXCLUDED.rules_version,
      sort_order = EXCLUDED.sort_order,
      leaderboard_enabled = EXCLUDED.leaderboard_enabled,
      updated_at = NOW();
