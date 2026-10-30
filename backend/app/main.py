from datetime import datetime, timezone
import asyncio

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import basketball, catalog, config, db, fdata, football, oddsapi, oddspapi
from .board import Board

app = FastAPI(title="Match Model API", version="2.1")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
async def health():
    return {"ok": True, "db": db.backend()}


@app.get("/api/health/db")
async def health_db():
    return {"ok": db.ping(), "db": db.backend()}


@app.get("/api/status")
async def status():
    return {"keys": {"football-data.org": fdata.configured(), "The Odds API": oddsapi.configured(),
                     "OddsPapi": oddspapi.configured()},
            "odds_api_quota": dict(oddsapi.quota), "cache_hours": config.ODDS_CACHE_SECONDS / 3600}


@app.get("/api/leagues")
async def leagues():
    cat = await catalog.all_leagues()
    out = {}
    for sport, items in cat.items():
        by_country: dict = {}
        for l in items:
            by_country.setdefault(l["country"], []).append(
                {"key": l["key"], "name": l["name"], "model": l["model"], "pinnacle": bool(l["op"])})
        out[sport] = [{"country": c, "leagues": sorted(v, key=lambda x: (not x["model"], x["name"]))}
                      for c, v in sorted(by_country.items(), key=lambda kv: (kv[0] in ("Other",), kv[0]))]
    return out


@app.get("/api/matches")
async def matches(
    sport: str = Query("football", pattern="^(football|basketball)$"),
    league: str = "PL",
    days: int = Query(7, ge=1, le=365),
    date_from: str | None = None,
    date_to: str | None = None,
):
    if date_from:
        try:
            datetime.strptime(date_from, "%Y-%m-%d")
            datetime.strptime(date_to or date_from, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "Dates must use YYYY-MM-DD")
        if date_to and date_to < date_from:
            raise HTTPException(400, "End date must be on or after start date")
    cat = await catalog.all_leagues()
    leagues = cat.get(sport, [])
    selected = leagues if league == "all" else [l for l in leagues if l["key"] == league]
    if not selected:
        raise HTTPException(404, f"Unknown {sport} league '{league}'")

    async def build_one(lg):
        try:
            return await (football.build(lg, days, date_from, date_to)
                          if sport == "football" else basketball.build(lg, days, date_from, date_to))
        except Exception as exc:
            return {"sport": sport, "league": lg["key"], "name": lg["name"], "country": lg["country"],
                    "mode": "error", "matches": [], "status": [{"provider": "League load", "ok": False,
                    "matched": 0, "note": str(exc)[:160]}], "quota": dict(oddsapi.quota)}

    sem = asyncio.Semaphore(3)
    async def bounded(lg):
        async with sem:
            return await build_one(lg)
    results = await asyncio.gather(*(bounded(lg) for lg in selected))

    if league != "all":
        data = results[0]
        if data["mode"] == "error":
            raise HTTPException(502, data["status"][0]["note"])
    else:
        matches_out, status_map = [], {}
        for item in results:
            for match in item["matches"]:
                match["league_key"], match["league_name"] = item["league"], item["name"]
                matches_out.append(match)
            for provider in item["status"]:
                key = provider["provider"]
                summary = status_map.setdefault(key, {"provider": key, "ok": False, "matched": 0,
                                                       "leagues_checked": 0, "leagues_ok": 0, "notes": []})
                summary["leagues_checked"] += 1
                summary["ok"] = summary["ok"] or provider["ok"]
                summary["matched"] += provider.get("matched", 0)
                summary["leagues_ok"] += int(bool(provider["ok"]))
                if provider.get("note"):
                    summary["notes"].append(provider["note"])
        status_out = list(status_map.values())
        for summary in status_out:
            summary["note"] = (f'{summary["leagues_ok"]}/{summary["leagues_checked"]} leagues available'
                               + (f'; {summary["notes"][0]}' if summary["notes"] else ""))
        matches_out.sort(key=lambda m: m["kickoff"])
        data = {"sport": sport, "league": "all", "name": "All leagues", "mode": "all",
                "matches": matches_out, "status": status_out, "quota": dict(oddsapi.quota),
                "leagues_loaded": len(selected),
                "leagues_with_matches": len({m["league_key"] for m in matches_out})}

    if sport == "football":
        for item in (results if league == "all" else [data]):
            if item.get("mode") == "model":
                try:
                    db.log_predictions(item)
                except Exception:
                    pass
    return data


@app.get("/api/extra")
async def extra(league: str, event: str):
    """Corner lines straight from The Odds API for one match (costs credits, so only on request)."""
    lg = await catalog.find("football", league)
    if not lg or not oddsapi.configured():
        raise HTTPException(400, "Unknown league or The Odds API key missing")
    try:
        ev = await oddsapi.event_extra(lg["oa"], event, "alternate_totals_corners")
    except Exception as e:
        raise HTTPException(502, str(e)[:200])
    b = {}
    fx = [{"id": "x", "kickoff": ev["commence_time"], "home": ev["home_team"], "away": ev["away_team"]}]
    oddsapi.ingest([ev], fx, b, True)
    return football._ladder(b.get("x", Board()), "corners", ev["commence_time"], datetime.now(timezone.utc))


@app.get("/api/performance")
async def performance(league: str | None = None):
    try:
        for comp in db.competitions_pending():
            try:
                db.settle(comp, await fdata.finished_matches(comp))
            except Exception:
                continue
    except Exception:
        pass
    return db.performance(league)
