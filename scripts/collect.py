import os
import json, re, datetime, urllib.request, urllib.parse, urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"; DATA.mkdir(exist_ok=True)
TZ=datetime.timezone(datetime.timedelta(hours=-3))
now=datetime.datetime.now(TZ); day=now.date().isoformat()
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
 with urllib.request.urlopen(req,timeout=25) as r:
  return r.read().decode("utf-8","ignore")

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

def ml_seller(seller_id, token, cache):
 if not seller_id:return {}
 if seller_id in cache:return cache[seller_id]
 data,err=ml_get(f"/users/{seller_id}",token)
 if err:
  out={"seller_lookup_error":err}; cache[seller_id]=out; return out
 rep=(data or {}).get("seller_reputation") or {}
 tx=rep.get("transactions") or {}
 ratings=tx.get("ratings") or {}
 status=(data or {}).get("status") or {}
 out={
  "seller_nickname":(data or {}).get("nickname"),
  "seller_status":status.get("site_status") if isinstance(status,dict) else status,
  "seller_reputation_level":rep.get("level_id"),
  "power_seller_status":rep.get("power_seller_status"),
  "seller_transactions_total":tx.get("total"),
  "seller_transactions_completed":tx.get("completed"),
  "seller_transactions_canceled":tx.get("canceled"),
  "seller_rating_positive":ratings.get("positive"),
  "seller_rating_neutral":ratings.get("neutral"),
  "seller_rating_negative":ratings.get("negative"),
  "seller_permalink":(data or {}).get("permalink")
 }
 cache[seller_id]=out
 return out

def ml_exact_url(src,item_id):
 base=(src.get("url") or "").split("?",1)[0].split("#",1)[0]
 return f"{base}?wid={item_id}" if item_id else base

def ml_is_factory_warranty(text):
 return isinstance(text,str) and "garantia de f" in text.lower()

def ml_catalog_candidates(src, token):
 product_id=src.get("product_id")
 if not product_id: raise RuntimeError("product_id ausente")
 data,err=ml_get(f"/products/{product_id}/items",token)
 if err: raise RuntimeError(f"catalog items: {err}")
 results=(data or {}).get("results") or []
 seller_cache={}; candidates=[]
 for r in results:
  if r.get("condition") not in (None,"new"): continue
  price=r.get("price")
  item_id=r.get("item_id") or r.get("id")
  if price is None or not item_id: continue
  seller_id=r.get("seller_id") or ((r.get("seller") or {}).get("id"))
  shipping=r.get("shipping") or {}
  warranty=r.get("warranty")
  c={
   "item_id":item_id,
   "seller_id":seller_id,
   "price":float(price),
   "original_price":r.get("original_price"),
   "currency_id":r.get("currency_id"),
   "condition":r.get("condition"),
   "listing_type_id":r.get("listing_type_id"),
   "official_store_id":r.get("official_store_id"),
   "warranty":warranty,
   "factory_warranty":ml_is_factory_warranty(warranty),
   "free_shipping":shipping.get("free_shipping"),
   "shipping_cost":shipping.get("cost"),
   "logistic_type":shipping.get("logistic_type"),
   "url":ml_exact_url(src,item_id)
  }
  c.update(ml_seller(seller_id,token,seller_cache))
  level=c.get("seller_reputation_level")
  c["trusted_seller_rule"]=bool(c.get("seller_status")=="active" and (level=="5_green" or c.get("power_seller_status") in ("silver","gold","platinum")))
  candidates.append(c)
 candidates.sort(key=lambda x:(not x.get("trusted_seller_rule"),not x.get("factory_warranty"),x.get("price",10**12)))
 return candidates

def ml_offer(src):
 token=ml_token()
 me,me_error=ml_get("/users/me",token)
 candidates=ml_catalog_candidates(src,token)
 if not candidates: raise RuntimeError("Nenhuma oferta nova encontrada no produto de catalogo")
 best=candidates[0]
 return {
  "price":best.get("price"),
  "title":src.get("name"),
  "seller_id":best.get("seller_id"),
  "seller_nickname":best.get("seller_nickname"),
  "seller_status":best.get("seller_status"),
  "seller_reputation_level":best.get("seller_reputation_level"),
  "power_seller_status":best.get("power_seller_status"),
  "seller_transactions_total":best.get("seller_transactions_total"),
  "seller_rating_positive":best.get("seller_rating_positive"),
  "seller_rating_neutral":best.get("seller_rating_neutral"),
  "seller_rating_negative":best.get("seller_rating_negative"),
  "seller_permalink":best.get("seller_permalink"),
  "official_store_id":best.get("official_store_id"),
  "condition":best.get("condition"),
  "status":"active",
  "permalink":best.get("url"),
  "currency_id":best.get("currency_id"),
  "free_shipping":best.get("free_shipping"),
  "shipping_cost":best.get("shipping_cost"),
  "logistic_type":best.get("logistic_type"),
  "warranty":best.get("warranty"),
  "factory_warranty":best.get("factory_warranty"),
  "catalog_product_id":src.get("product_id"),
  "winner_item_id":best.get("item_id"),
  "collection_source":"catalog_product_items",
  "trusted_seller_rule":best.get("trusted_seller_rule"),
  "market_offer_count":len(candidates),
  "market_offers":candidates,
  "auth_user_id":(me or {}).get("id"),
  "auth_nickname":(me or {}).get("nickname"),
  "auth_error":me_error
 }

def price_from_html(html):
 pats=[r'"price"\s*:\s*"?([0-9]+(?:[.,][0-9]+)?)',r'R\$\s*([0-9\.]+,[0-9]{2})']
 vals=[]
 for pat in pats:
  for x in re.findall(pat,html,re.I):
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
 except Exception as e:
  o["error"]=f"{type(e).__name__}: {e}"
 offers.append(o)

models=[]
for mid in sorted(set(x["model"] for x in SOURCES)):
 xs=[x for x in offers if x["model"]==mid]
 valid=[x["effective_price"] for x in xs if x["effective_price"] is not None]
 models.append({"id":mid,"name":xs[0]["name"],"offers":xs,"summary":{"min":min(valid) if valid else None,"max":max(valid) if valid else None,"avg":round(sum(valid)/len(valid),2) if valid else None}})

snapshot={"collected_at":now.isoformat(),"trip_cost_py":TRIP,"models":models}
(DATA/"snapshots").mkdir(exist_ok=True)
(DATA/"snapshots"/f"{day}.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
(DATA/"latest.json").write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")

hist=DATA/"history.json"
arr=json.loads(hist.read_text(encoding="utf-8")) if hist.exists() else []
previous={}
for entry in arr:
 for model in entry.get("models",[]):
  for offer in model.get("offers",[]):
   key=(offer.get("model"),offer.get("store"))
   if offer.get("price") is not None: previous[key]=offer
for model in snapshot["models"]:
 for offer in model["offers"]:
  key=(offer.get("model"),offer.get("store"))
  if offer.get("price") is None and key in previous:
   old=previous[key]
   offer["last_valid_price"]=old.get("price")
   offer["last_valid_effective_price"]=old.get("effective_price")
   offer["last_valid_collected_at"]=old.get("collected_at")
arr=[x for x in arr if x.get("date")!=day]
arr.append({"date":day,**snapshot})
arr.sort(key=lambda x:x.get("date",""))
hist.write_text(json.dumps(arr,ensure_ascii=False,indent=2),encoding="utf-8")
