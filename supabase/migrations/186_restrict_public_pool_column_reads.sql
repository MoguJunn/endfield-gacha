-- Public clients must use the visible-pools RPC or explicitly select this
-- safe column set. Pool ownership UUIDs remain available only to trusted
-- server/service-role paths and are not part of the browser REST contract.

REVOKE SELECT ON TABLE public.pools FROM anon, authenticated;

GRANT SELECT (
  pool_id,
  name,
  name_en,
  type,
  extra_subtype,
  extra_rule_profile,
  extra_series_key,
  extra_series_phase,
  locked,
  is_limited_weapon,
  created_at,
  updated_at,
  up_character,
  description,
  banner_url,
  start_time,
  end_time,
  featured_characters
) ON TABLE public.pools TO anon, authenticated;
