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

async function searchProducts(query, env) {
  const q = encodeURIComponent(query.trim());
  const data = await ml(`/products/search?status=active&site_id=${encodeURIComponent(env.ML_SITE_ID || 'MLB')}&q=${q}`, env);
  const base = (data?.results || []).filter(x => x?.id).slice(0, 12);
  const detailed = await Promise.all(base.map(async item => {
    try { return normalizeProduct(await ml(`/products/${encodeURIComponent(item.id)}`, env)); }
    catch { return normalizeProduct(item); }
  }));
  return detailed;
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

async function addProduct(request, env) {
  const body = await request.json();
  const pid = String(body.catalog_product_id || '').trim().toUpperCase();
  if (!/^MLB\d+$/.test(pid)) return json({ error: 'catalog_product_id inválido' }, 400);

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
        const results = await searchProducts(q, env);
        return json({ query: q, count: results.length, results }, 200, cors);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/product/')) {
        const pid = url.pathname.split('/').pop().toUpperCase();
        if (!/^MLB\d+$/.test(pid)) return json({ error: 'Produto inválido' }, 400, cors);
        return json(normalizeProduct(await ml(`/products/${encodeURIComponent(pid)}`, env)), 200, cors);
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

      if (request.method === 'POST' && url.pathname === '/watchlist') {
        const response = await addProduct(request, env);
        const headers = new Headers(response.headers);
        Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
        return new Response(response.body, { status: response.status, headers });
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
