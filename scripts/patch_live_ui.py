from pathlib import Path

p = Path("index.html")
s = p.read_text(encoding="utf-8")

if "async function loadLiveData()" in s:
    raise SystemExit("Interface já integrada ao latest.json")

needle = "render();\n</script></body></html>"
pos = s.rfind(needle)
if pos < 0:
    raise SystemExit("Ponto final de renderização não encontrado")

injection = r'''async function loadLiveData(){
  try{
    const r=await fetch('data/latest.json?ts='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('latest.json HTTP '+r.status);
    const data=await r.json();
    const liveModel=(data.models||[]).find(x=>x.id==='forerunner-570');
    const ml=((liveModel||{}).offers||[]).find(x=>x.store==='Mercado Livre'&&x.available&&x.price&&x.url);
    if(!ml)return;
    const m=RADAR.modelos.find(x=>x.id==='fr570');
    if(!m)return;
    m.lojas=(m.lojas||[]).filter(x=>!String(x.nome||'').startsWith('Mercado Livre'));
    const nome=['Mercado Livre',ml.seller_nickname,ml.factory_warranty?'garantia fábrica':null].filter(Boolean).join(' · ');
    m.lojas.unshift({
      nome,
      preco:Number(ml.price),
      url:ml.url,
      mercadoLivre:true,
      vendedor:ml.seller_nickname||'',
      reputacao:ml.seller_reputation_level||'',
      garantia:ml.warranty||'',
      vendas:ml.seller_transactions_total||0,
      itemId:ml.winner_item_id||'',
      coletadoEm:ml.collected_at||data.collected_at||''
    });
    m.mlLive={
      itemId:ml.winner_item_id||'',
      vendedor:ml.seller_nickname||'',
      reputacao:ml.seller_reputation_level||'',
      garantia:ml.warranty||'',
      vendas:ml.seller_transactions_total||0,
      ofertas:ml.market_offer_count||0,
      coletadoEm:ml.collected_at||data.collected_at||''
    };
  }catch(e){
    console.warn('Radar Garmin: não foi possível carregar a oferta viva do Mercado Livre',e);
  }
}
'''

s = s[:pos] + injection + "loadLiveData().finally(render);\n</script></body></html>" + s[pos+len(needle):]
p.write_text(s, encoding="utf-8")
print("Integração da interface com data/latest.json aplicada")
