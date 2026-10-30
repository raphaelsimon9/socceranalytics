"""oddspapi.io v4: Pinnacle prices for 1X2 / moneyline, goal & points totals, BTTS, and (when posted) corners/shots.

Parsing rules (verified against live Pinnacle payloads):
  * Pinnacle's `bookmakerMarketId` ends in "<period>/<type>", e.g. ".../0/moneyline", ".../0/totals".
    Period 0 = full game. Period 1 = FIRST HALF, which must never be mixed into full-time prices.
  * Totals outcomes carry a label such as "2.5/over", so the line needs no lookup.
  * BTTS is market 104 (outcome 104 = yes, 105 = no).
  * Corners/shots have unlabelled ids, so they are classified by NAME from the /markets catalogue.
    They are only posted ~3 days before kick-off, so far-off matches legitimately have none."""
import asyncio
import re

from . import config
from .board import Board
from .util import cached, client, match_fixture

OP = "https://api.oddspapi.io/v4"
SPORT = {"football": 10, "basketball": 11}


def configured() -> bool:
    return bool(config.ODDSPAPI_KEY)


async def _get(path: str, params: dict):
    async with client() as c:
        for attempt in range(3):
            r = await c.get(f"{OP}{path}", params={**params, "apiKey": config.ODDSPAPI_KEY})
            if r.status_code == 429:
                await asyncio.sleep(2.0 * (attempt + 1))     # cooldown between calls
                continue
            if r.status_code == 401:
                raise RuntimeError("OddsPapi: invalid key")
            if r.status_code >= 400:
                raise RuntimeError(f"OddsPapi: HTTP {r.status_code} {r.text[:120]}")
            return r.json()
    raise RuntimeError("OddsPapi: still rate-limited after retries")


async def participants(sport: str) -> dict:
    async def go():
        return {str(k): v for k, v in (await _get("/participants", {"sportId": SPORT[sport]})).items()}
    return await cached(f"op:participants:{sport}", 7 * 86400, go)


def classify(name: str) -> str | None:
    """Catalogue market name -> 'corners' | 'shots' | 'sot' for FULL-TIME TEAM TOTAL over/under, else None."""
    n = (name or "").lower()
    if "over under" not in n and "over/under" not in n and "total" not in n:
        return None
    if any(t in n for t in ("player", "half", "1st", "2nd", "team 1", "team 2", "home", "away", "specials", "race")):
        return None
    if "corner" in n:
        return "corners"
    if "shot" in n:
        return "sot" if ("target" in n or "on goal" in n) else "shots"
    return None


async def catalogue() -> dict:
    """marketId -> {family, line}. Large, static: cached for a day. Failure just disables corners/shots."""
    async def go():
        raw = await _get("/markets", {"sportId": SPORT["football"], "language": "en"})
        rows = raw if isinstance(raw, list) else list(raw.values()) if isinstance(raw, dict) else []
        out = {}
        for m in rows:
            if not isinstance(m, dict):
                continue
            fam = classify(m.get("marketName") or m.get("name"))
            per = str(m.get("period", "fulltime")).lower().replace(" ", "")
            try:
                line = float(m.get("handicap"))
            except (TypeError, ValueError):
                continue
            if fam and per in ("fulltime", "ft", "0") and (line * 2) % 2 == 1:
                out[str(m.get("marketId") or m.get("id"))] = {"family": fam, "line": line}
        return out
    try:
        return await cached("op:catalogue", 86400, go)
    except Exception:
        return {}


async def tournament_odds(tid: int, book: str) -> list:
    async def go():
        data = await _get("/odds-by-tournaments", {"tournamentIds": tid, "bookmaker": book})
        return data if isinstance(data, list) else []
    return await cached(f"op:odds:{tid}:{book}", config.ODDS_CACHE_SECONDS, go)


def _price(outcome: dict):
    p = ((outcome or {}).get("players") or {}).get("0") or {}
    return (p.get("price"), p.get("active", True), p.get("bookmakerOutcomeId", ""))


def parse(events: list, names: dict, fixtures: list, boards: dict, sport: str, cat: dict, slug_label=None) -> int:
    football = sport == "football"
    hit = set()
    for ev in events:
        home, away = names.get(str(ev.get("participant1Id"))), names.get(str(ev.get("participant2Id")))
        if not home or not away:
            continue
        fid = match_fixture(fixtures, home, away, ev.get("startTime"))
        if fid is None:
            continue
        for slug, bk in (ev.get("bookmakerOdds") or {}).items():
            if bk.get("suspended") or not bk.get("bookmakerIsActive", True):
                continue
            b = boards.setdefault(fid, Board())
            got = False
            for mid, mk in (bk.get("markets") or {}).items():
                if not mk.get("marketActive", True):
                    continue
                label = str(mk.get("bookmakerMarketId", ""))
                parts = label.split("/")
                typ, per = (parts[-1], parts[-2]) if len(parts) >= 2 else ("", "")
                outs = mk.get("outcomes") or {}
                if typ == "moneyline" and per == "0":
                    for oid, o in outs.items():
                        price, active, tag = _price(o)
                        if active and tag in ("home", "draw", "away"):
                            b.add(slug, "h2h" if football else "ml", None, tag, price, "OddsPapi"); got = True
                elif typ == "totals" and per == "0":
                    for oid, o in outs.items():
                        price, active, tag = _price(o)
                        m = re.match(r"^([\d.]+)/(over|under)$", tag or "")
                        if not (m and active):
                            continue
                        line = float(m.group(1))
                        if football and (line * 2) % 2 != 1:
                            continue
                        b.add(slug, "total", line, m.group(2), price, "OddsPapi"); got = True
                elif football and mid == "104":
                    for oid, sel in (("104", "yes"), ("105", "no")):
                        price, active, _ = _price(outs.get(oid))
                        if active:
                            b.add(slug, "btts", None, sel, price, "OddsPapi"); got = True
                elif football and mid in cat and len(outs) == 2:
                    fam, line = cat[mid]["family"], cat[mid]["line"]
                    for rank, (oid, o) in enumerate(sorted(outs.items(), key=lambda kv: int(kv[0]))):
                        price, active, tag = _price(o)
                        if active:
                            sel = "over" if "over" in (tag or "").lower() else "under" if "under" in (tag or "").lower() \
                                else ("over" if rank == 0 else "under")
                            b.add(slug, fam, line, sel, price, "OddsPapi"); got = True
            if got:
                hit.add(fid)
    return len(hit)


async def ingest(league: dict, sport: str, fixtures: list, boards: dict) -> dict:
    """Fetch + parse every configured bookmaker for the league's tournament. Never raises."""
    info = {"provider": "OddsPapi", "ok": False, "matched": 0, "note": ""}
    if not configured() or not league.get("op"):
        info["note"] = "not configured" if not configured() else "no tournament id for this league"
        return info
    try:
        nm = await participants(sport)
        cat = await catalogue() if sport == "football" else {}
        for i, book in enumerate(config.ODDSPAPI_BOOKMAKERS):
            if i:
                await asyncio.sleep(1.1)
            events = await tournament_odds(league["op"], book)
            info["matched"] = max(info["matched"], parse(events, nm, fixtures, boards, sport, cat))
        info["ok"] = True
    except Exception as e:     # provider failures never break the page
        info["note"] = str(e)[:160]
    return info
