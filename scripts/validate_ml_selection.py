import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LATEST=ROOT/"data"/"latest.json"

if not LATEST.exists():
    raise SystemExit("FAIL: data/latest.json nao encontrado")

data=json.loads(LATEST.read_text(encoding="utf-8"))
ml=None
for model in data.get("models",[]):
    if model.get("id") != "forerunner-570":
        continue
    for offer in model.get("offers",[]):
        if offer.get("store") == "Mercado Livre":
            ml=offer
            break

if not ml:
    raise SystemExit("FAIL: oferta Mercado Livre do Forerunner 570 nao encontrada")
if ml.get("error"):
    raise SystemExit(f"FAIL: coleta ML com erro: {ml.get('error')}")
if not ml.get("available"):
    raise SystemExit("FAIL: oferta selecionada nao esta disponivel")
if ml.get("collection_source") != "catalog_product_items":
    raise SystemExit(f"FAIL: fonte inesperada: {ml.get('collection_source')}")

offers=ml.get("market_offers") or []
if not offers:
    raise SystemExit("FAIL: market_offers vazio")

for c in offers:
    if c.get("condition") not in (None,"new"):
        raise SystemExit(f"FAIL: oferta usada entrou no ranking: {c.get('item_id')}")
    if c.get("item_status") not in (None,"active"):
        raise SystemExit(f"FAIL: oferta inativa entrou no ranking: {c.get('item_id')}")

expected=sorted(
    offers,
    key=lambda c:(
        not bool(c.get("trusted_seller_rule")),
        not bool(c.get("factory_warranty")),
        float(c.get("price",10**12)),
    ),
)[0]

if ml.get("winner_item_id") != expected.get("item_id"):
    raise SystemExit(
        f"FAIL: vencedor {ml.get('winner_item_id')} != esperado {expected.get('item_id')}"
    )
if float(ml.get("price")) != float(expected.get("price")):
    raise SystemExit(
        f"FAIL: preco vencedor {ml.get('price')} != esperado {expected.get('price')}"
    )
if f"wid={ml.get('winner_item_id')}" not in (ml.get("url") or ""):
    raise SystemExit("FAIL: URL vencedora nao aponta para o item exato")

trusted=[c for c in offers if c.get("trusted_seller_rule")]
trusted_factory=[c for c in trusted if c.get("factory_warranty")]
if trusted and not ml.get("trusted_seller_rule"):
    raise SystemExit("FAIL: havia vendedor confiavel, mas o vencedor nao e confiavel")
if trusted_factory and not ml.get("factory_warranty"):
    raise SystemExit("FAIL: havia oferta confiavel com garantia de fabrica, mas ela nao foi priorizada")

winning_pool=(
    trusted_factory if trusted_factory
    else trusted if trusted
    else [c for c in offers if c.get("factory_warranty")]
    or offers
)
min_price=min(float(c.get("price")) for c in winning_pool)
if float(ml.get("price")) != min_price:
    raise SystemExit(
        f"FAIL: vencedor nao e o menor preco do grupo prioritario: {ml.get('price')} != {min_price}"
    )

print("PASS: regra Mercado Livre validada")
print(f"Produto: {ml.get('title')}")
print(f"Item: {ml.get('winner_item_id')}")
print(f"Preco: R$ {float(ml.get('price')):.2f}")
print(f"Vendedor: {ml.get('seller_nickname')} | reputacao={ml.get('seller_reputation_level')}")
print(f"Garantia: {ml.get('warranty')}")
print(f"Ofertas avaliadas: {len(offers)}")
print(f"Tier: {ml.get('selection_tier')}")
print(f"URL: {ml.get('url')}")
