import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"
HISTORY = DATA / "history.json"

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
