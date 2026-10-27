import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Moon, Sun, Trophy, CalendarDays, RefreshCw, CircleHelp, ChartNoAxesCombined, Dribbble, Goal, Database, Gauge, History, ChevronDown, Search, CheckCircle2, AlertTriangle, Layers3 } from 'lucide-react';
import './styles.css';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
const num = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const dateInput = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const defaultRange = () => ({ from: dateInput(new Date(Date.now() - 10 * 86400000)), to: dateInput(new Date()) });

async function api(path, options) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function App() {
  const [sport, setSport] = useState('football');
  const [theme, setTheme] = useState(() => window.localStorage.getItem('matchlab-theme') || 'light');
  const [view, setView] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [competition, setCompetition] = useState('all');
  const [selected, setSelected] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [backtest, setBacktest] = useState(null);
  const [summary, setSummary] = useState(null);
  const [config, setConfig] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [query, setQuery] = useState('');
  const [dateMode, setDateMode] = useState('all');
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('matchlab-theme', theme); }, [theme]);

  const loadConfig = useCallback(async () => {
    try { const [c, s] = await Promise.all([api('/api/config'), api('/api/analytics/summary')]); setConfig(c); setSummary(s); }
    catch (e) { setError(`API unavailable: ${e.message}. Start the backend and check its URL.`); }
  }, []);

  const loadMatches = useCallback(async () => {
    setBusy(true); setError(''); setMessage(''); setSelected(null); setForecast(null);
    try {
      if (sport === 'football') {
        const [compData, matchData] = await Promise.all([
          api('/api/football/competitions'),
          api(`/api/football/matches?dateFrom=${range.from}&dateTo=${range.to}${competition !== 'all' ? `&competition=${encodeURIComponent(competition)}` : ''}`)
        ]);
        setCompetitions(compData.competitions || []); setMatches(matchData.matches || []);
      } else {
        const matchData = await api(`/api/basketball/games?dateFrom=${range.from}&dateTo=${range.to}`);
        setCompetitions([]); setMatches(matchData.games || []);
      }
      const s = await api('/api/analytics/summary'); setSummary(s);
    } catch (e) { setMatches([]); setError(e.message); }
    finally { setBusy(false); }
  }, [sport, range.from, range.to, competition]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { loadMatches(); }, [sport]);

  const loadHistorical = async () => {
    setHistoryBusy(true); setError(''); setMessage('');
    try {
      if (sport === 'football') {
        const days = Math.max(14, Math.min(730, Math.ceil((Date.now() - new Date(`${range.from}T00:00:00`).getTime()) / 86400000)));
        const result = await api(`/api/football/history?days=${days}${competition !== 'all' ? `&competition=${encodeURIComponent(competition)}` : ''}`);
        setMessage(`Imported ${result.count} completed football matches; ${result.stored.total} records are stored locally.`);
      } else {
        const season = Number(range.from.slice(0, 4)) - (Number(range.from.slice(5, 7)) < 10 ? 1 : 0);
        const result = await api(`/api/basketball/history?season=${season}`);
        setMessage(`Imported ${result.count} completed NBA games for season ${result.season}; ${result.stored.total} records are stored locally.`);
      }
      const s = await api('/api/analytics/summary'); setSummary(s);
    } catch (e) { setError(e.message); }
    finally { setHistoryBusy(false); }
  };

  const runBacktest = async () => {
    setBacktestBusy(true); setError('');
    try { setBacktest(await api(`/api/analytics/backtest?sport=${sport}`)); setView('evaluation'); }
    catch (e) { setError(e.message); }
    finally { setBacktestBusy(false); }
  };

  const chooseMatch = async match => {
    setSelected(match); setForecast(null); setError('');
    try {
      const data = sport === 'football'
        ? await api(`/api/football/forecast/${match.id}`)
        : await api(`/api/basketball/forecast/${match.id}`);
      setForecast(data.forecast);
    } catch (e) { setError(e.message); }
  };

  const compOptions = useMemo(() => competitions.filter(c => c.name && (c.code || c.id)).sort((a, b) => a.name.localeCompare(b.name)), [competitions]);
  const filtered = useMemo(() => matches.filter(m => {
    const home = sport === 'football' ? (m.homeTeamName || m.homeTeam?.name) : (m.home_team?.full_name || m.home_team?.name);
    const away = sport === 'football' ? (m.awayTeamName || m.awayTeam?.name) : (m.visitor_team?.full_name || m.visitor_team?.name);
    const league = m.competition || (sport === 'basketball' ? 'NBA' : '');
    const searchOk = `${home || ''} ${away || ''} ${league} ${m.area || ''}`.toLowerCase().includes(query.toLowerCase());
    const date = new Date(m.utcDate || m.date).getTime();
    const dateOk = dateMode === 'all' || (dateMode === 'upcoming' ? date >= Date.now() - 2 * 3600000 : date < Date.now());
    return searchOk && dateOk;
  }).sort((a, b) => new Date(a.utcDate || a.date) - new Date(b.utcDate || b.date)), [matches, query, dateMode, sport]);

  const providerConfigured = sport === 'football' ? config?.sports?.football?.configured : config?.sports?.basketball?.configured;
  const completed = sport === 'football' ? summary?.football?.completed : summary?.basketball?.completed;
  const stored = sport === 'football' ? summary?.football?.total : summary?.basketball?.total;
  const homeName = match => sport === 'football' ? (match.homeTeamName || match.homeTeam?.name) : (match.home_team?.full_name || match.home_team?.name);
  const awayName = match => sport === 'football' ? (match.awayTeamName || match.awayTeam?.name) : (match.visitor_team?.full_name || match.visitor_team?.name);
  const matchDate = match => match.utcDate || match.date;
  const scoreHome = match => sport === 'football' ? match.homeScore : match.home_team_score;
  const scoreAway = match => sport === 'football' ? match.awayScore : match.visitor_team_score;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Activity size={21}/></div><span>Match<span className="brand-accent">Lab</span></span><span className="brand-tag">ANALYTICS</span></div>
      <div className="side-label">WORKSPACE</div>
      <button className={`nav-item ${view === 'matches' ? 'active' : ''}`} onClick={() => setView('matches')}><ChartNoAxesCombined size={18}/> Match centre</button>
      <button className={`nav-item ${view === 'evaluation' ? 'active' : ''}`} onClick={() => setView('evaluation')}><Gauge size={18}/> Model evaluation</button>
      <button className={`nav-item ${view === 'data' ? 'active' : ''}`} onClick={() => setView('data')}><Database size={18}/> Data sources</button>
      <div className="sidebar-spacer"/>
      <div className="sidebar-status"><div className="status-heading"><span className={`status-dot ${providerConfigured ? 'online' : 'offline'}`}/>{providerConfigured ? 'Provider connected' : 'Provider not configured'}</div><p>{sport === 'football' ? 'football-data.org' : 'BALLDONTLIE · NBA'}</p><p className="side-disclaimer">Statistical research and model evaluation only. Estimates are uncertain and may be incomplete.</p></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="mobile-brand"><Activity size={20}/> MatchLab</div><div className="breadcrumbs">Workspace <span>/</span> <b>{view === 'matches' ? 'Match centre' : view === 'evaluation' ? 'Model evaluation' : 'Data sources'}</b></div><div className="top-actions"><span className="privacy-label"><CheckCircle2 size={14}/> API keys stay server-side</span><button className="icon-btn" aria-label="Toggle light and dark mode" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button><div className="avatar">ML</div></div></header>
      <section className="welcome"><div><div className="eyebrow"><span className="pulse"/> SPORTS DATA WORKSPACE</div><h1>{view === 'matches' ? 'Match centre' : view === 'evaluation' ? 'Model evaluation' : 'Data sources'}</h1><p>{view === 'matches' ? 'Explore match records, recent team form, and transparent score estimates.' : view === 'evaluation' ? 'Measure how well model probabilities align with historical results.' : 'Manage data provider setup and inspect local historical snapshots.'}</p></div><button className="primary-btn" onClick={() => view === 'matches' ? loadMatches() : view === 'evaluation' ? runBacktest() : loadConfig()} disabled={busy || backtestBusy}><RefreshCw size={16} className={busy || backtestBusy ? 'spin' : ''}/> {view === 'matches' ? 'Refresh data' : view === 'evaluation' ? 'Run evaluation' : 'Check status'}</button></section>
      <section className="sport-toolbar"><div><label htmlFor="sport-select">SPORT</label><div className="select-wrap"><select id="sport-select" value={sport} onChange={e => { setSport(e.target.value); setCompetition('all'); setSelected(null); setForecast(null); setBacktest(null); }}><option value="football">⚽ Football</option><option value="basketball">🏀 Basketball · NBA</option></select><ChevronDown size={15}/></div></div><div className="date-fields"><div><label htmlFor="date-from">FROM</label><input id="date-from" type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))}/></div><div><label htmlFor="date-to">TO</label><input id="date-to" type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))}/></div><button className="outline-btn" onClick={loadMatches} disabled={busy}>Apply filters</button></div><div className="toolbar-spacer"/><span className={`provider-pill ${providerConfigured ? 'ready' : ''}`}><span/> {providerConfigured ? 'Provider configured' : 'Needs API key'}</span></section>

      {error && <div className="notice error"><AlertTriangle size={18}/><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
      {message && <div className="notice success"><CheckCircle2 size={18}/><span>{message}</span><button onClick={() => setMessage('')}>Dismiss</button></div>}

      {view === 'matches' && <>
        <section className="stats-grid">
          <div className="stat-card"><div className="stat-top"><span>Records in workspace</span><Database size={17}/></div><strong>{stored ?? '—'}</strong><small>Persisted locally on the API server</small></div>
          <div className="stat-card"><div className="stat-top"><span>Completed results</span><CheckCircle2 size={17}/></div><strong>{completed ?? '—'}</strong><small>With final scores available</small></div>
          <div className="stat-card"><div className="stat-top"><span>Forecast baseline</span><ChartNoAxesCombined size={17}/></div><strong className="stat-word">{sport === 'football' ? 'Poisson' : 'Score model'}</strong><small>{sport === 'football' ? 'Goal-rate distribution' : 'Recent points and margin'}</small></div>
          <div className="stat-card"><div className="stat-top"><span>Data provider</span><Layers3 size={17}/></div><strong className="stat-word">{providerConfigured ? 'Connected' : 'Not set'}</strong><small>{sport === 'football' ? 'football-data.org v4' : 'BALLDONTLIE NBA API'}</small></div>
        </section>
        <div className="content-grid">
          <section className="panel match-panel"><div className="panel-head"><div><h2>{sport === 'football' ? 'Football fixtures & results' : 'NBA games'}</h2><p>{filtered.length} records in selected date range</p></div><span className="live-pill"><i/>{providerConfigured ? 'PROVIDER DATA' : 'API SETUP REQUIRED'}</span></div>
            <div className="filters"><div className="searchbox"><Search size={16}/><input aria-label="Search matches" placeholder="Search teams or competition..." value={query} onChange={e => setQuery(e.target.value)}/></div>{sport === 'football' && <div className="select-wrap filter-select"><select aria-label="Filter competition" value={competition} onChange={e => setCompetition(e.target.value)}><option value="all">All competitions</option>{compOptions.map(c => <option key={c.code || c.id} value={c.code || c.id}>{c.name}</option>)}</select><ChevronDown size={15}/></div>}<div className="segmented"><button className={dateMode === 'all' ? 'chosen' : ''} onClick={() => setDateMode('all')}>All dates</button><button className={dateMode === 'upcoming' ? 'chosen' : ''} onClick={() => setDateMode('upcoming')}>Upcoming</button><button className={dateMode === 'past' ? 'chosen' : ''} onClick={() => setDateMode('past')}>Past</button></div></div>
            {!providerConfigured ? <div className="empty-state"><div className="empty-icon"><CircleHelp size={25}/></div><h3>Connect your data provider</h3><p>Add the appropriate key to <code>server/.env</code>, restart the API, and refresh this page. See the Data sources tab for setup details.</p><button className="outline-btn" onClick={() => setView('data')}>View setup instructions</button></div> : busy ? <div className="empty-state"><RefreshCw className="spin" size={26}/><h3>Loading provider data…</h3><p>Requesting match records for the selected dates.</p></div> : filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Goal size={25}/></div><h3>No records found</h3><p>Try a wider date range, a different competition, or another search term.</p></div> : <div className="match-list">{filtered.slice(0, 80).map(m => <button className={`match-row ${selected?.id === m.id ? 'selected' : ''}`} key={m.id} onClick={() => chooseMatch(m)}><div className="match-date"><b>{new Date(matchDate(m)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</b><span>{new Date(matchDate(m)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div><div className="match-teams"><div><span className="team-dot">{(homeName(m) || 'H').slice(0, 1)}</span><b>{homeName(m) || 'Home team'}</b>{Number.isFinite(scoreHome(m)) && <em>{scoreHome(m)}</em>}</div><div><span className="team-dot">{(awayName(m) || 'A').slice(0, 1)}</span><b>{awayName(m) || 'Away team'}</b>{Number.isFinite(scoreAway(m)) && <em>{scoreAway(m)}</em>}</div></div><div className="match-meta"><span>{m.competition || (sport === 'basketball' ? 'NBA' : 'Competition')}</span><small>{m.status || (Number.isFinite(scoreHome(m)) ? 'Completed' : 'Scheduled')}</small></div><span className="row-chevron">›</span></button>)}</div>}
            {filtered.length > 80 && <div className="list-footer">Showing 80 of {filtered.length} matches.</div>}
          </section>
          <section className="panel analysis-panel"><div className="panel-head"><div><h2>Match analysis</h2><p>Outcome probabilities and model notes</p></div><ChartNoAxesCombined size={19} className="muted-icon"/></div>
            {!selected ? <div className="analysis-empty"><div className="analysis-graphic"><ChartNoAxesCombined size={32}/></div><h3>Select a match</h3><p>Choose a fixture to estimate the score distribution using historical records available to the model.</p></div> : <div className="analysis-body"><div className="selected-match"><span>{selected.competition || (sport === 'basketball' ? 'NBA' : 'Selected fixture')}</span><h3>{homeName(selected)}</h3><div className="versus">VS</div><h3>{awayName(selected)}</h3><small>{new Date(matchDate(selected)).toLocaleString()}</small></div>
              {!forecast ? <div className="analysis-empty compact"><RefreshCw className={busy ? 'spin' : ''} size={24}/><h3>Loading estimate…</h3><p>Calculating from available historical matches.</p></div> : <><div className="section-label">ESTIMATED MATCH OUTCOME</div>{[['Home win', forecast.probabilities?.homeWin], ...(sport === 'football' ? [['Draw', forecast.probabilities?.draw]] : []), ['Away win', forecast.probabilities?.awayWin]].map(([label, value]) => <div className="prob-row" key={label}><div><span>{label}</span><b>{pct(value)}</b></div><div className="progress"><i style={{ width: `${Math.max(0, Math.min(100, (value || 0) * 100))}%` }}/></div></div>)}<div className="confidence-row"><span>Sample indicator</span><b>{forecast.confidence || 'Not available'}</b></div><div className="score-estimate"><div><span>Expected {sport === 'football' ? 'goals' : 'points'} · home</span><b>{forecast.expectedScore?.home ?? '—'}</b></div><div><span>Expected {sport === 'football' ? 'goals' : 'points'} · away</span><b>{forecast.expectedScore?.away ?? '—'}</b></div><div><span>Combined total</span><b>{forecast.expectedScore?.total ?? '—'}</b></div></div>{sport === 'football' && forecast.goalTotals && <><div className="section-label">GOAL-TOTAL DISTRIBUTION</div><p className="muted-copy">Model-estimated probability of total match goals relative to each line.</p><div className="table-wrap"><table><thead><tr><th>Total goals</th><th>Over</th><th>Under</th></tr></thead><tbody>{forecast.goalTotals.map(row => <tr key={row.line}><td>{row.line}</td><td>{pct(row.over)}</td><td>{pct(row.under)}</td></tr>)}</tbody></table></div><p className="muted-copy">Corners and shots are not estimated because the configured football provider does not supply those statistics consistently for this fixture.</p></>}{sport === 'basketball' && forecast.totalPointsDistribution && <><div className="section-label">TOTAL-POINTS DISTRIBUTION</div><p className="muted-copy">Model-estimated distribution around projected combined points.</p><div className="table-wrap"><table><thead><tr><th>Total points line</th><th>Over</th><th>Under</th></tr></thead><tbody>{forecast.totalPointsDistribution.map(row => <tr key={row.line}><td>{row.line}</td><td>{pct(row.over)}</td><td>{pct(row.under)}</td></tr>)}</tbody></table></div></>}<div className="model-note"><b>{forecast.model}</b><p>These are model estimates, not guarantees. Review the sample size and historical evaluation before interpreting them.</p></div><div className="section-label">MODEL NOTES</div><ul className="caveats">{(forecast.notes || []).map(note => <li key={note}>{note}</li>)}</ul></>}
            </div>}
          </section>
        </div>
        <section className="history-callout"><div className="callout-icon"><History size={20}/></div><div><h3>Build a useful evaluation sample</h3><p>Import completed historical records, then inspect accuracy, Brier score, log loss, and probability calibration.</p></div><button className="outline-btn" onClick={loadHistorical} disabled={historyBusy || !providerConfigured}>{historyBusy ? 'Importing…' : 'Import historical data'}</button><button className="primary-btn" onClick={runBacktest} disabled={backtestBusy}>{backtestBusy ? 'Evaluating…' : 'Evaluate model'}</button></section>
      </>}

      {view === 'evaluation' && <section className="evaluation-layout"><div className="panel evaluation-panel"><div className="panel-head"><div><h2>Historical model evaluation</h2><p>Run diagnostics on completed records stored by this server.</p></div><button className="primary-btn" onClick={runBacktest} disabled={backtestBusy}>{backtestBusy ? 'Running…' : 'Run backtest'}</button></div>{!backtest ? <div className="empty-state"><div className="empty-icon"><Gauge size={25}/></div><h3>No evaluation run yet</h3><p>First import historical completed matches from the Match centre, then run the backtest.</p><button className="outline-btn" onClick={() => setView('matches')}>Go to Match centre</button></div> : <><div className="evaluation-meta"><span><b>Sport:</b> {backtest.sport}</span><span><b>Model:</b> {backtest.model}</span><span><b>Evaluated records:</b> {backtest.metrics.evaluated}</span></div><div className="metric-grid"><div className="metric-card"><span>Top-class accuracy</span><strong>{pct(backtest.metrics.accuracy)}</strong><small>Share of most likely classes matching outcomes</small></div><div className="metric-card"><span>Brier score</span><strong>{num(backtest.metrics.brierScore)}</strong><small>Lower is better; 0 is perfect</small></div><div className="metric-card"><span>Log loss</span><strong>{num(backtest.metrics.logLoss)}</strong><small>Lower is better; penalizes overconfident errors</small></div></div><p className="evaluation-message">{backtest.metrics.message}</p><div className="section-label">PROBABILITY CALIBRATION</div><p className="muted-copy">For each bin, compare the average predicted probability with the observed outcome rate. A well-calibrated model should have similar values.</p><div className="table-wrap"><table><thead><tr><th>Probability bin</th><th>Observations</th><th>Mean predicted</th><th>Observed rate</th></tr></thead><tbody>{backtest.calibration.map(row => <tr key={row.range}><td>{row.range}</td><td>{row.count}</td><td>{pct(row.meanPredicted)}</td><td>{pct(row.observedRate)}</td></tr>)}</tbody></table></div><div className="section-label recent-title">RECENT EVALUATION RECORDS</div><div className="table-wrap"><table><thead><tr><th>Date</th><th>Match</th><th>Predicted probabilities</th><th>Actual result</th></tr></thead><tbody>{backtest.sample.map((row, i) => <tr key={`${row.date}-${i}`}><td>{row.date ? new Date(row.date).toLocaleDateString() : '—'}</td><td>{row.label}</td><td>{row.predicted.map((v, j) => <span className="prob-chip" key={j}>{pct(v)}</span>)}</td><td>{row.actual.map((v, j) => v ? `Class ${j + 1}` : null).filter(Boolean).join(', ')}</td></tr>)}</tbody></table></div><ul className="caveats evaluation-caveats">{backtest.caveats.map(c => <li key={c}>{c}</li>)}</ul></>}</div></section>}

      {view === 'data' && <section className="data-layout"><div className="panel data-panel"><div className="panel-head"><div><h2>Provider setup</h2><p>Configure credentials on the server, not in browser code.</p></div><Database size={20} className="muted-icon"/></div><div className="provider-card"><div className="provider-icon football-icon"><Goal size={22}/></div><div className="provider-copy"><h3>Football · football-data.org</h3><p>Competition lists, fixtures, completed results, and match scores. Available competitions depend on your provider plan.</p><a href="https://www.football-data.org/documentation/quickstart" target="_blank" rel="noreferrer">Open official documentation ↗</a><code>FOOTBALL_DATA_API_KEY=your_key</code></div><span className={`connection-state ${config?.sports?.football?.configured ? 'connected' : ''}`}>{config?.sports?.football?.configured ? 'Configured' : 'Not configured'}</span></div><div className="provider-card"><div className="provider-icon basketball-icon"><Dribbble size={22}/></div><div className="provider-copy"><h3>Basketball · BALLDONTLIE NBA</h3><p>NBA teams, historical and scheduled games, scores, and season data. Endpoint access and history limits depend on your account tier.</p><a href="https://docs.balldontlie.io/" target="_blank" rel="noreferrer">Open official documentation ↗</a><code>BALLDONTLIE_API_KEY=your_key</code></div><span className={`connection-state ${config?.sports?.basketball?.configured ? 'connected' : ''}`}>{config?.sports?.basketball?.configured ? 'Configured' : 'Not configured'}</span></div><div className="setup-steps"><h3>Setup checklist</h3><ol><li>Copy <code>.env.example</code> to <code>server/.env</code>.</li><li>Paste your provider keys into the matching variables. Do not put secrets in <code>client/.env</code>.</li><li>Restart the API server with <code>npm run dev</code> from the project root.</li><li>Return to Match centre, choose a date range, and import completed historical data.</li><li>Run model evaluation after enough results have been collected.</li></ol></div><div className="storage-summary"><div><span>Last local snapshot</span><b>{summary?.updatedAt ? new Date(summary.updatedAt).toLocaleString() : 'No snapshots yet'}</b></div><div><span>Football records</span><b>{summary?.football?.total ?? 0}</b></div><div><span>NBA records</span><b>{summary?.basketball?.total ?? 0}</b></div></div></div></section>}

      <footer className="footer"><span>© 2026 MatchLab Analytics</span><span>Data coverage depends on provider plan.</span><span>Research tool · No betting integrations</span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
