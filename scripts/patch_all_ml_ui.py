from pathlib import Path

root=Path(__file__).resolve().parents[1]
collector=root/'scripts'/'collect_ml_catalog_all.py'
s=collector.read_text(encoding='utf-8')
s=s.replace('"hrm600": {"name":"HRM 600 M/GG","sku":"010-13383-00","query":"Garmin HRM 600 M GG","terms":["hrm","600"]},','"hrm600": {"name":"HRM 600 M/GG","sku":"010-13383-00","query":"Garmin HRM 600 010-13383-00","terms":["hrm","600"],"preferred":["m gg","m xl"],"forbidden":["pp p","xs s","pp","xs"]},')
old=''' for p in results:\n  text=norm(" ".join([str(p.get("name") or ""),str(p.get("id") or "")]))\n  if all(term in text for term in terms): matches.append(p)\n if not matches:\n  sample=[{"id":p.get("id"),"name":p.get("name")} for p in results[:8]]\n  raise RuntimeError(f"catalogo nao resolvido para {cfg['query']}; amostra={sample}")\n # prefere nome Garmin e o resultado mais curto/especifico\n matches.sort(key=lambda p:("garmin" not in norm(p.get("name")),len(norm(p.get("name")))))\n p=matches[0]\n'''
new=''' for p in results:\n  attrs=" ".join(str((a or {}).get("value_name") or (a or {}).get("value_id") or "") for a in (p.get("attributes") or []))\n  text=norm(" ".join([str(p.get("name") or ""),str(p.get("id") or ""),attrs]))\n  if all(term in text for term in terms):\n   p["_radar_text"]=text; matches.append(p)\n if not matches:\n  sample=[{"id":p.get("id"),"name":p.get("name")} for p in results[:8]]\n  raise RuntimeError(f"catalogo nao resolvido para {cfg['query']}; amostra={sample}")\n sku=norm(cfg.get("sku")); preferred=[norm(x) for x in cfg.get("preferred",[])]; forbidden=[norm(x) for x in cfg.get("forbidden",[])]\n matches.sort(key=lambda p:(\n  any(x and x in p.get("_radar_text","") for x in forbidden),\n  not bool(sku and sku in p.get("_radar_text","")),\n  not bool(preferred and any(x and x in p.get("_radar_text","") for x in preferred)),\n  "garmin" not in norm(p.get("name")),\n  len(norm(p.get("name")))\n ))\n p=matches[0]\n'''
if old not in s: raise SystemExit('bloco resolve_product nao encontrado')
s=s.replace(old,new)
collector.write_text(s,encoding='utf-8')

index=root/'index.html'
h=index.read_text(encoding='utf-8')
start=h.index('async function loadLiveData(){')
end=h.index('\nloadLiveData().finally(render);',start)
newfun='''async function loadLiveData(){
  try{
    const r=await fetch('data/latest.json?ts='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('latest.json HTTP '+r.status);
    const data=await r.json();
    const map={'forerunner-570':'fr570','forerunner-970':'fr970','venu-4':'venu4','hrm600':'hrm600'};
    let loaded=0;
    for(const [liveId,uiId] of Object.entries(map)){
      const liveModel=(data.models||[]).find(x=>x.id===liveId);
      const ml=((liveModel||{}).offers||[]).find(x=>x.store==='Mercado Livre'&&x.available&&x.price&&x.url);
      const m=RADAR.modelos.find(x=>x.id===uiId);
      if(!ml||!m)continue;
      m.lojas=(m.lojas||[]).filter(x=>!String(x.nome||'').startsWith('Mercado Livre'));
      const nome=['Mercado Livre',ml.seller_nickname,ml.factory_warranty?'garantia fábrica':null].filter(Boolean).join(' · ');
      m.lojas.unshift({nome,preco:Number(ml.price),url:ml.url,mercadoLivre:true,vendedor:ml.seller_nickname||'',reputacao:ml.seller_reputation_level||'',garantia:ml.warranty||'',vendas:ml.seller_transactions_total||0,itemId:ml.winner_item_id||'',coletadoEm:ml.collected_at||data.collected_at||''});
      m.mlLive={itemId:ml.winner_item_id||'',catalogProductId:ml.catalog_product_id||'',vendedor:ml.seller_nickname||'',reputacao:ml.seller_reputation_level||'',garantia:ml.warranty||'',vendas:ml.seller_transactions_total||0,ofertas:ml.market_offer_count||0,coletadoEm:ml.collected_at||data.collected_at||''};
      loaded++;
    }
    if(loaded)RADAR.coletaAtiva=true;
  }catch(e){console.warn('Radar Garmin: não foi possível carregar as ofertas vivas do Mercado Livre',e);}
}'''
h=h[:start]+newfun+h[end:]
index.write_text(h,encoding='utf-8')
