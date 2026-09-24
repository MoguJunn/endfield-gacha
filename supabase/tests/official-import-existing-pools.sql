BEGIN;
CREATE TEMP TABLE catalog_insert_calls (calls INTEGER NOT NULL);
INSERT INTO catalog_insert_calls VALUES (0);
CREATE FUNCTION public.test_import_catalog_statement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE catalog_insert_calls SET calls = calls + 1;
  RETURN NULL;
END;
$$;
CREATE TRIGGER test_import_catalog_statement AFTER INSERT ON public.pools
  FOR EACH STATEMENT EXECUTE FUNCTION public.test_import_catalog_statement();

DO $test$
DECLARE
  v_user UUID := '00000000-0000-0000-0000-000000000001';
  v_task UUID := '00000000-0000-0000-0000-000000000196';
  v_result JSONB;
BEGIN
  INSERT INTO public.official_import_tasks (
    id,user_id,source,import_mode,game_uid,server_id,status,access_key_hash
  ) VALUES (v_task,v_user,'cn','incremental','statement-test','1','confirming','test');
  v_result := public.commit_official_import_records(v_task,v_user,
    '[{"pool_id":"rpc_pool","name":"Existing","type":"limited"}]', '[]');
  IF (SELECT calls FROM catalog_insert_calls) <> 0 OR (v_result->>'createdPools')::INTEGER <> 0 THEN
    RAISE EXCEPTION 'existing pool import fired catalog INSERT trigger';
  END IF;

  UPDATE public.official_import_tasks SET status='confirming' WHERE id=v_task;
  v_result := public.commit_official_import_records(v_task,v_user,
    '[{"pool_id":"rpc_pool","name":"Existing","type":"limited"},
      {"pool_id":"new_statement_test","name":"New","type":"limited"}]', '[]');
  IF (SELECT calls FROM catalog_insert_calls) <> 1 OR (v_result->>'createdPools')::INTEGER <> 1
    OR NOT EXISTS (SELECT 1 FROM public.pools WHERE pool_id='new_statement_test') THEN
    RAISE EXCEPTION 'mixed existing/new pool import failed';
  END IF;

  UPDATE public.official_import_tasks SET status='confirming' WHERE id=v_task;
  PERFORM public.commit_official_import_records(v_task,v_user,'[]','[]');
  IF (SELECT calls FROM catalog_insert_calls) <> 1 THEN
    RAISE EXCEPTION 'empty pool import fired catalog INSERT trigger';
  END IF;
END;
$test$;
ROLLBACK;
