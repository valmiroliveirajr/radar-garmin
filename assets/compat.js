// Compatibilidade temporaria entre o front-end novo e versoes anteriores do Worker.
// Envia a chave administrativa tambem nas consultas quando ela existir no aparelho.
req = async function(path,opt={},auth=false){
  if(!api())throw Error('Backend do Radar ML não configurado.');
  const h={...(opt.headers||{})};
  const k=key();
  if(auth&&!k){admin('Conecte este aparelho para concluir o cadastro.');throw Error('Administração não conectada neste aparelho.');}
  if(k)h['x-admin-key']=k;
  const r=await fetch(api()+path,{...opt,headers:h});
  const txt=await r.text();
  let d;try{d=JSON.parse(txt)}catch{d={error:txt}}
  if(!r.ok){
    if(r.status===401&&auth){localStorage.removeItem('radarMlAdminKey');admin('A chave administrativa não foi aceita.');}
    throw Error(d.error||d.message||`HTTP ${r.status}`);
  }
  return d;
};

adminOk = async function(k){
  if(!k||!api())return false;
  try{
    const r=await fetch(api()+'/session/check',{headers:{'x-admin-key':k},cache:'no-store'});
    // Worker novo: 200. Worker anterior: a chave passa pela autenticacao e a rota termina em 404.
    return r.ok||r.status===404;
  }catch{return false;}
};
