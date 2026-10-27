import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forecastFootball, forecastBasketball, evaluateForecasts, calibrationBins } from './models.js';
import { snapshotSport, getStore } from './store.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
app.use(cors({ origin: (origin, cb) => !origin || !allowedOrigins.length || allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed by CORS')) }));
app.use(express.json({ limit: '100kb' }));
app.use((req, _res, next) => { req.startedAt = Date.now(); next(); });

const cache = new Map();
async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  const value = await loader();
  cache.set(key, { time: Date.now(), value });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.time > 60 * 60 * 1000) cache.delete(k);
  return value;
}
function apiError(message, status = 500, code = 'INTERNAL_ERROR') { const e = new Error(message); e.status = status; e.code = code; return e; }
function dateOnly(date) { return date.toISOString().slice(0, 10); }
function parseDay(value, name) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw apiError(`${name} must be YYYY-MM-DD`, 400, 'INVALID_QUERY');
  return value;
}
function safeInt(value, fallback, min, max) { const n = Number.parseInt(value, 10); if (!Number.isFinite(n) || n < min) return fallback; return Math.min(max, n); }

async function footballGet(path) {
  if (!process.env.FOOTBALL_DATA_API_KEY) throw apiError('Football data is not configured. Add FOOTBALL_DATA_API_KEY to server/.env.', 503, 'PROVIDER_NOT_CONFIGURED');
  return cached(`fd:${path}`, 90_000, async () => {
    const response = await fetch(`https://api.football-data.org/v4${path}`, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 180);
      const status = response.status === 429 ? 429 : response.status === 403 ? 403 : response.status >= 500 ? 502 : response.status;
      throw apiError(`football-data.org returned ${response.status}${body ? `: ${body}` : ''}`, status, 'FOOTBALL_PROVIDER_ERROR');
    }
    return response.json();
  });
}
function mapFootballMatch(m) {
  return {
    id: m.id, utcDate: m.utcDate, status: m.status, matchday: m.matchday,
    competition: m.competition?.name || 'Unknown competition', competitionCode: m.competition?.code || null,
    competitionId: m.competition?.id || null, area: m.area?.name || '',
    homeTeam: { id: m.homeTeam?.id, name: m.homeTeam?.name || 'Home team', crest: m.homeTeam?.crest || null },
    awayTeam: { id: m.awayTeam?.id, name: m.awayTeam?.name || 'Away team', crest: m.awayTeam?.crest || null },
    homeScore: m.score?.fullTime?.home ?? null, awayScore: m.score?.fullTime?.away ?? null,
    halfTime: m.score?.halfTime || null
  };
}
function clientFootballMatch(m) {
  return { ...m, homeTeamName: m.homeTeam?.name, awayTeamName: m.awayTeam?.name, homeCrest: m.homeTeam?.crest, awayCrest: m.awayTeam?.crest, homeScore: m.homeScore, awayScore: m.awayScore };
}

async function basketballGet(path) {
  if (!process.env.BALLDONTLIE_API_KEY) throw apiError('NBA data is not configured. Add BALLDONTLIE_API_KEY to server/.env.', 503, 'PROVIDER_NOT_CONFIGURED');
  return cached(`bdl:${path}`, 90_000, async () => {
    const response = await fetch(`https://api.balldontlie.io${path}`, { headers: { Authorization: process.env.BALLDONTLIE_API_KEY }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 180);
      const status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 403 : response.status >= 500 ? 502 : response.status;
      throw apiError(`BALLDONTLIE returned ${response.status}${body ? `: ${body}` : ''}`, status, 'BASKETBALL_PROVIDER_ERROR');
    }
    return response.json();
  });
}
function mapBasketballGame(g) {
  return { id: g.id, date: g.date, status: g.status, season: g.season, postseason: Boolean(g.postseason), home_team: g.home_team, visitor_team: g.visitor_team, home_team_score: Number.isFinite(g.home_team_score) ? g.home_team_score : null, visitor_team_score: Number.isFinite(g.visitor_team_score) ? g.visitor_team_score : null };
}

app.get('/api/health', async (_req, res) => {
  const store = await getStore();
  res.json({ ok: true, service: 'matchlab-api', timestamp: new Date().toISOString(), providers: { football: Boolean(process.env.FOOTBALL_DATA_API_KEY), basketball: Boolean(process.env.BALLDONTLIE_API_KEY) }, store: { updatedAt: store.updatedAt, footballMatches: store.footballMatches.length, basketballGames: store.basketballGames.length } });
});
app.get('/api/config', (_req, res) => res.json({ sports: { football: { configured: Boolean(process.env.FOOTBALL_DATA_API_KEY), provider: 'football-data.org' }, basketball: { configured: Boolean(process.env.BALLDONTLIE_API_KEY), provider: 'BALLDONTLIE NBA' } }, features: ['fixtures', 'recent-form', 'score-distributions', 'historical-backtesting', 'calibration', 'persistent-snapshots'] }));

app.get('/api/football/competitions', async (_req, res, next) => {
  try {
    const data = await footballGet('/competitions');
    res.json({ competitions: (data.competitions || []).map(c => ({ id: c.id, name: c.name, code: c.code, area: c.area?.name, emblem: c.emblem, plan: c.plan, currentSeason: c.currentSeason?.startDate })) });
  } catch (e) { next(e); }
});
app.get('/api/football/matches', async (req, res, next) => {
  try {
    const now = new Date();
    const from = parseDay(req.query.dateFrom, 'dateFrom') || dateOnly(new Date(now.getTime() - 7 * 86400000));
    const to = parseDay(req.query.dateTo, 'dateTo') || dateOnly(new Date(now.getTime() + 14 * 86400000));
    if (from > to) throw apiError('dateFrom must be on or before dateTo', 400, 'INVALID_QUERY');
    const competition = req.query.competition ? String(req.query.competition).slice(0, 12) : '';
    const status = req.query.status ? String(req.query.status).toUpperCase() : '';
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (status && ['SCHEDULED', 'LIVE', 'IN_PLAY', 'PAUSED', 'FINISHED', 'POSTPONED', 'CANCELLED'].includes(status)) params.set('status', status);
    const path = `${competition ? `/competitions/${encodeURIComponent(competition)}` : ''}/matches?${params}`;
    const data = await footballGet(path);
    const matches = (data.matches || []).map(mapFootballMatch);
    await snapshotSport('football', matches);
    res.json({ matches: matches.map(clientFootballMatch), count: matches.length, dateFrom: from, dateTo: to, provider: 'football-data.org' });
  } catch (e) { next(e); }
});
app.get('/api/football/history', async (req, res, next) => {
  try {
    const days = safeInt(req.query.days, 180, 14, 730);
    const to = new Date(); const from = new Date(to.getTime() - days * 86400000);
    const params = new URLSearchParams({ dateFrom: dateOnly(from), dateTo: dateOnly(to), status: 'FINISHED' });
    if (req.query.competition) params.set('competitions', String(req.query.competition).slice(0, 12));
    const data = await footballGet(`/matches?${params}`);
    const matches = (data.matches || []).map(mapFootballMatch).filter(m => Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore));
    const stored = await snapshotSport('football', matches);
    res.json({ matches: matches.map(clientFootballMatch), count: matches.length, days, stored, provider: 'football-data.org' });
  } catch (e) { next(e); }
});
app.get('/api/football/forecast/:matchId', async (req, res, next) => {
  try {
    const matchId = safeInt(req.params.matchId, 0, 1, 2_000_000_000);
    if (!matchId) throw apiError('Invalid match ID', 400, 'INVALID_QUERY');
    const matchData = await footballGet(`/matches/${matchId}`);
    const m = mapFootballMatch(matchData);
    const from = dateOnly(new Date(new Date(m.utcDate).getTime() - 180 * 86400000));
    const to = dateOnly(new Date(new Date(m.utcDate).getTime() - 86400000));
    let history = [];
    try {
      const params = new URLSearchParams({ dateFrom: from, dateTo: to, status: 'FINISHED' });
      if (m.competitionCode) params.set('competitions', m.competitionCode);
      const result = await footballGet(`/matches?${params}`);
      history = (result.matches || []).map(mapFootballMatch);
      await snapshotSport('football', history);
    } catch (historyError) {
      const store = await getStore(); history = store.footballMatches;
      if (!history.length) throw historyError;
    }
    const forecast = forecastFootball(m, history);
    res.json({ match: { id: m.id, utcDate: m.utcDate, competition: m.competition, homeTeam: m.homeTeam.name, awayTeam: m.awayTeam.name }, forecast, provider: 'football-data.org' });
  } catch (e) { next(e); }
});

app.get('/api/basketball/teams', async (_req, res, next) => {
  try {
    const data = await basketballGet('/nba/v1/teams');
    res.json({ teams: data.data || [], meta: data.meta || {}, provider: 'BALLDONTLIE' });
  } catch (e) { next(e); }
});
app.get('/api/basketball/games', async (req, res, next) => {
  try {
    const now = new Date();
    const from = parseDay(req.query.dateFrom, 'dateFrom') || dateOnly(new Date(now.getTime() - 7 * 86400000));
    const to = parseDay(req.query.dateTo, 'dateTo') || dateOnly(new Date(now.getTime() + 14 * 86400000));
    if (from > to) throw apiError('dateFrom must be on or before dateTo', 400, 'INVALID_QUERY');
    const params = new URLSearchParams({ 'start_date': from, 'end_date': to, per_page: String(safeInt(req.query.perPage, 100, 1, 100)) });
    if (req.query.season) params.set('seasons[]', String(safeInt(req.query.season, new Date().getFullYear(), 1946, 2100)));
    if (req.query.teamId) params.set('team_ids[]', String(safeInt(req.query.teamId, 0, 1, 10000)));
    const data = await basketballGet(`/nba/v1/games?${params}`);
    const games = (data.data || []).map(mapBasketballGame);
    await snapshotSport('basketball', games);
    res.json({ games, count: games.length, meta: data.meta || {}, dateFrom: from, dateTo: to, provider: 'BALLDONTLIE NBA' });
  } catch (e) { next(e); }
});
app.get('/api/basketball/history', async (req, res, next) => {
  try {
    const season = safeInt(req.query.season, new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0), 1946, 2100);
    const params = new URLSearchParams({ 'seasons[]': String(season), per_page: '100' });
    if (req.query.teamId) params.set('team_ids[]', String(safeInt(req.query.teamId, 0, 1, 10000)));
    let data = await basketballGet(`/nba/v1/games?${params}`);
    const allGames = [...(data.data || [])];
    let cursor = data.meta?.next_cursor;
    let pages = 1;
    // Keep the historical import bounded to limit provider usage; the cursor is supplied by the API.
    while (cursor && pages < 5) {
      const nextParams = new URLSearchParams(params);
      nextParams.set('cursor', String(cursor));
      data = await basketballGet(`/nba/v1/games?${nextParams}`);
      allGames.push(...(data.data || []));
      cursor = data.meta?.next_cursor;
      pages++;
    }
    const games = allGames.map(mapBasketballGame).filter(g => Number.isFinite(g.home_team_score) && Number.isFinite(g.visitor_team_score));
    const stored = await snapshotSport('basketball', games);
    res.json({ games, count: games.length, season, pagesFetched: pages, moreAvailable: Boolean(cursor), stored, meta: data.meta || {}, provider: 'BALLDONTLIE NBA' });
  } catch (e) { next(e); }
});
app.get('/api/basketball/forecast/:gameId', async (req, res, next) => {
  try {
    const id = safeInt(req.params.gameId, 0, 1, 2_000_000_000);
    if (!id) throw apiError('Invalid game ID', 400, 'INVALID_QUERY');
    const data = await basketballGet(`/nba/v1/games/${id}`);
    const game = mapBasketballGame(data.data || data);
    const params = new URLSearchParams({ 'seasons[]': String(game.season), per_page: '100' });
    params.append('team_ids[]', String(game.home_team.id)); params.append('team_ids[]', String(game.visitor_team.id));
    const historyData = await basketballGet(`/nba/v1/games?${params}`);
    const history = (historyData.data || []).map(mapBasketballGame);
    await snapshotSport('basketball', history);
    res.json({ game, forecast: forecastBasketball(game, history), provider: 'BALLDONTLIE NBA' });
  } catch (e) { next(e); }
});

app.post('/api/analytics/sync', async (req, res, next) => {
  try {
    const sport = req.body?.sport;
    if (!['football', 'basketball'].includes(sport)) throw apiError('sport must be football or basketball', 400, 'INVALID_BODY');
    const store = await getStore();
    res.json({ sport, storedMatches: sport === 'football' ? store.footballMatches.length : store.basketballGames.length, updatedAt: store.updatedAt, message: 'Provider requests automatically snapshot returned records. Use the history endpoint to ingest a historical window.' });
  } catch (e) { next(e); }
});
app.get('/api/analytics/backtest', async (req, res, next) => {
  try {
    const sport = req.query.sport === 'basketball' ? 'basketball' : 'football';
    const store = await getStore();
    const source = sport === 'football' ? store.footballMatches : store.basketballGames;
    const matches = source.filter(m => Number.isFinite(sport === 'football' ? m.homeScore : m.home_team_score) && Number.isFinite(sport === 'football' ? m.awayScore : m.visitor_team_score)).sort((a, b) => new Date(a.utcDate || a.date) - new Date(b.utcDate || b.date));
    const rows = [];
    for (const m of matches) {
      const prediction = sport === 'football' ? forecastFootball(m, matches) : forecastBasketball(m, matches);
      if (sport === 'football') {
        const outcome = m.homeScore > m.awayScore ? 0 : m.homeScore === m.awayScore ? 1 : 2;
        rows.push({ probabilities: [prediction.probabilities.homeWin, prediction.probabilities.draw, prediction.probabilities.awayWin], actual: [outcome === 0, outcome === 1, outcome === 2], date: m.utcDate, label: `${m.homeTeam?.name || 'Home'} v ${m.awayTeam?.name || 'Away'}` });
      } else {
        const outcome = m.home_team_score > m.visitor_team_score ? 0 : 1;
        rows.push({ probabilities: [prediction.probabilities.homeWin, prediction.probabilities.awayWin], actual: [outcome === 0, outcome === 1], date: m.date, label: `${m.home_team?.full_name || m.home_team?.name || 'Home'} v ${m.visitor_team?.full_name || m.visitor_team?.name || 'Away'}` });
      }
    }
    const metrics = evaluateForecasts(rows);
    res.json({ sport, model: sport === 'football' ? 'Recent-form Poisson baseline' : 'Recent-form score baseline', metrics, calibration: calibrationBins(rows), sample: rows.slice(-20).reverse().map(r => ({ date: r.date, label: r.label, predicted: r.probabilities, actual: r.actual })), store: { updatedAt: store.updatedAt, storedRecords: source.length }, caveats: ['This first version is a diagnostic backtest over locally stored provider records.', 'Predictions use date-filtered team history, but the stored sample may be incomplete or limited by your provider plan.', 'Compare results across multiple seasons before drawing conclusions.'] });
  } catch (e) { next(e); }
});
app.get('/api/analytics/summary', async (_req, res) => {
  const store = await getStore();
  res.json({ updatedAt: store.updatedAt, football: { total: store.footballMatches.length, completed: store.footballMatches.filter(m => m.status === 'FINISHED' && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore)).length }, basketball: { total: store.basketballGames.length, completed: store.basketballGames.filter(g => Number.isFinite(g.home_team_score) && Number.isFinite(g.visitor_team_score)).length } });
});

// Optional single-origin production deployment (used by the Docker image).
if (process.env.SERVE_CLIENT === 'true') {
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDist = resolve(here, '../../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(resolve(clientDist, 'index.html'));
    });
  }
}
app.use((req, res, _next) => { if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found', code: 'NOT_FOUND' }); res.status(404).send('Not found'); });

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(`[api] ${err.code || 'ERROR'}: ${err.message}`);
  res.status(status).json({ error: err.message || 'Unexpected server error', code: err.code || 'INTERNAL_ERROR' });
});
app.listen(PORT, () => console.log(`MatchLab API listening on http://localhost:${PORT}`));
