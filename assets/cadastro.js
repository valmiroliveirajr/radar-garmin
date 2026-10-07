// Cadastro de produto sem chave.
// O Worker aceita o cadastro vindo desta pagina dentro de limites (40 produtos na lista,
// 15 cadastros por dia). A chave administrativa continua existindo para o coletor e para
// manutencao, mas ninguem precisa digita-la para acompanhar um produto.
(function () {
  save = async function () {
    const p = state.draft;
    if (!p) return;
    const origin = $('#draftOrigin');
    if (origin) p.origin_policy = origin.value;
    $('#modalFoot').innerHTML = '<button class="primary" disabled>Adicionando…</button>';
    try {
      const d = await req('/watchlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalog_product_id: p.id, name: p.name, cover_image: p.cover_image, gallery_images: p.gallery_images, origin_policy: p.origin_policy }),
      });
      const e = d.product;
      const list = products();
      const current = list.find(x => x.catalog_product_id === e.catalog_product_id);
      if (!current) {
        const images = e.gallery_images || [];
        list.push({
          catalog_product_id: e.catalog_product_id, name: e.name, watchlist_name: e.name,
          cover_image: e.cover_image, thumbnail: e.cover_image, images, gallery_images: images,
          origin_policy: e.origin_policy, attributes: p.attributes || [],
          selected_offer: null, market: { offer_count: 0, min_price: null, trusted_count: 0 }, market_offers: [],
        });
      }
      state.current = e.catalog_product_id;
      state.img = 0;
      close();
      render();
      if (d.already) { toast('Esse produto já está no Radar.'); return; }
      toast('Produto adicionado. A primeira coleta foi solicitada.');
      poll(e.catalog_product_id);
    } catch (e) {
      toast('Não foi possível adicionar: ' + e.message);
      if (state.draft) draft();
    }
  };

  // A chave guardada (quando existir) so e apagada se o servidor disser que esta errada;
  // falha passageira de rede nao apaga nada.
  async function adminCheck(k) {
    if (!k || !api()) return 'unknown';
    try {
      const r = await fetch(api() + '/session/check', { headers: { 'x-admin-key': k }, cache: 'no-store' });
      if (r.ok || r.status === 404) return 'ok';
      if (r.status === 401 || r.status === 403) return 'rejected';
      return 'unknown';
    } catch { return 'unknown'; }
  }
  adminOk = async function (k) { return (await adminCheck(k)) !== 'rejected'; };

  saveAdmin = async function () {
    const url = $('#adminApiInput').value.trim().replace(/\/$/, '');
    const k = $('#adminKeyInput').value.trim();
    url ? localStorage.setItem('radarMlApi', url) : localStorage.removeItem('radarMlApi');
    $('#modalFoot').innerHTML = '<button class="primary" disabled>Testando…</button>';
    await health();
    if (!k) { localStorage.removeItem('radarMlAdminKey'); close(); toast('Configuração salva. O cadastro de produtos não precisa de chave.'); return; }
    const result = await adminCheck(k);
    if (result === 'rejected') { localStorage.removeItem('radarMlAdminKey'); admin('A chave foi recusada. Ela não é necessária para cadastrar produtos; pode deixar o campo vazio.'); return; }
    localStorage.setItem('radarMlAdminKey', k);
    if (result === 'unknown') { admin('Não consegui testar a chave agora (servidor sem resposta). Ela ficou guardada neste aparelho.'); return; }
    close();
    toast('Chave guardada neste aparelho.');
  };

  // Produto recem-cadastrado continua na lateral depois de recarregar a pagina: ele ja esta
  // em data/watchlist.json, mas so entra em data/latest.json quando a coleta termina.
  async function showWaitingProducts() {
    let list;
    try {
      const r = await fetch('data/watchlist.json?' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      list = (await r.json()).products || [];
    } catch { return; }
    for (let i = 0; i < 40 && !state.data.collected_at; i++) await new Promise(done => setTimeout(done, 150));
    const have = new Set(products().map(x => x.catalog_product_id));
    const waiting = list.filter(w => w && w.catalog_product_id && w.active !== false && !have.has(w.catalog_product_id));
    if (!waiting.length) return;
    if (!Array.isArray(state.data.products)) state.data.products = [];
    for (const w of waiting) {
      const images = w.gallery_images || [];
      state.data.products.push({
        catalog_product_id: w.catalog_product_id, name: w.name, watchlist_name: w.name,
        cover_image: w.cover_image || images[0] || null, thumbnail: w.cover_image || images[0] || null,
        images, gallery_images: images, origin_policy: w.origin_policy, attributes: [],
        selected_offer: null, market: { offer_count: 0, min_price: null, trusted_count: 0 }, market_offers: [],
      });
    }
    render();
  }
  showWaitingProducts();
})();
