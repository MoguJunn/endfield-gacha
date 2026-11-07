-- Complete the missing non-duplicate indexes from migration 140. The wallet
-- primary key and idx_game_score_events_user_game_created already cover the
-- other two historical index definitions on the production instance.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_game_score_events_game_created
  ON public.game_score_events(game_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_score_events_client_meta
  ON public.game_score_events USING GIN(client_meta);
CREATE INDEX IF NOT EXISTS idx_game_catalog_status_sort
  ON public.game_catalog(status,sort_order);

-- Also repairs instances that applied the original 176 before PUBLIC was
-- explicitly revoked. These economic RPCs accept a service-verified user ID.
REVOKE ALL ON FUNCTION public.save_game_state(UUID,TEXT,JSONB,INTEGER,BIGINT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_aic_milestone(UUID,INTEGER) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.purchase_aic_item(UUID,TEXT,BIGINT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_game_state(UUID,TEXT,JSONB,INTEGER,BIGINT),
  public.claim_aic_milestone(UUID,INTEGER),public.purchase_aic_item(UUID,TEXT,BIGINT,TEXT,JSONB) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
