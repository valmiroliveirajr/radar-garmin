// Cadastro sem perder o produto quando o aparelho ainda nao tem a chave.
// Antes: "Adicionar ao Radar" sem chave abria a Administracao e, ao salvar a chave, a tela
// fechava e o produto escolhido era descartado - nada era cadastrado e nada avisava isso.
// Agora: a chave e pedida uma unica vez e o cadastro continua sozinho logo depois.
(function () {
  let pending = null;
  const baseSave = save;
  const baseSaveAdmin = saveAdmin;
  const baseClose = close;

  save = async function () {
    if (state.draft && !key()) {
      const origin = $('#draftOrigin');
      if (origin) state.draft.origin_policy = origin.value;
      const product = state.draft;
      admin('Para cadastrar, informe a chave do Radar. É pedida uma única vez neste aparelho; em seguida o produto é adicionado automaticamente.');
      pending = product; // depois de admin(), que pode fechar/abrir telas
      return;
    }
    return baseSave();
  };

  saveAdmin = async function () {
    const product = pending;
    await baseSaveAdmin();
    if (!product) return;
    if (!key()) { pending = product; return; } // chave recusada: a tela de chave continua aberta
    pending = null;
    state.draft = product;
    draft();
    await baseSave();
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

  // Fechar ou cancelar a tela desiste do cadastro pendente.
  close = function () {
    pending = null;
    return baseClose.apply(this, arguments);
  };
})();
