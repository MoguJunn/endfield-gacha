-- 148: 小游戏目录追加 uno-protocol（协议对决）
--
-- 与 endfield-games/api/_lib/gameRules.js 的 FALLBACK_GAMES 白名单保持一致。
-- 类 UNO 卡牌对战（单人对 AI），含 7 条可选规则与「源石技艺·干员协议 / 法术异常」场外玩法。

INSERT INTO public.game_catalog (game_id, title, summary, status, rules_version, sort_order, leaderboard_enabled)
VALUES
  ('uno-protocol', '协议对决', '类 UNO 卡牌对战，含可选规则与源石技艺·法术异常场外玩法。', 'active', 'v1', 30, TRUE)
ON CONFLICT (game_id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = EXCLUDED.status,
      rules_version = EXCLUDED.rules_version,
      sort_order = EXCLUDED.sort_order,
      leaderboard_enabled = EXCLUDED.leaderboard_enabled,
      updated_at = NOW();
