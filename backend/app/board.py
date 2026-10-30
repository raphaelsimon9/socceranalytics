"""OddsBoard: every price quoted for one match, from every bookmaker/provider, plus consensus probabilities.

Markets: h2h (3-way 1X2) | ml (2-way moneyline) | total | btts | corners | shots | sot
Consensus probability = de-vigged (margin removed) bookmaker prices, averaged with Pinnacle counted 3x."""
from collections import defaultdict

SELS = {"h2h": ("home", "draw", "away"), "ml": ("home", "away"), "btts": ("yes", "no"),
        "total": ("over", "under"), "corners": ("over", "under"), "shots": ("over", "under"), "sot": ("over", "under")}
SHARP = {"pinnacle"}
SHARP_WEIGHT = 3.0


class Board:
    def __init__(self):
        self.q = defaultdict(lambda: defaultdict(dict))   # (market, line) -> book -> {sel: price}
        self.sources: set = set()

    def add(self, book: str, market: str, line, sel: str, price, source: str = ""):
        try:
            price = float(price)
        except (TypeError, ValueError):
            return
        if price <= 1.0 or sel not in SELS.get(market, ()):
            return
        self.q[(market, line)][book.lower()][sel] = price
        if source:
            self.sources.add(source)

    def lines(self, market: str, football: bool = True) -> list:
        out = []
        for (m, line), books in self.q.items():
            if m != market or line is None:
                continue
            if any(len(b) == len(SELS[market]) for b in books.values()):
                out.append(line)
        return sorted(out)

    def fair(self, market: str, line=None) -> dict | None:
        books = self.q.get((market, line))
        if not books:
            return None
        sels = SELS[market]
        acc, wsum, n, sharp, per_book = defaultdict(float), 0.0, 0, False, defaultdict(list)
        from .util import devig
        for book, quotes in books.items():
            if len(quotes) != len(sels):
                continue
            probs = devig([quotes[s] for s in sels])
            if not probs:
                continue
            w = SHARP_WEIGHT if book in SHARP else 1.0
            sharp = sharp or book in SHARP
            for s, p in zip(sels, probs):
                acc[s] += w * p
                per_book[s].append(p)
            wsum += w
            n += 1
        if not n:
            return None
        spread = max(per_book[sels[0]]) - min(per_book[sels[0]])
        return {"probs": {s: acc[s] / wsum for s in sels}, "n": n, "sharp": sharp, "spread": spread}

    def best(self, market: str, line, sel: str):
        best = None
        for book, quotes in (self.q.get((market, line)) or {}).items():
            p = quotes.get(sel)
            if p and (best is None or p > best[0]):
                best = (p, book)
        return best
