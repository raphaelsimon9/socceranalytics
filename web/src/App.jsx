import { useEffect, useMemo, useState } from "react";
import Results from "./Results.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function api(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch { /* not json */ } throw new Error(m); }
  return r.json();
}

/* ───────── small pieces ───────── */
function Conf({ c }) {
  if (!c) return null;
  return <span className={`conf conf-${c.label.toLowerCase()}`} title={`Confidence score ${c.score}/100`}>{c.label}</span>;
}

function Cell({ e, tone }) {
  if (!e) return <td className="cell na">–</td>;
  const p = Math.round(e.prob * 100);
  return (
    <td className={`cell ${tone || ""}`}>
      <div className="cellrow">
        <b>{p}%</b><Conf c={e.conf} />
      </div>
      <div className="bar"><i style={{ width: `${p}%` }} /></div>
      <div className="sub">
        {e.odds ? <>@ {e.odds.toFixed(2)} <span className="book">{e.book}</span>{e.edge != null && <span className={e.edge >= 0.03 ? "edge pos" : "edge"}> {e.edge >= 0 ? "+" : ""}{(e.edge * 100).toFixed(1)}%</span>}</> : <span className="muted">no price</span>}
        {e.derived && <span className="muted"> · derived</span>}
      </div>
    </td>
  );
}

function PickChips({ picks }) {
  if (!picks?.length) return <p className="muted small">No selection clears the confidence bar for this match.</p>;
  return (
    <div className="chips">
      {picks.map((p) => (
        <div className="chip" key={p.key || p.label}>
          <span className="chiplabel">{p.label}</span>
          <b>{pct(p.prob)}</b>
          <Conf c={p.conf} />
          {p.odds && <span className="sub">@ {p.odds.toFixed(2)}</span>}
        </div>
      ))}
    </div>
  );
}

function ResultBars({ result, order }) {
  return (
    <div className="bars3">
      {order.map(([k, name]) => {
        const e = result[k];
        if (!e) return null;
        return (
          <div className="rb" key={k}>
            <div className="rbhead"><span>{name}</span><Conf c={e.conf} /></div>
            <div className="rbpct">{pct(e.prob)}</div>
            <div className="bar big"><i style={{ width: `${e.prob * 100}%` }} /></div>
            <div className="sub">{e.odds ? <>best @ {e.odds.toFixed(2)} <span className="book">{e.book}</span>{e.edge != null && <span className={e.edge >= 0.03 ? "edge pos" : "edge"}> {e.edge >= 0 ? "+" : ""}{(e.edge * 100).toFixed(1)}%</span>}</> : <span className="muted">no price</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

function LadderTable({ rows, title }) {
  return (
    <div className="tablewrap">
      <table className="ladder">
        <thead><tr><th>{title}</th><th>Over</th><th>Under</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.line} className={r.main ? "mainline" : ""}>
              <th>{r.line}{r.main && <span className="tag">main</span>}</th>
              <Cell e={r.over} /><Cell e={r.under} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notice({ status, children }) {
  return <p className="notice">{status}{children}</p>;
}

/* ───────── football card ───────── */
function MarketBlock({ block, label, hint, canFetch, onFetch, busy }) {
  if (block.lines.length) return <LadderTable rows={block.lines} title={`${label} line`} />;
  return (
    <div className="empty">
      <b>No {label.toLowerCase()} lines yet.</b>
      <p className="muted small">
        {block.status === "not_open"
          ? `Bookmakers usually post ${hint} about 3 days before kickoff. Check back closer to the match.`
          : `None of your connected sources is quoting ${hint} for this match.`}
      </p>
      {canFetch && <button className="btn ghost" disabled={busy} onClick={onFetch}>{busy ? "Fetching…" : "Try The Odds API (uses credits)"}</button>}
    </div>
  );
}

export function FootballCard({ m, league }) {
  const [tab, setTab] = useState("result");
  const [corners, setCorners] = useState(m.corners);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fetchCorners = async () => {
    setBusy(true); setErr("");
    try { const c = await api(`/api/extra?league=${encodeURIComponent(league)}&event=${encodeURIComponent(m.event_id)}`); setCorners(c); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const tabs = [["result", "Result"], ["goals", "Goals"], ["corners", "Corners"], ["shots", "Shots"], ["info", "Info"]];
  const hasShots = m.shots.lines.length || m.sot.lines.length;
  return (
    <article className="card">
      <header className="cardhead">
        <div>
          <div className="muted small">{when(m.kickoff)}</div>
          <div className="league-label">{m.league_name || m.league_key || "League unavailable"}</div>
          <h3>{m.home} <span className="vs">vs</span> {m.away}</h3>
        </div>
        <span className={`basis basis-${m.basis}`}>{m.basis === "blend" ? "Model + market" : m.basis === "model" ? "Model" : m.basis === "market" ? "Market-derived" : "No data"}</span>
      </header>
      <PickChips picks={m.picks} />
      <nav className="tabs sub-tabs">
        {tabs.map(([k, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{n}</button>)}
      </nav>
      {tab === "result" && (Object.keys(m.result).length
        ? <ResultBars result={m.result} order={[["home", "Home to win"], ["draw", "Draw"], ["away", "Away to win"]]} />
        : <p className="muted">No win/draw/win data for this match yet.</p>)}
      {tab === "goals" && (
        <>
          {m.goals.length ? <LadderTable rows={m.goals} title="Total goals" /> : <p className="muted">No goals data yet.</p>}
          {(m.btts.yes || m.btts.no) && (
            <div className="tablewrap"><table className="ladder"><thead><tr><th>Both teams score</th><th>Yes</th><th>No</th></tr></thead>
              <tbody><tr><th>BTTS</th><Cell e={m.btts.yes} /><Cell e={m.btts.no} /></tr></tbody></table></div>
          )}
        </>
      )}
      {tab === "corners" && (
        <>
          <MarketBlock block={corners} label="Corners" hint="corner lines" canFetch={!!m.event_id && !corners.lines.length} onFetch={fetchCorners} busy={busy} />
          {err && <p className="err small">{err}</p>}
          <p className="muted small">Probabilities are the bookmakers' own prices with the margin removed. No corner statistics are available from your three APIs, so this is not a separate model.</p>
        </>
      )}
      {tab === "shots" && (
        <>
          {m.shots.lines.length > 0 && <MarketBlock block={m.shots} label="Total shots" hint="shot lines" />}
          {m.sot.lines.length > 0 && <MarketBlock block={m.sot} label="Shots on target" hint="shot lines" />}
          {!hasShots && <MarketBlock block={m.shots} label="Shots" hint="team shot lines" />}
          <p className="muted small">Shot lines come from Pinnacle via OddsPapi when posted. The Odds API only offers player shot props, so it cannot fill this tab.</p>
        </>
      )}
      {tab === "info" && (
        <div className="info">
          {m.meta.xg_home != null && <p>Expected goals: <b>{m.meta.xg_home.toFixed(2)}</b> – <b>{m.meta.xg_away.toFixed(2)}</b>{m.meta.scores?.length ? <> · likely scores {m.meta.scores.map((s) => `${s.score} (${pct(s.p)})`).join(", ")}</> : null}</p>}
          {m.meta.form_home && <p>Form: {m.home} <b>{m.meta.form_home.last5.split("").join(" ")}</b> · {m.away} <b>{m.meta.form_away.last5.split("").join(" ")}</b></p>}
          <p>Sources: {m.meta.sources.length ? m.meta.sources.join(", ") : "none"} · bookmakers in consensus: {m.meta.books}</p>
          <p className="muted small">Confidence (0–100) combines how decisive the probability is, how much match history backs the model, whether the market agrees, and how many bookmakers (and Pinnacle) are pricing it. “Derived” lines are extrapolated from the market's main goals line. Edge = probability × best price − 1; treat positive edge as a prompt to double-check, not a guarantee.</p>
        </div>
      )}
    </article>
  );
}

/* ───────── basketball card ───────── */
export function BasketballCard({ m }) {
  return (
    <article className="card">
      <header className="cardhead">
        <div>
          <div className="muted small">{when(m.kickoff)}</div>
          <div className="league-label">{m.league_name || m.league_key || "League unavailable"}</div>
          <h3>{m.away} <span className="vs">@</span> {m.home}</h3>
        </div>
        <span className="basis basis-market">Market-derived</span>
      </header>
      <PickChips picks={m.picks} />
      {Object.keys(m.result).length
        ? <ResultBars result={m.result} order={[["home", "Home to win"], ["away", "Away to win"]]} />
        : <p className="muted">No moneyline yet.</p>}
      {m.totals.length > 0 && (
        <>
          <h4 className="sect">Points totals{m.meta.mu != null && <span className="muted small"> · projected total ≈ {m.meta.mu}{m.meta.lean ? ` · lean: ${m.meta.lean}` : ""}</span>}</h4>
          <LadderTable rows={m.totals} title="Total points" />
        </>
      )}
      <p className="muted small">Win % is the bookmaker consensus (margin removed, Pinnacle weighted). Lines marked “derived” are extrapolated from the main total with a normal distribution; only observed lines show a price.</p>
    </article>
  );
}

/* ───────── page ───────── */
function Sun() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>; }
function Moon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>; }

export default function App() {
  const [theme, setTheme] = useState(() => store.get("matchmodel-theme", store.get("edgelab-theme", "light")));
  const [sport, setSport] = useState(() => store.get("matchmodel-sport", store.get("edgelab-sport", "football")));
  const [league, setLeague] = useState(() => store.get(`matchmodel-league-${store.get("matchmodel-sport", "football")}`, store.get(`edgelab-league-${store.get("edgelab-sport", "football")}`, "")));
  const today = new Date();
  const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const [dateFrom, setDateFrom] = useState(localDate(today));
  const [dateTo, setDateTo] = useState(""); // empty means a single selected day
  const [minPct, setMinPct] = useState(0);
  const [maxPct, setMaxPct] = useState(100);
  const [tab, setTab] = useState("predictions");
  const [cat, setCat] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set("matchmodel-theme", theme); }, [theme]);
  useEffect(() => { api("/api/leagues").then(setCat).catch((e) => setErr(e.message)); }, []);

  const groups = cat?.[sport] || [];
  const flat = useMemo(() => groups.flatMap((g) => g.leagues), [groups]);
  useEffect(() => {
    if (flat.length && league !== "all" && !flat.some((l) => l.key === league)) setLeague(flat[0].key);
  }, [flat, league]);

  useEffect(() => {
    if (!league || (league !== "all" && !flat.some((l) => l.key === league)) || tab !== "predictions" || !dateFrom) return;
    let live = true;
    setLoading(true); setErr(""); setData(null);
    api(`/api/matches?sport=${sport}&league=${encodeURIComponent(league)}&date_from=${dateFrom}&date_to=${dateTo || dateFrom}`)
      .then((d) => live && setData(d)).catch((e) => live && setErr(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [sport, league, dateFrom, dateTo, tab, flat]);

  const pickSport = (s) => { setSport(s); store.set("matchmodel-sport", s); setLeague(store.get(`matchmodel-league-${s}`, store.get(`edgelab-league-${s}`, ""))); setData(null); };
  const pickLeague = (l) => { setLeague(l); store.set(`matchmodel-league-${sport}`, l); };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Match Model</div>
        <div className="seg" role="tablist" aria-label="Sport">
          <button className={sport === "football" ? "on" : ""} onClick={() => pickSport("football")}>⚽ Football</button>
          <button className={sport === "basketball" ? "on" : ""} onClick={() => pickSport("basketball")}>🏀 Basketball</button>
        </div>
        <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle night mode" title={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </header>

      <nav className="tabs main-tabs">
        <button className={tab === "predictions" ? "on" : ""} onClick={() => setTab("predictions")}>Predictions</button>
        {sport === "football" && <button className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>Results log</button>}
      </nav>

      {tab === "results" && sport === "football" ? <Results /> : (
        <>
          <section className="controls">
            <label>League
              <select value={league} onChange={(e) => pickLeague(e.target.value)}>
                <option value="all">All Leagues</option>
                {groups.map((g) => (
                  <optgroup key={g.country} label={g.country}>
                    {g.leagues.map((l) => <option key={l.key} value={l.key}>{l.name}{l.model ? " ★" : ""}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>From date
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); if (dateTo && dateTo < e.target.value) setDateTo(""); }} />
            </label>
            <label>To date <span className="muted small">(optional)</span>
              <input type="date" min={dateFrom} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <div className="prob-filter">
              <div className="prob-head"><b>Probability range</b><span>{minPct}% – {maxPct}%</span></div>
              <div className="range-inputs">
                <label>Minimum
                  <input type="range" min="0" max="100" value={minPct} onChange={(e) => setMinPct(Math.min(+e.target.value, maxPct))} />
                </label>
                <label>Maximum
                  <input type="range" min="0" max="100" value={maxPct} onChange={(e) => setMaxPct(Math.max(+e.target.value, minPct))} />
                </label>
              </div>
            </div>
            {sport === "football" && <span className="muted small legend">★ = full goal model (football-data.org). Others use market-derived data.</span>}
            {league === "all" && <span className="muted small legend">All Leagues queries more competitions and may use more provider API requests/credits.</span>}
          </section>

          {data?.status && (
            <div className="status">
              {data.status.map((s) => (
                <span key={s.provider} className={`pill ${s.ok ? "ok" : "off"}`} title={s.note}>{s.provider}{s.ok ? ` · ${s.matched}` : ""}{!s.ok && s.note ? ` · ${s.note.slice(0, 40)}` : ""}</span>
              ))}
              {data.quota?.remaining != null && <span className="pill">Odds API credits left: {data.quota.remaining}</span>}
            </div>
          )}

          {err && <p className="err">{err}</p>}
          {loading && <p className="muted">Loading {sport} matches…</p>}
          {data && !loading && !data.matches.length && <p className="muted">No matches found for {dateFrom}{dateTo ? ` to ${dateTo}` : ""} in {data.name}. Try another date or league.</p>}
          {data && !loading && (() => {
            const withinRange = (match) => {
              const probs = [];
              const visit = (value) => {
                if (!value || typeof value !== "object") return;
                if (Array.isArray(value)) return value.forEach(visit);
                if (typeof value.prob === "number") probs.push(value.prob * 100);
                Object.values(value).forEach(visit);
              };
              visit(match.picks); visit(match.result); visit(match.goals); visit(match.btts);
              visit(match.totals); visit(match.corners); visit(match.shots); visit(match.sot);
              return probs.some((p) => p >= minPct && p <= maxPct);
            };
            const visibleMatches = data.matches.filter(withinRange);
            return <>
              <p className="muted small">{visibleMatches.length} of {data.matches.length} matches match the probability filter{league === "all" ? ` · ${data.leagues_with_matches || 0} leagues with fixtures` : ""}.</p>
              {!visibleMatches.length && <p className="empty">No matches have outcomes in the selected probability range. Adjust the sliders.</p>}
              <div className="grid">
                {visibleMatches.map((m) => sport === "football"
                  ? <FootballCard key={`${m.league_key || league}-${m.id}`} m={m} league={m.league_key || league} />
                  : <BasketballCard key={`${m.league_key || league}-${m.id}`} m={m} />)}
              </div>
            </>;
          })()}
          
        </>
      )}
      <footer className="foot muted small">Probabilities are statistical estimates, not guarantees. Match analysis only.</footer>
    </div>
  );
}
