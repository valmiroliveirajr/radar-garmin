// Evolucao do preco por produto.
// Le data/price_series.json (resumo gerado por scripts/rebuild_history.py em cada coleta)
// e desenha a secao "Evolucao do preco" logo abaixo do resumo do produto.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const COLOR = { sel: '#6d28d9', min: '#8b8d98', grid: '#ece7e0' };
  const DAY = 86400000;
  let series = null;
  let resizeTimer = null;

  const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const moneyShort = v => 'R$ ' + Math.round(Number(v)).toLocaleString('pt-BR');
  const time = d => Date.parse(d + 'T00:00:00Z');
  const dayMonth = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  const fullDate = d => d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // Compatibilidade: se o resumo ainda nao existir, monta a serie a partir do history.json completo.
  function fromHistory(entries) {
    const out = {};
    for (const entry of entries || []) {
      for (const p of entry.products || []) {
        if (!p || !p.catalog_product_id) continue;
        (out[p.catalog_product_id] = out[p.catalog_product_id] || []).push({
          date: entry.date,
          selected_price: p.selected_offer ? p.selected_offer.price : null,
          min_price: p.market ? p.market.min_price : null,
          offer_count: p.market ? p.market.offer_count : null,
          seller: p.selected_offer ? p.selected_offer.seller_nickname : null,
        });
      }
    }
    return out;
  }

  async function load() {
    try {
      const r = await fetch('data/price_series.json?' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        series = (await r.json()).products || {};
      } else {
        const h = await fetch('data/history.json?' + Date.now(), { cache: 'no-store' });
        series = h.ok ? fromHistory(await h.json()) : {};
      }
    } catch (e) {
      console.error(e);
      series = {};
    }
    draw();
  }

  function rowsFor(pid) {
    return ((series && series[pid]) || [])
      .filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || ''))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  function statTile(label, value, note) {
    const t = el('div', 'metric');
    t.appendChild(el('span', '', label));
    const s = el('strong');
    if (value instanceof Node) s.appendChild(value); else s.textContent = value;
    t.appendChild(s);
    if (note) t.appendChild(el('small', '', note));
    return t;
  }

  function percent(diff, base) {
    if (!base || !diff) return '';
    return (diff > 0 ? '+' : '−') + Math.abs(diff / base * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  }

  function deltaNode(diff, base, withPercent) {
    const w = el('span', 'ph-delta');
    if (!diff) { w.textContent = 'sem variação'; return w; }
    const up = diff > 0;
    w.classList.add(up ? 'ph-up' : 'ph-down');
    w.appendChild(el('i', '', up ? '▲' : '▼'));
    const pct = withPercent ? percent(diff, base) : '';
    w.appendChild(document.createTextNode((up ? '+' : '−') + money(Math.abs(diff)) + (pct ? ' (' + pct + ')' : '')));
    return w;
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo || Math.abs(hi) * 0.04 || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const start = Math.floor(lo / step) * step;
    const ticks = [];
    for (let v = start; v <= hi + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }

  function chart(host, rows) {
    host.textContent = '';
    const W = Math.max(260, host.clientWidth || 600);
    const narrow = W < 520;
    const H = narrow ? 200 : 240;
    const M = { l: narrow ? 62 : 66, r: narrow ? 14 : 84, t: 14, b: 28 };
    const PW = W - M.l - M.r, PH = H - M.t - M.b;

    const values = [];
    rows.forEach(r => { if (isNum(r.selected_price)) values.push(r.selected_price); if (isNum(r.min_price)) values.push(r.min_price); });
    let lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    const pad = (hi - lo) * 0.18 || hi * 0.02 || 1;
    const ticks = niceTicks(lo - pad, hi + pad, 4);
    lo = ticks[0]; hi = ticks[ticks.length - 1];

    const t0 = time(rows[0].date), t1 = time(rows[rows.length - 1].date);
    const x = d => (t1 === t0 ? M.l + PW / 2 : M.l + (time(d) - t0) / (t1 - t0) * PW);
    const y = v => M.t + (1 - (v - lo) / (hi - lo)) * PH;

    const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', tabindex: '0' });
    const last = rows[rows.length - 1];
    root.setAttribute('aria-label', 'Evolução do preço de ' + fullDate(rows[0].date) + ' a ' + fullDate(last.date) +
      (isNum(last.selected_price) ? '. Oferta selecionada mais recente: ' + money(last.selected_price) : '') + '. Valores na tabela abaixo.');

    // Grade horizontal e rotulos do eixo de preco
    ticks.forEach(v => {
      root.appendChild(svg('line', { x1: M.l, x2: M.l + PW, y1: y(v), y2: y(v), stroke: COLOR.grid, 'stroke-width': 1 }));
      const t = svg('text', { x: M.l - 8, y: y(v) + 3.5, 'text-anchor': 'end' });
      t.textContent = moneyShort(v);
      root.appendChild(t);
    });

    // Rotulos de data: primeiro, ultimo e os que couberem entre eles
    const maxLabels = Math.max(2, Math.floor(PW / 62));
    const stepIdx = Math.max(1, Math.ceil((rows.length - 1) / (maxLabels - 1)));
    let lastLabelX = -1e9;
    rows.forEach((r, i) => {
      const isEdge = i === 0 || i === rows.length - 1;
      if (!isEdge && i % stepIdx !== 0) return;
      const px = x(r.date);
      if (!isEdge && (px - lastLabelX < 54 || x(last.date) - px < 64)) return;
      if (isEdge && i > 0 && px - lastLabelX < 40) return;
      const t = svg('text', { x: px, y: H - 8, 'text-anchor': rows.length > 1 && i === 0 ? 'start' : (i === rows.length - 1 && rows.length > 1 ? 'end' : 'middle') });
      t.textContent = dayMonth(r.date);
      root.appendChild(t);
      lastLabelX = px;
    });

    // Series: menor preco bruto (contexto, cinza) por baixo; oferta selecionada (destaque) por cima
    const defs = [
      { key: 'min_price', color: COLOR.min, label: 'Menor preço bruto' },
      { key: 'selected_price', color: COLOR.sel, label: 'Oferta selecionada' },
    ];
    const showDots = rows.length <= 45;
    defs.forEach(def => {
      const pts = rows.filter(r => isNum(r[def.key]));
      for (let i = 1; i < pts.length; i++) {
        const gap = Math.round((time(pts[i].date) - time(pts[i - 1].date)) / DAY) > 1;
        root.appendChild(svg('line', {
          x1: x(pts[i - 1].date), y1: y(pts[i - 1][def.key]), x2: x(pts[i].date), y2: y(pts[i][def.key]),
          stroke: def.color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-opacity': gap ? 0.32 : 1,
        }));
      }
      pts.forEach((r, i) => {
        if (!showDots && i !== pts.length - 1) return;
        root.appendChild(svg('circle', { cx: x(r.date), cy: y(r[def.key]), r: 4, fill: def.color, stroke: '#fff', 'stroke-width': 2 }));
      });
    });

    // Rotulo direto no fim da linha (so quando ha margem a direita)
    if (!narrow) {
      const ySel = isNum(last.selected_price) ? y(last.selected_price) : null;
      const yMin = isNum(last.min_price) ? y(last.min_price) : null;
      if (ySel != null) {
        const t = svg('text', { x: M.l + PW + 10, y: ySel + 4, class: 'ph-end' });
        t.textContent = moneyShort(last.selected_price);
        root.appendChild(t);
      }
      if (yMin != null && (ySel == null || Math.abs(yMin - ySel) >= 15)) {
        const t = svg('text', { x: M.l + PW + 10, y: yMin + 4 });
        t.textContent = moneyShort(last.min_price);
        root.appendChild(t);
      }
    }

    // Camada de leitura: linha vertical que gruda na data mais proxima + caixa com os valores
    const cross = svg('line', { y1: M.t, y2: M.t + PH, stroke: '#17171d', 'stroke-width': 1, 'stroke-opacity': 0.35, visibility: 'hidden' });
    root.appendChild(cross);
    const marks = defs.map(def => {
      const c = svg('circle', { r: 5.5, fill: def.color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' });
      root.appendChild(c);
      return c;
    });
    const hit = svg('rect', { x: M.l - 12, y: 0, width: PW + 24, height: H, fill: 'transparent' });
    root.appendChild(hit);
    host.appendChild(root);

    const tip = el('div', 'ph-tip');
    host.appendChild(tip);
    let current = -1;

    function show(i) {
      if (i < 0 || i >= rows.length) return;
      current = i;
      const r = rows[i], px = x(r.date);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      defs.forEach((def, k) => {
        if (isNum(r[def.key])) { marks[k].setAttribute('cx', px); marks[k].setAttribute('cy', y(r[def.key])); marks[k].setAttribute('visibility', 'visible'); }
        else marks[k].setAttribute('visibility', 'hidden');
      });
      tip.textContent = '';
      tip.appendChild(el('div', 'ph-tip-date', fullDate(r.date)));
      defs.slice().reverse().forEach(def => {
        const line = el('div', 'ph-tip-row');
        const keyMark = el('i'); keyMark.style.background = def.color;
        line.appendChild(keyMark);
        line.appendChild(el('strong', '', isNum(r[def.key]) ? money(r[def.key]) : 'sem dado'));
        line.appendChild(el('span', '', def.label));
        tip.appendChild(line);
      });
      if (r.seller) tip.appendChild(el('div', 'ph-tip-foot', 'Vendedor: ' + r.seller));
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      let left = px + 12;
      if (left + tw > W - 4) left = px - 12 - tw;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = (M.t + 4) + 'px';
    }
    function hide() {
      current = -1;
      cross.setAttribute('visibility', 'hidden');
      marks.forEach(m => m.setAttribute('visibility', 'hidden'));
      tip.style.display = 'none';
    }
    function nearest(evt) {
      const box = root.getBoundingClientRect();
      const px = (evt.clientX - box.left) * (W / box.width);
      let best = 0, dist = Infinity;
      rows.forEach((r, i) => { const d = Math.abs(x(r.date) - px); if (d < dist) { dist = d; best = i; } });
      return best;
    }
    root.addEventListener('pointermove', e => show(nearest(e)));
    root.addEventListener('pointerdown', e => show(nearest(e)));
    root.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    root.addEventListener('focus', () => { if (current < 0) show(rows.length - 1); });
    root.addEventListener('blur', hide);
    root.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { show(Math.max(0, (current < 0 ? rows.length : current) - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { show(Math.min(rows.length - 1, current + 1)); e.preventDefault(); }
      else if (e.key === 'Escape') hide();
    });
  }

  const TABLE_PREVIEW = 10;

  function table(rows) {
    const wrap = el('div', 'ph-table-wrap');
    const t = el('table', 'offers ph-table');
    const head = el('tr');
    ['Data', 'Oferta selecionada', 'Variação', 'Menor preço bruto', 'Ofertas', 'Vendedor'].forEach(h => head.appendChild(el('th', '', h)));
    const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    const body = el('tbody');
    // Mais recente primeiro; a variacao compara com a coleta anterior que tenha preco.
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      let prev = null;
      for (let j = i - 1; j >= 0 && !prev; j--) if (isNum(rows[j].selected_price)) prev = rows[j];
      const tr = el('tr');
      if (rows.length - 1 - i >= TABLE_PREVIEW) tr.className = 'ph-more';
      tr.appendChild(el('td', '', fullDate(r.date)));
      tr.appendChild(el('td', 'price', isNum(r.selected_price) ? money(r.selected_price) : '—'));
      const dv = el('td');
      if (prev && isNum(r.selected_price)) dv.appendChild(deltaNode(r.selected_price - prev.selected_price, prev.selected_price, true));
      else dv.textContent = '—';
      tr.appendChild(dv);
      tr.appendChild(el('td', 'price', isNum(r.min_price) ? money(r.min_price) : '—'));
      tr.appendChild(el('td', '', r.offer_count != null ? String(r.offer_count) : '—'));
      tr.appendChild(el('td', '', r.seller || '—'));
      body.appendChild(tr);
    }
    t.appendChild(body);
    wrap.appendChild(t);
    const box = el('div');
    box.appendChild(wrap);
    if (rows.length > TABLE_PREVIEW) {
      const btn = el('button', 'ph-toggle', 'Ver os ' + rows.length + ' dias');
      btn.type = 'button';
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        const open = t.classList.toggle('ph-all');
        btn.setAttribute('aria-expanded', String(open));
        btn.textContent = open ? 'Mostrar só os ' + TABLE_PREVIEW + ' mais recentes' : 'Ver os ' + rows.length + ' dias';
      });
      box.appendChild(btn);
    }
    return box;
  }

  function missingDays(rows) {
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      for (let t = time(rows[i - 1].date) + DAY; t < time(rows[i].date); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
    }
    return out;
  }

  function draw() {
    const content = document.querySelector('#content');
    const hero = content && content.querySelector('.hero');
    const old = document.querySelector('#priceHistory');
    if (old) old.remove();
    if (!hero || series === null) return;

    const rows = rowsFor(state.current);
    const priced = rows.filter(r => isNum(r.selected_price));

    const section = el('section', 'section');
    section.id = 'priceHistory';
    const head = el('div', 'section-head');
    const headText = el('div');
    headText.appendChild(el('h3', '', 'Evolução do preço'));
    headText.appendChild(el('p', '', 'Um ponto por dia de coleta. A oferta selecionada segue a regra do Radar (vendedor confiável e garantia).'));
    head.appendChild(headText);
    section.appendChild(head);

    const panel = el('div', 'panel ph-panel');
    section.appendChild(panel);
    hero.insertAdjacentElement('afterend', section);

    if (!priced.length) {
      panel.appendChild(el('div', 'ph-empty', 'Ainda sem histórico para este produto. O primeiro ponto entra na próxima coleta diária.'));
      return;
    }

    const first = priced[0], last = priced[priced.length - 1];
    const lowest = priced.reduce((a, b) => (b.selected_price < a.selected_price ? b : a));
    const highest = priced.reduce((a, b) => (b.selected_price > a.selected_price ? b : a));
    const stats = el('div', 'ph-stats');
    stats.appendChild(statTile('Preço na última coleta', money(last.selected_price), fullDate(last.date)));
    const totalDiff = last.selected_price - first.selected_price;
    const daysNote = priced.length + (priced.length === 1 ? ' dia coletado' : ' dias coletados');
    stats.appendChild(statTile('Variação desde ' + dayMonth(first.date),
      priced.length > 1 ? deltaNode(totalDiff, first.selected_price, false) : 'primeiro registro',
      (percent(totalDiff, first.selected_price) ? percent(totalDiff, first.selected_price) + ' · ' : '') + daysNote));
    stats.appendChild(statTile('Menor já registrado', money(lowest.selected_price), fullDate(lowest.date)));
    stats.appendChild(statTile('Maior já registrado', money(highest.selected_price), fullDate(highest.date)));
    panel.appendChild(stats);

    if (rows.length > 1) {
      const legend = el('div', 'ph-legend');
      [['Oferta selecionada', COLOR.sel], ['Menor preço bruto do mercado', COLOR.min]].forEach(pair => {
        const k = el('span', 'ph-key', pair[0]);
        k.style.setProperty('--k', pair[1]);
        legend.appendChild(k);
      });
      panel.appendChild(legend);
      const host = el('div', 'ph-chart');
      panel.appendChild(host);
      chart(host, rows);
      const missing = missingDays(rows);
      if (missing.length) {
        const list = missing.length <= 6 ? missing.map(dayMonth).join(', ') : missing.length + ' dias';
        panel.appendChild(el('p', 'ph-note', 'Sem coleta em ' + list + ': o trecho mais claro da linha liga os dias vizinhos, não é preço medido.'));
      }
    } else {
      panel.appendChild(el('p', 'ph-note', 'O gráfico aparece a partir do segundo dia de coleta.'));
    }
    panel.appendChild(table(rows));
  }

  // Redesenha junto com a tela do produto (mesmo padrao do compat.js: sobrepor a funcao global).
  const baseRender = render;
  render = function () {
    baseRender.apply(this, arguments);
    try { draw(); } catch (e) { console.error(e); }
  };

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { try { draw(); } catch (e) { console.error(e); } }, 160);
  });

  load();
})();
