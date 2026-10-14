-- Restore deleted history without assigning database-generated columns.
BEGIN;
DO $$
DECLARE v_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.revert_account_data_revision(uuid,bigint,text,uuid)'::regprocedure)
    INTO v_definition;
  IF position('INSERT INTO public.history SELECT v_history.*;' IN v_definition)=0 THEN
    RAISE EXCEPTION 'revision_restore_definition_changed';
  END IF;
  v_definition := replace(v_definition,'INSERT INTO public.history SELECT v_history.*;',
    'SELECT string_agg(quote_ident(attname), '','' ORDER BY attnum) INTO v_columns FROM pg_attribute
      WHERE attrelid = ''public.history''::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '''';
    EXECUTE format(''INSERT INTO public.history(%s) SELECT %s FROM jsonb_populate_record(NULL::public.history,$1)'',
      v_columns,v_columns) USING to_jsonb(v_history);');
  EXECUTE v_definition;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
