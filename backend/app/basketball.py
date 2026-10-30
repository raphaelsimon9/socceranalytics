"""Basketball: win probabilities and points-total ladders derived from bookmaker prices.

None of the three APIs publishes basketball results history, so there is no team model here: probabilities are
de-vigged market consensus (Pinnacle weighted 3x). Totals are modelled as Normal(mu, sigma) around the market's
main line, which lets us price lines the books did not quote."""
from datetime import datetime, timezone

from . import oddsapi, oddspapi
from .board import Board
from .common import clamp, entry, top_picks
from .util import ND

SIGMA = {"basketball_nba": 18.5, "basketball_wnba": 15.5, "basketball_euroleague": 14.5,
         "basketball_ncaab": 16.0, "basketball_wncaab": 15.0, "basketball_nbl": 17.0}
STEP = {"basketball_nba": 4.0, "basketball_wnba": 3.5, "basketball_euroleague": 3.0}


def _half(x: float) -> float:
    """Nearest x.5 line."""
    return round(x - 0.5) + 0.5


def assemble(f: dict, board: Board | None, lk: str) -> dict:
    board = board or Board()
    sigma, step = SIGMA.get(lk, 16.5), STEP.get(lk, 3.5)
    entries, result, totals, meta = [], {}, [], {"mu": None, "main_line": None, "sigma": sigma}
    ml = board.fair("ml")
    if ml:
        for sel, label in (("home", "Home win"), ("away", "Away win")):
            result[sel] = entry(label, ml["probs"][sel], best=board.best("ml", None, sel), books=ml["n"], sharp=ml["sharp"],
                                key=sel, family="result")
            entries.append(result[sel])
    lines = board.lines("total")
    if lines:
        info = {l: board.fair("total", l) for l in lines}
        main = max(lines, key=lambda l: (info[l]["n"], -abs(info[l]["probs"]["over"] - .5)))
        po = clamp(info[main]["probs"]["over"], 0.03, 0.97)
        mu = main + sigma * ND.inv_cdf(po)
        meta.update(mu=round(mu, 1), main_line=main, books=info[main]["n"])
        wanted = {_half(main + k * step) for k in range(-3, 4)} | {main}
        for line in sorted(wanted):
            direct = info.get(line)
            if direct:
                p, books, sharp, derived = direct["probs"]["over"], direct["n"], direct["sharp"], False
            else:
                p, books, sharp, derived = 1 - ND.cdf((line - mu) / sigma), info[main]["n"], info[main]["sharp"], True
            kw = dict(books=books, sharp=sharp, derived=derived)
            over = entry(f"Over {line}", p, best=board.best("total", line, "over"), key=f"over_{line}",
                         family=f"total{line}", **kw)
            under = entry(f"Under {line}", 1 - p, best=board.best("total", line, "under"), key=f"under_{line}",
                          family=f"total{line}", **kw)
            totals.append({"line": line, "main": line == main, "over": over, "under": under})
        # one total pick per side: the line whose probability is closest to ~70% (a sturdier, shorter-priced angle)
        for side in ("over", "under"):
            cands = [r[side] for r in totals if 0.58 <= r[side]["prob"] <= 0.85]
            if cands:
                entries.append(min(cands, key=lambda e: abs(e["prob"] - 0.70)) | {"family": f"totals_{side}"})
        lean = max((totals[[r["line"] for r in totals].index(main)][s] for s in ("over", "under")), key=lambda e: e["prob"])
        meta["lean"] = lean["label"] if lean["prob"] >= 0.53 else None
    return {"id": f["id"], "kickoff": f["kickoff"], "home": f["home"], "away": f["away"],
            "basis": "market" if (result or totals) else "none", "result": result, "totals": totals,
            "picks": top_picks(entries, 0.55, 0.85), "meta": {**meta, "sources": sorted(board.sources),
                                                              "books": (ml or {}).get("n", 0)}}


async def build(league: dict, days: int = 7, date_from: str | None = None, date_to: str | None = None) -> dict:
    status, events, boards = [], [], {}
    oa = {"provider": "The Odds API", "ok": False, "matched": 0, "note": ""}
    if oddsapi.configured():
        try:
            events = await oddsapi.events_odds(league["oa"], "h2h,totals")
            oa["ok"] = True
        except Exception as e:
            oa["note"] = str(e)[:160]
    else:
        oa["note"] = "not configured"
    fixtures = oddsapi.in_date_range(oddsapi.fixtures_from_events(events), date_from, date_to) if date_from else oddsapi.in_window(oddsapi.fixtures_from_events(events), days)
    oa["matched"] = oddsapi.ingest(events, fixtures, boards, False)
    status.append(oa)
    status.append(await oddspapi.ingest(league, "basketball", fixtures, boards))
    matches = sorted((assemble(f, boards.get(f["id"]), league["oa"]) for f in fixtures), key=lambda m: m["kickoff"])
    return {"sport": "basketball", "league": league["key"], "name": league["name"], "country": league["country"],
            "mode": "market", "matches": matches, "status": status, "quota": dict(oddsapi.quota)}
