-- Restore the four timestamp hooks omitted from the game-platform baseline.
BEGIN;
CREATE OR REPLACE TRIGGER update_game_currency_wallets_updated_at
  BEFORE UPDATE ON public.game_currency_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_game_leaderboard_entries_updated_at
  BEFORE UPDATE ON public.game_leaderboard_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_game_user_stats_updated_at
  BEFORE UPDATE ON public.game_user_stats
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE TRIGGER update_game_catalog_updated_at
  BEFORE UPDATE ON public.game_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
COMMIT;
