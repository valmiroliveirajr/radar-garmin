// Cadastro sem perder o produto quando o aparelho ainda nao tem a chave.
// Antes: "Adicionar ao Radar" sem chave abria a Administracao e, ao salvar a chave, a tela
// fechava e o produto escolhido era descartado - nada era cadastrado e nada avisava isso.
// Agora: a chave e pedida uma unica vez e o cadastro continua sozinho logo depois.
(function () {
  let pending = null;
  const baseSave = save;
  const baseClose = close;

  save = async function () {
    if (state.draft && !key()) {
      const origin = $('#draftOrigin');
      if (origin) state.draft.origin_policy = origin.value;
      const product = state.draft;
      admin('Este aparelho ainda não tem a chave do Radar. Informe uma única vez: ela fica guardada aqui e não será pedida nos próximos produtos. Em seguida este produto é adicionado automaticamente.');
      pending = product; // depois de admin(), que pode fechar/abrir telas
      return;
    }
    return baseSave();
  };

  // A chave so e apagada quando o servidor responde, com todas as letras, que ela esta errada.
  // Antes, qualquer falha passageira na verificacao (rede, servidor reiniciando) apagava a
  // chave guardada, e o aparelho voltava a pedir a chave do nada.
  async function adminCheck(k) {
    if (!k || !api()) return 'unknown';
    try {
      const r = await fetch(api() + '/session/check', { headers: { 'x-admin-key': k }, cache: 'no-store' });
      if (r.ok || r.status === 404) return 'ok'; // 404 = Worker antigo, sem a rota, mas a chave passou
      if (r.status === 401 || r.status === 403) return 'rejected';
      return 'unknown';
    } catch { return 'unknown'; }
  }
  adminOk = async function (k) { return (await adminCheck(k)) !== 'rejected'; };

  saveAdmin = async function () {
    const product = pending;
    const url = $('#adminApiInput').value.trim().replace(/\/$/, '');
    const k = $('#adminKeyInput').value.trim();
    url ? localStorage.setItem('radarMlApi', url) : localStorage.removeItem('radarMlApi');
    $('#modalFoot').innerHTML = '<button class="primary" disabled>Testando…</button>';
    await health();
    if (!k) {
      localStorage.removeItem('radarMlAdminKey');
      close();
      toast('API salva para consulta.');
      return;
    }
    const result = await adminCheck(k);
    if (result === 'rejected') {
      localStorage.removeItem('radarMlAdminKey');
      admin('A chave foi recusada. Confira se é a chave atual do Radar.');
      pending = product;
      return;
    }
    localStorage.setItem('radarMlAdminKey', k);
    if (result === 'unknown') {
      admin('Não consegui testar a chave agora (servidor sem resposta). Ela ficou guardada neste aparelho; tente de novo em instantes.');
      pending = product;
      return;
    }
    if (!product) {
      close();
      toast('Chave guardada neste aparelho. Não será pedida de novo.');
      return;
    }
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
