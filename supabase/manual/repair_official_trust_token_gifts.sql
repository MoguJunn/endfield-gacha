-- Targeted maintenance, NOT a schema migration or an automatic baseline step.
-- Required psql variables: expected_token_count, backup_file (psql client path).
-- Default: inspect and ROLLBACK. Set apply_repair=true only after checking counts.
-- The backup stores exact old/new history rows and affected anomaly reminders.
\if :{?apply_repair}
\else
  \set apply_repair false
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE token_repair_candidates ON COMMIT DROP AS
SELECT h.user_id, h.record_id, h.game_uid, h.server_scope, h.pool_id, h.seq_id,
       p.up_character AS character_name
FROM public.history h
JOIN public.pools p ON p.pool_id = h.pool_id AND p.type = 'limited'
WHERE h.character_name = p.up_character || '的信物'
  AND h.item_name = h.character_name
  AND h.rarity = 4 AND h.special_type IS NULL AND h.character_id IS NULL
  AND NOT h.is_free AND NOT h.is_info_book AND h.edit_version = 1
  AND NOT EXISTS (SELECT 1 FROM public.history_change_log l
                  WHERE l.user_id = h.user_id AND l.record_id = h.record_id)
  AND EXISTS (
    SELECT 1 FROM public.official_import_staged_records s
    JOIN public.official_import_tasks t ON t.id = s.task_id
    WHERE t.status = 'committed' AND t.user_id = h.user_id AND t.game_uid = h.game_uid
      AND COALESCE(t.server_id, 'legacy') = h.server_scope
      AND s.pool_id = h.pool_id AND s.seq_id = h.seq_id AND s.timestamp = h.timestamp
      AND s.item_name = h.item_name AND s.item_id IS NULL AND s.quality IS NULL
  );
CREATE TEMP TABLE token_repair_expectation ON COMMIT DROP AS
SELECT :'expected_token_count'::integer AS expected;
DO $$ BEGIN
  IF (SELECT count(*) FROM token_repair_candidates) <> (SELECT expected FROM token_repair_expectation) THEN
    RAISE EXCEPTION 'Token candidate count changed; stop and recheck';
  END IF;
END $$;

-- Lock the shared limited-pity histories of affected accounts before planning.
DO $$ BEGIN
  PERFORM h.record_id FROM public.history h JOIN public.pools p ON p.pool_id = h.pool_id
  WHERE p.type = 'limited' AND EXISTS (
    SELECT 1 FROM token_repair_candidates c WHERE c.user_id = h.user_id
      AND c.game_uid = h.game_uid AND c.server_scope = h.server_scope)
  ORDER BY h.user_id, h.record_id FOR UPDATE OF h;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM token_repair_candidates c JOIN public.history h
    USING (user_id, game_uid, server_scope, pool_id, seq_id)
    WHERE h.character_name IS DISTINCT FROM c.character_name || '的信物'
      OR h.item_name IS DISTINCT FROM c.character_name || '的信物'
      OR h.rarity <> 4 OR h.special_type IS NOT NULL OR h.character_id IS NOT NULL
      OR h.edit_version <> 1 OR h.is_free OR h.is_info_book) THEN
    RAISE EXCEPTION 'Token changed while waiting for locks; stop and recheck';
  END IF;
END $$;

CREATE TEMP TABLE token_repair_history ON COMMIT DROP AS
WITH ordered AS (
  SELECT h.*, c.character_name AS gift_character_name,
    row_number() OVER w AS position,
    count(*) FILTER (WHERE NOT h.is_free AND NOT h.is_info_book
      AND COALESCE(h.special_type, '') <> 'gift' AND c.record_id IS NULL) OVER w AS paid_position
  FROM public.history h JOIN public.pools p ON p.pool_id = h.pool_id AND p.type = 'limited'
  LEFT JOIN token_repair_candidates c ON c.user_id = h.user_id AND c.game_uid = h.game_uid
    AND c.server_scope = h.server_scope AND c.pool_id = h.pool_id AND c.seq_id = h.seq_id
  WHERE EXISTS (SELECT 1 FROM token_repair_candidates c WHERE c.user_id = h.user_id
    AND c.game_uid = h.game_uid AND c.server_scope = h.server_scope)
  WINDOW w AS (PARTITION BY h.user_id, h.game_uid, h.server_scope
    ORDER BY h.timestamp, CASE WHEN h.seq_id ~ '^[0-9]+$' THEN h.seq_id::numeric END,
      h.seq_id, h.record_id ROWS UNBOUNDED PRECEDING)
), segments AS (
  SELECT ordered.*, COALESCE(max(paid_position) FILTER (WHERE rarity = 6
    AND NOT is_free AND NOT is_info_book AND COALESCE(special_type, '') <> 'gift'
    AND gift_character_name IS NULL) OVER (PARTITION BY user_id, game_uid, server_scope
      ORDER BY position ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS last_hit,
    COALESCE(max(position) FILTER (WHERE rarity = 6 AND NOT is_free AND NOT is_info_book
      AND COALESCE(special_type, '') <> 'gift' AND gift_character_name IS NULL)
      OVER (PARTITION BY user_id, game_uid, server_scope ORDER BY position
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS segment
  FROM ordered
), affected AS (
  SELECT segments.*, count(*) FILTER (WHERE gift_character_name IS NOT NULL)
    OVER (PARTITION BY user_id, game_uid, server_scope, segment
      ORDER BY position ROWS UNBOUNDED PRECEDING) AS tokens_in_segment
  FROM segments
)
SELECT h.user_id, h.record_id, h.game_uid, h.server_scope, h.pool_id, h.seq_id, to_jsonb(h) AS old_row,
  to_jsonb(h) || jsonb_build_object(
    'pity', LEAST(GREATEST(a.paid_position - a.last_hit, 0), 80),
    'updated_at', now(), 'edit_version', h.edit_version + 1
  ) || CASE WHEN a.gift_character_name IS NOT NULL THEN jsonb_build_object(
    'rarity', 6, 'special_type', 'gift', 'character_name', a.gift_character_name,
    'is_standard', false
  ) ELSE '{}'::jsonb END AS new_row
FROM affected a JOIN public.history h USING (user_id, game_uid, server_scope, pool_id, seq_id)
WHERE a.tokens_in_segment > 0 AND (a.gift_character_name IS NOT NULL
  OR h.pity IS DISTINCT FROM LEAST(GREATEST(a.paid_position - a.last_hit, 0), 80));

SELECT jsonb_build_object('tokens', (SELECT count(*) FROM token_repair_candidates),
  'users', (SELECT count(DISTINCT user_id) FROM token_repair_candidates),
  'history_updates', (SELECT count(*) FROM token_repair_history)) AS repair_plan;

\if :apply_repair
  -- COPY must succeed before any production record is changed. Do not overwrite
  -- a previous backup. Its path is private and must not appear in public docs.
  -- psql writes the file; postgres does not need pg_write_server_files.
  \o :backup_file
  COPY (
    SELECT jsonb_build_object('history', jsonb_agg(to_jsonb(r)), 'anomalies', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.history_anomalies a
      JOIN token_repair_candidates c USING (user_id, game_uid, server_scope, pool_id, seq_id)
      WHERE a.issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM' AND a.status = 'pending'
    )) FROM token_repair_history r
  ) TO STDOUT;
  \o

  UPDATE public.history h SET
    rarity = (r.new_row->>'rarity')::integer,
    special_type = r.new_row->>'special_type', character_name = r.new_row->>'character_name',
    pity = (r.new_row->>'pity')::integer, is_standard = (r.new_row->>'is_standard')::boolean,
    edit_version = (r.new_row->>'edit_version')::bigint, updated_at = now()
  FROM token_repair_history r WHERE h.user_id = r.user_id AND h.game_uid = r.game_uid
    AND h.server_scope = r.server_scope AND h.pool_id = r.pool_id AND h.seq_id = r.seq_id;

  UPDATE public.history_anomalies a SET status = 'resolved', resolved_at = now(),
    resolution_note = '已根据官方导入证据修正为限定池信物赠送；不计入抽数与保底。'
  FROM token_repair_candidates c WHERE c.user_id = a.user_id AND c.game_uid = a.game_uid
    AND c.server_scope = a.server_scope AND c.pool_id = a.pool_id AND c.seq_id = a.seq_id
    AND a.issue_code = 'OFFICIAL_IMPORT_UNKNOWN_ITEM' AND a.status = 'pending';
  -- Existing revision triggers enqueue the corresponding owner/account rebuilds.
  COMMIT;
\else
  ROLLBACK;
\endif
