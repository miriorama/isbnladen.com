'use strict';

const Biblio = (() => {
  const API = 'https://api.cloud.sbn.it/gateway/opac-ws/search/documenti?codPolo=TO0';
  const OPAC = 'https://cloud.sbn.it/opac/TO0/ricercaSemplice';
  const LIBRARIES = [
    { code: 'HA', isil: 'CN0133', name: 'Anna Frank · Borgo San Dalmazzo' },
    { code: '50', isil: 'CN0037', name: 'Biblioteca civica · Cuneo' }
  ];
  const KEY = 'biblio.saved.v1';
  const SIZE = 12;
  const fields = ['any', 'titolo', 'nome', 'soggetto', 'isbn'];
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').replace(/[\u0088\u0089\u0098\u009c]/g, '').replace(/<<|>>/g, '');
  let saved = [];
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(data)) saved = data.filter(d => d && typeof d.bid === 'string' && typeof d.syntetic_title === 'string').slice(0, 500);
  } catch { /* Storage may be unavailable; the list still works in this session. */ }
  let state = { query: '', field: 'any', start: 0, total: 0, docs: [], mode: 'catalog', loading: false };
  let controller;
  let availabilityController;
  const availabilityCache = new Map();

  function parseAvailability(data, library) {
    const result = data.result?.possedutoResult;
    if (!data.esito?.successful || !result?.posseduto || (result.esito?.returnCode != null && result.esito.returnCode !== 0)) {
      throw new Error('Disponibilità non verificabile');
    }
    const copies = [];
    const addCopies = (items, location = '', document = null) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (String(item.bib || '').trim() !== library.code) continue;
        const availability = item.disponibilita;
        const available = availability?.disponibile;
        const reason = clean(availability?.motivo).trim();
        const status = available === true ? 'Disponibile' : available === false
          ? (/prestito/i.test(reason) ? 'In prestito' : 'Non disponibile') : 'Disponibilità non comunicata';
        copies.push({ status, available, reason, location,
          inventory: [item.serie?.trim(), item.numero].filter(value => value !== undefined && value !== '').join(' '),
          date: availability?.dataDisponibilita,
          reservable: availability?.prenotazioni?.prenotabile === true,
          document: document?.isbd || '' });
      }
    };
    for (const shelf of result.posseduto.collocazione || []) {
      addCopies(shelf.inventario, [shelf.sez, shelf.loc, shelf.spec].filter(Boolean).map(value => value.trim()).join(' '), shelf.documento);
    }
    // Non-collocated inventory uses the same inventory DTO in the SBN response.
    const loose = result.posseduto.nonCollocato;
    addCopies(Array.isArray(loose) ? loose : loose?.inventario);
    return copies;
  }

  function paintAvailability(node, copies, checkedAt) {
    node.replaceChildren();
    const available = copies.filter(copy => copy.available === true).length;
    const unknown = copies.some(copy => typeof copy.available !== 'boolean');
    const label = available ? `Disponibile · ${available} ${available === 1 ? 'copia' : 'copie'}`
      : !copies.length || unknown ? 'Disponibilità non comunicata'
      : copies.every(copy => copy.status === 'In prestito') ? 'In prestito' : 'Non disponibile';
    const badge = element('span', label, 'biblio-availability-badge');
    badge.dataset.state = available ? 'available' : !copies.length || unknown ? 'unknown' : 'unavailable';
    node.append(badge);
    if (copies.length) {
      const details = element('details', undefined, 'biblio-availability-details');
      details.append(element('summary', 'Copie e collocazioni'));
      for (const copy of copies) {
        const parts = [copy.status, copy.reason, copy.location && `Collocazione: ${copy.location}`, copy.inventory && `Inventario: ${copy.inventory}`].filter(Boolean);
        if (copy.date) {
          const date = new Date(copy.date);
          if (!Number.isNaN(date.getTime())) parts.push(`Data disponibilità indicata da SBN: ${date.toLocaleDateString('it-IT')}`);
        }
        if (copy.reservable) parts.push('Prenotabile secondo SBN');
        if (copy.document) parts.push(`Documento collegato: ${copy.document}`);
        details.append(element('p', parts.join(' · ')));
      }
      node.append(details);
    }
    node.append(element('small', `Verificato alle ${new Date(checkedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`));
  }

  async function loadAvailability(jobs) {
    availabilityController?.abort();
    const batch = new AbortController();
    availabilityController = batch;
    let cursor = 0;
    async function worker() {
      while (!batch.signal.aborted && cursor < jobs.length) {
        const { bid, node, library } = jobs[cursor++];
        const cacheKey = `${library.code}:${bid}`;
        const cached = availabilityCache.get(cacheKey);
        if (cached && Date.now() - cached.checkedAt < 60000) {
          paintAvailability(node, cached.copies, cached.checkedAt);
          continue;
        }
        const request = new AbortController();
        const abort = () => request.abort();
        batch.signal.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 12000);
        try {
          const url = new URL('https://api.cloud.sbn.it/gateway/opac-ws/posseduto');
          url.search = new URLSearchParams({ bid, isil: library.isil, codPolo: 'TO0', withDisponibilita: 'true', withFascicoli: 'true', note: 'true', sedi: 'true' });
          const response = await fetch(url, { headers: { Authorization: 'sbncloud-spa-open' }, signal: request.signal, credentials: 'omit' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const copies = parseAvailability(await response.json(), library);
          if (batch.signal.aborted) return;
          const checkedAt = Date.now();
          availabilityCache.set(cacheKey, { copies, checkedAt });
          if (availabilityCache.size > 200) availabilityCache.delete(availabilityCache.keys().next().value);
          paintAvailability(node, copies, checkedAt);
        } catch {
          if (batch.signal.aborted) return;
          node.replaceChildren(element('span', 'Disponibilità non verificabile', 'biblio-availability-badge'));
          const retry = element('button', 'Riprova', 'biblio-availability-retry');
          retry.type = 'button';
          retry.onclick = () => render();
          node.append(retry);
        } finally {
          clearTimeout(timeout);
          batch.signal.removeEventListener('abort', abort);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = clean(text);
    if (className) node.className = className;
    return node;
  }
  function permalink(bid, library) {
    return `https://cloud.sbn.it/opac/TO0/${encodeURIComponent(library.code)}/dettaglio/documento/${encodeURIComponent(bid)}`;
  }
  function catalogUrl(query, field, library) {
    const url = new URL(library ? `https://cloud.sbn.it/opac/TO0/${library.code}/ricercaSemplice` : OPAC);
    url.searchParams.set('search', query);
    url.searchParams.set('searchField', field);
    return url.href;
  }
  function filter(field, value, match = 'andWord') {
    return { field, value, realValue: '', match, operator: 'AND', otherFiltersGroup: [] };
  }
  function setMode(mode) {
    state.mode = mode;
    $('catalog-tab').setAttribute('aria-pressed', mode === 'catalog');
    $('saved-tab').setAttribute('aria-pressed', mode === 'saved');
    $('search-panel').hidden = mode === 'saved';
    $('saved-count').textContent = saved.length;
  }
  function render() {
    const isSaved = state.mode === 'saved';
    const docs = isSaved ? saved : state.docs;
    $('results').replaceChildren();
    $('results-eyebrow').textContent = isSaved ? 'I TUOI SORVEGLIATI SPECIALI' : 'DUE BIBLIOTECHE SOTTO OSSERVAZIONE';
    $('results-title').textContent = isSaved ? 'La mia lista di lettura' : state.query ? `Risultati per “${state.query}”` : 'Ogni ricerca comincia da un indizio.';
    $('sort-wrap').hidden = isSaved || !state.query;
    $('empty').hidden = docs.length > 0 || state.loading;
    $('empty').querySelector('h3').textContent = isSaved ? 'La lista dei sorvegliati è ancora vuota.' : state.query ? 'Il libro resta latitante.' : 'Nessun identikit, nessun ricercato.';
    $('empty').querySelector('p').textContent = isSaved ? 'Premi “Salva” accanto a un risultato per ritrovarlo qui, su questo browser.' : state.query ? 'Nessun documento trovato. Prova un altro indizio: meno parole o un campo di ricerca diverso.' : 'Lascia un titolo, un autore o un ISBN. Al sopralluogo tra gli scaffali pensiamo noi.';
    const availabilityJobs = [];
    docs.forEach(doc => {
      const card = element('article', undefined, 'biblio-card');
      const cover = element('div', (doc.author || doc.syntetic_title || 'B').slice(0, 1), 'biblio-cover');
      cover.setAttribute('aria-hidden', 'true');
      const content = element('div', undefined, 'biblio-card-content');
      content.append(element('h3', doc.syntetic_title), element('p', doc.author || 'Autore non indicato'), element('p', doc.publish || 'Pubblicazione non indicata'));
      const meta = [doc.date?.[0], doc.language?.join(', '), `SBN ${doc.bid}`].filter(Boolean).join(' · ');
      content.append(element('p', meta));
      for (const library of LIBRARIES) {
        const section = element('div', undefined, 'biblio-library');
        section.append(element('strong', library.name, 'biblio-library-name'));
        const availability = element('div', 'Verifica disponibilità…', 'biblio-availability');
        availability.setAttribute('aria-live', 'polite');
        const holdings = Array.isArray(doc.tag977) ? doc.tag977.map(code => String(code).trim()) : null;
        const present = !holdings || holdings.includes(library.code);
        if (present) availabilityJobs.push({ bid: doc.bid, node: availability, library });
        else availability.textContent = 'Non presente nel catalogo di questa biblioteca';
        section.append(availability);
        if (present) {
          const link = element('a', 'Scheda e servizi SBN ↗');
          link.href = permalink(doc.bid, library);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          section.append(link);
        }
        content.append(section);
      }
      const active = saved.some(item => item.bid === doc.bid);
      const button = element('button', active ? '✓ Salvato' : '+ Salva', 'biblio-save');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? 'Rimuovi dalla lista' : 'Salva'}: ${clean(doc.syntetic_title)}`);
      button.onclick = () => toggleSave(doc);
      card.append(cover, content, button);
      $('results').append(card);
    });
    loadAvailability(availabilityJobs);
    $('pagination').hidden = isSaved || state.total <= SIZE || state.loading;
    $('previous').disabled = state.start === 0;
    $('next').disabled = state.start + SIZE >= state.total;
    $('page-label').textContent = `Pagina ${Math.floor(state.start / SIZE) + 1} di ${Math.max(1, Math.ceil(state.total / SIZE))}`;
    $('saved-count').textContent = saved.length;
  }
  function toggleSave(doc) {
    if (saved.some(item => item.bid === doc.bid)) saved = saved.filter(item => item.bid !== doc.bid);
    else saved.push({ bid: doc.bid, syntetic_title: doc.syntetic_title || 'Titolo non indicato', author: doc.author, publish: doc.publish, date: doc.date, language: doc.language, tag977: doc.tag977 });
    let persisted = true;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { persisted = false; }
    render();
    $('status').textContent = persisted ? `${saved.length} documenti nella tua lista, salvata su questo browser.` : 'Lista aggiornata per questa sessione. Il browser non consente il salvataggio permanente.';
  }
  async function search(start = 0) {
    if (!state.query) return;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const timeout = setTimeout(() => current.abort(), 20000);
    state.start = start;
    state.loading = true;
    state.docs = [];
    state.total = 0;
    setMode('catalog');
    render();
    $('results').setAttribute('aria-busy', 'true');
    $('status').textContent = 'Sopralluogo tra gli scaffali di Anna Frank e Cuneo…';
    const [sort, order = 'asc'] = $('sort').value.split(':');
    const payload = { start, maxRows: SIZE, sort, order, filters: { filters: [
      { operator: 'AND', filters: LIBRARIES.map(library => ({ ...filter('library', library.code, 'completePhrase'), operator: 'OR' })) },
      { operator: 'AND', filters: [filter(state.field, state.query)] }
    ] } };
    try {
      // Public application identifier used by the SBN Cloud frontend; not a user credential.
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'sbncloud-spa-open' }, body: JSON.stringify(payload), signal: current.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      // SBN returns a NOT FOUND warning, without a result object, for zero matches.
      const result = data.esito?.cod_esito === '3001' && data.esito?.testoEsito === 'NOT FOUND'
        ? { documenti: [], totElements: 0 } : data.result?.solrSearch;
      if ((!data.esito?.successful && data.esito?.cod_esito !== '3001') || !Array.isArray(result?.documenti) || !Number.isFinite(result.totElements)) throw new Error('Risposta SBN non valida');
      if (current !== controller) return;
      state.docs = result.documenti;
      state.total = result.totElements;
      state.loading = false;
      render();
      $('status').textContent = `${state.total.toLocaleString('it-IT')} documenti trovati${state.total ? ` · Mostrati ${start + 1}–${Math.min(start + SIZE, state.total)}` : ''} · Anna Frank e Cuneo`;
    } catch (error) {
      if (current !== controller) return;
      state.loading = false;
      render();
      $('empty').hidden = true;
      $('status').replaceChildren(document.createTextNode('Il catalogo non è raggiungibile in questo momento. '));
      const retry = element('button', 'Riprova');
      retry.onclick = () => search(start);
      $('status').append(retry);
      for (const library of LIBRARIES) {
        const fallback = element('a', ` Cerca su SBN: ${library.name} ↗`);
        fallback.href = catalogUrl(state.query, state.field, library);
        fallback.target = '_blank'; fallback.rel = 'noopener noreferrer';
        $('status').append(fallback);
      }
    } finally {
      clearTimeout(timeout);
      if (current === controller) $('results').setAttribute('aria-busy', 'false');
    }
  }
  function submit(event) {
    event?.preventDefault();
    const query = $('query').value.trim();
    if (!query) { $('query').focus(); return; }
    state.query = query;
    state.field = $('field').value;
    const url = new URL(location.href);
    url.searchParams.set('q', query); url.searchParams.set('field', state.field);
    history.replaceState(null, '', url);
    search();
  }
  function showSaved() {
    controller?.abort(); controller = null;
    state.loading = false;
    $('results').setAttribute('aria-busy', 'false');
    setMode('saved'); render();
    $('status').textContent = `${saved.length} documenti salvati su questo browser. La lista non è sincronizzata con SBN.`;
  }
  function showCatalog() {
    setMode('catalog');
    if (state.query) search(state.start);
    else { render(); $('status').textContent = 'Consulta i cataloghi di Anna Frank e Cuneo. I ricercati finiscono nella tua lista di lettura.'; }
  }
  const params = new URLSearchParams(location.search);
  $('query').value = (params.get('q') || '').slice(0, 250);
  $('field').value = fields.includes(params.get('field')) ? params.get('field') : 'any';
  render();
  if ($('query').value.trim()) submit();
  return { submit, showSaved, showCatalog, suggest(query, field) { $('query').value = query; $('field').value = field; submit(); }, sort() { search(); }, page(direction) { if (state.loading) return; const start = state.start + direction * SIZE; if (start >= 0 && start < state.total) search(start); } };
})();
