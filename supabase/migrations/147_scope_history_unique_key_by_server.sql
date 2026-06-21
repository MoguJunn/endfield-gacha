-- 147: scope account history uniqueness by server.
-- ACCOUNT-SERVER-001: allow the same game UID / pool / seq to exist separately per server.

ALTER TABLE public.history
  ADD COLUMN IF NOT EXISTS server_scope TEXT
  GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(server_id), ''), 'legacy')) STORED;

-- Defensive cleanup for environments that may have lost the older unique constraint.
DELETE FROM public.history AS h
WHERE h.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, game_uid, server_scope, pool_id, seq_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      ) AS rn
    FROM public.history
    WHERE user_id IS NOT NULL
      AND game_uid IS NOT NULL
      AND pool_id IS NOT NULL
      AND seq_id IS NOT NULL
  ) AS ranked
  WHERE ranked.rn > 1
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_server_scope_pool_seq_unique'
  ) THEN
    ALTER TABLE public.history
      ADD CONSTRAINT history_user_game_server_scope_pool_seq_unique
      UNIQUE (user_id, game_uid, server_scope, pool_id, seq_id);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_pool_seq_unique'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_game_pool_seq_unique;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_game_seq_unique'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_game_seq_unique;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.history'::regclass
      AND conname = 'history_user_id_game_uid_seq_id_key'
  ) THEN
    ALTER TABLE public.history
      DROP CONSTRAINT history_user_id_game_uid_seq_id_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_history_user_game_server_scope
  ON public.history (user_id, game_uid, server_scope);

COMMENT ON COLUMN public.history.server_scope IS
  '账号区服唯一性范围；server_id 为空的旧记录使用 legacy。';

COMMENT ON CONSTRAINT history_user_game_server_scope_pool_seq_unique ON public.history IS
  '同一用户、同一游戏账号、同一区服、同一卡池、同一 seq_id 不重复。';

NOTIFY pgrst, 'reload schema';
