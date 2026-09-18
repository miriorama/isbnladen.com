'use strict';

const LibraryPreferences = (() => {
  const KEY = 'biblio.libraries.v1';
  const defaults = [
    { code: 'HA', isil: 'CN0133', name: 'Biblioteca civica Anna Frank', city: 'Borgo San Dalmazzo', province: 'Cuneo' },
    { code: '50', isil: 'CN0037', name: 'Biblioteca civica di Cuneo', city: 'Cuneo', province: 'Cuneo' }
  ];
  const normalize = value => String(value ?? '').trim();
  function validate(items) {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    return items.filter(item => {
      if (!item || typeof item.code !== 'string' || !/^[A-Za-z0-9]{1,3}$/.test(item.code) ||
          typeof item.isil !== 'string' || !/^(?:IT-)?[A-Z]{2}\d{4}$/.test(item.isil) ||
          typeof item.name !== 'string' || !item.name.trim() || seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    }).map(item => ({ code: item.code, isil: item.isil.replace(/^IT-/, ''), name: item.name.trim(),
      city: normalize(item.city), province: normalize(item.province), address: normalize(item.address) }));
  }
  function read() {
    try {
      const items = validate(JSON.parse(localStorage.getItem(KEY)));
      if (items.length) return items;
    } catch { /* Keep the original libraries when storage is missing or invalid. */ }
    return defaults.map(item => ({ ...item }));
  }
  const $ = id => document.getElementById(id);
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it');
  let selected = read();
  let directory = [];
  let loading = false;
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function selection() {
    $('library-selected').replaceChildren();
    for (const library of selected) {
      const button = node('button', `${library.name}${library.city ? ` · ${library.city}` : ''} ×`, 'biblio-library-chip');
      button.type = 'button';
      button.setAttribute('aria-label', `Rimuovi ${library.name}, ${library.city}`);
      button.onclick = () => toggle(library.code, false);
      $('library-selected').append(button);
    }
    $('library-selection-count').textContent = `${selected.length} ${selected.length === 1 ? 'biblioteca selezionata' : 'biblioteche selezionate'}`;
  }
  function toggle(code, checked) {
    if (!checked && selected.length === 1) {
      $('library-save-status').textContent = 'Tienine almeno una: scegli un’altra biblioteca prima di rimuovere questa.';
      filter();
      return;
    }
    const library = directory.find(item => item.code === code);
    const next = checked ? [...selected.filter(item => item.code !== code), library].filter(Boolean) : selected.filter(item => item.code !== code);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      selected = next;
      $('library-save-status').textContent = 'Fatto! Cercheremo i libri nelle biblioteche che hai scelto.';
    } catch {
      $('library-save-status').textContent = 'Il browser non consente di salvare la selezione. Abilita l’archiviazione locale e riprova.';
    }
    selection();
    filter();
  }
  function filter() {
    const focusedCode = document.activeElement?.matches('.biblio-directory-item input') ? document.activeElement.value : null;
    const words = fold($('library-query').value.trim()).split(/\s+/).filter(Boolean);
    const province = $('library-province').value;
    const matches = directory.filter(item => (!province || item.province === province) &&
      words.every(word => fold(`${item.name} ${item.city}`).includes(word)));
    $('library-list').replaceChildren();
    for (const library of matches) {
      const label = node('label', undefined, 'biblio-directory-item');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.some(item => item.code === library.code);
      checkbox.setAttribute('onchange', 'LibraryPreferences.toggle(this.value, this.checked)');
      checkbox.value = library.code;
      const content = node('span', undefined, 'biblio-directory-content');
      content.append(node('strong', library.name), node('span', [library.city, library.province].filter(Boolean).join(' · ')));
      if (library.address) content.append(node('small', library.address));
      label.append(checkbox, content);
      $('library-list').append(label);
    }
    if (focusedCode) {
      const input = [...$('library-list').querySelectorAll('input')].find(item => item.value === focusedCode);
      input?.focus({ preventScroll: true });
    }
    $('library-results-status').textContent = loading ? 'Un attimo, carichiamo le biblioteche…' : `${matches.length} ${matches.length === 1 ? 'biblioteca trovata' : 'biblioteche trovate'}`;
    $('library-no-results').hidden = loading || matches.length > 0;
  }
  async function load() {
    if (loading) return;
    loading = true;
    $('library-retry').hidden = true;
    $('library-load-error').hidden = true;
    $('library-list').setAttribute('aria-busy', 'true');
    filter();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('https://api.cloud.sbn.it/gateway/opac-ws/polo/TO0', {
        headers: { Authorization: 'sbncloud-spa-open' }, credentials: 'omit', signal: controller.signal
      });
      if (!response.ok) throw new Error('Elenco non disponibile');
      const data = await response.json();
      if (!data.esito?.successful || !Array.isArray(data.result?.libraries)) throw new Error('Elenco non valido');
      const items = validate(data.result.libraries.map(item => {
        const details = item.dettagli?.[0] || {};
        return { code: normalize(item.cod_bib), isil: normalize(item.isil), name: normalize(item.name),
          city: normalize(details.citta), province: normalize(details.provincia), address: normalize(details.indirizzo) };
      }));
      if (!items.length) throw new Error('Elenco vuoto');
      directory = items.sort((a, b) => a.name.localeCompare(b.name, 'it'));
      const previousProvince = $('library-province').value;
      $('library-province').replaceChildren(new Option('Tutte le province', ''));
      for (const province of [...new Set(items.map(item => item.province).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'it'))) {
        $('library-province').append(new Option(province, province));
      }
      $('library-province').value = previousProvince;
    } catch {
      $('library-load-error').hidden = false;
      $('library-retry').hidden = false;
    } finally {
      clearTimeout(timeout);
      loading = false;
      $('library-list').setAttribute('aria-busy', 'false');
      filter();
    }
  }
  function init() {
    directory = selected.slice();
    selection();
    load();
    window.addEventListener('pageshow', () => { selected = read(); selection(); filter(); });
    window.addEventListener('storage', event => {
      if (event.key === KEY || event.key === null) { selected = read(); selection(); filter(); }
    });
  }
  return { KEY, read, init, load, filter, toggle };
})();

const Biblio = (() => {
  const API = 'https://api.cloud.sbn.it/gateway/opac-ws/search/documenti?codPolo=TO0';
  const OPAC = 'https://cloud.sbn.it/opac/TO0/ricercaSemplice';
  let libraries = LibraryPreferences.read();
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
  const googleCovers = new Map();
  const pendingGoogleCovers = new Map();
  let googleCoverRequest = 0;
  const coverPlaceholders = new Map();
  const coverEmojis = ['📕', '📗', '📘', '📙'];

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

  function availabilityDate(copy) {
    if (!copy.date) return '';
    const date = new Date(copy.date);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT');
  }
  function copyStatus(copy) {
    const date = availabilityDate(copy);
    return copy.status === 'In prestito' && date ? `In prestito fino al ${date}` : copy.status;
  }
  function paintAvailability(node, locationNode, copies) {
    node.replaceChildren();
    const available = copies.filter(copy => copy.available === true).length;
    const unknown = copies.some(copy => typeof copy.available !== 'boolean');
    const label = available ? `Disponibile · ${available} ${available === 1 ? 'copia' : 'copie'}`
      : !copies.length || unknown ? 'Disponibilità non comunicata'
      : copies.every(copy => copy.status === 'In prestito') ? [...new Set(copies.map(copyStatus))].join(' · ') : 'Non disponibile';
    const badge = element('span', label, 'biblio-availability-badge');
    badge.dataset.state = available ? 'available' : !copies.length || unknown ? 'unknown' : 'unavailable';
    node.append(badge);
    locationNode.replaceChildren();
    const locations = [...new Set(copies.map(copy => copy.location).filter(Boolean))];
    for (const location of locations) locationNode.append(element('div', location, 'biblio-library-shelf'));
    if (!locations.length) locationNode.append(element('span', 'Non comunicata'));
    if (copies.length) {
      const details = element('details', undefined, 'biblio-availability-details');
      details.append(element('summary', 'Dettagli delle copie'));
      for (const copy of copies) {
        const parts = [copyStatus(copy), copy.reason, copy.location && `Collocazione: ${copy.location}`, copy.inventory && `Inventario: ${copy.inventory}`].filter(Boolean);
        if (copy.status !== 'In prestito' && availabilityDate(copy)) {
          parts.push(`Data disponibilità indicata da SBN: ${availabilityDate(copy)}`);
        }
        if (copy.reservable) parts.push('Prenotabile secondo SBN');
        if (copy.document) parts.push(`Documento collegato: ${copy.document}`);
        details.append(element('p', parts.join(' · ')));
      }
      locationNode.append(details);
    }
  }

  async function loadAvailability(jobs) {
    availabilityController?.abort();
    const batch = new AbortController();
    availabilityController = batch;
    let cursor = 0;
    async function worker() {
      while (!batch.signal.aborted && cursor < jobs.length) {
        const { bid, node, locationNode, library } = jobs[cursor++];
        const cacheKey = `${library.code}:${bid}`;
        const cached = availabilityCache.get(cacheKey);
        if (cached && Date.now() - cached.checkedAt < 60000) {
          paintAvailability(node, locationNode, cached.copies);
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
          paintAvailability(node, locationNode, copies);
        } catch {
          if (batch.signal.aborted) return;
          node.replaceChildren(element('span', 'Disponibilità non verificabile', 'biblio-availability-badge'));
          locationNode.textContent = 'Non verificabile';
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
  function bookIsbn(doc) {
    const values = Array.isArray(doc.isbn) ? doc.isbn : [doc.isbn];
    return values.map(value => String(value ?? '').replace(/[\s-]/g, '').toUpperCase())
      .find(value => /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(value)) || '';
  }
  // Google Books Dynamic Links: raggruppa gli ISBN richiesti nello stesso render.
  function googleCover(isbn) {
    if (!googleCovers.has(isbn)) {
      googleCovers.set(isbn, new Promise(resolve => pendingGoogleCovers.set(isbn, resolve)));
      if (pendingGoogleCovers.size === 1) queueMicrotask(loadGoogleCovers);
    }
    return googleCovers.get(isbn);
  }
  function loadGoogleCovers() {
    const batch = new Map(pendingGoogleCovers);
    pendingGoogleCovers.clear();
    const callback = `isbnladenGoogleCovers${++googleCoverRequest}`;
    const script = document.createElement('script');
    let finished = false;
    const finish = (data = {}, failed = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      script.remove();
      delete window[callback];
      for (const [isbn, resolve] of batch) {
        let thumbnail = '';
        try {
          const value = data[`ISBN:${isbn}`]?.thumbnail_url;
          if (value) {
            const url = new URL(value);
            if (url.hostname === 'books.google.com' || url.hostname.endsWith('.books.google.com') || url.hostname.endsWith('.googleusercontent.com')) {
              url.protocol = 'https:';
              thumbnail = url.href;
            }
          }
        } catch { /* Mantieni l’emoji se Google non restituisce un URL valido. */ }
        if (failed) googleCovers.delete(isbn);
        resolve(thumbnail);
      }
    };
    const timeout = setTimeout(() => finish({}, true), 10000);
    window[callback] = data => finish(data);
    script.onerror = () => finish({}, true);
    const url = new URL('https://books.google.com/books');
    url.search = new URLSearchParams({ jscmd: 'viewapi', bibkeys: [...batch.keys()].map(isbn => `ISBN:${isbn}`).join(','), callback });
    script.src = url.href;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  }
  function bookCover(doc) {
    const cover = element('div', undefined, 'biblio-cover');
    const key = doc.bid || doc.syntetic_title;
    if (!coverPlaceholders.has(key)) {
      coverPlaceholders.set(key, coverEmojis[Math.floor(Math.random() * coverEmojis.length)]);
    }
    cover.append(element('span', coverPlaceholders.get(key), 'biblio-cover-placeholder'));
    cover.setAttribute('aria-hidden', 'true');
    const isbn = bookIsbn(doc);
    if (!isbn) return cover;
    const image = element('img', undefined, 'biblio-cover-image');
    image.alt = '';
    image.width = 65;
    image.height = 90;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.onload = () => cover.classList.add('biblio-cover-loaded');
    image.onerror = () => {
      cover.classList.remove('biblio-cover-loaded');
      image.remove();
    };
    googleCover(isbn).then(url => {
      if (!url) return;
      image.src = url;
      cover.append(image);
    });
    return cover;
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
    $('libraries-tab').toggleAttribute('aria-current', mode === 'libraries');
    if (mode === 'libraries') $('libraries-tab').setAttribute('aria-current', 'page');
    $('search-panel').hidden = mode !== 'catalog';
    $('results-panel').hidden = mode === 'libraries';
    $('libraries-view').hidden = mode !== 'libraries';
    document.title = mode === 'libraries' ? 'Biblioteche — isbnladen' : mode === 'saved' ? 'Preferiti — isbnladen' : 'isbnladen — La tua prossima lettura';
    const url = new URL(location.href);
    if ((url.searchParams.get('view') || 'catalog') !== mode) {
      url.searchParams.set('view', mode);
      history.pushState(null, '', url);
    }
    $('saved-count').textContent = saved.length;
  }
  function render() {
    if (state.mode === 'libraries') {
      $('hero-emoji').textContent = '📍';
      $('hero-heading').textContent = 'Le tue';
      $('hero-emphasis').textContent = 'biblioteche.';
      $('hero-description').textContent = 'Scegli le biblioteche che frequenti. Cercheremo i libri e le copie disponibili proprio lì.';
      $('hero-note').textContent = 'Polo Piemonte–Torino (TO0). Le tue scelte restano salvate in questo browser.';
      return;
    }
    const isSaved = state.mode === 'saved';
    $('hero-emoji').textContent = isSaved ? '📌' : '📚';
    $('hero-heading').textContent = isSaved ? 'I tuoi' : 'I libri più';
    $('hero-emphasis').textContent = isSaved ? 'preferiti.' : 'ricercati.';
    $('hero-description').textContent = isSaved ? 'Tutti i titoli che ti ispirano, pronti per la prossima lettura.' : 'Trova un libro che ti ispira, scopri dove prenderlo in prestito e aggiungilo ai preferiti.';
    $('hero-note').textContent = isSaved ? 'I preferiti restano in questo browser e non sono sincronizzati con SBN.' : 'Cerca per titolo, autore o ISBN nelle biblioteche che hai scelto.';
    const docs = isSaved ? saved : state.docs;
    $('results').replaceChildren();
    $('results-panel').hidden = !isSaved && !state.query;
    $('results-head').hidden = isSaved;
    $('status').hidden = isSaved;
    $('results-title').textContent = !isSaved && state.query ? `Risultati per “${state.query}”` : '';
    $('sort-wrap').hidden = isSaved || !state.query;
    const availabilityJobs = [];
    docs.forEach(doc => {
      const card = element('article', undefined, 'biblio-card');
      const cover = bookCover(doc);
      const content = element('div', undefined, 'biblio-card-content');
      content.append(element('h3', doc.syntetic_title), element('p', doc.author || 'Autore non indicato'), element('p', doc.publish || 'Pubblicazione non indicata'));
      const meta = [doc.date?.[0], doc.language?.join(', '), `SBN ${doc.bid}`].filter(Boolean).join(' · ');
      content.append(element('p', meta));
      const libraryBox = element('div', undefined, 'biblio-library-box');
      libraryBox.setAttribute('role', 'table');
      libraryBox.tabIndex = 0;
      libraryBox.setAttribute('aria-label', 'Disponibilità nelle biblioteche selezionate');
      const headings = element('div', undefined, 'biblio-library biblio-library-head');
      headings.setAttribute('role', 'row');
      for (const [label, className] of [['Biblioteca', 'identity'], ['Luogo', 'place'], ['Disponibilità', 'stock'], ['Collocazione', 'location']]) {
        const heading = element('div', label, `biblio-library-cell biblio-library-${className}`);
        heading.setAttribute('role', 'columnheader');
        headings.append(heading);
      }
      libraryBox.append(headings);
      const holdings = Array.isArray(doc.tag977) ? doc.tag977.map(code => String(code).trim()) : null;
      for (const library of libraries) {
        if (holdings && !holdings.includes(library.code)) continue;
        const section = element('div', undefined, 'biblio-library');
        section.setAttribute('role', 'row');
        const cell = className => {
          const value = element('div', undefined, `biblio-library-cell ${className}`);
          value.setAttribute('role', 'cell');
          section.append(value);
          return value;
        };
        const identity = cell('biblio-library-identity');
        identity.append(element('strong', library.name, 'biblio-library-name'));
        const place = cell('biblio-library-place');
        place.append(element('span', library.city || 'Non comunicato'));
        if (library.address) place.append(element('small', library.address));
        const availabilityCell = cell('biblio-library-stock');
        const availability = element('div', 'Verifica in corso…', 'biblio-availability');
        availability.setAttribute('aria-live', 'polite');
        availabilityCell.append(availability);
        const locationNode = cell('biblio-library-location');
        locationNode.textContent = 'Verifica in corso…';
        availabilityJobs.push({ bid: doc.bid, node: availability, locationNode, library });
        const link = element('a', 'Scheda SBN ↗');
        link.href = permalink(doc.bid, library);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        identity.append(link);
        libraryBox.append(section);
      }
      if (libraryBox.children.length > 1) content.append(libraryBox);
      else content.append(element('p', 'Non presente nelle biblioteche selezionate.'));
      const active = saved.some(item => item.bid === doc.bid);
      const button = element('button', active ? '✓ Salvato' : '+ Salva', 'biblio-save');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', `${active ? 'Rimuovi dai preferiti' : 'Salva'}: ${clean(doc.syntetic_title)}`);
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
    else saved.push({ bid: doc.bid, syntetic_title: doc.syntetic_title || 'Titolo non indicato', author: doc.author, publish: doc.publish, date: doc.date, language: doc.language, tag977: doc.tag977, isbn: bookIsbn(doc) });
    let persisted = true;
    try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { persisted = false; }
    render();
    $('status').hidden = state.mode === 'saved' && persisted;
    $('status').textContent = persisted ? '' : 'Preferiti aggiornati per questa sessione. Il browser non consente il salvataggio permanente.';
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
    $('status').textContent = 'Cerchiamo tra i tuoi scaffali…';
    const [sort, order = 'asc'] = $('sort').value.split(':');
    const payload = { start, maxRows: SIZE, sort, order, filters: { filters: [
      { operator: 'AND', filters: libraries.map(library => ({ ...filter('library', library.code, 'completePhrase'), operator: 'OR' })) },
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
      $('status').textContent = `${state.total.toLocaleString('it-IT')} documenti trovati${state.total ? ` · Mostrati ${start + 1}–${Math.min(start + SIZE, state.total)}` : ''} · ${libraries.length} ${libraries.length === 1 ? 'biblioteca selezionata' : 'biblioteche selezionate'}`;
    } catch (error) {
      if (current !== controller) return;
      state.loading = false;
      render();
      $('status').replaceChildren(document.createTextNode('Il catalogo non è raggiungibile in questo momento. '));
      const retry = element('button', 'Riprova');
      retry.onclick = () => search(start);
      $('status').append(retry);
      for (const library of libraries) {
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
    libraries = LibraryPreferences.read();
    updateLibrarySummary();
    controller?.abort(); controller = null;
    state.loading = false;
    $('results').setAttribute('aria-busy', 'false');
    setMode('saved'); render();
    $('status').textContent = '';
  }
  function showCatalog() {
    libraries = LibraryPreferences.read();
    updateLibrarySummary();
    setMode('catalog');
    if (state.query) search(state.start);
    else { render(); $('status').textContent = ''; }
  }
  let librariesTemplate;
  async function showLibraries() {
    controller?.abort(); controller = null;
    availabilityController?.abort();
    state.loading = false;
    $('results').setAttribute('aria-busy', 'false');
    setMode('libraries');
    render();
    if (!librariesTemplate) {
      librariesTemplate = (async () => {
        const host = $('libraries-view');
        host.setAttribute('aria-busy', 'true');
        host.replaceChildren(element('p', 'Un attimo, apriamo le biblioteche…', 'biblio-status'));
        try {
          const response = await fetch('biblioteche.html');
          if (!response.ok) throw new Error('Template non disponibile');
          const template = document.createElement('template');
          template.innerHTML = await response.text();
          if (!template.content.querySelector('#library-list')) throw new Error('Template non valido');
          host.replaceChildren(template.content.cloneNode(true));
          LibraryPreferences.init();
        } catch {
          librariesTemplate = null;
          const retry = element('button', 'Riprova', 'biblio-save');
          retry.setAttribute('onclick', 'Biblio.showLibraries()');
          host.replaceChildren(element('p', 'Non riusciamo ad aprire le biblioteche. Riprova.', 'biblio-status'), retry);
        } finally {
          host.setAttribute('aria-busy', 'false');
        }
      })();
    }
    await librariesTemplate;
  }
  function navigate(event, view) {
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    event?.preventDefault();
    if (view === 'libraries') showLibraries();
    else if (view === 'saved') showSaved();
    else showCatalog();
  }
  function updateLibrarySummary() {
    $('selected-libraries-summary').replaceChildren(...libraries.map(library =>
      element('span', [library.name, library.city].filter(Boolean).join(' · '), 'biblio-library-chip')
    ));
  }
  function syncLibraries() {
    const next = LibraryPreferences.read();
    if (JSON.stringify(next) === JSON.stringify(libraries)) return;
    libraries = next;
    updateLibrarySummary();
    availabilityController?.abort();
    if (state.mode === 'catalog' && state.query) search();
    else render();
  }
  window.addEventListener('pageshow', syncLibraries);
  window.addEventListener('storage', event => {
    if (event.key === LibraryPreferences.KEY || event.key === null) syncLibraries();
  });
  updateLibrarySummary();
  const params = new URLSearchParams(location.search);
  $('query').value = (params.get('q') || '').slice(0, 250);
  $('field').value = fields.includes(params.get('field')) ? params.get('field') : 'any';
  state.query = $('query').value.trim();
  state.field = $('field').value;
  render();
  setMode(['saved', 'libraries'].includes(params.get('view')) ? params.get('view') : 'catalog');
  if (params.get('view') === 'libraries') showLibraries();
  else if (params.get('view') === 'saved') showSaved();
  else if ($('query').value.trim()) submit();
  window.addEventListener('popstate', () => navigate(null, new URLSearchParams(location.search).get('view')));
  return { submit, showSaved, showCatalog, showLibraries, navigate, suggest(query, field) { $('query').value = query; $('field').value = field; submit(); }, sort() { search(); }, page(direction) { if (state.loading) return; const start = state.start + direction * SIZE; if (start >= 0 && start < state.total) search(start); } };
})();
