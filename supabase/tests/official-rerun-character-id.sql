BEGIN;
SET LOCAL request.jwt.claim.role = 'authenticated';
INSERT INTO public.pool_id_aliases (source,alias_id,pool_id,is_primary)
VALUES ('official_api','rerun_chr_yvonne','joint_manual_extra_reconstruction_yvonne_p1',false)
ON CONFLICT(source,alias_id) DO UPDATE SET pool_id=EXCLUDED.pool_id;
INSERT INTO public.history (
  user_id,record_id,pool_id,game_uid,seq_id,server_id,rarity,item_name,is_standard,pool_version,timestamp
) VALUES (
  '00000000-0000-0000-0000-000000000001','character-id-198',
  'joint_manual_extra_reconstruction_yvonne_p1','character-id-fixture','198','1',6,'伊冯',false,1,
  '2026-09-24T04:08:16Z'
);
CREATE TEMP TABLE character_roster_before AS
SELECT character_id,is_up FROM public.pool_characters
WHERE pool_id='joint_manual_extra_reconstruction_yvonne_p1';

-- APPLY CHARACTER PROMOTION

DO $test$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pools WHERE pool_id='rerun_chr_yvonne'
      AND extra_rule_profile='reconstruction_character_v1' AND up_character='伊冯')
    OR EXISTS (SELECT 1 FROM public.pools WHERE pool_id='joint_manual_extra_reconstruction_yvonne_p1') THEN
    RAISE EXCEPTION 'character catalog identity not promoted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.history WHERE record_id='character-id-198'
      AND pool_id='rerun_chr_yvonne' AND pool_version=1 AND is_standard=false) THEN
    RAISE EXCEPTION 'character promotion lost record period or UP flag';
  END IF;
  IF EXISTS (SELECT character_id,is_up FROM character_roster_before
    EXCEPT SELECT character_id,is_up FROM public.pool_characters WHERE pool_id='rerun_chr_yvonne') THEN
    RAISE EXCEPTION 'character promotion lost roster';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pool_id_aliases WHERE alias_id='joint_manual_extra_reconstruction_yvonne_p1'
      AND pool_id='rerun_chr_yvonne') THEN
    RAISE EXCEPTION 'temporary character alias not preserved';
  END IF;
  IF current_setting('request.jwt.claim.role') <> 'authenticated' THEN
    RAISE EXCEPTION 'migration did not restore caller role';
  END IF;
END;
$test$;
ROLLBACK;
