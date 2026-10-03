import os
import json, re, datetime, urllib.request, urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/"data"; DATA.mkdir(exist_ok=True)
TZ=datetime.timezone(datetime.timedelta(hours=-3)); now=datetime.datetime.now(TZ); day=now.date().isoformat()
TRIP=1200.0
SOURCES=[
 {"model":"forerunner-570","name":"Forerunner 570 47 mm","sku":"010-02971-00","store":"Mercado Livre","url":"https://www.mercadolivre.com.br/garmin-forerunner-570-preto-47mm/p/MLB51160740?wid=MLB5145446199","country":"BR","product_id":"MLB51160740","item_id":"MLB5145446199"},
 {"model":"forerunner-970","name":"Forerunner 970","sku":"010-02969-00","store":"Garmin Brasil","url":"https://www.garminbrasil.com.br/collections/forerunner/products/relogio-garmin-forerunner-970-cinza-com-monitor-cardiaco-de-pulso-e-gps","country":"BR"},
 {"model":"forerunner-970","name":"Forerunner 970","sku":"010-02969-00","store":"Compras Paraguai","url":"https://www.comprasparaguai.com.br/relogio-smartwatch-garmin-forerunner-970-47-mm-pretocinza-carbono-dlc-titanio-010-02969-00__4906340/","country":"PY"},
 {"model":"forerunner-570","name":"Forerunner 570 47 mm","sku":"010-02971-00","store":"Garmin Brasil","url":"https://www.garminbrasil.com.br/collections/produtos-prudential-fully/products/relogio-garmin-forerunner-570-cinza-ardosia-translucido-preto-com-monitor-cardiaco-de-pulso-e-gps","country":"BR"},
 {"model":"forerunner-570","name":"Forerunner 570 47 mm","sku":"010-02971-01","store":"Compras Paraguai","url":"https://www.comprasparaguai.com.br/relogio-smartwatch-garmin-forerunner-570-47-mm-amp-yellow-010-02971-01__4906335/","country":"PY"},
 {"model":"venu-4","name":"Venu 4 45 mm","sku":"010-03014-00","store":"Garmin Brasil","url":"https://www.garminbrasil.com.br/products/relogio-garmin-venu-4-ardosia-e-preto-45-mm-com-monitor-cardiaco-de-pulso-e-gps","country":"BR"},
 {"model":"venu-4","name":"Venu 4 45 mm","sku":"010-03014-00","store":"Compras Paraguai","url":"https://www.comprasparaguai.com.br/garmin-smartwatch-venu-4-45mm-black__5257596/","country":"PY"}
]
def fetch(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 RadarGarmin/1.0","Accept":"application/json,text/html;q=0.9,*/*;q=0.8"})
 with urllib.request.urlopen(req,timeout=25) as r:return r.read().decode("utf-8","ignore")
def ml_token():
 token=os.environ.get("ML_ACCESS_TOKEN")
 if not token: raise RuntimeError("ML_ACCESS_TOKEN nao configurado")
 return token
def ml_get(path, token):
 req=urllib.request.Request("https://api.mercadolibre.com"+path,headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=25) as r:
   return json.loads(r.read().decode()), None
 except urllib.error.HTTPError as e:
  body=e.read().decode("utf-8","ignore")
  return None, f"HTTP {e.code}: {body[:800]}"

def ml_seller(seller_id, token):
 if not seller_id:return {}
 data, err=ml_get(f"/users/{seller_id}",token)
 if err:return {"seller_lookup_error":err}
 rep=(data or {}).get("seller_reputation") or {}
 tx=rep.get("transactions") or {}
 ratings=tx.get("ratings") or {}
 return {
  "seller_nickname":(data or {}).get("nickname"),
  "seller_status":(data or {}).get("status",{}).get("site_status") if isinstance((data or {}).get("status"),dict) else (data or {}).get("status"),
  "seller_reputation_level":rep.get("level_id"),
  "power_seller_status":rep.get("power_seller_status"),
  "seller_transactions_completed":tx.get("completed"),
  "seller_transactions_canceled":tx.get("canceled"),
  "seller_rating_positive":ratings.get("positive"),
  "seller_rating_neutral":ratings.get("neutral"),
  "seller_rating_negative":ratings.get("negative")
 }

def ml_offer(src):
 token=ml_token()
 me, me_error=ml_get("/users/me",token)
 product_id=src.get("product_id")
 if product_id:
  product, product_error=ml_get(f"/products/{product_id}",token)
  if not product_error and product:
   winner=product.get("buy_box_winner") or {}
   seller_id=winner.get("seller_id")
   item_id=winner.get("item_id")
   price=winner.get("price")
   permalink=product.get("permalink") or src.get("url")
   if item_id and permalink:
    sep="&" if "?" in permalink else "?"
    permalink=f"{permalink}{sep}wid={item_id}"
   out={
    "price":float(price) if price is not None else None,
    "title":product.get("name"),
    "seller_id":seller_id,
    "official_store_id":winner.get("official_store_id"),
    "condition":winner.get("condition"),
    "status":"active" if product.get("status")=="active" and winner else product.get("status"),
    "permalink":permalink,
    "currency_id":winner.get("currency_id"),
    "free_shipping":(winner.get("shipping") or {}).get("free_shipping"),
    "warranty":None,
    "catalog_product_id":product_id,
    "winner_item_id":item_id,
    "collection_source":"catalog_buy_box",
    "auth_user_id":(me or {}).get("id"),
    "auth_nickname":(me or {}).get("nickname"),
    "auth_error":me_error,
    "product_error":None
   }
   out.update(ml_seller(seller_id,token))
   return out
  product_diag=product_error
 else:
  product_diag="product_id ausente"
 item_id=src.get("item_id")
 data, item_error=ml_get(f"/items/{item_id}",token) if item_id else (None,"item_id ausente")
 if item_error:
  raise RuntimeError(f"ML bloqueado; users_me={'ok' if me else me_error}; product={product_diag}; item={item_error}")
 p=data.get("price")
 out={
  "price":float(p) if p is not None else None,
  "title":data.get("title"),
  "seller_id":data.get("seller_id"),
  "official_store_id":data.get("official_store_id"),
  "condition":data.get("condition"),
  "status":data.get("status"),
  "permalink":data.get("permalink"),
  "currency_id":data.get("currency_id"),
  "free_shipping":(data.get("shipping") or {}).get("free_shipping"),
  "warranty":next((x.get("value_name") for x in data.get("sale_terms",[]) if x.get("id") in ("WARRANTY_TYPE","WARRANTY_TIME")),None),
  "collection_source":"item",
  "auth_user_id":(me or {}).get("id"),
  "auth_nickname":(me or {}).get("nickname"),
  "product_error":product_diag
 }
 out.update(ml_seller(data.get("seller_id"),token))
 return out

def price_from_html(html):
 pats=[r'"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)',r'R\$\s*([0-9\.]+,[0-9]{2})']
 vals=[]
 for p in pats:
  for x in re.findall(p,html,re.I):
   try:
    v=float(x.replace(".","").replace(",","."))
    if 300<=v<=20000: vals.append(v)
   except: pass
  if vals:return vals[0]
 return None
offers=[]
for src in SOURCES:
 o={**src,"collected_at":now.isoformat(),"price":None,"effective_price":None,"available":None,"error":None}
 try:
  if src["store"]=="Mercado Livre":
   ml=ml_offer(src); p=ml.pop("price"); o.update(ml)
   if o.get("permalink"):o["url"]=o["permalink"]
   o["price"]=p; o["available"]=p is not None and o.get("status")=="active"
  else:
   html=fetch(src["url"]); p=price_from_html(html); o["price"]=p; o["available"]=p is not None
  if p is not None:o["effective_price"]=round(p+(TRIP if src["country"]=="PY" else 0),2)
 except Exception as e:o["error"]=f"{type(e).__name__}: {e}"
 offers.append(o)
models=[]
for mid in sorted(set(x["model"] for x in SOURCES)):
 xs=[x for x in offers if x["model"]==mid]; valid=[x["effective_price"] for x in xs if x["effective_price"] is not None]
 models.append({"id":mid,"name":xs[0]["name"],"offers":xs,"summary":{"min":min(valid) if valid else None,"max":max(valid) if valid else None,"avg":round(sum(valid)/len(valid),2) if valid else None}})
snapshot={"collected_at":now.isoformat(),"trip_cost_py":TRIP,"models":models}
(DATA/"snapshots").mkdir(exist_ok=True)
(DATA/"snapshots"/f"{day}.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
(DATA/"latest.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
hist=DATA/"history.json"; arr=json.loads(hist.read_text(encoding="utf-8")) if hist.exists() else []
previous={}
for entry in arr:
 for model in entry.get("models",[]):
  for offer in model.get("offers",[]):
   key=(offer.get("model"),offer.get("store"),offer.get("url"))
   if offer.get("price") is not None: previous[key]=offer
# Falha de coleta nunca vira preço zero nem apaga o último valor válido.
for model in snapshot["models"]:
 for offer in model["offers"]:
  key=(offer.get("model"),offer.get("store"),offer.get("url"))
  if offer.get("price") is None and key in previous:
   old=previous[key]
   offer["last_valid_price"]=old.get("price")
   offer["last_valid_effective_price"]=old.get("effective_price")
   offer["last_valid_collected_at"]=old.get("collected_at")
arr=[x for x in arr if x.get("date")!=day]; arr.append({"date":day,**snapshot})
arr.sort(key=lambda x:x.get("date",""))
hist.write_text(json.dumps(arr,ensure_ascii=False,indent=2),encoding="utf-8")
