-- Reverse of 0001_init.sql. Drop in dependency order (children → parents → types).
DROP TABLE IF EXISTS shame_votes;
DROP TABLE IF EXISTS hall_of_shame;
DROP TABLE IF EXISTS forfeits;
DROP TABLE IF EXISTS predictions;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS forfeit_state;
DROP TYPE IF EXISTS proof_kind;
DROP TYPE IF EXISTS match_status;
DROP TYPE IF EXISTS outcome_1x2;
