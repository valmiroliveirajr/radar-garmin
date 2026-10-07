// Colar um link do Mercado Livre na busca: o Worker identifica o produto (rota /resolve)
// e a tela segue direto para "Configurar produto". Texto comum continua na busca normal.
(function () {
  const ML_HOST = /(?:^|\.)(?:mercadolivre\.com(?:\.br)?|mercadolibre\.com|meli\.la)$/i;
  const WITH_SCHEME = /https?:\/\/[^\s<>"']+/i;
  const BARE = /(?:^|\s)((?:[\w-]+\.)*(?:mercadolivre\.com(?:\.br)?|mercadolibre\.com|meli\.la)\/[^\s<>"']*)/i;

  // Aceita o link sozinho ou no meio do texto que o aplicativo do Mercado Livre compartilha.
  function linkIn(text) {
    const full = text.match(WITH_SCHEME);
    if (full) return full[0].replace(/[)\].,;]+$/, '');
    const bare = text.match(BARE);
    return bare ? 'https://' + bare[1] : null;
  }
  function isMercadoLivre(link) {
    try { return ML_HOST.test(new URL(link).hostname); } catch { return false; }
  }

  const cancelButton = '<button class="secondary" data-close>Cancelar</button>';
  const closeButton = '<button class="secondary" data-close>Fechar</button>';
  const baseSearch = search;

  search = async function () {
    const input = $('#searchInput');
    const link = linkIn(input.value.trim());
    if (!link) return baseSearch();
    if (!isMercadoLivre(link)) {
      modal('Link de outro site', '', '<div class="status-box bad">Só consigo identificar links do Mercado Livre. Para outros casos, digite o nome do produto.</div>', closeButton);
      return;
    }
    modal('Identificando o produto', 'Lendo o link do Mercado Livre…', '<div class="empty">Consultando o catálogo…</div>', cancelButton);
    try {
      const d = await req('/resolve?url=' + encodeURIComponent(link));
      if (d.kind === 'product' && d.product && d.product.id) {
        state.results = [d.product];
        input.value = d.product.name || '';
        pick(d.product.id);
        if (d.via === 'pagina') toast('Achei este produto na página do link. Confira se é o certo antes de adicionar.');
        return;
      }
      state.results = d.results || [];
      input.value = d.query || '';
      const n = state.results.length;
      modal('Escolha o produto exato',
        n ? `O link é de um anúncio avulso. Encontrei ${n} produto${n === 1 ? '' : 's'} de catálogo com esse nome.` : 'O link é de um anúncio avulso.',
        resultView(d.query || ''), cancelButton);
    } catch (e) {
      modal('Não foi possível ler o link', '', `<div class="status-box bad">${esc(e.message)}</div><div class="hint">Você também pode digitar o nome do produto na busca.</div>`, closeButton);
    }
  };

  const input = $('#searchInput');
  $('#searchButton').onclick = search;
  input.placeholder = 'Buscar produto ou colar link do Mercado Livre';
  input.addEventListener('paste', () => setTimeout(() => { if (linkIn(input.value.trim())) search(); }, 0));
})();
