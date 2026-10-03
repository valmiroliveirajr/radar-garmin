import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WATCHLIST = DATA / "watchlist.json"
LATEST = DATA / "latest.json"
HISTORY = DATA / "history.json"


def uniq(values):
    out = []
    seen = set()
    for value in values or []:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def apply(snapshot, prefs):
    for product in snapshot.get("products", []):
        pid = product.get("catalog_product_id")
        entry = prefs.get(pid)
        if not entry:
            continue
        product["origin_policy"] = entry.get("origin_policy", "all")
        product["watchlist_name"] = entry.get("name") or product.get("name")
        cover = entry.get("cover_image")
        gallery = uniq(entry.get("gallery_images") or [])
        if cover or gallery:
            images = uniq([cover, *gallery, *(product.get("images") or [])])
            product["cover_image"] = cover or (images[0] if images else None)
            product["gallery_images"] = gallery or images
            product["images"] = images
            product["thumbnail"] = product["cover_image"] or (images[0] if images else None)
    return snapshot


def main():
    if not WATCHLIST.exists() or not LATEST.exists():
        return
    watchlist = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    prefs = {p.get("catalog_product_id"): p for p in watchlist.get("products", []) if p.get("catalog_product_id")}
    latest = json.loads(LATEST.read_text(encoding="utf-8"))
    latest = apply(latest, prefs)
    LATEST.write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    collected_at = latest.get("collected_at") or ""
    day = collected_at[:10]
    if day:
        snap = DATA / "snapshots" / f"{day}.json"
        if snap.exists():
            snap.write_text(json.dumps(apply(json.loads(snap.read_text(encoding="utf-8")), prefs), ensure_ascii=False, indent=2), encoding="utf-8")

        if HISTORY.exists():
            history = json.loads(HISTORY.read_text(encoding="utf-8"))
            for i, entry in enumerate(history):
                if entry.get("date") == day:
                    history[i] = {"date": day, **latest}
                    break
            HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
