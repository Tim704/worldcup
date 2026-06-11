-- ============================================================================
-- 0002_bracket_predictions.sql — the Tournament Predictor prophecy (Contract §11).
--
-- One row per user holding their whole-tournament prediction as three JSONB
-- documents. The shape is deliberately document-oriented: the bracket is a
-- single interdependent artefact (changing a group order cascades through the
-- knockout tree), so it is read and rewritten atomically as one unit — a
-- single-statement upsert, never row-per-pick churn.
--
--   group_picks   { "A": ["Mexico", …], … }  — per group letter (A–L), the
--                 user's predicted finishing order; index 0 = group winner.
--   third_picks   [ "A", "C", … ]            — up to 8 group letters whose
--                 3rd-placed team is predicted to take a best-third berth.
--   bracket_picks { "M74": "Mexico", … }     — picked winner per knockout
--                 slot, keyed by FIFA match number (M73–M102, M104; M103 —
--                 the third-place match — is not part of the predictor).
--
-- Validation of letters/slot keys/team-name lengths lives in
-- src/lib/bracketPicks.ts; the DB enforces only the JSONB top-level types.
--
-- Reversible: 0002_bracket_predictions.down.sql drops the table.
-- ============================================================================

CREATE TABLE bracket_predictions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    group_picks   JSONB       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(group_picks) = 'object'),

    third_picks   JSONB       NOT NULL DEFAULT '[]'::jsonb
                  CHECK (jsonb_typeof(third_picks) = 'array'),

    bracket_picks JSONB       NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(bracket_picks) = 'object'),

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One prophecy per user. Doubles as the upsert conflict target AND the
    -- lookup index (UNIQUE creates a btree) — no separate index needed.
    CONSTRAINT bracket_predictions_one_per_user UNIQUE (user_id)
);
