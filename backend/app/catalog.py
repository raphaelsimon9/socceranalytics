"""League catalogue. Football-data.org free-tier competitions get the full goal model; every other league
comes from The Odds API (and OddsPapi where a tournament id is known) and is analysed from market prices."""
from . import oddsapi
from .util import cached

# key, name, country, football-data code, the-odds-api key, oddspapi tournament id
_FB_MODEL = [
    ("PL", "Premier League", "England", "PL", "soccer_epl", 17),
    ("ELC", "Championship", "England", "ELC", "soccer_efl_champ", 18),
    ("PD", "La Liga", "Spain", "PD", "soccer_spain_la_liga", 8),
    ("SA", "Serie A", "Italy", "SA", "soccer_italy_serie_a", 23),
    ("BL1", "Bundesliga", "Germany", "BL1", "soccer_germany_bundesliga", 35),
    ("FL1", "Ligue 1", "France", "FL1", "soccer_france_ligue_one", 34),
    ("DED", "Eredivisie", "Netherlands", "DED", "soccer_netherlands_eredivisie", 37),
    ("PPL", "Primeira Liga", "Portugal", "PPL", "soccer_portugal_primeira_liga", 238),
    ("BSA", "Série A", "Brazil", "BSA", "soccer_brazil_campeonato", 325),
    ("CL", "Champions League", "Europe", "CL", "soccer_uefa_champs_league", 7),
]
# odds-only leagues: (the-odds-api key, name, country, oddspapi tournament id or None)
_FB_ODDS = [
    ("soccer_uefa_europa_league", "Europa League", "Europe", 679),
    ("soccer_uefa_europa_conf_league", "Conference League", "Europe", None),
    ("soccer_conmebol_copa_libertadores", "Copa Libertadores", "South America", None),
    ("soccer_england_league1", "League One", "England", None),
    ("soccer_england_league2", "League Two", "England", None),
    ("soccer_fa_cup", "FA Cup", "England", None),
    ("soccer_spain_segunda_division", "La Liga 2", "Spain", None),
    ("soccer_italy_serie_b", "Serie B", "Italy", None),
    ("soccer_germany_bundesliga2", "2. Bundesliga", "Germany", None),
    ("soccer_france_ligue_two", "Ligue 2", "France", None),
    ("soccer_belgium_first_div", "Pro League", "Belgium", None),
    ("soccer_turkey_super_league", "Süper Lig", "Turkey", None),
    ("soccer_spl", "Premiership", "Scotland", None),
    ("soccer_greece_super_league", "Super League", "Greece", None),
    ("soccer_denmark_superliga", "Superliga", "Denmark", None),
    ("soccer_sweden_allsvenskan", "Allsvenskan", "Sweden", None),
    ("soccer_norway_eliteserien", "Eliteserien", "Norway", None),
    ("soccer_switzerland_superleague", "Super League", "Switzerland", None),
    ("soccer_austria_bundesliga", "Bundesliga", "Austria", None),
    ("soccer_poland_ekstraklasa", "Ekstraklasa", "Poland", None),
    ("soccer_league_of_ireland", "Premier Division", "Ireland", None),
    ("soccer_usa_mls", "MLS", "USA", 242),
    ("soccer_mexico_ligamx", "Liga MX", "Mexico", None),
    ("soccer_argentina_primera_division", "Primera División", "Argentina", None),
    ("soccer_brazil_serie_b", "Série B", "Brazil", None),
    ("soccer_australia_aleague", "A-League", "Australia", None),
    ("soccer_japan_j_league", "J1 League", "Japan", None),
    ("soccer_korea_kleague1", "K League 1", "South Korea", None),
    ("soccer_china_superleague", "Super League", "China", None),
]
_BB = [  # the-odds-api key, name, country, oddspapi tournament id or None
    ("basketball_nba", "NBA", "USA", 132),
    ("basketball_euroleague", "EuroLeague", "Europe", 138),
    ("basketball_ncaab", "NCAA Men", "USA", None),
    ("basketball_wnba", "WNBA", "USA", None),
    ("basketball_wncaab", "NCAA Women", "USA", None),
    ("basketball_nbl", "NBL", "Australia", None),
]
_COUNTRY_HINT = {"england": "England", "spain": "Spain", "italy": "Italy", "germany": "Germany", "france": "France",
                 "netherlands": "Netherlands", "portugal": "Portugal", "brazil": "Brazil", "argentina": "Argentina",
                 "usa": "USA", "mexico": "Mexico", "turkey": "Turkey", "scotland": "Scotland", "spl": "Scotland",
                 "belgium": "Belgium", "australia": "Australia", "japan": "Japan", "korea": "South Korea",
                 "china": "China", "uefa": "Europe", "conmebol": "South America", "fiba": "Europe",
                 "euroleague": "Europe", "denmark": "Denmark", "sweden": "Sweden", "norway": "Norway"}


def static() -> dict:
    fb = [dict(key=k, sport="football", name=n, country=c, fd=fd, oa=oa, op=op, model=True)
          for k, n, c, fd, oa, op in _FB_MODEL]
    fb += [dict(key=oa, sport="football", name=n, country=c, fd=None, oa=oa, op=op, model=False)
           for oa, n, c, op in _FB_ODDS]
    bb = [dict(key=oa, sport="basketball", name=n, country=c, fd=None, oa=oa, op=op, model=False)
          for oa, n, c, op in _BB]
    return {"football": fb, "basketball": bb}


async def all_leagues() -> dict:
    """Static catalogue + every extra soccer/basketball competition The Odds API currently lists as active."""
    cat = static()
    known = {l["oa"] for v in cat.values() for l in v}
    try:
        live = await cached("oa:sports", 12 * 3600, oddsapi.sports) if oddsapi.configured() else []
    except Exception:
        live = []
    for s in live:
        key, group = s.get("key", ""), (s.get("group") or "").lower()
        if key in known or s.get("has_outrights") or not s.get("active", True):
            continue
        sport = "football" if group == "soccer" else "basketball" if group == "basketball" else None
        if not sport:
            continue
        country = next((v for k, v in _COUNTRY_HINT.items() if k in key), "Other")
        cat[sport].append(dict(key=key, sport=sport, name=s.get("title") or key, country=country,
                               fd=None, oa=key, op=None, model=False))
    # drop leagues The Odds API says are out of season/inactive (keeps the dropdown honest)
    active = {s["key"] for s in live if s.get("active", True)}
    if active:
        for sport in cat:
            cat[sport] = [l for l in cat[sport] if l["model"] or l["oa"] in active]
    return cat


async def find(sport: str, key: str):
    for l in (await all_leagues()).get(sport, []):
        if l["key"] == key:
            return l
    return None
