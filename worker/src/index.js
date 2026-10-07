const ML_API = 'https://api.mercadolibre.com';
const WATCHLIST_PATH = 'data/watchlist.json';

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || 'https://valmiroliveirajr.github.io').replace(/\/$/, '');
  return origin === allowed ? origin : allowed;
}

function corsHeaders(request, env) {
  return {
    'access-control-allow-origin': allowedOrigin(request, env),
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-key',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function isAdmin(request, env) {
  const key = request.headers.get('x-admin-key') || '';
  return Boolean(env.ADMIN_KEY && key && key === env.ADMIN_KEY);
}

function requireAdmin(request, env) {
  if (!isAdmin(request, env)) throw new Response('Chave administrativa inválida.', { status: 401 });
}

async function tokenStoreGet(env, key) {
  if (!env.ML_TOKEN_STORE) return null;
  try { return await env.ML_TOKEN_STORE.get(key); } catch { return null; }
}

async function tokenStorePut(env, key, value) {
  if (!env.ML_TOKEN_STORE || value == null) return;
  await env.ML_TOKEN_STORE.put(key, String(value));
}

async function refreshMlToken(env, refreshToken) {
  if (!refreshToken) throw new Error('Refresh token do Mercado Livre não configurado');
  if (!env.ML_CLIENT_ID || !env.ML_CLIENT_SECRET) throw new Error('Credenciais OAuth do Mercado Livre não configuradas para renovação');

  const form = new URLSearchParams();
  form.set('grant_type', 'refresh_token');
  form.set('client_id', env.ML_CLIENT_ID);
  form.set('client_secret', env.ML_CLIENT_SECRET);
  form.set('refresh_token', refreshToken);

  const response = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok || !body?.access_token) {
    const err = new Error(`Falha ao renovar token Mercado Livre HTTP ${response.status}`);
    err.status = response.status;
    err.detail = body;
    throw err;
  }

  const expiresIn = Number(body.expires_in || 21600);
  const expiresAt = Date.now() + Math.max(60, expiresIn - 120) * 1000;
  await tokenStorePut(env, 'access_token', body.access_token);
  await tokenStorePut(env, 'access_token_expires_at', expiresAt);
  if (body.refresh_token) await tokenStorePut(env, 'refresh_token', body.refresh_token);
  return { token: body.access_token, expiresAt, mode: 'refresh' };
}

async function getMlToken(env, forceRefresh = false) {
  const storedToken = await tokenStoreGet(env, 'access_token');
  const storedExpiry = Number(await tokenStoreGet(env, 'access_token_expires_at') || 0);
  if (!forceRefresh && storedToken && (!storedExpiry || storedExpiry > Date.now() + 60000)) {
    return { token: storedToken, expiresAt: storedExpiry || null, mode: 'kv' };
  }

  const storedRefresh = await tokenStoreGet(env, 'refresh_token');
  const refreshToken = storedRefresh || env.ML_REFRESH_TOKEN || '';
  if (env.ML_TOKEN_STORE && refreshToken && env.ML_CLIENT_ID && env.ML_CLIENT_SECRET) {
    return refreshMlToken(env, refreshToken);
  }

  if (env.ML_ACCESS_TOKEN) return { token: env.ML_ACCESS_TOKEN, expiresAt: null, mode: 'static' };
  throw new Error('ML_ACCESS_TOKEN não configurado no Worker');
}

async function mlRequest(path, env, tokenInfo) {
  return fetch(ML_API + path, {
    headers: { authorization: `Bearer ${tokenInfo.token}`, accept: 'application/json' },
  });
}

async function ml(path, env) {
  let tokenInfo = await getMlToken(env, false);
  let response = await mlRequest(path, env, tokenInfo);
  if (response.status === 401 && env.ML_TOKEN_STORE) {
    tokenInfo = await getMlToken(env, true);
    response = await mlRequest(path, env, tokenInfo);
  }

  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`Mercado Livre HTTP ${response.status}`);
    err.status = response.status;
    err.detail = body;
    throw err;
  }
  return body;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function imagesOf(product) {
  const images = [];
  for (const picture of product?.pictures || []) {
    if (typeof picture === 'string') images.push(picture);
    else if (picture && typeof picture === 'object') images.push(picture.secure_url || picture.url || picture.source);
  }
  images.push(product?.secure_thumbnail, product?.thumbnail);
  return unique(images);
}

function attrsOf(product) {
  return (product?.attributes || []).filter(Boolean).map(a => ({
    id: a.id,
    name: a.name,
    value_id: a.value_id,
    value_name: a.value_name,
  }));
}

function normalizeProduct(product) {
  const images = imagesOf(product);
  return {
    id: product?.id,
    name: product?.name || product?.short_description?.content || product?.id,
    status: product?.status,
    domain_id: product?.domain_id,
    family_name: product?.family_name,
    thumbnail: images[0] || null,
    images,
    attributes: attrsOf(product),
  };
}

// ---- Busca no catalogo com reordenacao por semelhanca ----
// A busca do Mercado Livre devolve poucos itens (10 por padrao) numa ordem propria, que
// nao acompanha o texto digitado. Aqui pedimos mais candidatos, em duas consultas (texto
// completo e versao curta), e reordenamos pelo quanto o nome bate com o que foi pedido.

const WEAK_WORDS = new Set([
  'relogio', 'smartwatch', 'smart', 'watch', 'monitor', 'novo', 'nova', 'original', 'lacrado', 'oficial',
  'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'e', 'o', 'a', 'em', 'cor', 'tela', 'kit',
  'mm', 'cm', 'gb', 'tb', 'ml', 'kg', 'nf', 'gps',
]);

function foldText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Grafias diferentes da mesma palavra nos anuncios.
const SAME_WORD = { saphira: 'safira', saphire: 'safira', sapphire: 'safira', zafiro: 'safira', musica: 'music', titanio: 'titanium' };

function tokensOf(value) {
  return (foldText(value).match(/[a-z]+|\d+/g) || []).map(token => SAME_WORD[token] || token);
}

function tokenWeight(token) {
  if (/^\d+$/.test(token)) return token.length <= 4 ? 3 : 1;
  if (WEAK_WORDS.has(token) || token.length <= 1) return 0.4;
  return 1;
}

function matchScore(queryTokens, name) {
  const have = new Set(tokensOf(name));
  let total = 0;
  let hit = 0;
  for (const token of queryTokens) {
    const weight = tokenWeight(token);
    total += weight;
    if (have.has(token)) hit += weight;
  }
  return total ? hit / total : 0;
}

function shortQuery(query) {
  const words = foldText(query).split(/[^a-z0-9]+/).filter(Boolean)
    .filter(word => !WEAK_WORDS.has(word) && !/^\d{5,}$/.test(word));
  return words.slice(0, 4).join(' ');
}

async function catalogSearch(query, env) {
  const base = `/products/search?status=active&site_id=${encodeURIComponent(env.ML_SITE_ID || 'MLB')}&q=${encodeURIComponent(query)}`;
  try {
    return (await ml(`${base}&limit=50`, env))?.results || [];
  } catch (error) {
    if (error.status && error.status !== 400) throw error;
    return (await ml(base, env))?.results || [];
  }
}

async function searchProducts(query, env) {
  const text = String(query || '').trim();
  const queryTokens = unique(tokensOf(text));
  const queries = [text];
  const short = shortQuery(text);
  if (short && short !== foldText(text).replace(/[^a-z0-9]+/g, ' ').trim()) queries.push(short);

  const found = new Map();
  for (const q of queries) {
    let items = [];
    try { items = await catalogSearch(q, env); }
    catch (error) { if (!found.size && q === queries[queries.length - 1]) throw error; }
    for (const item of items) if (item?.id && !found.has(item.id)) found.set(item.id, item);
  }

  const ranked = [...found.values()]
    .map((item, order) => ({ item, order, score: matchScore(queryTokens, item.name) }))
    .sort((x, y) => y.score - x.score || x.order - y.order)
    .slice(0, 12);

  const results = await Promise.all(ranked.map(async ({ item, score }) => {
    let product;
    try { product = normalizeProduct(await ml(`/products/${encodeURIComponent(item.id)}`, env)); }
    catch { product = normalizeProduct(item); }
    product.match = Math.round(score * 100);
    return product;
  }));

  // "Bate" = o melhor candidato cobre a maior parte do texto e traz o numero do modelo
  // (o primeiro numero curto do texto: Fenix 9, Forerunner 265, iPhone 16...).
  const model = queryTokens.find(token => /^\d{1,4}$/.test(token)) || null;
  const best = results[0];
  const close = Boolean(best && best.match >= 60 && (!model || tokensOf(best.name).includes(model)));
  return { results, close, model_token: model, candidates: found.size };
}

// ---- Identificar produto a partir de um link do Mercado Livre ----

const ML_LINK_HOST = /(^|\.)(mercadolivre\.com(\.br)?|mercadolibre\.com|meli\.la)$/i;

function mlLinkUrl(raw) {
  let text = String(raw || '').trim();
  if (text && !/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  return ML_LINK_HOST.test(url.hostname) ? url : null;
}

function slugToQuery(slug) {
  return String(slug || '')
    .replace(/_JM$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai do endereco o que der para saber sem abrir a pagina:
// produto de catalogo (/p/MLB...), anuncio (MLB-123...) e o texto do nome.
function parseMlLink(url) {
  let path = url.pathname;
  try { path = decodeURIComponent(path); } catch { /* mantem como veio */ }
  const out = { productId: null, itemId: null, userProductId: null, query: '' };
  const segments = path.split('/').filter(Boolean);

  const catalog = path.match(/\/p\/(MLB\d+)(?:\/|$)/i);
  if (catalog) out.productId = catalog[1].toUpperCase();

  const item = path.match(/^\/(MLB)-?(\d{6,})(?:-([^/]*))?/i);
  if (item) {
    out.itemId = `MLB${item[2]}`;
    out.query = slugToQuery(item[3]);
  }
  const userProduct = path.match(/\/up\/(MLBU\d+)(?:\/|$)/i);
  if (userProduct) out.userProductId = userProduct[1].toUpperCase();
  if (!out.itemId) {
    // O anuncio pode vir em ?wid= / ?item_id= ou depois do # (links copiados da busca do site).
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    for (const params of [url.searchParams, fragment]) {
      for (const name of ['wid', 'item_id']) {
        const value = (params.get(name) || '').match(/^MLB-?(\d{6,})$/i);
        if (value && !out.itemId) out.itemId = `MLB${value[1]}`;
      }
    }
  }
  if (!out.query && segments.length > 1 && /^(p|up)$/i.test(segments[1]) && !/^MLB/i.test(segments[0])) {
    out.query = slugToQuery(segments[0]);
  }
  if (!out.query && /^lista\./i.test(url.hostname) && segments.length) {
    out.query = slugToQuery(segments[segments.length - 1]);
  }
  return out;
}

// Links curtos (compartilhar do aplicativo) so revelam o produto depois do redirecionamento.
// Segue no maximo 5 saltos, sempre dentro de dominios do Mercado Livre.
async function followMlLink(start) {
  let url = start;
  let parsed = parseMlLink(url);
  for (let hop = 0; hop < 5 && !parsed.productId && !parsed.itemId && !parsed.query; hop++) {
    let response;
    try {
      response = await fetch(url.toString(), {
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt;q=0.9', 'user-agent': 'Mozilla/5.0 RadarML/1.0' },
      });
    } catch { break; }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      let next;
      try { next = mlLinkUrl(new URL(location, url).toString()); } catch { next = null; }
      if (!next) break;
      url = next;
      parsed = parseMlLink(url);
      continue;
    }
    if (response.ok && /text\/html/i.test(response.headers.get('content-type') || '')) {
      // Ultimo recurso: a pagina de destino nao traz o produto no endereco.
      const html = (await response.text()).slice(0, 400000);
      const found = html.match(/\/p\/(MLB\d+)/i) || html.match(/"catalog_product_id"\s*:\s*"(MLB\d+)"/i);
      if (found) { parsed.productId = found[1].toUpperCase(); parsed.fromPage = true; }
    }
    break;
  }
  return { url, parsed };
}

async function resolveLink(raw, env) {
  const start = mlLinkUrl(raw);
  if (!start) return json({ error: 'Cole um link do Mercado Livre (mercadolivre.com.br).' }, 400);

  const { parsed } = await followMlLink(start);
  // O que o Mercado Livre respondeu em cada tentativa (so codigos, nenhum dado sensivel).
  const tried = { product_id: parsed.productId, item_id: parsed.itemId, user_product_id: parsed.userProductId };

  if (parsed.productId) {
    try {
      const product = normalizeProduct(await ml(`/products/${encodeURIComponent(parsed.productId)}`, env));
      if (product.id) return json({ kind: 'product', via: parsed.fromPage ? 'pagina' : 'link', product, tried });
    } catch (error) { tried.product_status = error.status || 'erro'; }
  }

  const lookups = [];
  if (parsed.itemId) lookups.push(['item', `/items/${encodeURIComponent(parsed.itemId)}`]);
  if (parsed.userProductId) lookups.push(['user_product', `/user-products/${encodeURIComponent(parsed.userProductId)}`]);
  for (const [name, path] of lookups) {
    try {
      const data = await ml(path, env);
      tried[`${name}_status`] = 200;
      tried[`${name}_catalog`] = data?.catalog_product_id || null;
      if (data?.catalog_product_id) {
        const product = normalizeProduct(await ml(`/products/${encodeURIComponent(data.catalog_product_id)}`, env));
        if (product.id) return json({ kind: 'product', via: 'anuncio', product, tried });
      }
      if (!parsed.query && (data?.title || data?.name)) parsed.query = data.title || data.name;
    } catch (error) {
      // Anuncio de terceiro costuma responder 403: segue para a busca pelo nome.
      if (!(`${name}_status` in tried)) tried[`${name}_status`] = error.status || 'erro';
    }
  }

  const words = parsed.query.split(' ').filter(Boolean);
  if (words.length && parsed.query.length >= 2) {
    const query = words.slice(0, 12).join(' ');
    const found = await searchProducts(query, env);
    return json({ kind: 'search', query, count: found.results.length, results: found.results, close: found.close, candidates: found.candidates, tried });
  }

  return json({ error: 'Não consegui identificar o produto nesse link. Abra o anúncio e copie o endereço da página do produto.', tried }, 422);
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubRepo(env) {
  return env.GITHUB_REPOSITORY || 'valmiroliveirajr/radar-garmin';
}

async function github(path, env, init = {}) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN não configurado no Worker');
  const response = await fetch(`https://api.github.com/repos/${githubRepo(env)}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'radar-ml-worker',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) {
    const err = new Error(`GitHub HTTP ${response.status}`);
    err.status = response.status;
    err.detail = body;
    throw err;
  }
  return body;
}

async function readWatchlist(env) {
  const file = await github(`/contents/${WATCHLIST_PATH}?ref=main`, env);
  const data = JSON.parse(base64ToUtf8(file.content || ''));
  return { data, sha: file.sha };
}

async function writeWatchlist(data, sha, message, env) {
  return github(`/contents/${WATCHLIST_PATH}`, env, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
      sha,
      branch: 'main',
    }),
  });
}

function safeSelectedImages(product, requested) {
  const available = imagesOf(product);
  const requestedGallery = unique(requested?.gallery_images || []).filter(url => available.includes(url)).slice(0, 10);
  let cover = requested?.cover_image && available.includes(requested.cover_image) ? requested.cover_image : null;
  if (!cover) cover = requestedGallery[0] || available[0] || null;
  const gallery = unique([cover, ...requestedGallery, ...available]).slice(0, 10);
  return { cover, gallery, available };
}

function slugId(product) {
  const tail = String(product?.id || '').replace(/^MLB/i, '');
  return `mlb-${tail || crypto.randomUUID().slice(0, 8)}`;
}

// Cadastro sem chave: a pagina do Radar pode incluir produtos, dentro de limites.
// Com a chave administrativa (coletor, manutencao) nao ha limite.
const PUBLIC_MAX_PRODUCTS = 40;
const PUBLIC_MAX_ADDS_PER_DAY = 15;

function fromRadarPage(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || 'https://valmiroliveirajr.github.io').replace(/\/$/, '');
  return (request.headers.get('origin') || '') === allowed;
}

function publicAddsKey() {
  return `public_adds:${new Date().toISOString().slice(0, 10)}`;
}

async function addProduct(request, env, publicMode = false) {
  if (publicMode) {
    if (!fromRadarPage(request, env)) return json({ error: 'Cadastro permitido somente a partir da página do Radar.' }, 403);
    if (!env.ML_TOKEN_STORE) return json({ error: 'Cadastro sem chave indisponível: contador diário não configurado.' }, 503);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Pedido inválido' }, 400); }
  const pid = String(body.catalog_product_id || '').trim().toUpperCase();
  if (!/^MLB\d+$/.test(pid)) return json({ error: 'catalog_product_id inválido' }, 400);

  let addsToday = 0;
  if (publicMode) {
    addsToday = Number(await tokenStoreGet(env, publicAddsKey()) || 0);
    if (addsToday >= PUBLIC_MAX_ADDS_PER_DAY) {
      return json({ error: `Limite de ${PUBLIC_MAX_ADDS_PER_DAY} cadastros por dia atingido. Tente amanhã.` }, 429);
    }
  }

  const product = await ml(`/products/${encodeURIComponent(pid)}`, env);
  if (!product || product.status === 'inactive') return json({ error: 'Produto de catálogo indisponível' }, 400);

  const { cover, gallery } = safeSelectedImages(product, body);
  const { data, sha } = await readWatchlist(env);
  data.version = Math.max(Number(data.version || 1), 2);
  data.source = 'Mercado Livre';
  data.site_id = env.ML_SITE_ID || 'MLB';
  data.products = Array.isArray(data.products) ? data.products : [];

  const today = new Date().toISOString().slice(0, 10);
  const current = data.products.find(x => x.catalog_product_id === pid);
  if (publicMode && current) return json({ ok: true, already: true, product: current });
  if (publicMode && data.products.length >= PUBLIC_MAX_PRODUCTS) {
    return json({ error: `A lista chegou ao limite de ${PUBLIC_MAX_PRODUCTS} produtos.` }, 409);
  }
  const entry = {
    id: current?.id || slugId(product),
    catalog_product_id: pid,
    name: product.name || body.name || pid,
    active: true,
    origin_policy: body.origin_policy === 'national' ? 'national' : 'all',
    cover_image: cover,
    gallery_images: gallery,
    added_at: current?.added_at || today,
    updated_at: today,
  };

  if (current) Object.assign(current, entry);
  else data.products.push(entry);

  await writeWatchlist(data, sha, `${current ? 'Atualizar' : 'Adicionar'} ${entry.name} no Radar ML`, env);
  if (publicMode) {
    try { await env.ML_TOKEN_STORE.put(publicAddsKey(), String(addsToday + 1), { expirationTtl: 3 * 86400 }); } catch { /* contador e aproximado */ }
  }
  return json({ ok: true, product: entry, collection_trigger: 'push:data/watchlist.json' });
}

async function deleteProduct(productId, env) {
  const pid = String(productId || '').trim().toUpperCase();
  const { data, sha } = await readWatchlist(env);
  const before = data.products?.length || 0;
  data.products = (data.products || []).filter(x => x.catalog_product_id !== pid);
  if (data.products.length === before) return json({ error: 'Produto não encontrado na watchlist' }, 404);
  await writeWatchlist(data, sha, `Remover ${pid} do Radar ML`, env);
  return json({ ok: true, catalog_product_id: pid });
}

async function health(env) {
  let mlOk = false;
  let githubOk = false;
  let tokenMode = 'unconfigured';
  let mlStatus = null;
  let githubStatus = null;
  try {
    const tokenInfo = await getMlToken(env, false);
    tokenMode = tokenInfo.mode;
    const response = await mlRequest('/users/me', env, tokenInfo);
    mlStatus = response.status;
    mlOk = response.ok;
  } catch (error) {
    mlStatus = error.status || 'error';
  }
  try {
    await github(`/contents/${WATCHLIST_PATH}?ref=main`, env);
    githubStatus = 200;
    githubOk = true;
  } catch (error) {
    githubStatus = error.status || 'error';
  }
  const storedRefresh = await tokenStoreGet(env, 'refresh_token');
  return {
    ok: mlOk && githubOk,
    service: 'radar-ml-api',
    ml: mlOk,
    github: githubOk,
    ml_status: mlStatus,
    github_status: githubStatus,
    token_mode: tokenMode,
    auto_refresh_ready: Boolean(env.ML_TOKEN_STORE && env.ML_CLIENT_ID && env.ML_CLIENT_SECRET && (storedRefresh || env.ML_REFRESH_TOKEN)),
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        const result = await health(env);
        return json(result, result.ok ? 200 : 503, cors);
      }

      if (request.method === 'GET' && url.pathname === '/search') {
        const q = (url.searchParams.get('q') || '').trim();
        if (q.length < 2) return json({ error: 'Informe pelo menos 2 caracteres.' }, 400, cors);
        const found = await searchProducts(q, env);
        return json({ query: q, count: found.results.length, results: found.results, close: found.close, candidates: found.candidates }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname === '/resolve') {
        const response = await resolveLink(url.searchParams.get('url'), env);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      if (request.method === 'GET' && url.pathname.startsWith('/product/')) {
        const pid = url.pathname.split('/').pop().toUpperCase();
        if (!/^MLB\d+$/.test(pid)) return json({ error: 'Produto inválido' }, 400, cors);
        return json(normalizeProduct(await ml(`/products/${encodeURIComponent(pid)}`, env)), 200, cors);
      }

      if (request.method === 'POST' && url.pathname === '/watchlist') {
        // Chave valida = sem limites. Sem chave (ou chave antiga) = cadastro publico com limites.
        const response = await addProduct(request, env, !isAdmin(request, env));
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      requireAdmin(request, env);

      if (request.method === 'GET' && url.pathname === '/session/check') {
        return json({ ok: true, admin: true }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/catalog/')) {
        const pid = url.pathname.split('/').pop().toUpperCase();
        if (!/^MLB\d+$/.test(pid)) return json({ error: 'Produto inválido' }, 400, cors);
        return json(await ml(`/products/${encodeURIComponent(pid)}`, env), 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/offers/')) {
        const pid = url.pathname.split('/').pop().toUpperCase();
        if (!/^MLB\d+$/.test(pid)) return json({ error: 'Produto inválido' }, 400, cors);
        return json(await ml(`/products/${encodeURIComponent(pid)}/items`, env), 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/seller/')) {
        const sellerId = url.pathname.split('/').pop();
        if (!/^\d+$/.test(sellerId)) return json({ error: 'Vendedor inválido' }, 400, cors);
        return json(await ml(`/users/${encodeURIComponent(sellerId)}`, env), 200, cors);
      }

      if (request.method === 'DELETE' && url.pathname.startsWith('/watchlist/')) {
        const response = await deleteProduct(url.pathname.split('/').pop(), env);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
      }

      return json({ error: 'Rota não encontrada' }, 404, cors);
    } catch (error) {
      if (error instanceof Response) {
        const headers = new Headers(error.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(error.body, { status: error.status, headers });
      }
      return json({ error: error.message || String(error), detail: error.detail || null }, error.status || 500, cors);
    }
  },
};
