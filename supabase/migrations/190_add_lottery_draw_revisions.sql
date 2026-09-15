BEGIN;

CREATE TABLE IF NOT EXISTS public.summer_lottery_draw_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id TEXT NOT NULL REFERENCES public.summer_lottery_campaigns(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  status TEXT NOT NULL CHECK (status IN ('superseded', 'final')),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  reason_public TEXT NOT NULL CHECK (char_length(reason_public) BETWEEN 3 AND 300),
  prize_plan JSONB NOT NULL,
  seed_commitment TEXT NOT NULL CHECK (seed_commitment ~ '^[0-9a-f]{64}$'),
  seed_reveal TEXT NOT NULL,
  public_randomness_chain TEXT NOT NULL CHECK (public_randomness_chain ~ '^[0-9a-f]{64}$'),
  public_randomness_round BIGINT NOT NULL CHECK (public_randomness_round > 0),
  public_randomness TEXT NOT NULL CHECK (public_randomness ~ '^[0-9a-f]{64}$'),
  public_randomness_signature TEXT NOT NULL CHECK (
    public_randomness_signature ~ '^[0-9a-f]+$'
    AND length(public_randomness_signature) % 2 = 0
  ),
  candidate_manifest_hash TEXT NOT NULL CHECK (candidate_manifest_hash ~ '^[0-9a-f]{64}$'),
  drawn_at TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, revision_number)
);

CREATE TABLE IF NOT EXISTS public.summer_lottery_draw_revision_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_revision_id UUID NOT NULL REFERENCES public.summer_lottery_draw_revisions(id)
    ON DELETE RESTRICT,
  campaign_id TEXT NOT NULL REFERENCES public.summer_lottery_campaigns(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  entry_id UUID NOT NULL REFERENCES public.summer_lottery_entries(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  prize_tier TEXT NOT NULL CHECK (prize_tier IN ('first', 'second')),
  winner_order INTEGER NOT NULL CHECK (winner_order > 0),
  claim_status TEXT NOT NULL,
  outcome_status TEXT NOT NULL CHECK (outcome_status IN ('invalidated', 'superseded')),
  outcome_reason TEXT NOT NULL CHECK (char_length(outcome_reason) BETWEEN 3 AND 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draw_revision_id, prize_tier, winner_order),
  UNIQUE (draw_revision_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_summer_lottery_draw_revisions_campaign
  ON public.summer_lottery_draw_revisions (campaign_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_summer_lottery_draw_revision_winners_revision
  ON public.summer_lottery_draw_revision_winners (draw_revision_id, outcome_status);

ALTER TABLE public.summer_lottery_draw_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summer_lottery_draw_revision_winners ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_summer_lottery_draw_revision_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'summer_lottery_draw_revision_immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_summer_lottery_draw_revisions_no_update_delete
  ON public.summer_lottery_draw_revisions;
CREATE TRIGGER trg_summer_lottery_draw_revisions_no_update_delete
  BEFORE UPDATE OR DELETE ON public.summer_lottery_draw_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_summer_lottery_draw_revision_mutation();
DROP TRIGGER IF EXISTS trg_summer_lottery_draw_revisions_no_truncate
  ON public.summer_lottery_draw_revisions;
CREATE TRIGGER trg_summer_lottery_draw_revisions_no_truncate
  BEFORE TRUNCATE ON public.summer_lottery_draw_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_summer_lottery_draw_revision_mutation();
DROP TRIGGER IF EXISTS trg_summer_lottery_draw_revision_winners_no_update_delete
  ON public.summer_lottery_draw_revision_winners;
CREATE TRIGGER trg_summer_lottery_draw_revision_winners_no_update_delete
  BEFORE UPDATE OR DELETE ON public.summer_lottery_draw_revision_winners
  FOR EACH ROW EXECUTE FUNCTION public.prevent_summer_lottery_draw_revision_mutation();
DROP TRIGGER IF EXISTS trg_summer_lottery_draw_revision_winners_no_truncate
  ON public.summer_lottery_draw_revision_winners;
CREATE TRIGGER trg_summer_lottery_draw_revision_winners_no_truncate
  BEFORE TRUNCATE ON public.summer_lottery_draw_revision_winners
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_summer_lottery_draw_revision_mutation();

REVOKE ALL ON TABLE public.summer_lottery_draw_revisions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.summer_lottery_draw_revision_winners
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.summer_lottery_draw_revisions TO service_role;
GRANT SELECT ON TABLE public.summer_lottery_draw_revision_winners TO service_role;

COMMENT ON TABLE public.summer_lottery_draw_revisions IS
  '已公开开奖的不可变修订快照，保留种子、公共随机数、候选清单哈希与修订原因。';
COMMENT ON TABLE public.summer_lottery_draw_revision_winners IS
  '开奖修订时的原中奖名单及每名用户的公开处理结果。';

NOTIFY pgrst, 'reload schema';
COMMIT;
