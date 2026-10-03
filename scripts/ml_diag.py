import os, json, re, urllib.request, urllib.parse, urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
DATA.mkdir(exist_ok=True)
TOKEN=os.environ.get("ML_ACCESS_TOKEN","")
APP_ID=os.environ.get("ML_CLIENT_ID","")
PRODUCT_URL="https://www.mercadolivre.com.br/garmin-forerunner-570-preto-47mm/p/MLB51160740?wid=MLB5145446199"

def get(path):
    req=urllib.request.Request(
        "https://api.mercadolibre.com"+path,
        headers={"Authorization":"Bearer "+TOKEN,"Accept":"application/json"},
    )
    try:
        with urllib.request.urlopen(req,timeout=25) as r:
            body=json.loads(r.read().decode("utf-8","ignore"))
            return {"http":r.status,"body":body}
    except urllib.error.HTTPError as e:
        raw=e.read().decode("utf-8","ignore")
        try: body=json.loads(raw)
        except Exception: body=raw[:1000]
        return {"http":e.code,"body":body}
    except Exception as e:
        return {"http":None,"error":f"{type(e).__name__}: {e}"}

def public_page(url):
    req=urllib.request.Request(url,headers={
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"pt-BR,pt;q=0.9,en;q=0.7",
    })
    try:
        with urllib.request.urlopen(req,timeout=30) as r:
            html=r.read().decode("utf-8","ignore")
            title=(re.search(r"<title[^>]*>(.*?)</title>",html,re.I|re.S) or [None,None])[1]
            patterns=[
                r'"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)',
                r'itemprop=["\']price["\'][^>]*content=["\']([0-9.]+)',
                r'content=["\']([0-9.]+)["\'][^>]*itemprop=["\']price["\']',
                r'R\$\s*([0-9\.]+(?:,[0-9]{2})?)',
            ]
            vals=[]
            for pat in patterns:
                for x in re.findall(pat,html,re.I):
                    try:
                        v=float(x.replace(".","").replace(",",".")) if "," in x else float(x)
                        if 1000 <= v <= 15000 and v not in vals: vals.append(v)
                    except Exception: pass
            return {
                "http":r.status,"final_url":r.geturl(),"title":re.sub(r"\s+"," ",title or "").strip()[:300],
                "html_bytes":len(html.encode("utf-8")),"price_candidates":vals[:20],
                "has_item_id":"MLB5145446199" in html,"blocked_hint":bool(re.search(r"captcha|access denied|forbidden",html,re.I)),
            }
    except urllib.error.HTTPError as e:
        return {"http":e.code,"error":e.read().decode("utf-8","ignore")[:500]}
    except Exception as e:
        return {"http":None,"error":f"{type(e).__name__}: {e}"}

def pick(obj, keys):
    body=obj.get("body") if isinstance(obj,dict) else None
    if not isinstance(body,dict): return obj
    return {"http":obj.get("http"),**{k:body.get(k) for k in keys if k in body}}

if not TOKEN:
    raise SystemExit("ML_ACCESS_TOKEN ausente")

me=get("/users/me")
user_id=((me.get("body") or {}).get("id") if isinstance(me,dict) else None)
app=get(f"/applications/{APP_ID}") if APP_ID else {"error":"ML_CLIENT_ID ausente"}
grants=get(f"/applications/{APP_ID}/grants") if APP_ID else {"error":"ML_CLIENT_ID ausente"}
user_apps=get(f"/users/{user_id}/applications") if user_id else {"error":"user_id ausente"}
product=get("/products/MLB51160740")
product_items=get("/products/MLB51160740/items")
product_search=get("/products/search?"+urllib.parse.urlencode({"status":"active","site_id":"MLB","q":"Garmin Forerunner 570 47mm"}))
item=get("/items/MLB5145446199")
search=get("/sites/MLB/search?"+urllib.parse.urlencode({"q":"Garmin Forerunner 570 47mm","limit":1}))
page=public_page(PRODUCT_URL)

diag={
    "users_me":pick(me,["id","nickname","status","site_id"]),
    "application":pick(app,["id","site_id","active","sandbox_mode","certification_status","scopes","redirect_uri","url"]),
    "application_grants":grants,
    "user_applications":user_apps,
    "product":pick(product,["id","status","name","buy_box_winner","buy_box_winner_price_range","children_ids","pickers","settings"]),
    "product_items":product_items,
    "product_search":product_search,
    "item":item,
    "search":search,
    "public_product_page":page,
}
(DATA/"ml_diag.json").write_text(json.dumps(diag,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(diag,ensure_ascii=False,indent=2))
