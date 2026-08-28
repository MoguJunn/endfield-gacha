-- Restrict anonymous/authenticated table reads to configuration that is
-- intentionally rendered by the public frontend. Private operational
-- settings remain available to service-role APIs and super administrators.

DROP POLICY IF EXISTS "site_config_select_all" ON public.site_config;
DROP POLICY IF EXISTS "site_config_select_public" ON public.site_config;

CREATE POLICY "site_config_select_public" ON public.site_config
  FOR SELECT
  USING (
    key IN (
      'site_version',
      'build_info',
      'author_name',
      'author_bilibili',
      'github_url',
      'icp_number',
      'icp_url',
      'police_number',
      'police_url',
      'legal_registration_by_domain',
      'about_disclaimer',
      'home_hero_slogan',
      'qq_group_number',
      'home_next_version_target_at',
      'home_version_timeline',
      'home_roadmap_items',
      'home_friendly_links',
      'about_features',
      'pool_localizations',
      'entity_localizations'
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );
