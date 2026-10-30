import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import basketball, catalog, config, football, oddsapi, oddspapi
from app.board import Board
from app.common import confidence, top_picks
from app.util import devig, fit_poisson_total, poisson_over, same

NOW = datetime.now(timezone.utc)
KO = (NOW + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
FAR = (NOW + timedelta(days=6)).strftime("%Y-%m-%dT%H:%M:%SZ")
FIX = [{"id": 1, "kickoff": KO, "home": "Everton FC", "away": "Chelsea FC"}]


def test_devig_and_names():
    assert abs(sum(devig([2.0, 3.5, 4.0])) - 1) < 1e-9 and devig([1.0, 2.0]) is None
    assert same("Manchester United FC", "Man United") and not same("Real Madrid", "Real Sociedad")
    lam = fit_poisson_total(2.5, 0.55)
    assert abs(poisson_over(2.5, lam) - 0.55) < 1e-3


def test_board_consensus_weights_pinnacle():
    b = Board()
    for book, o, u in (("pinnacle", 1.80, 2.10), ("bet365", 1.95, 1.85), ("bwin", 1.95, 1.85)):
        b.add(book, "total", 2.5, "over", o); b.add(book, "total", 2.5, "under", u)
    f = b.fair("total", 2.5)
    assert f["n"] == 3 and f["sharp"] and abs(sum(f["probs"].values()) - 1) < 1e-9
    assert b.best("total", 2.5, "over") == (1.95, "bet365") or b.best("total", 2.5, "over")[0] == 1.95
    assert b.lines("total") == [2.5]
    b.add("x", "total", 3.5, "over", 2.0)       # incomplete pair: never a "line"
    assert b.lines("total") == [2.5]


def test_confidence_orders_sensibly():
    strong = confidence(0.78, books=6, sharp=True)
    weak = confidence(0.52, books=1)
    assert strong["score"] > weak["score"] and strong["label"] in ("High", "Medium") and weak["label"] == "Low"
    # disagreement with the market lowers confidence
    assert confidence(0.7, sample=20, market_p=0.40)["score"] < confidence(0.7, sample=20, market_prob=0.70)["score"] \
        if False else True
    assert confidence(0.7, sample=20, market_prob=0.40)["score"] < confidence(0.7, sample=20, market_prob=0.70)["score"]


def _mk(label, tag_prices, active=True):
    return {"marketActive": active, "bookmakerMarketId": label, "outcomes": {
        oid: {"players": {"0": {"active": active, "bookmakerOutcomeId": tag, "price": price}}}
        for oid, (tag, price) in tag_prices.items()}}


def test_oddspapi_parse_period_and_corners():
    ev = {"participant1Id": 48, "participant2Id": 38, "startTime": KO, "bookmakerOdds": {"pinnacle": {
        "bookmakerIsActive": True, "suspended": False, "markets": {
            "101": _mk("line/29/1980/1/2/0/moneyline", {"101": ("home", 3.29), "102": ("draw", 3.73), "103": ("away", 2.17)}),
            "1010": _mk("altLine/29/1980/1/2/3/0/totals", {"1010": ("2.5/over", 1.7), "1011": ("2.5/under", 2.25)}),
            "108": _mk("altLine/29/1980/1/2/3/0/totals", {"108": ("1.5/over", 1.25), "109": ("1.5/under", 4.1)}),
            "10258": _mk("altLine/29/1980/1/2/3/1/totals", {"10258": ("1.5/over", 2.47), "10259": ("1.5/under", 1.55)}),  # 1st half
            "10208": _mk("line/29/1980/1/2/1/moneyline", {"10208": ("home", 9.9), "10209": ("draw", 9.9), "10210": ("away", 9.9)}),
            "104": _mk("1/2/3", {"104": ("9", 1.59), "105": ("9", 2.44)}),
            "5001": _mk("1/2/3", {"5001": ("", 1.9), "5002": ("", 1.9)}),       # corners 9.5 via catalogue
            "5003": _mk("1/2/3", {"5003": ("", 1.8), "5004": ("", 2.0)}),       # shots 24.5 via catalogue
        }}}}
    cat = {"5001": {"family": "corners", "line": 9.5}, "5003": {"family": "shots", "line": 24.5}}
    boards = {}
    assert oddspapi.parse([ev], {"48": "Everton", "38": "Chelsea"}, FIX, boards, "football", cat) == 1
    b = boards[1]
    assert b.best("h2h", None, "home") == (3.29, "pinnacle") and b.best("h2h", None, "away")[0] == 2.17
    assert b.lines("total") == [1.5, 2.5]                     # first-half 1.5 did not leak in
    assert b.best("total", 1.5, "over")[0] == 1.25
    assert b.best("btts", None, "yes")[0] == 1.59
    assert b.lines("corners") == [9.5] and b.lines("shots") == [24.5]


def test_catalogue_classifier():
    c = oddspapi.classify
    assert c("Corners - Over Under Full Time") == "corners"
    assert c("Shots on Target - Over Under Full Time") == "sot" and c("Total Shots - Over Under Full Time") == "shots"
    assert c("Corners - Over Under 1st Half") is None and c("Player Shots - Over Under") is None
    assert c("Over Under Full Time") is None


def test_oddsapi_ingest_football_and_basketball():
    ev = {"id": "e1", "home_team": "Everton", "away_team": "Chelsea", "commence_time": KO, "bookmakers": [
        {"key": "bet365", "markets": [
            {"key": "h2h", "outcomes": [{"name": "Everton", "price": 3.2}, {"name": "Chelsea", "price": 2.2}, {"name": "Draw", "price": 3.6}]},
            {"key": "totals", "outcomes": [{"name": "Over", "price": 1.8, "point": 2.5}, {"name": "Under", "price": 2.0, "point": 2.5},
                                           {"name": "Over", "price": 1.5, "point": 2.0}]}]}]}
    boards, em = {}, {}
    assert oddsapi.ingest([ev], FIX, boards, True, em) == 1 and em[1] == "e1"
    f = boards[1].fair("h2h")
    assert abs(sum(f["probs"].values()) - 1) < 1e-9 and boards[1].lines("total") == [2.5]   # whole line skipped
    b2 = {}
    oddsapi.ingest([ev], FIX, b2, False)
    assert b2[1].fair("h2h") is None and set(b2[1].fair("ml")["probs"]) == {"home", "away"}   # basketball is 2-way


def test_football_market_mode_derives_lines():
    b = Board()
    for sel, p in (("home", 2.6), ("draw", 3.4), ("away", 2.7)):
        b.add("pinnacle", "h2h", None, sel, p)
    b.add("pinnacle", "total", 2.5, "over", 1.85); b.add("pinnacle", "total", 2.5, "under", 2.0)
    m = football.assemble(FIX[0], None, [], b, NOW, False)
    assert m["basis"] == "market" and m["result"]["home"]["prob"] > 0.3
    rows = {g["line"]: g for g in m["goals"]}
    assert set(rows) == {1.5, 2.5, 3.5, 4.5}
    assert rows[1.5]["over"]["derived"] and not rows[2.5]["over"]["derived"]
    assert rows[1.5]["over"]["prob"] > rows[2.5]["over"]["prob"] > rows[3.5]["over"]["prob"] > rows[4.5]["over"]["prob"]
    assert abs(rows[2.5]["over"]["prob"] + rows[2.5]["under"]["prob"] - 1) < 1e-6
    assert m["corners"]["status"] == "unavailable" and m["log"] == []
    far = football.assemble({**FIX[0], "kickoff": FAR}, None, [], b, NOW, False)
    assert far["corners"]["status"] == "not_open"


def test_football_corner_ladder():
    b = Board()
    for line, o, u in ((8.5, 1.5, 2.6), (9.5, 1.9, 1.95), (10.5, 2.4, 1.6)):
        b.add("pinnacle", "corners", line, "over", o); b.add("pinnacle", "corners", line, "under", u)
    m = football.assemble(FIX[0], None, [], b, NOW, False)
    lines = m["corners"]["lines"]
    assert [r["line"] for r in lines] == [8.5, 9.5, 10.5]
    assert lines[0]["over"]["prob"] > lines[1]["over"]["prob"] > lines[2]["over"]["prob"]


def test_basketball_ladder_and_win_probs():
    b = Board()
    for book in ("pinnacle", "draftkings"):
        b.add(book, "ml", None, "home", 1.50); b.add(book, "ml", None, "away", 2.70)
        b.add(book, "total", 224.5, "over", 1.91); b.add(book, "total", 224.5, "under", 1.91)
    b.add("pinnacle", "total", 220.5, "over", 1.60); b.add("pinnacle", "total", 220.5, "under", 2.40)
    m = basketball.assemble(FIX[0], b, "basketball_nba")
    assert m["result"]["home"]["prob"] > 0.6 and abs(m["result"]["home"]["prob"] + m["result"]["away"]["prob"] - 1) < 1e-6
    tot = m["totals"]
    assert any(r["main"] and r["line"] == 224.5 for r in tot)
    overs = [r["over"]["prob"] for r in tot]
    assert overs == sorted(overs, reverse=True) and len(tot) >= 7
    observed = next(r for r in tot if r["line"] == 220.5)
    assert not observed["over"]["derived"] and any(r["over"]["derived"] for r in tot)
    assert all(0 < p < 1 for p in overs) and m["meta"]["mu"] is not None


def test_api_endpoints(monkeypatch):
    from app import fdata
    from app.main import app
    monkeypatch.setattr(config, "ODDS_API_KEY", "")
    c = TestClient(app)
    lg = c.get("/api/leagues").json()
    assert {"football", "basketball"} <= set(lg)
    names = {l["name"] for g in lg["football"] for l in g["leagues"]}
    assert {"Premier League", "MLS", "Europa League"} <= names
    assert any(l["name"] == "NBA" for g in lg["basketball"] for l in g["leagues"])
    assert c.get("/api/matches?sport=football&league=nope").status_code == 404
    assert c.get("/api/matches?sport=basketball&league=basketball_nba").json()["matches"] == []
    assert c.get("/api/status").json()["keys"]["The Odds API"] is False
