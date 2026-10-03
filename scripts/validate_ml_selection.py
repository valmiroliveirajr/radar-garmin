import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LATEST=ROOT/"data"/"latest.json"
EXPECTED={"forerunner-570","forerunner-970","venu-4","hrm600"}

if not LATEST.exists():
    raise SystemExit("FAIL: data/latest.json nao encontrado")

data=json.loads(LATEST.read_text(encoding="utf-8"))
seen=set()

for model in data.get("models",[]):
    mid=model.get("id")
    if mid not in EXPECTED:
        continue
    ml=next((o for o in model.get("offers",[]) if o.get("store")=="Mercado Livre"),None)
    if not ml:
        raise SystemExit(f"FAIL: oferta Mercado Livre nao encontrada para {mid}")
    seen.add(mid)
    if ml.get("error"):
        raise SystemExit(f"FAIL {mid}: coleta ML com erro: {ml.get('error')}")
    if not ml.get("available"):
        raise SystemExit(f"FAIL {mid}: oferta selecionada nao esta disponivel")
    if ml.get("collection_source") != "catalog_product_items":
        raise SystemExit(f"FAIL {mid}: fonte inesperada: {ml.get('collection_source')}")
    if not ml.get("catalog_product_id"):
        raise SystemExit(f"FAIL {mid}: catalog_product_id ausente")

    offers=ml.get("market_offers") or []
    if not offers:
        raise SystemExit(f"FAIL {mid}: market_offers vazio")

    for c in offers:
        if c.get("condition") not in (None,"new"):
            raise SystemExit(f"FAIL {mid}: oferta usada entrou no ranking: {c.get('item_id')}")
        if c.get("item_status") not in (None,"active"):
            raise SystemExit(f"FAIL {mid}: oferta inativa entrou no ranking: {c.get('item_id')}")

    expected=sorted(offers,key=lambda c:(not bool(c.get("trusted_seller_rule")),not bool(c.get("factory_warranty")),float(c.get("price",10**12))))[0]
    if ml.get("winner_item_id") != expected.get("item_id"):
        raise SystemExit(f"FAIL {mid}: vencedor {ml.get('winner_item_id')} != esperado {expected.get('item_id')}")
    if float(ml.get("price")) != float(expected.get("price")):
        raise SystemExit(f"FAIL {mid}: preco vencedor {ml.get('price')} != esperado {expected.get('price')}")
    if f"wid={ml.get('winner_item_id')}" not in (ml.get("url") or ""):
        raise SystemExit(f"FAIL {mid}: URL vencedora nao aponta para o item exato")

    trusted=[c for c in offers if c.get("trusted_seller_rule")]
    trusted_factory=[c for c in trusted if c.get("factory_warranty")]
    if trusted and not ml.get("trusted_seller_rule"):
        raise SystemExit(f"FAIL {mid}: havia vendedor confiavel, mas o vencedor nao e confiavel")
    if trusted_factory and not ml.get("factory_warranty"):
        raise SystemExit(f"FAIL {mid}: havia oferta confiavel com garantia de fabrica, mas ela nao foi priorizada")

    winning_pool=trusted_factory if trusted_factory else trusted if trusted else [c for c in offers if c.get("factory_warranty")] or offers
    min_price=min(float(c.get("price")) for c in winning_pool)
    if float(ml.get("price")) != min_price:
        raise SystemExit(f"FAIL {mid}: vencedor nao e o menor preco do grupo prioritario: {ml.get('price')} != {min_price}")

    print(f"PASS {mid}: {ml.get('catalog_product_id')} | item={ml.get('winner_item_id')} | R$ {float(ml.get('price')):.2f} | {ml.get('seller_nickname')} | {ml.get('selection_tier')}")

missing=EXPECTED-seen
if missing:
    raise SystemExit("FAIL: modelos ML ausentes: "+", ".join(sorted(missing)))
print("PASS: regra Mercado Livre validada para todos os produtos")
