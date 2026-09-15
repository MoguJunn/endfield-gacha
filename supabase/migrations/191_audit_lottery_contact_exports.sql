BEGIN;

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT constraint_row.conname
  INTO v_constraint_name
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.summer_lottery_operation_audit'::REGCLASS
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid) LIKE '%operation%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.summer_lottery_operation_audit DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;
END;
$$;

ALTER TABLE public.summer_lottery_operation_audit
  ADD CONSTRAINT summer_lottery_operation_audit_operation_check
  CHECK (operation IN ('prepare', 'draw', 'contact_export'));

COMMENT ON COLUMN public.summer_lottery_operation_audit.operation IS
  '受审计的抽奖操作：prepare、draw，或经明确授权的一次性 contact_export。';

NOTIFY pgrst, 'reload schema';
COMMIT;
