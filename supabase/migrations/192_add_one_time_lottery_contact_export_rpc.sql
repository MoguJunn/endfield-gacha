BEGIN;

CREATE OR REPLACE FUNCTION public.export_summer_lottery_contacts_once(
  p_campaign_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_campaign public.summer_lottery_campaigns%ROWTYPE;
  v_actor_user_id UUID;
  v_super_admin_count INTEGER;
  v_entry_count INTEGER;
  v_contacts JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT campaign_row.*
  INTO v_campaign
  FROM public.summer_lottery_campaigns AS campaign_row
  WHERE campaign_row.id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;
  IF v_campaign.contacts_cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'contacts_already_cleared';
  END IF;
  IF v_campaign.contact_retention_until <= NOW() THEN
    RAISE EXCEPTION 'contact_retention_expired';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.summer_lottery_operation_audit AS audit_row
    WHERE audit_row.campaign_id = p_campaign_id
      AND audit_row.operation = 'contact_export'
  ) THEN
    RAISE EXCEPTION 'contact_export_already_completed';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_super_admin_count
  FROM public.profiles AS profile_row
  WHERE profile_row.role = 'super_admin';

  IF v_super_admin_count <> 1 THEN
    RAISE EXCEPTION 'super_admin_ambiguity';
  END IF;

  SELECT profile_row.id
  INTO STRICT v_actor_user_id
  FROM public.profiles AS profile_row
  WHERE profile_row.role = 'super_admin';

  SELECT COUNT(*)::INTEGER
  INTO v_entry_count
  FROM public.summer_lottery_entries AS entry_row
  WHERE entry_row.campaign_id = p_campaign_id;

  IF v_entry_count > 1000 THEN
    RAISE EXCEPTION 'lottery_export_entry_limit';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'lotteryNumber', 'P3R26-' || lpad(entry_row.entry_number::TEXT, 6, '0'),
        'entryNumber', entry_row.entry_number,
        'contactType', entry_row.contact_type,
        'encryptedContact', entry_row.contact_value,
        'notificationConfirmedAt', entry_row.notification_confirmed_at,
        'eligible', entry_row.eligible,
        'prizeTier', winner_row.prize_tier,
        'winnerOrder', winner_row.winner_order,
        'claimStatus', winner_row.claim_status,
        'enteredAt', entry_row.created_at
      )
      ORDER BY entry_row.entry_number
    ),
    '[]'::JSONB
  )
  INTO v_contacts
  FROM public.summer_lottery_entries AS entry_row
  LEFT JOIN public.summer_lottery_winners AS winner_row
    ON winner_row.campaign_id = entry_row.campaign_id
   AND winner_row.entry_id = entry_row.id
  WHERE entry_row.campaign_id = p_campaign_id;

  INSERT INTO public.summer_lottery_operation_audit (
    campaign_id,
    actor_user_id,
    operation
  ) VALUES (
    p_campaign_id,
    v_actor_user_id,
    'contact_export'
  );

  RETURN jsonb_build_object(
    'campaignId', p_campaign_id,
    'contacts', v_contacts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.export_summer_lottery_contacts_once(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_summer_lottery_contacts_once(TEXT)
  TO service_role;

COMMENT ON FUNCTION public.export_summer_lottery_contacts_once(TEXT) IS
  '一次性导出活动报名联系方式密文，并在同一事务写入不可变 contact_export 审计。';

NOTIFY pgrst, 'reload schema';
COMMIT;
