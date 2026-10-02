import json, os, urllib.request, datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"; DATA.mkdir(exist_ok=True)
# Catálogo inicial oficial. A coleta de lojas deve usar APIs/endpoints permitidos por cada fonte.
models=[
 {"id":"forerunner-970","name":"Forerunner 970","status":"current"},
 {"id":"forerunner-570","name":"Forerunner 570","status":"current"},
 {"id":"forerunner-965","name":"Forerunner 965","status":"track"},
 {"id":"forerunner-265","name":"Forerunner 265","status":"track"},
 {"id":"forerunner-165","name":"Forerunner 165","status":"track"}
]
today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).isoformat()
snapshot={"collected_at":today,"models":[],"note":"Estrutura pronta. Preços só entram após integração autorizada com cada fonte."}
for m in models:
    snapshot["models"].append({**m,"offers":[],"summary":{"min":None,"max":None,"avg":None}})
day=today[:10]
(DATA/"snapshots").mkdir(exist_ok=True)
(DATA/"snapshots"/f"{day}.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
(DATA/"latest.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
hist=DATA/"history.json"
arr=json.loads(hist.read_text(encoding="utf-8")) if hist.exists() else []
arr=[x for x in arr if x.get("date")!=day]
arr.append({"date":day,"collected_at":today,"models":snapshot["models"]})
hist.write_text(json.dumps(arr,ensure_ascii=False,indent=2),encoding="utf-8")
