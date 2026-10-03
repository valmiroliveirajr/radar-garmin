import os, json, datetime, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WATCHLIST = DATA / "watchlist.json"
LATEST = DATA / "latest.json"
HISTORY = DATA / "history.json"
SNAPSHOTS = DATA / "snapshots"
TZ = datetime.timezone(datetime.timedelta(hours=-3))
NOW = datetime.datetime.now(TZ)
DAY = NOW.date().isoformat()

POLICY = [
    "eliminar ofertas usadas ou inativas",
    "priorizar vendedor confiavel e ativo",
    "entre vendedores confiaveis, priorizar garantia de fabrica",
    "dentro do melhor grupo, escolher o menor preco",
]


def token():
    value = os.environ.get("ML_ACCESS_TOKEN")
    if not value:
        raise RuntimeError("ML_ACCESS_TOKEN nao configurado")
    return value


def ml_get(path, access_token):
    req = urllib.request.Request(
        "https://api.mercadolibre.com" + path,
        headers={"Authorization": "Bearer " + access_token, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "ignore")
        return None, f"HTTP {exc.code}: {body[:1000]}"


def unique(values):
    out = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def extract_images(obj):
    urls = []
    for picture in (obj or {}).get("pictures") or []:
        if isinstance(picture, str):
            urls.append(picture)
        elif isinstance(picture, dict):
            urls.append(picture.get("secure_url") or picture.get("url") or picture.get("source"))
    for key in ("secure_thumbnail", "thumbnail"):
        urls.append((obj or {}).get(key))
    return unique(urls)


def extract_attributes(product):
    out = []
    for attr in (product or {}).get("attributes") or []:
        if not isinstance(attr, dict):
            continue
        out.append({
            "id": attr.get("id"),
            "name": attr.get("name"),
            "value_id": attr.get("value_id"),
            "value_name": attr.get("value_name"),
        })
    return out


def seller_info(seller_id, access_token, cache):
    if not seller_id:
        return {}
    if seller_id in cache:
        return cache[seller_id]
    data, err = ml_get(f"/users/{seller_id}", access_token)
    if err:
        out = {"seller_lookup_error": err}
        cache[seller_id] = out
        return out
    reputation = (data or {}).get("seller_reputation") or {}
    transactions = reputation.get("transactions") or {}
    ratings = transactions.get("ratings") or {}
    status = (data or {}).get("status") or {}
    out = {
        "seller_nickname": (data or {}).get("nickname"),
        "seller_status": status.get("site_status") if isinstance(status, dict) else status,
        "seller_reputation_level": reputation.get("level_id"),
        "power_seller_status": reputation.get("power_seller_status"),
        "seller_transactions_total": transactions.get("total"),
        "seller_transactions_completed": transactions.get("completed"),
        "seller_transactions_canceled": transactions.get("canceled"),
        "seller_rating_positive": ratings.get("positive"),
        "seller_rating_neutral": ratings.get("neutral"),
        "seller_rating_negative": ratings.get("negative"),
        "seller_permalink": (data or {}).get("permalink"),
    }
    cache[seller_id] = out
    return out


def is_factory_warranty(text):
    return isinstance(text, str) and "garantia de f" in text.lower()


def selection_tier(candidate):
    if candidate.get("trusted_seller_rule") and candidate.get("factory_warranty"):
        return "trusted_factory_warranty"
    if candidate.get("trusted_seller_rule"):
        return "trusted_seller"
    if candidate.get("factory_warranty"):
        return "factory_warranty_untrusted_seller"
    return "fallback_price"


def selection_key(candidate):
    return (
        not bool(candidate.get("trusted_seller_rule")),
        not bool(candidate.get("factory_warranty")),
        float(candidate.get("price", 10**12)),
    )


def exact_offer_url(product_id, item_id):
    return f"https://www.mercadolivre.com.br/p/{product_id}?wid={item_id}"


def collect_product(entry, access_token):
    product_id = entry.get("catalog_product_id")
    if not product_id:
        raise RuntimeError("catalog_product_id ausente na watchlist")

    product, product_error = ml_get(f"/products/{product_id}", access_token)
    if product_error:
        raise RuntimeError(f"produto {product_id}: {product_error}")

    items, items_error = ml_get(f"/products/{product_id}/items", access_token)
    if items_error:
        raise RuntimeError(f"ofertas {product_id}: {items_error}")

    seller_cache = {}
    candidates = []
    rows = (items or {}).get("results") or []

    for row in rows:
        if row.get("condition") not in (None, "new"):
            continue
        if row.get("status") not in (None, "active"):
            continue
        price = row.get("price")
        item_id = row.get("item_id") or row.get("id")
        if price is None or not item_id:
            continue

        seller_id = row.get("seller_id") or ((row.get("seller") or {}).get("id"))
        shipping = row.get("shipping") or {}
        warranty = row.get("warranty")
        candidate = {
            "item_id": item_id,
            "seller_id": seller_id,
            "price": float(price),
            "original_price": row.get("original_price"),
            "currency_id": row.get("currency_id") or "BRL",
            "condition": row.get("condition") or "new",
            "item_status": row.get("status") or "active",
            "listing_type_id": row.get("listing_type_id"),
            "official_store_id": row.get("official_store_id"),
            "warranty": warranty,
            "factory_warranty": is_factory_warranty(warranty),
            "free_shipping": shipping.get("free_shipping"),
            "shipping_cost": shipping.get("cost"),
            "logistic_type": shipping.get("logistic_type"),
            "url": exact_offer_url(product_id, item_id),
            "images": extract_images(row),
        }
        candidate.update(seller_info(seller_id, access_token, seller_cache))
        level = candidate.get("seller_reputation_level")
        candidate["trusted_seller_rule"] = bool(
            candidate.get("seller_status") == "active"
            and (
                level == "5_green"
                or candidate.get("power_seller_status") in ("silver", "gold", "platinum")
            )
        )
        candidate["selection_tier"] = selection_tier(candidate)
        candidates.append(candidate)

    candidates.sort(key=selection_key)
    if not candidates:
        raise RuntimeError(f"nenhuma oferta nova e ativa no catalogo {product_id}")

    for index, candidate in enumerate(candidates, 1):
        candidate["selection_rank"] = index

    best = candidates[0]
    trusted = [x for x in candidates if x.get("trusted_seller_rule")]
    trusted_factory = [x for x in trusted if x.get("factory_warranty")]
    market_min = min(x["price"] for x in candidates)

    images = extract_images(product)
    if not images:
        images = unique(url for candidate in candidates for url in candidate.get("images", []))

    product_name = (product or {}).get("name") or entry.get("name") or product_id
    selected_offer = {
        "item_id": best.get("item_id"),
        "url": best.get("url"),
        "price": best.get("price"),
        "original_price": best.get("original_price"),
        "currency_id": best.get("currency_id"),
        "condition": best.get("condition"),
        "status": best.get("item_status"),
        "listing_type_id": best.get("listing_type_id"),
        "official_store_id": best.get("official_store_id"),
        "seller_id": best.get("seller_id"),
        "seller_nickname": best.get("seller_nickname"),
        "seller_status": best.get("seller_status"),
        "seller_reputation_level": best.get("seller_reputation_level"),
        "power_seller_status": best.get("power_seller_status"),
        "seller_transactions_total": best.get("seller_transactions_total"),
        "seller_transactions_completed": best.get("seller_transactions_completed"),
        "seller_transactions_canceled": best.get("seller_transactions_canceled"),
        "seller_rating_positive": best.get("seller_rating_positive"),
        "seller_rating_neutral": best.get("seller_rating_neutral"),
        "seller_rating_negative": best.get("seller_rating_negative"),
        "seller_permalink": best.get("seller_permalink"),
        "warranty": best.get("warranty"),
        "factory_warranty": best.get("factory_warranty"),
        "free_shipping": best.get("free_shipping"),
        "shipping_cost": best.get("shipping_cost"),
        "logistic_type": best.get("logistic_type"),
        "trusted_seller_rule": best.get("trusted_seller_rule"),
        "selection_tier": best.get("selection_tier"),
        "selection_rank": 1,
        "selection_reason": (
            "vendedor confiavel + garantia de fabrica + menor preco do melhor grupo"
            if best.get("trusted_seller_rule") and best.get("factory_warranty")
            else "melhor oferta segundo a politica validada"
        ),
    }

    return {
        "id": entry.get("id") or product_id.lower(),
        "catalog_product_id": product_id,
        "name": product_name,
        "status": (product or {}).get("status"),
        "domain_id": (product or {}).get("domain_id"),
        "family_name": (product or {}).get("family_name"),
        "site_id": "MLB",
        "images": images,
        "thumbnail": images[0] if images else None,
        "attributes": extract_attributes(product),
        "added_at": entry.get("added_at"),
        "collected_at": NOW.isoformat(),
        "source": "Mercado Livre",
        "available": True,
        "error": None,
        "selection_policy": POLICY,
        "selected_offer": selected_offer,
        "market": {
            "offer_count": len(candidates),
            "min_price": market_min,
            "trusted_count": len(trusted),
            "trusted_factory_warranty_count": len(trusted_factory),
            "selected_price_premium_vs_market_min": round(float(best["price"]) - float(market_min), 2),
        },
        "market_offers": candidates,
    }


def error_product(entry, exc):
    return {
        "id": entry.get("id") or (entry.get("catalog_product_id") or "produto").lower(),
        "catalog_product_id": entry.get("catalog_product_id"),
        "name": entry.get("name") or entry.get("catalog_product_id") or "Produto",
        "site_id": "MLB",
        "images": [],
        "thumbnail": None,
        "attributes": [],
        "added_at": entry.get("added_at"),
        "collected_at": NOW.isoformat(),
        "source": "Mercado Livre",
        "available": False,
        "error": f"{type(exc).__name__}: {exc}",
        "selection_policy": POLICY,
        "selected_offer": None,
        "market": {"offer_count": 0, "min_price": None, "trusted_count": 0, "trusted_factory_warranty_count": 0, "selected_price_premium_vs_market_min": None},
        "market_offers": [],
    }


def save_snapshot(snapshot):
    DATA.mkdir(exist_ok=True)
    SNAPSHOTS.mkdir(exist_ok=True)
    LATEST.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    (SNAPSHOTS / f"{DAY}.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")

    history = []
    if HISTORY.exists():
        try:
            history = json.loads(HISTORY.read_text(encoding="utf-8"))
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []
    history = [entry for entry in history if entry.get("date") != DAY]
    history.append({"date": DAY, **snapshot})
    history.sort(key=lambda entry: entry.get("date", ""))
    HISTORY.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    if not WATCHLIST.exists():
        raise SystemExit("data/watchlist.json nao encontrado")
    watchlist = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    entries = [entry for entry in watchlist.get("products", []) if entry.get("active", True)]
    if not entries:
        raise SystemExit("watchlist sem produtos ativos")

    access_token = token()
    products = []
    errors = []
    for entry in entries:
        try:
            product = collect_product(entry, access_token)
            products.append(product)
            offer = product["selected_offer"]
            print(f"ML OK {product['catalog_product_id']}: {offer['item_id']} | R$ {offer['price']:.2f} | {product['name']}")
        except Exception as exc:
            products.append(error_product(entry, exc))
            errors.append(f"{entry.get('catalog_product_id')}: {type(exc).__name__}: {exc}")
            print("ML ERRO", errors[-1])

    snapshot = {
        "schema_version": 2,
        "source": "Mercado Livre",
        "site_id": "MLB",
        "collected_at": NOW.isoformat(),
        "products": products,
    }
    save_snapshot(snapshot)
    if errors:
        raise SystemExit("; ".join(errors))


if __name__ == "__main__":
    main()
