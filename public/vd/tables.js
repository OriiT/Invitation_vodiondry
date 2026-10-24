// Plan de table : glisser-déposer (SortableJS, chargé avant ce fichier) et menus « Déplacer vers… ».
// Chaque déplacement est enregistré par POST JSON /admin/tables/assign (jeton CSRF en en-tête).
// Sans JavaScript, la page fonctionne avec les formulaires (bouton « Déplacer »).
(() => {
  'use strict';

  const board = document.querySelector('[data-plan]');
  if (!board) return;
  document.documentElement.classList.add('tp-js');

  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrf = csrfMeta ? csrfMeta.getAttribute('content') || '' : '';
  const live = document.getElementById('tp-live');
  const pool = board.querySelector('.tp-pool-list');
  const search = board.querySelector('[data-pool-search]');
  const sideSelect = board.querySelector('[data-pool-side]');
  const filterForm = board.querySelector('[data-pool-filter]');
  const noResult = board.querySelector('[data-pool-none]');

  // ------------------------------------------------------------ textes (mêmes formulations que le serveur)

  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const overText = (n) => `Capacité dépassée de ${n} place${n > 1 ? 's' : ''}`;
  const overSummary = (names) =>
    names.length
      ? `${names.length > 1 ? `${names.length} tables dépassent leur capacité` : '1 table dépasse sa capacité'} : ${names.join(', ')}.`
      : '';
  // Même règle que fold() côté serveur (src/lib/import.ts) : apostrophes typographiques (’ de l'iPhone) → « ' ».
  const fold = (s) => String(s || '').replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'").normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  // ------------------------------------------------------------ message (zone aria-live)

  let liveTimer = 0;
  function say(text, kind) {
    if (!live) return;
    clearTimeout(liveTimer);
    live.className = `tp-live${kind === 'warn' ? ' is-warn' : kind === 'err' ? ' is-err' : ''}`;
    live.textContent = text;
    liveTimer = setTimeout(() => { live.textContent = ''; }, kind === 'ok' ? 3000 : 7000);
  }

  // ------------------------------------------------------------ compteurs

  const chipsOf = (list) => Array.from(list.querySelectorAll('.tp-chip'));
  const seatsOfChip = (chip) => Number(chip.dataset.seats) || 0;

  function cardOf(tableId) {
    return tableId ? board.querySelector(`.tp-table[data-table-id="${CSS.escape(String(tableId))}"]`) : null;
  }

  function listOf(tableId) {
    if (!tableId) return pool;
    const card = cardOf(tableId);
    return card ? card.querySelector('.tp-list') : null;
  }

  /** Met à jour une carte de table à partir de la réponse du serveur. */
  function applyTable(t) {
    if (!t) return;
    const card = cardOf(t.id);
    if (!card) return;
    card.dataset.seats = String(t.seats);
    card.dataset.capacity = String(t.capacity);
    const v = card.querySelector('.tp-count-v');
    const cap = card.querySelector('.tp-count-c');
    if (v) v.textContent = String(t.seats);
    if (cap) cap.textContent = String(t.capacity);
    card.classList.toggle('is-over', Boolean(t.over));
    const alert = card.querySelector('.tp-over');
    if (alert) {
      alert.hidden = !t.over;
      alert.textContent = t.over ? overText(t.over_by) : '';
    }
    const bar = card.querySelector('.tp-meter > span');
    if (bar) {
      const pct = t.capacity > 0 ? Math.min(100, Math.round((t.seats / t.capacity) * 100)) : t.seats > 0 ? 100 : 0;
      bar.style.width = `${pct}%`;
    }
  }

  /** Totaux recalculés depuis la page : places attribuées, à attribuer, tables en dépassement. */
  function refreshTotals() {
    const cards = Array.from(board.querySelectorAll('.tp-table'));
    const placed = cards.reduce((s, c) => s + (Number(c.dataset.seats) || 0), 0);
    const poolChips = pool ? chipsOf(pool) : [];
    const unplaced = poolChips.reduce((s, c) => s + seatsOfChip(c), 0);
    const placedEl = document.querySelector('[data-stat="placed"]');
    const unplacedEl = document.querySelector('[data-stat="unplaced"]');
    if (placedEl) placedEl.textContent = String(placed);
    if (unplacedEl) unplacedEl.textContent = String(unplaced);
    const poolCount = board.querySelector('[data-pool-count]');
    if (poolCount) poolCount.textContent = `${plural(poolChips.length, 'invité', 'invités')} · ${plural(unplaced, 'place', 'places')}`;
    const over = document.querySelector('[data-over-summary]');
    if (over) {
      const names = cards
        .filter((c) => c.classList.contains('is-over'))
        .map((c) => (c.querySelector('.tp-title') || {}).textContent || '');
      over.hidden = names.length === 0;
      over.textContent = overSummary(names);
    }
  }

  // ------------------------------------------------------------ filtre des invités à placer

  function matches(chip) {
    const side = sideSelect ? sideSelect.value : '';
    const q = search ? fold(search.value) : '';
    return (!side || chip.dataset.side === side) && (!q || fold(chip.dataset.name).includes(q));
  }

  function applyFilter(updateUrl) {
    if (!pool) return;
    const chips = chipsOf(pool);
    let visible = 0;
    for (const chip of chips) {
      const ok = matches(chip);
      chip.classList.toggle('hidden', !ok);
      if (ok) visible++;
    }
    // Une pastille déplacée vers une table est toujours visible.
    board.querySelectorAll('.tp-table .tp-chip.hidden').forEach((c) => c.classList.remove('hidden'));
    if (noResult) noResult.hidden = !(chips.length > 0 && visible === 0);
    if (updateUrl && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      const q = search ? search.value.trim() : '';
      const side = sideSelect ? sideSelect.value : '';
      if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
      if (side) url.searchParams.set('side', side); else url.searchParams.delete('side');
      ['ok', 'over'].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }

  if (search) search.addEventListener('input', () => applyFilter(true));
  if (sideSelect) sideSelect.addEventListener('change', () => applyFilter(true));
  if (filterForm) filterForm.addEventListener('submit', (e) => { e.preventDefault(); applyFilter(true); });
  // Le navigateur peut restaurer les champs du filtre (retour arrière) : on resynchronise,
  // et on retire ?ok / ?over de l'adresse pour qu'un rechargement ne réaffiche pas le message.
  applyFilter(/[?&](ok|over)=/.test(window.location.search));

  /** Après le premier déplacement, le message affiché au chargement n'est plus d'actualité. */
  function clearPageMessages() {
    document.querySelectorAll('.wrap.main > .flash, .tp-warn').forEach((el) => el.remove());
  }

  // ------------------------------------------------------------ enregistrement

  class AssignError extends Error {
    constructor(message, network) {
      super(message);
      this.network = Boolean(network);
    }
  }

  async function assign(guestId, tableId) {
    let res;
    try {
      res = await fetch('/admin/tables/assign', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ guest_id: Number(guestId), table_id: tableId ? Number(tableId) : null }),
      });
    } catch (e) {
      throw new AssignError('Connexion impossible : le déplacement n’a pas été enregistré.', true);
    }
    let data = null;
    let text = '';
    try {
      text = await res.text();
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (!res.ok || !data || !data.ok) {
      const msg = (data && data.message) || (text && text.length < 200 ? text : '') || 'Le déplacement n’a pas pu être enregistré. Rechargez la page.';
      throw new AssignError(msg, false);
    }
    return data;
  }

  /** Place la pastille dans une liste, par ordre alphabétique. */
  function insertSorted(list, chip) {
    const name = chip.dataset.name || '';
    const next = chipsOf(list).find((c) => c !== chip && (c.dataset.name || '').localeCompare(name, 'fr', { sensitivity: 'base', numeric: true }) > 0);
    list.insertBefore(chip, next || null);
  }

  function setSelect(chip, tableId) {
    const sel = chip.querySelector('select.tp-select');
    if (!sel) return;
    sel.value = tableId ? String(tableId) : '';
    sel.dataset.current = sel.value;
  }

  function afterSuccess(chip, data) {
    const tableId = data.table ? data.table.id : null;
    const target = listOf(tableId);
    if (target && chip.parentElement !== target) insertSorted(target, chip);
    setSelect(chip, tableId);
    applyTable(data.table);
    applyTable(data.previous);
    applyFilter(false);
    refreshTotals();
    clearPageMessages();
    chip.classList.remove('is-moved');
    void chip.offsetWidth; // relance l'animation
    chip.classList.add('is-moved');
    const name = chip.dataset.name || 'Invité';
    if (data.warning) say(data.warning, 'warn');
    else if (data.table) say(`${name} : ${data.table.name} (${data.table.seats} / ${data.table.capacity} places).`, 'ok');
    else say(`${name} : non placé.`, 'ok');
  }

  // Glisser-déposer
  async function onDrop(chip, from, oldIndex, to) {
    const tableId = to.dataset.tableId || null;
    chip.classList.add('is-busy');
    let data;
    try {
      data = await assign(chip.dataset.guestId, tableId);
    } catch (err) {
      // Retour à la place d'origine.
      const ref = Array.from(from.children).filter((c) => c !== chip)[oldIndex] || null;
      from.insertBefore(chip, ref);
      applyFilter(false);
      refreshTotals();
      say(err.message, 'err');
      return;
    } finally {
      chip.classList.remove('is-busy');
    }
    afterSuccess(chip, data);
  }

  if (typeof window.Sortable === 'function') {
    board.querySelectorAll('.tp-list').forEach((list) => {
      window.Sortable.create(list, {
        group: 'plan',
        sort: false,
        animation: 150,
        delay: 150,
        delayOnTouchOnly: true,
        touchStartThreshold: 5,
        emptyInsertThreshold: 24,
        draggable: '.tp-chip',
        filter: '.tp-move',
        preventOnFilter: false,
        ghostClass: 'tp-ghost',
        chosenClass: 'tp-chosen',
        dragClass: 'tp-drag',
        onStart: () => board.classList.add('is-dragging'),
        onEnd: (evt) => {
          board.classList.remove('is-dragging');
          if (evt.from === evt.to) return;
          onDrop(evt.item, evt.from, evt.oldIndex, evt.to);
        },
      });
    });
  }

  // Menu « Déplacer vers… »
  board.addEventListener('change', async (e) => {
    const sel = e.target instanceof HTMLSelectElement && e.target.classList.contains('tp-select') ? e.target : null;
    if (!sel) return;
    const chip = sel.closest('.tp-chip');
    if (!chip) return;
    const previous = sel.dataset.current || '';
    if (sel.value === previous) return;
    chip.classList.add('is-busy');
    let data;
    try {
      data = await assign(chip.dataset.guestId, sel.value || null);
    } catch (err) {
      chip.classList.remove('is-busy');
      if (err.network && sel.form) {
        // Repli : envoi classique du formulaire.
        sel.form.submit();
        return;
      }
      sel.value = previous;
      say(err.message, 'err');
      return;
    }
    chip.classList.remove('is-busy');
    afterSuccess(chip, data);
  });
})();
