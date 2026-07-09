-- 141: 小游戏货币增减 RPC
--
-- apply_game_currency_delta 在单事务内原子地：
--   1. upsert 钱包余额（balance / lifetime_earned / lifetime_spent）
--   2. 写一条不可变流水（game_currency_ledger）
-- 通过 p_idempotency_key 的唯一约束保证同一笔入账只生效一次（重复调用直接
-- 返回已有钱包状态，不重复加减）。
--
-- SECURITY DEFINER 绕过 RLS；仅授予 service_role（小游戏后端调用）。

CREATE OR REPLACE FUNCTION public.apply_game_currency_delta(
  p_user_id UUID,
  p_currency_code TEXT,
  p_amount BIGINT,
  p_reason TEXT DEFAULT 'unspecified',
  p_source_game_id TEXT DEFAULT NULL,
  p_source_event_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  currency_code TEXT,
  balance BIGINT,
  lifetime_earned BIGINT,
  lifetime_spent BIGINT,
  ledger_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_ledger public.game_currency_ledger%ROWTYPE;
  v_wallet public.game_currency_wallets%ROWTYPE;
  v_earned_delta BIGINT := 0;
  v_spent_delta BIGINT := 0;
  v_new_ledger_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_currency_code IS NULL THEN
    RAISE EXCEPTION 'user id and currency code are required';
  END IF;

  -- 幂等：若该 key 已记账，直接返回当前钱包状态
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_ledger
    FROM public.game_currency_ledger
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
      SELECT * INTO v_wallet
      FROM public.game_currency_wallets
      WHERE user_id = p_user_id AND game_currency_wallets.currency_code = p_currency_code;

      currency_code := v_wallet.currency_code;
      balance := v_wallet.balance;
      lifetime_earned := v_wallet.lifetime_earned;
      lifetime_spent := v_wallet.lifetime_spent;
      ledger_id := v_existing_ledger.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  IF p_amount >= 0 THEN
    v_earned_delta := p_amount;
  ELSE
    v_spent_delta := -p_amount;
  END IF;

  -- upsert 钱包并锁行
  INSERT INTO public.game_currency_wallets AS w (
    user_id, currency_code, balance, lifetime_earned, lifetime_spent
  )
  VALUES (
    p_user_id,
    p_currency_code,
    GREATEST(0, p_amount),
    v_earned_delta,
    v_spent_delta
  )
  ON CONFLICT (user_id, currency_code) DO UPDATE
    SET balance = w.balance + p_amount,
        lifetime_earned = w.lifetime_earned + v_earned_delta,
        lifetime_spent = w.lifetime_spent + v_spent_delta,
        updated_at = NOW()
  RETURNING * INTO v_wallet;

  IF v_wallet.balance < 0 THEN
    RAISE EXCEPTION 'insufficient balance for user % currency %', p_user_id, p_currency_code;
  END IF;

  v_new_ledger_id := gen_random_uuid();
  INSERT INTO public.game_currency_ledger (
    id, user_id, currency_code, amount, reason,
    source_game_id, source_event_id, idempotency_key, balance_after, meta
  )
  VALUES (
    v_new_ledger_id, p_user_id, p_currency_code, p_amount, COALESCE(p_reason, 'unspecified'),
    p_source_game_id, p_source_event_id, p_idempotency_key, v_wallet.balance, COALESCE(p_meta, '{}'::jsonb)
  );

  currency_code := v_wallet.currency_code;
  balance := v_wallet.balance;
  lifetime_earned := v_wallet.lifetime_earned;
  lifetime_spent := v_wallet.lifetime_spent;
  ledger_id := v_new_ledger_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.apply_game_currency_delta(UUID, TEXT, BIGINT, TEXT, TEXT, UUID, TEXT, JSONB) IS
  '原子货币增减：upsert 钱包 + 写不可变流水，按 idempotency_key 幂等。仅 service_role 调用。';
