"""Shared pieces: confidence scoring, pick entries, and the 'top picks' selector."""


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def confidence(prob: float, kind: str = "binary", sample=None, market_prob=None, books: int = 0,
               sharp: bool = False, derived: bool = False) -> dict:
    """0-100 score from: how decisive the probability is, how much data backs the model, whether the market
    agrees with it, and how deep/sharp the market is. Missing ingredients are left out, not guessed."""
    strength = clamp((prob - 0.34) / 0.36) if kind == "three" else clamp(abs(prob - 0.5) / 0.30)
    parts = [(0.35, strength)]
    if sample is not None:
        parts.append((0.25, clamp(sample / 20)))
    if market_prob is not None:
        parts.append((0.25, 1 - clamp(abs(prob - market_prob) / 0.15)))
    if books:
        parts.append((0.15, clamp(books / 6 + (0.25 if sharp else 0))))
    score = 100 * sum(w * v for w, v in parts) / sum(w for w, _ in parts)
    if derived:
        score *= 0.9
    score = int(round(score))
    return {"score": score, "label": "High" if score >= 68 else "Medium" if score >= 48 else "Low"}


def entry(label: str, prob: float, *, best=None, model_p=None, market_p=None, sample=None, books=0,
          sharp=False, derived=False, kind="binary", key=None, family="") -> dict:
    odds, book = (best if best else (None, None))
    return {
        "label": label, "key": key, "family": family, "prob": round(prob, 4),
        "odds": round(odds, 2) if odds else None, "book": book,
        "edge": round(prob * odds - 1, 4) if odds else None,
        "model_prob": None if model_p is None else round(model_p, 4),
        "market_prob": None if market_p is None else round(market_p, 4),
        "derived": derived,
        "conf": confidence(prob, kind, sample, market_p if model_p is not None else None, books, sharp, derived),
    }


def top_picks(entries: list, lo=0.55, hi=0.82, n=3) -> list:
    """Best-supported selections: decent probability but not a trivially short price, one per market family."""
    pool = [e for e in entries if e and lo <= e["prob"] <= hi]
    pool.sort(key=lambda e: (e["conf"]["score"] * e["prob"]), reverse=True)
    out, seen = [], set()
    for e in pool:
        if e["family"] in seen:
            continue
        seen.add(e["family"])
        out.append(e)
        if len(out) == n:
            break
    return out
