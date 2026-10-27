export function poisson(lambda, k) {
  if (k < 0 || !Number.isFinite(lambda) || lambda < 0) return 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

export function normalize(values) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  return total > 0 ? values.map(value => Math.max(0, value) / total) : values.map(() => 1 / values.length);
}

export function footballRates(teamId, matches, beforeDate, windowSize = 8) {
  const before = new Date(beforeDate).getTime();
  const rows = matches
    .filter(m => m.status === 'FINISHED' && new Date(m.utcDate).getTime() < before &&
      (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId) &&
      Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore))
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, windowSize);
  if (!rows.length) return { scored: 1.25, conceded: 1.25, n: 0, fallback: true };
  let scored = 0, conceded = 0;
  for (const m of rows) {
    const home = m.homeTeam.id === teamId;
    scored += home ? m.homeScore : m.awayScore;
    conceded += home ? m.awayScore : m.homeScore;
  }
  return { scored: scored / rows.length, conceded: conceded / rows.length, n: rows.length, fallback: false };
}

function poissonCdf(lambda, maxK) {
  let total = 0;
  for (let k = 0; k <= maxK; k++) total += poisson(lambda, k);
  return Math.max(0, Math.min(1, total));
}

function totalLineProbabilities(lambda, lines) {
  return lines.map(line => ({
    line,
    over: Math.max(0, Math.min(1, 1 - poissonCdf(lambda, Math.floor(line)))),
    under: Math.max(0, Math.min(1, poissonCdf(lambda, Math.ceil(line) - 1)))
  }));
}

function normalCdf(x) {
  // Abramowitz–Stegun approximation; adequate for descriptive baseline estimates.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function forecastFootball(match, history) {
  const date = match.utcDate;
  const h = footballRates(match.homeTeam?.id, history, date);
  const a = footballRates(match.awayTeam?.id, history, date);
  const homeLambda = clamp((h.scored + a.conceded) / 2 + 0.12, 0.2, 4.5);
  const awayLambda = clamp((a.scored + h.conceded) / 2, 0.2, 4.5);
  let home = 0, draw = 0, away = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = poisson(homeLambda, i) * poisson(awayLambda, j);
    if (i > j) home += p; else if (i === j) draw += p; else away += p;
  }
  const [pHome, pDraw, pAway] = normalize([home, draw, away]);
  const n = h.n + a.n;
  return {
    sport: 'football', model: 'Recent-form Poisson baseline',
    probabilities: { homeWin: pHome, draw: pDraw, awayWin: pAway },
    expectedScore: { home: Number(homeLambda.toFixed(2)), away: Number(awayLambda.toFixed(2)), total: Number((homeLambda + awayLambda).toFixed(2)) },
    goalTotals: totalLineProbabilities(homeLambda + awayLambda, [1.5, 2.5, 3.5, 4.5]),
    sample: { homeMatches: h.n, awayMatches: a.n, totalTeamMatches: n },
    confidence: n >= 12 ? 'Moderate sample' : n >= 6 ? 'Limited sample' : 'Low sample',
    notes: ['Estimates use only completed matches dated before the fixture.', 'The baseline does not model lineups, injuries, opponent strength, or tactical changes.', ...(h.fallback || a.fallback ? ['A league-neutral fallback rate was used where team history was unavailable.'] : [])]
  };
}

export function forecastBasketball(game, history) {
  const date = new Date(game.date).getTime();
  const teamRows = (teamId) => history.filter(g => new Date(g.date).getTime() < date &&
    (g.home_team?.id === teamId || g.visitor_team?.id === teamId) &&
    Number.isFinite(g.home_team_score) && Number.isFinite(g.visitor_team_score))
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  const averages = (teamId) => {
    const rows = teamRows(teamId);
    if (!rows.length) return { scored: 110, allowed: 110, n: 0 };
    let scored = 0, allowed = 0;
    for (const g of rows) {
      const home = g.home_team?.id === teamId;
      scored += home ? g.home_team_score : g.visitor_team_score;
      allowed += home ? g.visitor_team_score : g.home_team_score;
    }
    return { scored: scored / rows.length, allowed: allowed / rows.length, n: rows.length };
  };
  const h = averages(game.home_team?.id), a = averages(game.visitor_team?.id);
  const homePoints = (h.scored + a.allowed) / 2 + 2.2;
  const awayPoints = (a.scored + h.allowed) / 2;
  const diff = homePoints - awayPoints;
  const sd = 13.5;
  const totalSd = Math.sqrt(Math.max(1, h.n + a.n) > 1 ? 2 * 13.5 * 13.5 : 13.5 * 13.5);
  const pHome = 1 / (1 + Math.exp(-1.702 * diff / sd));
  return {
    sport: 'basketball', model: 'Recent-form score baseline',
    probabilities: { homeWin: pHome, awayWin: 1 - pHome },
    expectedScore: { home: Number(homePoints.toFixed(1)), away: Number(awayPoints.toFixed(1)), total: Number((homePoints + awayPoints).toFixed(1)), margin: Number(diff.toFixed(1)) },
    totalPointsDistribution: [180, 190, 200, 210, 220, 230, 240].map(line => ({ line, over: 1 - normalCdf((line - (homePoints + awayPoints)) / totalSd), under: normalCdf((line - (homePoints + awayPoints)) / totalSd) })),
    sample: { homeMatches: h.n, awayMatches: a.n, totalTeamMatches: h.n + a.n },
    confidence: h.n + a.n >= 16 ? 'Moderate sample' : h.n + a.n >= 8 ? 'Limited sample' : 'Low sample',
    notes: ['Uses each team’s recent completed games before the selected game.', 'No player availability, rest, travel, or lineup adjustments are included.']
  };
}

export function evaluateForecasts(rows) {
  const valid = rows.filter(r => Array.isArray(r.probabilities) && r.probabilities.length === r.actual.length && r.actual.some(Boolean));
  if (!valid.length) return { evaluated: 0, accuracy: null, brierScore: null, logLoss: null, message: 'Not enough valid historical observations to evaluate the model.' };
  let correct = 0, brier = 0, logLoss = 0;
  for (const row of valid) {
    const pred = row.probabilities;
    const predictedIndex = pred.indexOf(Math.max(...pred));
    const actualIndex = row.actual.indexOf(true);
    if (predictedIndex === actualIndex) correct++;
    pred.forEach((p, i) => { brier += (p - (row.actual[i] ? 1 : 0)) ** 2; });
    logLoss -= Math.log(Math.max(1e-12, pred[actualIndex]));
  }
  const count = valid.length;
  return { evaluated: count, accuracy: correct / count, brierScore: brier / count, logLoss: logLoss / count, message: 'Metrics are computed on the returned historical sample; small or selective samples can be misleading.' };
}

export function calibrationBins(rows, bins = 5) {
  const groups = Array.from({ length: bins }, (_, i) => ({ range: `${Math.round(i / bins * 100)}–${Math.round((i + 1) / bins * 100)}%`, count: 0, predicted: 0, observed: 0 }));
  for (const row of rows) {
    row.probabilities.forEach((p, i) => {
      const index = Math.min(bins - 1, Math.floor(p * bins));
      groups[index].count++;
      groups[index].predicted += p;
      groups[index].observed += row.actual[i] ? 1 : 0;
    });
  }
  return groups.map(g => ({ ...g, meanPredicted: g.count ? g.predicted / g.count : null, observedRate: g.count ? g.observed / g.count : null }));
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
