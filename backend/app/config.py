import os


def _list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


# The three data sources
FOOTBALL_DATA_KEY = os.getenv("FOOTBALL_DATA_KEY", "")   # football-data.org  (results + fixtures -> goal model)
ODDS_API_KEY = os.getenv("ODDS_API_KEY", "")             # the-odds-api.com   (odds, many bookmakers, leagues)
ODDSPAPI_KEY = os.getenv("ODDSPAPI_KEY", "")             # oddspapi.io        (Pinnacle odds, corners, shots)

ODDSPAPI_BOOKMAKERS = _list("ODDSPAPI_BOOKMAKERS", "pinnacle")   # one request per slug per league
THEODDSAPI_REGIONS = os.getenv("THEODDSAPI_REGIONS", "eu")        # credits = markets x regions per call
ODDS_CACHE_SECONDS = int(os.getenv("ODDS_CACHE_SECONDS", "21600"))  # 6 h: protects the 500 free credits/month
ODDS_API_MIN_CREDITS = int(os.getenv("ODDS_API_MIN_CREDITS", "20"))  # stop spending below this reserve
MODEL_WEIGHT = float(os.getenv("MODEL_WEIGHT", "0.6"))   # football-data leagues: weight of own model vs market
CORS_ORIGINS = _list("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
