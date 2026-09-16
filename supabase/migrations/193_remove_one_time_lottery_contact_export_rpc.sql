BEGIN;

DROP FUNCTION IF EXISTS public.export_summer_lottery_contacts_once(TEXT);

NOTIFY pgrst, 'reload schema';
COMMIT;
