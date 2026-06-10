-- ============================================================================
-- 0001_init.down.sql — reverses 0001_init.sql (Contract §3).
--
-- Drop order matters only loosely thanks to CASCADE, but we go strictly
-- bottom-up anyway: tables first (wagers/predictions reference matches/users;
-- matches.lock_at depends on calc_lock_time), then the function, then the
-- enum types. The pgcrypto extension is deliberately LEFT IN PLACE — it is a
-- shared, harmless cluster resource and the contract says so explicitly.
-- The schema_migrations bookkeeping table belongs to src/migrate.ts and is
-- not touched here.
-- ============================================================================

DROP TABLE IF EXISTS wagers, predictions, matches, users CASCADE;
DROP FUNCTION IF EXISTS calc_lock_time(TIMESTAMPTZ);
DROP TYPE IF EXISTS wager_pick, wager_state, match_status CASCADE;
