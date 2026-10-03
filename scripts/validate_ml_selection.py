import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
LATEST = DATA / "latest.json"
WATCHLIST = DATA / "watchlist.json"

if not LATEST.exists():
    raise SystemExit("FAIL: data/latest.json nao encontrado")
if not WATCHLIST.exists():
    raise SystemExit("FAIL: data/watchlist.json nao encontrado")

data = json.loads(LATEST.read_text(encoding="utf-8"))
watchlist = json.loads(WATCHLIST.read_text(encoding="utf-8"))
expected = {
    p.get("catalog_product_id")
    for p in watchlist.get("products", [])
    if p.get("active", True) and p.get("catalog_product_id")
}

if data.get("schema_version") != 2:
    raise SystemExit(f"FAIL: schema_version inesperado: {data.get('schema_version')}")
if data.get("source") != "Mercado Livre":
    raise SystemExit(f"FAIL: fonte inesperada: {data.get('source')}")

seen = set()
for product in data.get("products", []):
    pid = product.get("catalog_product_id")
    if pid not in expected:
        continue
    seen.add(pid)
    if product.get("error"):
        raise SystemExit(f"FAIL {pid}: coleta com erro: {product.get('error')}")
    if not product.get("available"):
        raise SystemExit(f"FAIL {pid}: produto indisponivel")

    offer = product.get("selected_offer") or {}
    offers = product.get("market_offers") or []
    if not offer or not offers:
        raise SystemExit(f"FAIL {pid}: oferta selecionada ou market_offers ausente")

    for candidate in offers:
        if candidate.get("condition") not in (None, "new"):
            raise SystemExit(f"FAIL {pid}: oferta usada no ranking: {candidate.get('item_id')}")
        if candidate.get("item_status") not in (None, "active"):
            raise SystemExit(f"FAIL {pid}: oferta inativa no ranking: {candidate.get('item_id')}")

    ranked = sorted(
        offers,
        key=lambda candidate: (
            not bool(candidate.get("trusted_seller_rule")),
            not bool(candidate.get("factory_warranty")),
            float(candidate.get("price", 10**12)),
        ),
    )
    winner = ranked[0]
    if offer.get("item_id") != winner.get("item_id"):
        raise SystemExit(f"FAIL {pid}: vencedor {offer.get('item_id')} != esperado {winner.get('item_id')}")
    if float(offer.get("price")) != float(winner.get("price")):
        raise SystemExit(f"FAIL {pid}: preco vencedor incorreto")
    if f"wid={offer.get('item_id')}" not in (offer.get("url") or ""):
        raise SystemExit(f"FAIL {pid}: URL nao aponta para o item exato")

    trusted = [c for c in offers if c.get("trusted_seller_rule")]
    trusted_factory = [c for c in trusted if c.get("factory_warranty")]
    if trusted and not offer.get("trusted_seller_rule"):
        raise SystemExit(f"FAIL {pid}: havia vendedor confiavel, mas o vencedor nao e confiavel")
    if trusted_factory and not offer.get("factory_warranty"):
        raise SystemExit(f"FAIL {pid}: havia oferta confiavel com garantia de fabrica, mas ela nao foi priorizada")

    pool = trusted_factory if trusted_factory else trusted if trusted else [c for c in offers if c.get("factory_warranty")] or offers
    minimum = min(float(c.get("price")) for c in pool)
    if float(offer.get("price")) != minimum:
        raise SystemExit(f"FAIL {pid}: vencedor nao e o menor preco do grupo prioritario")

    print(
        f"PASS {pid}: item={offer.get('item_id')} | R$ {float(offer.get('price')):.2f} | "
        f"{offer.get('seller_nickname')} | {offer.get('selection_tier')} | imagens={len(product.get('images') or [])}"
    )

missing = expected - seen
if missing:
    raise SystemExit("FAIL: produtos ausentes: " + ", ".join(sorted(missing)))

print("PASS: watchlist Mercado Livre validada")
