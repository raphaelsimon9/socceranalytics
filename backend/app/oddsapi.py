"""the-odds-api.com v4: league discovery (free), odds (1 credit per market per region), extra per-event markets."""
from . import config
from .util import cached, client, match_fixture, parse_iso

BASE = "https://api.the-odds-api.com/v4"
quota: dict = {"remaining": None, "used": None}


def configured() -> bool:
    return bool(config.ODDS_API_KEY)


def _note(r):
    for k, h in (("remaining", "x-requests-remaining"), ("used", "x-requests-used")):
        try:
            quota[k] = int(float(r.headers[h]))
        except (KeyError, ValueError):
            pass


def _check(r):
    _note(r)
    if r.status_code == 401:
        raise RuntimeError("The Odds API: invalid key")
    if r.status_code == 429:
        raise RuntimeError("The Odds API: rate/quota limit reached")
    if r.status_code >= 400:
        raise RuntimeError(f"The Odds API: HTTP {r.status_code} {r.text[:120]}")


def credits_ok() -> bool:
    return quota["remaining"] is None or quota["remaining"] > config.ODDS_API_MIN_CREDITS


async def sports() -> list:
    async with client() as c:
        r = await c.get(f"{BASE}/sports", params={"apiKey": config.ODDS_API_KEY})   # free: costs no credits
        _check(r)
        return r.json()


async def events_odds(sport_key: str, markets: str) -> list:
    async def go():
        if not credits_ok():
            raise RuntimeError(f"The Odds API credits low ({quota['remaining']} left): paused to protect your quota")
        async with client() as c:
            r = await c.get(f"{BASE}/sports/{sport_key}/odds", params={
                "apiKey": config.ODDS_API_KEY, "regions": config.THEODDSAPI_REGIONS, "markets": markets,
                "oddsFormat": "decimal", "dateFormat": "iso"})
            _check(r)
            return r.json()
    return await cached(f"oa:odds:{sport_key}:{markets}", config.ODDS_CACHE_SECONDS, go)


async def event_extra(sport_key: str, event_id: str, markets: str) -> dict:
    async def go():
        if not credits_ok():
            raise RuntimeError("The Odds API credits low: paused")
        async with client() as c:
            r = await c.get(f"{BASE}/sports/{sport_key}/events/{event_id}/odds", params={
                "apiKey": config.ODDS_API_KEY, "regions": config.THEODDSAPI_REGIONS, "markets": markets,
                "oddsFormat": "decimal"})
            _check(r)
            return r.json()
    return await cached(f"oa:extra:{event_id}:{markets}", config.ODDS_CACHE_SECONDS, go)


def fixtures_from_events(events: list) -> list:
    return [{"id": e["id"], "kickoff": e["commence_time"], "home": e["home_team"], "away": e["away_team"]}
            for e in events if e.get("home_team") and e.get("away_team")]


def ingest(events: list, fixtures: list, boards: dict, football: bool, eventmap: dict | None = None) -> int:
    """Add every quote to the right match's Board. Returns number of matches that received prices."""
    from .board import Board
    hit = set()
    for ev in events:
        fid = match_fixture(fixtures, ev.get("home_team", ""), ev.get("away_team", ""), ev.get("commence_time"))
        if fid is None:
            continue
        hit.add(fid)
        if eventmap is not None:
            eventmap[fid] = ev["id"]
        b = boards.setdefault(fid, Board())
        for bm in ev.get("bookmakers", []):
            book = bm.get("key", "")
            for mk in bm.get("markets", []):
                key = mk.get("key", "")
                for o in mk.get("outcomes", []):
                    name, price, pt = o.get("name", ""), o.get("price"), o.get("point")
                    if key == "h2h":
                        sel = "home" if name == ev["home_team"] else "away" if name == ev["away_team"] else \
                              "draw" if name.lower() == "draw" else None
                        if sel:
                            b.add(book, "h2h" if football else "ml", None, sel, price, "The Odds API")
                    elif key in ("totals", "alternate_totals") and pt is not None and name.lower() in ("over", "under"):
                        if football and (float(pt) * 2) % 2 != 1:
                            continue    # whole/quarter lines are pushes/Asian lines: skip for football
                        b.add(book, "total", float(pt), name.lower(), price, "The Odds API")
                    elif key == "btts" and name.lower() in ("yes", "no"):
                        b.add(book, "btts", None, name.lower(), price, "The Odds API")
                    elif "corners" in key and "totals" in key and pt is not None and name.lower() in ("over", "under"):
                        if (float(pt) * 2) % 2 == 1:
                            b.add(book, "corners", float(pt), name.lower(), price, "The Odds API")
    return len(hit)


def in_window(fixtures: list, days: int) -> list:
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)
    return [f for f in fixtures if now - timedelta(hours=1) <= parse_iso(f["kickoff"]) <= end]


def in_date_range(fixtures: list, date_from: str, date_to: str | None = None) -> list:
    """Keep scheduled events whose kickoff UTC calendar date is inside the inclusive range."""
    from datetime import date
    start = date.fromisoformat(date_from)
    end = date.fromisoformat(date_to or date_from)
    return [f for f in fixtures if start <= parse_iso(f["kickoff"]).date() <= end]
