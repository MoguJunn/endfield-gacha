-- 176: AIC 协议存档并发控制与经济事务
--
-- 149 已创建 game_saves 与 aic-protocol 目录项。本迁移只做向前增强：
--   1. 为云存档增加 revision 乐观锁与后端保护数据 server_data；
--   2. 新增通用奖励领取 / 购买事件表，提供数据库级幂等键；
--   3. 提供存档覆盖、AIC 里程碑领取和 AIC 商店购买三个原子 RPC。

ALTER TABLE public.game_saves
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS server_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.game_reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  reward_amount BIGINT NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game_id, claim_type, claim_key)
);

CREATE TABLE IF NOT EXISTS public.game_purchase_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cost BIGINT NOT NULL CHECK (cost > 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  effect JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_reward_claims_user_game
  ON public.game_reward_claims(user_id, game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_purchase_events_user_game
  ON public.game_purchase_events(user_id, game_id, created_at DESC);

ALTER TABLE public.game_reward_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_purchase_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.game_reward_claims FROM anon, authenticated;
REVOKE ALL ON public.game_purchase_events FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_reward_claims TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_purchase_events TO service_role;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.save_game_state(
  p_user_id UUID,
  p_game_id TEXT,
  p_save_data JSONB,
  p_schema_version INTEGER,
  p_expected_revision BIGINT
)
RETURNS TABLE (
  revision BIGINT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.game_saves%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR NULLIF(BTRIM(p_game_id), '') IS NULL THEN
    RAISE EXCEPTION 'user id and game id are required';
  END IF;
  IF p_save_data IS NULL OR jsonb_typeof(p_save_data) <> 'object' THEN
    RAISE EXCEPTION 'save data must be a JSON object';
  END IF;
  IF p_schema_version < 1 OR p_schema_version > 1000 THEN
    RAISE EXCEPTION 'invalid save schema version';
  END IF;

  SELECT * INTO v_row
  FROM public.game_saves AS s
  WHERE s.user_id = p_user_id AND s.game_id = p_game_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.revision <> COALESCE(p_expected_revision, 0) THEN
      RAISE EXCEPTION 'save_conflict: expected %, current %', p_expected_revision, v_row.revision;
    END IF;

    UPDATE public.game_saves AS s
    SET save_data = p_save_data,
        version = p_schema_version,
        revision = s.revision + 1,
        updated_at = NOW()
    WHERE s.user_id = p_user_id AND s.game_id = p_game_id
    RETURNING s.* INTO v_row;
  ELSE
    IF COALESCE(p_expected_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'save_conflict: expected %, current 0', p_expected_revision;
    END IF;

    INSERT INTO public.game_saves (user_id, game_id, save_data, version, revision)
    VALUES (p_user_id, p_game_id, p_save_data, p_schema_version, 1)
    RETURNING * INTO v_row;
  END IF;

  revision := v_row.revision;
  updated_at := v_row.updated_at;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_aic_milestone(
  p_user_id UUID,
  p_level INTEGER
)
RETURNS TABLE (
  claimed BOOLEAN,
  milestone_level INTEGER,
  score INTEGER,
  reward_amount BIGINT,
  balance BIGINT,
  ledger_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score INTEGER;
  v_reward BIGINT;
  v_claim_id UUID;
  v_event_id UUID;
  v_wallet RECORD;
  v_highest_level INTEGER := 0;
  v_daily_reward BIGINT := 0;
BEGIN
  v_score := CASE p_level
    WHEN 1 THEN 500
    WHEN 2 THEN 1000
    WHEN 3 THEN 2000
    WHEN 4 THEN 4000
    WHEN 5 THEN 8000
    WHEN 6 THEN 16000
    ELSE NULL
  END;
  IF v_score IS NULL THEN
    RAISE EXCEPTION 'invalid AIC milestone level';
  END IF;
  v_reward := v_score / 100;

  SELECT c.id INTO v_claim_id
  FROM public.game_reward_claims AS c
  WHERE c.user_id = p_user_id
    AND c.game_id = 'aic-protocol'
    AND c.claim_type = 'milestone'
    AND c.claim_key = p_level::TEXT;

  IF FOUND THEN
    SELECT w.balance INTO balance
    FROM public.game_currency_wallets AS w
    WHERE w.user_id = p_user_id AND w.currency_code = 't_creds';
    claimed := FALSE;
    milestone_level := p_level;
    score := v_score;
    reward_amount := 0;
    ledger_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COALESCE(MAX(CASE WHEN c.claim_key ~ '^[0-9]+$' THEN c.claim_key::INTEGER ELSE 0 END), 0),
    COALESCE(SUM(c.reward_amount) FILTER (WHERE c.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')), 0)
  INTO v_highest_level, v_daily_reward
  FROM public.game_reward_claims AS c
  WHERE c.user_id = p_user_id
    AND c.game_id = 'aic-protocol'
    AND c.claim_type = 'milestone';

  IF p_level <> v_highest_level + 1 THEN
    RAISE EXCEPTION 'AIC milestones must be claimed in order';
  END IF;
  IF v_daily_reward + v_reward > 200 THEN
    RAISE EXCEPTION 'AIC daily reward limit reached';
  END IF;

  INSERT INTO public.game_reward_claims (
    user_id, game_id, claim_type, claim_key, reward_amount, meta
  ) VALUES (
    p_user_id, 'aic-protocol', 'milestone', p_level::TEXT, v_reward,
    jsonb_build_object('level', p_level, 'score', v_score)
  )
  ON CONFLICT (user_id, game_id, claim_type, claim_key) DO NOTHING
  RETURNING id INTO v_claim_id;

  IF v_claim_id IS NULL THEN
    SELECT w.balance INTO balance
    FROM public.game_currency_wallets AS w
    WHERE w.user_id = p_user_id AND w.currency_code = 't_creds';
    claimed := FALSE;
    milestone_level := p_level;
    score := v_score;
    reward_amount := 0;
    ledger_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_event_id := gen_random_uuid();
  INSERT INTO public.game_score_events (
    id, user_id, game_id, score, points, rules_version, client_meta, integrity_status
  ) VALUES (
    v_event_id, p_user_id, 'aic-protocol', v_score, v_score, 'v2',
    jsonb_build_object('mode', 'aic-milestone', 'level', p_level), 'accepted'
  );

  INSERT INTO public.game_leaderboard_entries (
    game_id, season_id, user_id, best_score, total_points, play_count
  ) VALUES (
    'aic-protocol', 'global', p_user_id, v_score, v_score, 1
  )
  ON CONFLICT (game_id, season_id, user_id) DO UPDATE
    SET best_score = GREATEST(public.game_leaderboard_entries.best_score, EXCLUDED.best_score),
        total_points = public.game_leaderboard_entries.total_points + EXCLUDED.total_points,
        play_count = public.game_leaderboard_entries.play_count + 1,
        updated_at = NOW();

  INSERT INTO public.game_user_stats (user_id, total_points, play_count, last_played_at)
  VALUES (p_user_id, v_score, 1, NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET total_points = public.game_user_stats.total_points + EXCLUDED.total_points,
        play_count = public.game_user_stats.play_count + 1,
        last_played_at = NOW(),
        updated_at = NOW();

  SELECT * INTO v_wallet
  FROM public.apply_game_currency_delta(
    p_user_id,
    't_creds',
    v_reward,
    'aic_milestone',
    'aic-protocol',
    v_event_id,
    'aic:milestone:' || p_user_id::TEXT || ':' || p_level::TEXT,
    jsonb_build_object('level', p_level, 'score', v_score)
  );

  claimed := TRUE;
  milestone_level := p_level;
  score := v_score;
  reward_amount := v_reward;
  balance := v_wallet.balance;
  ledger_id := v_wallet.ledger_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_aic_item(
  p_user_id UUID,
  p_item_id TEXT,
  p_cost BIGINT,
  p_idempotency_key TEXT,
  p_effect JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  applied BOOLEAN,
  purchase_id UUID,
  balance BIGINT,
  revision BIGINT,
  server_data JSONB,
  ledger_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.game_purchase_events%ROWTYPE;
  v_purchase public.game_purchase_events%ROWTYPE;
  v_save public.game_saves%ROWTYPE;
  v_wallet RECORD;
  v_purchase_meta JSONB;
BEGIN
  IF p_cost <= 0 OR NULLIF(BTRIM(p_item_id), '') IS NULL OR NULLIF(BTRIM(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'item, positive cost and idempotency key are required';
  END IF;

  SELECT * INTO v_existing
  FROM public.game_purchase_events AS p
  WHERE p.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.user_id <> p_user_id OR v_existing.game_id <> 'aic-protocol' THEN
      RAISE EXCEPTION 'idempotency key already belongs to another purchase';
    END IF;
    SELECT * INTO v_save
    FROM public.game_saves AS s
    WHERE s.user_id = p_user_id AND s.game_id = 'aic-protocol';
    SELECT w.balance INTO balance
    FROM public.game_currency_wallets AS w
    WHERE w.user_id = p_user_id AND w.currency_code = 't_creds';
    applied := FALSE;
    purchase_id := v_existing.id;
    revision := COALESCE(v_save.revision, 0);
    server_data := COALESCE(v_save.server_data, '{}'::jsonb);
    ledger_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.game_saves (user_id, game_id, save_data, version, revision, server_data)
  VALUES (p_user_id, 'aic-protocol', '{}'::jsonb, 2, 0, '{}'::jsonb)
  ON CONFLICT (user_id, game_id) DO NOTHING;

  SELECT * INTO v_save
  FROM public.game_saves AS s
  WHERE s.user_id = p_user_id AND s.game_id = 'aic-protocol'
  FOR UPDATE;

  IF p_effect->>'type' = 'permanent_perk' AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_save.server_data->'purchases', '[]'::jsonb)) AS purchase
    WHERE purchase->>'itemId' = p_item_id
  ) THEN
    SELECT w.balance INTO balance
    FROM public.game_currency_wallets AS w
    WHERE w.user_id = p_user_id AND w.currency_code = 't_creds';
    applied := FALSE;
    purchase_id := NULL;
    revision := COALESCE(v_save.revision, 0);
    server_data := COALESCE(v_save.server_data, '{}'::jsonb);
    ledger_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.game_purchase_events (
    user_id, game_id, item_id, cost, idempotency_key, effect
  ) VALUES (
    p_user_id, 'aic-protocol', p_item_id, p_cost, p_idempotency_key,
    COALESCE(p_effect, '{}'::jsonb)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_purchase;

  IF v_purchase.id IS NULL THEN
    SELECT * INTO v_existing
    FROM public.game_purchase_events AS p
    WHERE p.idempotency_key = p_idempotency_key;
    IF v_existing.user_id <> p_user_id OR v_existing.game_id <> 'aic-protocol' THEN
      RAISE EXCEPTION 'idempotency key already belongs to another purchase';
    END IF;
    SELECT w.balance INTO balance
    FROM public.game_currency_wallets AS w
    WHERE w.user_id = p_user_id AND w.currency_code = 't_creds';
    applied := FALSE;
    purchase_id := v_existing.id;
    revision := COALESCE(v_save.revision, 0);
    server_data := COALESCE(v_save.server_data, '{}'::jsonb);
    ledger_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_wallet
  FROM public.apply_game_currency_delta(
    p_user_id,
    't_creds',
    -p_cost,
    'aic_purchase',
    'aic-protocol',
    NULL,
    'aic:purchase:' || p_idempotency_key,
    jsonb_build_object('itemId', p_item_id)
  );

  v_purchase_meta := jsonb_build_object(
    'purchaseId', v_purchase.id,
    'itemId', p_item_id,
    'effect', COALESCE(p_effect, '{}'::jsonb),
    'purchasedAt', v_purchase.created_at
  );

  UPDATE public.game_saves AS s
  SET server_data = jsonb_set(
        COALESCE(s.server_data, '{}'::jsonb),
        '{purchases}',
        COALESCE(s.server_data->'purchases', '[]'::jsonb) || jsonb_build_array(v_purchase_meta),
        TRUE
      ),
      revision = s.revision + 1,
      updated_at = NOW()
  WHERE s.user_id = p_user_id AND s.game_id = 'aic-protocol'
  RETURNING * INTO v_save;

  applied := TRUE;
  purchase_id := v_purchase.id;
  balance := v_wallet.balance;
  revision := v_save.revision;
  server_data := v_save.server_data;
  ledger_id := v_wallet.ledger_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.save_game_state(UUID, TEXT, JSONB, INTEGER, BIGINT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_aic_milestone(UUID, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_aic_item(UUID, TEXT, BIGINT, TEXT, JSONB) FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.save_game_state(UUID, TEXT, JSONB, INTEGER, BIGINT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.claim_aic_milestone(UUID, INTEGER) TO service_role;
    GRANT EXECUTE ON FUNCTION public.purchase_aic_item(UUID, TEXT, BIGINT, TEXT, JSONB) TO service_role;
  END IF;
END $$;

UPDATE public.game_catalog
SET title = 'AIC 协议',
    summary = '独立部署的终末地 AIC 自动化工业放置游戏，包含九资源配方网络、协同与重构。',
    rules_version = 'v2',
    sort_order = 40,
    leaderboard_enabled = TRUE,
    updated_at = NOW()
WHERE game_id = 'aic-protocol';

COMMENT ON COLUMN public.game_saves.revision IS
  '云存档乐观锁版本。客户端 PUT 必须携带 expectedRevision，成功写入后递增。';
COMMENT ON COLUMN public.game_saves.server_data IS
  '仅服务端经济事务可写的保护字段（购买记录、权益等），普通存档 PUT 不可覆盖。';
COMMENT ON TABLE public.game_reward_claims IS
  '小游戏奖励领取幂等表。user+game+claim_type+claim_key 唯一。';
COMMENT ON TABLE public.game_purchase_events IS
  '小游戏商店购买不可变流水，按 idempotency_key 防重复扣费与重复授予。';
