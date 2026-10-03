import os, json, urllib.request, urllib.parse, urllib.error, unicodedata
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
LATEST=DATA/"latest.json"
HISTORY=DATA/"history.json"

PRODUCTS={
 "forerunner-570": {"name":"Forerunner 570 47 mm","sku":"010-02971-00","product_id":"MLB51160740","query":"Garmin Forerunner 570 47 mm","terms":["forerunner","570"]},
 "forerunner-970": {"name":"Forerunner 970 47 mm","sku":"010-02969-00","query":"Garmin Forerunner 970 47 mm","terms":["forerunner","970"]},
 "venu-4": {"name":"Venu 4 45 mm","sku":"010-03014-00","query":"Garmin Venu 4 45 mm","terms":["venu","4","45"]},
 "hrm600": {"name":"HRM 600 M/GG","sku":"010-13383-00","query":"Garmin HRM 600 010-13383-00","terms":["hrm","600"],"preferred":["m gg","m xl"],"forbidden":["pp p","xs s","pp","xs"]},
}

POLICY=[
 "eliminar ofertas usadas ou inativas",
 "priorizar vendedor confiavel e ativo",
 "entre vendedores confiaveis, priorizar garantia de fabrica",
 "dentro do melhor grupo, escolher o menor preco",
]

def token():
 t=os.environ.get("ML_ACCESS_TOKEN")
 if not t: raise RuntimeError("ML_ACCESS_TOKEN nao configurado")
 return t

def get(path,tok):
 req=urllib.request.Request("https://api.mercadolibre.com"+path,headers={"Authorization":"Bearer "+tok,"Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=30) as r:return json.loads(r.read().decode()),None
 except urllib.error.HTTPError as e:
  body=e.read().decode("utf-8","ignore")
  return None,f"HTTP {e.code}: {body[:700]}"

def norm(s):
 s=unicodedata.normalize("NFKD",str(s or "")).encode("ascii","ignore").decode().lower()
 return " ".join(s.replace("/"," ").replace("-"," ").split())

def resolve_product(cfg,tok):
 if cfg.get("product_id"):return cfg["product_id"],cfg.get("name")
 q=urllib.parse.quote(cfg["query"])
 data,err=get(f"/products/search?status=active&site_id=MLB&q={q}",tok)
 if err: raise RuntimeError(f"products/search: {err}")
 results=(data or {}).get("results") or []
 terms=[norm(x) for x in cfg.get("terms",[])]
 matches=[]
 for p in results:
  attrs=" ".join(str((a or {}).get("value_name") or (a or {}).get("value_id") or "") for a in (p.get("attributes") or []))
  text=norm(" ".join([str(p.get("name") or ""),str(p.get("id") or ""),attrs]))
  if all(term in text for term in terms):
   p["_radar_text"]=text; matches.append(p)
 if not matches:
  sample=[{"id":p.get("id"),"name":p.get("name")} for p in results[:8]]
  raise RuntimeError(f"catalogo nao resolvido para {cfg['query']}; amostra={sample}")
 sku=norm(cfg.get("sku")); preferred=[norm(x) for x in cfg.get("preferred",[])]; forbidden=[norm(x) for x in cfg.get("forbidden",[])]
 matches.sort(key=lambda p:(
  any(x and x in p.get("_radar_text","") for x in forbidden),
  not bool(sku and sku in p.get("_radar_text","")),
  not bool(preferred and any(x and x in p.get("_radar_text","") for x in preferred)),
  "garmin" not in norm(p.get("name")),
  len(norm(p.get("name")))
 ))
 p=matches[0]
 return p.get("id"),p.get("name")

def seller(seller_id,tok,cache):
 if not seller_id:return {}
 if seller_id in cache:return cache[seller_id]
 data,err=get(f"/users/{seller_id}",tok)
 if err:
  out={"seller_lookup_error":err};cache[seller_id]=out;return out
 rep=(data or {}).get("seller_reputation") or {};tx=rep.get("transactions") or {};ratings=tx.get("ratings") or {};status=(data or {}).get("status") or {}
 out={"seller_nickname":(data or {}).get("nickname"),"seller_status":status.get("site_status") if isinstance(status,dict) else status,"seller_reputation_level":rep.get("level_id"),"power_seller_status":rep.get("power_seller_status"),"seller_transactions_total":tx.get("total"),"seller_transactions_completed":tx.get("completed"),"seller_transactions_canceled":tx.get("canceled"),"seller_rating_positive":ratings.get("positive"),"seller_rating_neutral":ratings.get("neutral"),"seller_rating_negative":ratings.get("negative"),"seller_permalink":(data or {}).get("permalink")}
 cache[seller_id]=out;return out

def factory_warranty(w):return isinstance(w,str) and "garantia de f" in w.lower()
def tier(c):
 if c.get("trusted_seller_rule") and c.get("factory_warranty"):return "trusted_factory_warranty"
 if c.get("trusted_seller_rule"):return "trusted_seller"
 if c.get("factory_warranty"):return "factory_warranty_untrusted_seller"
 return "fallback_price"

def collect_one(mid,cfg,tok,collected_at):
 pid,catalog_name=resolve_product(cfg,tok)
 data,err=get(f"/products/{pid}/items",tok)
 if err: raise RuntimeError(f"{mid} catalog items: {err}")
 rows=(data or {}).get("results") or [];cache={};offers=[]
 base=f"https://www.mercadolivre.com.br/p/{pid}"
 for r in rows:
  if r.get("condition") not in (None,"new") or r.get("status") not in (None,"active"):continue
  price=r.get("price");item=r.get("item_id") or r.get("id")
  if price is None or not item:continue
  sid=r.get("seller_id") or ((r.get("seller") or {}).get("id"));shipping=r.get("shipping") or {};w=r.get("warranty")
  c={"item_id":item,"seller_id":sid,"price":float(price),"original_price":r.get("original_price"),"currency_id":r.get("currency_id"),"condition":r.get("condition") or "new","item_status":r.get("status") or "active","listing_type_id":r.get("listing_type_id"),"official_store_id":r.get("official_store_id"),"warranty":w,"factory_warranty":factory_warranty(w),"free_shipping":shipping.get("free_shipping"),"shipping_cost":shipping.get("cost"),"logistic_type":shipping.get("logistic_type"),"url":f"{base}?wid={item}"}
  c.update(seller(sid,tok,cache));level=c.get("seller_reputation_level")
  c["trusted_seller_rule"]=bool(c.get("seller_status")=="active" and (level=="5_green" or c.get("power_seller_status") in ("silver","gold","platinum")))
  c["selection_tier"]=tier(c);offers.append(c)
 offers.sort(key=lambda c:(not c.get("trusted_seller_rule"),not c.get("factory_warranty"),float(c.get("price",10**12))))
 if not offers:raise RuntimeError(f"{mid}: nenhuma oferta nova/ativa no catalogo {pid}")
 for i,c in enumerate(offers,1):c["selection_rank"]=i
 best=offers[0];market_min=min(x["price"] for x in offers);trusted=[x for x in offers if x.get("trusted_seller_rule")];trusted_factory=[x for x in trusted if x.get("factory_warranty")]
 return {"model":mid,"name":cfg["name"],"sku":cfg["sku"],"store":"Mercado Livre","country":"BR","product_id":pid,"catalog_product_id":pid,"catalog_product_name":catalog_name,"item_id":best["item_id"],"winner_item_id":best["item_id"],"url":best["url"],"permalink":best["url"],"collected_at":collected_at,"price":best["price"],"effective_price":best["price"],"available":True,"error":None,"title":cfg["name"],"seller_id":best.get("seller_id"),"seller_nickname":best.get("seller_nickname"),"seller_status":best.get("seller_status"),"seller_reputation_level":best.get("seller_reputation_level"),"power_seller_status":best.get("power_seller_status"),"seller_transactions_total":best.get("seller_transactions_total"),"official_store_id":best.get("official_store_id"),"condition":best.get("condition"),"status":"active","currency_id":best.get("currency_id"),"free_shipping":best.get("free_shipping"),"shipping_cost":best.get("shipping_cost"),"logistic_type":best.get("logistic_type"),"warranty":best.get("warranty"),"factory_warranty":best.get("factory_warranty"),"collection_source":"catalog_product_items","trusted_seller_rule":best.get("trusted_seller_rule"),"selection_policy":POLICY,"selection_tier":best.get("selection_tier"),"selection_rank":1,"selection_reason":"vendedor confiavel + garantia de fabrica + menor preco do melhor grupo" if best.get("trusted_seller_rule") and best.get("factory_warranty") else "melhor oferta segundo a politica validada","market_offer_count":len(offers),"market_min_price":market_min,"market_trusted_count":len(trusted),"market_trusted_factory_warranty_count":len(trusted_factory),"selected_price_premium_vs_market_min":round(best["price"]-market_min,2),"market_offers":offers}

def upsert_model(snapshot,mid,cfg,offer):
 model=next((m for m in snapshot.get("models",[]) if m.get("id")==mid),None)
 if not model:
  model={"id":mid,"name":cfg["name"],"offers":[],"summary":{"min":None,"max":None,"avg":None}};snapshot.setdefault("models",[]).append(model)
 model["offers"]=[x for x in model.get("offers",[]) if x.get("store")!="Mercado Livre"]+[offer]
 vals=[x.get("effective_price") for x in model["offers"] if x.get("effective_price") is not None]
 model["summary"]={"min":min(vals) if vals else None,"max":max(vals) if vals else None,"avg":round(sum(vals)/len(vals),2) if vals else None}

if not LATEST.exists():raise SystemExit("data/latest.json ausente")
snapshot=json.loads(LATEST.read_text(encoding="utf-8"));tok=token();collected_at=snapshot.get("collected_at")
errors=[]
for mid,cfg in PRODUCTS.items():
 try:
  offer=collect_one(mid,cfg,tok,collected_at);upsert_model(snapshot,mid,cfg,offer)
  print(f"ML OK {mid}: {offer['catalog_product_id']} | {offer['winner_item_id']} | R$ {offer['price']:.2f}")
 except Exception as e:
  errors.append(f"{mid}: {type(e).__name__}: {e}")
  print("ML ERRO",errors[-1])
LATEST.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
# atualiza snapshot diario e entrada do dia no historico
if collected_at:
 day=collected_at[:10]
 snap=DATA/"snapshots"/f"{day}.json"
 snap.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding="utf-8")
 if HISTORY.exists():
  arr=json.loads(HISTORY.read_text(encoding="utf-8"));found=False
  for i,e in enumerate(arr):
   if e.get("date")==day:arr[i]={"date":day,**snapshot};found=True;break
  if not found:arr.append({"date":day,**snapshot})
  arr.sort(key=lambda x:x.get("date",""));HISTORY.write_text(json.dumps(arr,ensure_ascii=False,indent=2),encoding="utf-8")
if errors:raise SystemExit("; ".join(errors))
