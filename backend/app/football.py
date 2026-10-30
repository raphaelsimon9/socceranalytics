"""Football matches: goal model (football-data leagues) or market-derived probabilities (all other leagues)."""
from datetime import datetime, timezone

from . import fdata, oddsapi, oddspapi
from .board import Board
from .common import entry, top_picks
from .model import TeamModel, form
from .util import fit_poisson_total, parse_iso, poisson_over
from . import config

GOAL_LINES = (1.5, 2.5, 3.5, 4.5)
DB_KEYS = {1.5: "15", 2.5: "25", 3.5: "35", 4.5: "45"}


def _blend(model_p, fair_p, info):
    """Own model + market. Market gets weight only when it is deep enough to trust (>=2 books or Pinnacle)."""
    if model_p is not None and fair_p is not None and info and (info["n"] >= 2 or info["sharp"]):
        return config.MODEL_WEIGHT * model_p + (1 - config.MODEL_WEIGHT) * fair_p, "blend"
    if model_p is not None:
        return model_p, "model"
    return fair_p, "market"


def _market_total_lambda(board: Board):
    """Total-goals mean implied by the most balanced goals line the market quotes (for derived lines)."""
    best = None
    for line in board.lines("total"):
        f = board.fair("total", line)
        if f and (best is None or abs(f["probs"]["over"] - .5) < abs(best[1] - .5)):
            best = (line, f["probs"]["over"])
    return fit_poisson_total(*best) if best else None


def _ladder(board: Board, market: str, kickoff: str, now) -> dict:
    """Corners / shots: market-implied probabilities for up to 5 lines around the balanced one."""
    rows = []
    for line in board.lines(market):
        f = board.fair(market, line)
        if not f:
            continue
        po = f["probs"]["over"]
        mk = dict(books=f["n"], sharp=f["sharp"], market_p=None, model_p=None)
        rows.append((abs(po - 0.5), line, {
            "line": line,
            "over": entry(f"Over {line}", po, best=board.best(market, line, "over"), books=f["n"], sharp=f["sharp"],
                          key=f"{market}_over_{line}", family=market),
            "under": entry(f"Under {line}", 1 - po, best=board.best(market, line, "under"), books=f["n"],
                           sharp=f["sharp"], key=f"{market}_under_{line}", family=market)}))
    if rows:
        rows = sorted(sorted(rows, key=lambda r: r[0])[:5], key=lambda r: r[1])
        return {"status": "ok", "lines": [r[2] for r in rows]}
    hours = (parse_iso(kickoff) - now).total_seconds() / 3600
    return {"status": "not_open" if hours > 72 else "unavailable", "lines": []}


def assemble(f: dict, model, hist, board: Board | None, now, is_model: bool) -> dict:
    board = board or Board()
    pr, n_sample = None, None
    if model is not None:
        n_sample = min(model.games.get(f["home"], 0), model.games.get(f["away"], 0))
        if n_sample:
            pr = model.predict(f["home"], f["away"])
    sample_ok = bool(pr) and n_sample >= 8
    mp = pr if sample_ok else None            # only trust the model with enough matches behind both teams
    entries, basis = [], "market"

    # ---- 1X2
    fair = board.fair("h2h")
    result = {}
    for sel, label in (("home", "Home win"), ("draw", "Draw"), ("away", "Away win")):
        fp = fair["probs"][sel] if fair else None
        mpv = mp[sel] if mp else None
        if mpv is None and fp is None:
            continue
        p, basis = _blend(mpv, fp, fair)
        result[sel] = entry(label, p, best=board.best("h2h", None, sel), model_p=mpv, market_p=fp, sample=n_sample if mp else None,
                            books=fair["n"] if fair else 0, sharp=bool(fair and fair["sharp"]), kind="three", key=sel, family="result")
        entries.append(result[sel])

    # ---- goals lines
    lam = _market_total_lambda(board)
    goals = []
    for line in GOAL_LINES:
        direct = board.fair("total", line)
        fp, derived = (direct["probs"]["over"], False) if direct else (None, False)
        if fp is None and lam is not None and mp is None:
            fp, derived = poisson_over(line, lam), True
        mpv = mp["overs"][line] if mp else None
        if mpv is None and fp is None:
            continue
        p, _ = _blend(mpv, fp, direct)
        kw = dict(model_p=mpv, market_p=None if derived else fp, sample=n_sample if mp else None,
                  books=direct["n"] if direct else (0 if derived else 0), sharp=bool(direct and direct["sharp"]), derived=derived)
        k = DB_KEYS[line]
        over = entry(f"Over {line}", p, best=board.best("total", line, "over"), key=f"over{k}", family=f"goals{line}", **kw)
        under = entry(f"Under {line}", 1 - p, best=board.best("total", line, "under"), key=f"under{k}", family=f"goals{line}",
                      **{**kw, "model_p": None if mpv is None else 1 - mpv, "market_p": None if kw["market_p"] is None else 1 - kw["market_p"]})
        goals.append({"line": line, "over": over, "under": under})
        entries += [over, under]

    # ---- BTTS
    btts, bf = {}, board.fair("btts")
    for sel, label in (("yes", "BTTS Yes"), ("no", "BTTS No")):
        fp = bf["probs"][sel] if bf else None
        mpv = mp[f"btts_{sel}"] if mp else None
        if mpv is None and fp is None:
            continue
        p, _ = _blend(mpv, fp, bf)
        btts[sel] = entry(label, p, best=board.best("btts", None, sel), model_p=mpv, market_p=fp, sample=n_sample if mp else None,
                          books=bf["n"] if bf else 0, sharp=bool(bf and bf["sharp"]), key=f"btts_{sel}", family="btts")
        entries.append(btts[sel])

    # ---- corners & shots (market-implied: none of the three APIs publish team corner/shot statistics)
    corners = _ladder(board, "corners", f["kickoff"], now)
    shots = _ladder(board, "shots", f["kickoff"], now)
    sot = _ladder(board, "sot", f["kickoff"], now)
    for blk in (corners, shots, sot):
        for row in blk["lines"]:
            entries += [row["over"], row["under"]]

    picks = top_picks(entries)
    log_keys = {"home", "draw", "away", "btts_yes", "btts_no"} | {f"{s}{DB_KEYS[l]}" for l in GOAL_LINES for s in ("over", "under")}
    log = [{"key": e["key"], "market": e["family"], "pick": e["label"], "prob": e["prob"], "odds": e["odds"]}
           for e in entries if e["key"] in log_keys] if sample_ok and is_model else []
    rec = next((p for p in picks if p["key"] in log_keys), None)
    return {
        "id": f["id"], "kickoff": f["kickoff"], "home": f["home"], "away": f["away"],
        "basis": basis if (result or goals) else "none", "sample_ok": sample_ok,
        "result": result, "goals": goals, "btts": btts, "corners": corners, "shots": shots, "sot": sot,
        "picks": picks, "log": log, "rec_key": rec["key"] if rec else None,
        "meta": {"xg_home": mp["xg_home"] if mp else None, "xg_away": mp["xg_away"] if mp else None,
                 "scores": mp["top_scores"] if mp else [], "sample": n_sample,
                 "form_home": form(hist, f["home"]) if hist else None, "form_away": form(hist, f["away"]) if hist else None,
                 "sources": sorted(board.sources), "books": fair["n"] if fair else 0},
    }


async def build(league: dict, days: int = 7, date_from: str | None = None, date_to: str | None = None) -> dict:
    status, model, hist, events, boards = [], None, [], [], {}
    is_model = league["model"]
    fixtures = None
    if is_model:
        if not fdata.configured():
            raise RuntimeError("FOOTBALL_DATA_KEY is not set")
        hist = await fdata.finished_matches(league["fd"])
        fixtures = await (fdata.upcoming(league["fd"], days, date_from, date_to) if date_from else fdata.upcoming(league["fd"], days))
        model = TeamModel(hist) if len(hist) >= 30 else None
        status.append({"provider": "football-data.org", "ok": True, "matched": len(fixtures), "note": f"{len(hist)} past matches"})
    oa = {"provider": "The Odds API", "ok": False, "matched": 0, "note": ""}
    if oddsapi.configured():
        try:
            events = await oddsapi.events_odds(league["oa"], "h2h,totals")
            oa["ok"] = True
        except Exception as e:
            oa["note"] = str(e)[:160]
    else:
        oa["note"] = "not configured"
    if fixtures is None:
        fixtures = oddsapi.in_date_range(oddsapi.fixtures_from_events(events), date_from, date_to) if date_from else oddsapi.in_window(oddsapi.fixtures_from_events(events), days)
    eventmap: dict = {}
    oa["matched"] = oddsapi.ingest(events, fixtures, boards, True, eventmap)
    status.append(oa)
    status.append(await oddspapi.ingest(league, "football", fixtures, boards))
    now = datetime.now(timezone.utc)
    matches = [assemble(f, model, hist, boards.get(f["id"]), now, is_model) for f in fixtures]
    for m in matches:
        m["event_id"] = eventmap.get(m["id"])
    matches.sort(key=lambda m: m["kickoff"])
    return {"sport": "football", "league": league["key"], "name": league["name"], "country": league["country"],
            "mode": "model" if is_model else "market", "matches": matches, "status": status,
            "quota": dict(oddsapi.quota)}
