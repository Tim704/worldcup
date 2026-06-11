/**
 * flags.ts — team name → flag emoji for the Tournament Predictor team rows.
 * ----------------------------------------------------------------------------
 * A small static map covering the 48 WC2026 finalists exactly as the
 * football-data.org feed names them (plus the bundled sample-fixture names),
 * with graceful degradation: an unmapped team simply renders without a flag —
 * never a wrong one, never a crash. Keep keys in sync with the feed's display
 * names; this is presentation sugar, not identity (team NAMES remain the only
 * identity everywhere else in the app).
 * ----------------------------------------------------------------------------
 */

const TEAM_FLAGS: Readonly<Record<string, string>> = {
  Algeria: '🇩🇿',
  Argentina: '🇦🇷',
  Australia: '🇦🇺',
  Austria: '🇦🇹',
  Belgium: '🇧🇪',
  'Bosnia-Herzegovina': '🇧🇦',
  Brazil: '🇧🇷',
  Canada: '🇨🇦',
  'Cape Verde Islands': '🇨🇻',
  Colombia: '🇨🇴',
  'Congo DR': '🇨🇩',
  Croatia: '🇭🇷',
  Curaçao: '🇨🇼',
  Czechia: '🇨🇿',
  Ecuador: '🇪🇨',
  Egypt: '🇪🇬',
  England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  France: '🇫🇷',
  Germany: '🇩🇪',
  Ghana: '🇬🇭',
  Haiti: '🇭🇹',
  Iran: '🇮🇷',
  Iraq: '🇮🇶',
  'Ivory Coast': '🇨🇮',
  Japan: '🇯🇵',
  Jordan: '🇯🇴',
  Mexico: '🇲🇽',
  Morocco: '🇲🇦',
  Netherlands: '🇳🇱',
  'New Zealand': '🇳🇿',
  Norway: '🇳🇴',
  Panama: '🇵🇦',
  Paraguay: '🇵🇾',
  Portugal: '🇵🇹',
  Qatar: '🇶🇦',
  'Saudi Arabia': '🇸🇦',
  Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  Senegal: '🇸🇳',
  'South Africa': '🇿🇦',
  'South Korea': '🇰🇷',
  Spain: '🇪🇸',
  Sweden: '🇸🇪',
  Switzerland: '🇨🇭',
  Tunisia: '🇹🇳',
  Turkey: '🇹🇷',
  'United States': '🇺🇸',
  Uruguay: '🇺🇾',
  Uzbekistan: '🇺🇿',
  // Bundled sample fixtures (scripts/fixtures.py) name two extra teams.
  Poland: '🇵🇱',
  Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
};

/** The flag for a team, or null when unmapped (render nothing, never guess). */
export function flagFor(team: string): string | null {
  return TEAM_FLAGS[team] ?? null;
}
