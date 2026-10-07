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

  // Aviso honesto quando nada no catalogo bate com o que foi pedido.
  function note(text) {
    return `<div class="status-box" style="margin-bottom:12px">${text}</div>`;
  }
  const NOT_IN_CATALOG = 'Não achei no catálogo do Mercado Livre um produto que bata com esse texto. ' +
    'O Radar só consegue monitorar produtos de catálogo; abaixo estão os mais parecidos, do mais próximo para o mais distante.';
  const LISTING_NOT_IN_CATALOG = 'Esse link é de um anúncio avulso, sem página de produto no catálogo do Mercado Livre, ' +
    'e não achei um produto de catálogo equivalente. O Radar ainda não consegue monitorar esse tipo de anúncio; abaixo estão os mais parecidos.';

  function showResults(query, d, fromLink) {
    state.results = d.results || [];
    const n = state.results.length;
    const close = d.close !== false; // Worker antigo nao informa: nao mostra aviso
    const body = (n && !close ? note(fromLink ? LISTING_NOT_IN_CATALOG : NOT_IN_CATALOG) : '') + resultView(query);
    const subtitle = !n ? '' : close
      ? `${n} possibilidade${n === 1 ? '' : 's'}, da mais parecida para a menos parecida.`
      : 'Nenhuma bate com o que você pediu.';
    modal(close ? 'Escolha o produto exato' : 'Produto não encontrado no catálogo', subtitle, body, cancelButton);
  }

  search = async function () {
    const input = $('#searchInput');
    const text = input.value.trim();
    const link = linkIn(text);

    if (!link) {
      if (text.length < 2) { toast('Digite pelo menos 2 caracteres.'); return; }
      modal('Buscando no Mercado Livre', text, '<div class="empty">Consultando o catálogo…</div>', cancelButton);
      try {
        showResults(text, await req('/search?q=' + encodeURIComponent(text)), false);
      } catch (e) {
        modal('Não foi possível pesquisar', e.message, `<div class="status-box bad">${esc(e.message)}</div>`,
          '<button class="secondary" data-admin>Administração</button>' + closeButton);
      }
      return;
    }

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
      input.value = d.query || '';
      showResults(d.query || '', d, true);
    } catch (e) {
      modal('Não foi possível ler o link', '', `<div class="status-box bad">${esc(e.message)}</div><div class="hint">Você também pode digitar o nome do produto na busca.</div>`, closeButton);
    }
  };

  const input = $('#searchInput');
  $('#searchButton').onclick = search;
  input.placeholder = 'Buscar produto ou colar link do Mercado Livre';
  input.addEventListener('paste', () => setTimeout(() => { if (linkIn(input.value.trim())) search(); }, 0));
})();
