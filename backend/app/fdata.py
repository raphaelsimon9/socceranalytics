"""football-data.org (free tier): finished matches (model training) + upcoming fixtures."""
from datetime import date, timedelta

from . import config
from .util import cached, client

FD = "https://api.football-data.org/v4"


def configured() -> bool:
    return bool(config.FOOTBALL_DATA_KEY)


async def _fd(path, params=None):
    async with client() as c:
        r = await c.get(f"{FD}{path}", params=params, headers={"X-Auth-Token": config.FOOTBALL_DATA_KEY})
        if r.status_code == 429:
            raise RuntimeError("football-data.org: rate limit (10 requests/minute on the free tier), retry shortly")
        r.raise_for_status()
        return r.json()


def _season_start() -> int:
    today = date.today()
    return today.year if today.month >= 7 else today.year - 1


async def finished_matches(comp: str) -> list:
    """Current + previous season so early-season predictions are not starved of data."""
    async def go():
        out = []
        cur = _season_start()
        for season in (cur - 1, cur):
            try:
                data = await _fd(f"/competitions/{comp}/matches", {"status": "FINISHED", "season": season})
            except Exception:
                if season == cur:
                    raise
                continue
            for m in data["matches"]:
                ft = m["score"]["fullTime"]
                if ft["home"] is None:
                    continue
                out.append({"id": m["id"], "date": m["utcDate"][:10], "home": m["homeTeam"]["name"],
                            "away": m["awayTeam"]["name"], "hg": ft["home"], "ag": ft["away"]})
        return out
    return await cached(f"fd:fin:{comp}", 3600, go)


async def upcoming(comp: str, days: int = 7, date_from: str | None = None, date_to: str | None = None) -> list:
    d0 = date.fromisoformat(date_from) if date_from else date.today()
    d1 = date.fromisoformat(date_to) if date_to else d0 + timedelta(days=days)
    async def go():
        data = await _fd(f"/competitions/{comp}/matches",
                         {"status": "SCHEDULED,TIMED", "dateFrom": d0.isoformat(), "dateTo": d1.isoformat()})
        return [{"id": m["id"], "kickoff": m["utcDate"], "home": m["homeTeam"]["name"],
                 "away": m["awayTeam"]["name"]} for m in data["matches"]
                if m["homeTeam"].get("name") and m["awayTeam"].get("name")]
    return await cached(f"fd:up:{comp}:{d0}:{d1}", 900, go)
