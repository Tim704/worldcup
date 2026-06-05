/**
 * PredictView.tsx
 * ----------------------------------------------------------------------------
 * The "Predict" tab (CONTRACT §7).
 *
 * This view is a thin wrapper around the EXISTING, preserved
 * components/MatchPredictionCenter.tsx — that component is the full-featured,
 * self-styled prediction experience and must NOT be rewritten. We simply mount
 * it here so the bottom-tab router can route to it.
 *
 * MatchPredictionCenter is fully self-contained (it injects its own styles and
 * fonts), so this wrapper adds nothing but the route boundary.
 * ----------------------------------------------------------------------------
 */

import type React from 'react';
import MatchPredictionCenter from '../components/MatchPredictionCenter';

export default function PredictView(): React.ReactElement {
  return <MatchPredictionCenter />;
}
