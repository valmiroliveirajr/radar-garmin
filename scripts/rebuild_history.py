import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"
HISTORY = DATA / "history.json"
SERIES = DATA / "price_series.json"

entries = []
for path in sorted(SNAPSHOTS.glob("*.json")):
    try:
        snapshot = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"IGNORADO {path.name}: snapshot invalido ({exc})")
        continue
    if not isinstance(snapshot, dict):
        print(f"IGNORADO {path.name}: conteudo nao e objeto")
        continue
    date = path.stem
    entries.append({"date": date, **snapshot})

if not entries:
    raise SystemExit("Nenhum snapshot valido encontrado para reconstruir o historico")

entries.sort(key=lambda item: item.get("date", ""))
HISTORY.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Historico reconstruido com {len(entries)} snapshot(s)")

# Serie compacta para o grafico de evolucao do preco na interface (assets/history.js).
# history.json guarda o snapshot inteiro de cada dia e cresce ~100 KB por dia; a pagina
# le so este resumo: uma linha por produto por dia.
series = {}
for entry in entries:
    for product in entry.get("products") or []:
        if not isinstance(product, dict):
            continue
        pid = product.get("catalog_product_id")
        if not pid:
            continue
        offer = product.get("selected_offer") or {}
        market = product.get("market") or {}
        series.setdefault(pid, []).append({
            "date": entry.get("date"),
            "selected_price": offer.get("price"),
            "min_price": market.get("min_price"),
            "offer_count": market.get("offer_count"),
            "seller": offer.get("seller_nickname"),
        })

SERIES.write_text(
    json.dumps({"schema_version": 1, "products": series}, ensure_ascii=False, separators=(",", ":")),
    encoding="utf-8",
)
print(f"Serie de precos gerada para {len(series)} produto(s)")
