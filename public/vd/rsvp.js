// Branchement des réponses Oui / Non de l'invitation (chargé juste avant le script d'origine).
// Données injectées par le serveur : window.VODIONDRY = { mode: 'generic' | 'guest', code, name, expected, max,
//   response: { answer, count, message } | null, open, deadline, table, invalidCode }.
(() => {
  'use strict';
  const D = window.VODIONDRY || { mode: 'generic' };
  const $ = (s) => document.querySelector(s);
  const yes = $('#rsvpYes');
  const no = $('#rsvpNo');
  const wrap = $('#t3wrap');
  if (!yes || !no || !wrap) return;
  const ps = wrap.querySelectorAll(':scope > p');
  const closing = ps[ps.length - 1] || null; // « Nous avons hâte de célébrer ce jour avec vous. »
  const toastEl = $('#toast');
  let toastT = 0;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  /** Remplace le texte d'un paragraphe (avant l'animation : il sera tapé lettre à lettre ; après : affiché tel quel). */
  function setText(el, text) {
    if (!el) return;
    el.textContent = text;
    if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
  }

  const persons = (n) => n + (n > 1 ? ' personnes' : ' personne');
  const fmtDate = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');

  // ------------------------------------------------------------------ invitation générique
  if (D.mode !== 'guest') {
    const p = document.createElement('p');
    p.className = 't cardo tw vd-ask';
    p.textContent = 'Demandez votre lien personnel aux mariés.';
    yes.parentNode.insertBefore(p, yes);
    // Masqués et non supprimés : le script d'origine s'attend à trouver #rsvpYes et #rsvpNo.
    yes.hidden = true;
    no.hidden = true;
    if (D.invalidCode) setTimeout(() => toast('Ce lien n’est plus valide : demandez votre lien personnel aux mariés.'), 1200);
    return;
  }

  // ------------------------------------------------------------------ invitation personnelle
  const name = String(D.name || '').trim();
  const state = { response: D.response || null, open: D.open !== false, table: D.table || null, max: D.max };

  // La phrase doit tenir au-dessus de l'ornement (trait et cœur) du bas de la carte : 2 lignes à la taille
  // d'origine, 3 lignes au plus en police réduite (mesuré : la mise en page est proportionnelle à la carte, le
  // nombre de lignes ne dépend que du texte). Au-delà, le nom (très long) est omis.
  const LONG_TEXT = 60; // au-delà : .vd-long
  const LONGER_TEXT = 105; // au-delà : .vd-longer
  const MAX_TEXT = 125;

  function statusText() {
    const r = state.response;
    if (!r) {
      const withName = (who) =>
        state.open
          ? (who ? who + ', nous' : 'Nous') + ' attendons votre réponse.'
          : (who ? who + ', les' : 'Les') + ' réponses sont closes : contactez les mariés.';
      const t = withName(name);
      return t.length > MAX_TEXT ? withName('') : t;
    }
    let t = 'Réponse enregistrée : ' + (r.answer === 'oui' ? 'oui, ' + persons(r.count) : 'non') + '.';
    if (r.answer === 'oui' && state.table) t += ' Votre table : ' + state.table + '.';
    return t;
  }

  // Rang (--i) de la première lettre de la phrase dans l'animation « lettre à lettre » du site, relevé avant que
  // la phrase ne soit remplacée par un texte simple (voir replay ci-dessous).
  let firstCh = null;

  function render(dynamic) {
    const r = state.response;
    // Après l'apparition des boutons, pas de délai d'animation pour les changements de style.
    if (dynamic) yes.style.transitionDelay = '0s';
    if (closing && firstCh === null) {
      const ch = closing.querySelector('.ch');
      if (ch) firstCh = Number(ch.style.getPropertyValue('--i')) || 0;
    }
    const t = statusText();
    setText(closing, t);
    if (closing) {
      closing.classList.toggle('vd-long', t.length > LONG_TEXT && t.length <= LONGER_TEXT);
      closing.classList.toggle('vd-longer', t.length > LONGER_TEXT);
    }
    if (r) {
      // Une seule action : « Modifier » (contour), à la place de « Oui, je viens ».
      yes.textContent = 'Modifier';
      yes.classList.remove('fill');
      yes.setAttribute('aria-label', 'Modifier ma réponse');
      yes.hidden = !state.open;
      no.hidden = true;
    } else {
      yes.textContent = 'Oui, je viens';
      yes.classList.add('fill');
      yes.removeAttribute('aria-label');
      yes.hidden = false;
      no.hidden = false;
    }
  }
  render();

  // « Revoir l'enveloppe » : le site retire la classe « typed » puis la remet pour rejouer l'animation. Après une
  // réponse, la phrase est un texte simple (sans lettres .ch) et « Modifier » n'a plus de délai : on rétablit les
  // deux pour que la carte se tape de nouveau lettre à lettre, comme au premier passage.
  new MutationObserver(() => {
    if (wrap.classList.contains('typed')) return;
    yes.style.transitionDelay = '';
    if (!closing || firstCh === null || closing.querySelector('.ch')) return;
    const frag = document.createDocumentFragment();
    [...closing.textContent].forEach((c, k) => {
      const sp = document.createElement('span');
      sp.className = 'ch';
      sp.textContent = c;
      sp.style.setProperty('--i', String(firstCh + k));
      frag.appendChild(sp);
    });
    closing.textContent = '';
    closing.appendChild(frag);
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });

  // ------------------------------------------------------------------ fenêtre de réponse
  // Nombre de personnes plafonné au nombre prévu pour l'invitation (vérifié aussi par le serveur), ou au nombre
  // déjà confirmé s'il est plus grand (réponse saisie par les mariés) : modifier sa réponse ne fait pas perdre de places.
  function maxCount() {
    const r = state.response;
    const confirmed = r && r.answer === 'oui' ? Number(r.count) || 0 : 0;
    return Math.min(30, Math.max(1, Number(state.max) || Number(D.expected) || 1, confirmed));
  }
  let sheet = null;
  let lastFocus = null;
  let sending = false;
  let closeT = 0;
  const form = { answer: 'oui', count: 1, message: '', max: 1 };

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach((c) => c && e.appendChild(c));
    return e;
  }

  function build() {
    const title = el('h2', { class: 'vd-title', id: 'vdTitle', text: 'Votre réponse' });
    const lead = el('p', { class: 'vd-lead', id: 'vdLead' });
    const segYes = el('button', { type: 'button', class: 'vd-seg-b', 'data-a': 'oui', role: 'radio', text: 'Oui, je viens' });
    const segNo = el('button', { type: 'button', class: 'vd-seg-b', 'data-a': 'non', role: 'radio', text: 'Non' });
    const seg = el('div', { class: 'vd-seg', role: 'radiogroup', 'aria-label': 'Votre réponse' }, [segYes, segNo]);
    const minus = el('button', { type: 'button', class: 'vd-step', 'aria-label': 'Une personne de moins', text: '−' });
    const plus = el('button', { type: 'button', class: 'vd-step', 'aria-label': 'Une personne de plus', text: '+' });
    const num = el('output', { class: 'vd-num', id: 'vdNum', 'aria-live': 'polite' });
    const unit = el('span', { class: 'vd-unit', id: 'vdUnit' });
    const hint = el('p', { class: 'vd-hint' });
    const countBox = el('div', { class: 'vd-count', id: 'vdCount' }, [
      el('p', { class: 'vd-q', text: 'Combien serez-vous ?' }),
      el('div', { class: 'vd-stepper' }, [minus, el('div', { class: 'vd-numbox' }, [num, unit]), plus]),
      hint,
    ]);
    const msgLabel = el('label', { class: 'vd-label', for: 'vdMsg', text: 'Un mot pour les mariés' });
    const msg = el('textarea', { id: 'vdMsg', class: 'vd-msg', rows: '3', maxlength: '1000', placeholder: 'Facultatif' });
    const err = el('p', { class: 'vd-err', role: 'alert' });
    const send = el('button', { type: 'submit', class: 'vd-btn vd-fill', text: 'Confirmer' });
    const cancel = el('button', { type: 'button', class: 'vd-btn', text: 'Annuler' });
    const f = el('form', { class: 'vd-form', novalidate: '' }, [seg, countBox, msgLabel, msg, err, el('div', { class: 'vd-actions' }, [cancel, send])]);
    const panel = el('div', { class: 'vd-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vdTitle' }, [
      el('span', { class: 'vd-grip', 'aria-hidden': 'true' }),
      title,
      lead,
      f,
    ]);
    const back = el('div', { class: 'vd-back' }, [panel]);
    document.body.appendChild(back);

    const sync = () => {
      segYes.setAttribute('aria-checked', String(form.answer === 'oui'));
      segNo.setAttribute('aria-checked', String(form.answer === 'non'));
      countBox.hidden = form.answer !== 'oui';
      num.textContent = String(form.count);
      unit.textContent = form.count > 1 ? 'personnes' : 'personne';
      minus.disabled = form.count <= 1;
      plus.disabled = form.count >= form.max;
      hint.textContent = 'Votre invitation est prévue pour ' + persons(form.max) + '.';
      lead.textContent =
        form.answer === 'oui'
          ? (name ? name + ', nous' : 'Nous') + ' serons ravis de vous accueillir.'
          : (name ? name + ', vous' : 'Vous') + ' ne pourrez pas venir ? Merci de nous prévenir.';
    };
    segYes.addEventListener('click', () => { form.answer = 'oui'; sync(); });
    segNo.addEventListener('click', () => { form.answer = 'non'; sync(); });
    minus.addEventListener('click', () => { form.count = Math.max(1, form.count - 1); sync(); });
    plus.addEventListener('click', () => { form.count = Math.min(form.max, form.count + 1); sync(); });
    msg.addEventListener('input', () => { form.message = msg.value; });
    cancel.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') trapFocus(e, panel);
    });
    f.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    sheet = { back, panel, msg, err, send, sync, segYes, segNo };
  }

  function trapFocus(e, root) {
    const items = [...root.querySelectorAll('button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openSheet(answer) {
    if (!state.open) {
      toast('Les réponses sont closes depuis le ' + fmtDate(D.deadline) + '. Contactez directement les mariés.');
      return;
    }
    // Fermeture encore en cours (réouverture rapide au clavier) : elle ne doit pas masquer la fenêtre rouverte.
    clearTimeout(closeT);
    if (!sheet) build();
    const r = state.response;
    form.answer = answer;
    form.max = maxCount();
    form.count = Math.min(form.max, r && r.answer === 'oui' && r.count > 0 ? r.count : form.max);
    form.message = r ? r.message || '' : '';
    sheet.msg.value = form.message;
    sheet.err.textContent = '';
    sheet.sync();
    lastFocus = document.activeElement;
    document.documentElement.classList.add('vd-lock');
    sheet.back.classList.add('on');
    requestAnimationFrame(() => {
      sheet.back.classList.add('show');
      (answer === 'oui' ? sheet.segYes : sheet.segNo).focus({ preventScroll: true });
    });
  }

  function close() {
    if (!sheet || !sheet.back.classList.contains('on')) return;
    sheet.back.classList.remove('show');
    document.documentElement.classList.remove('vd-lock');
    clearTimeout(closeT);
    closeT = setTimeout(() => sheet.back.classList.remove('on'), 320);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  async function submit() {
    if (sending) return;
    sending = true;
    sheet.send.disabled = true;
    sheet.err.textContent = '';
    try {
      const res = await fetch('/api/rsvp/' + encodeURIComponent(D.code), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: form.answer, count: form.answer === 'oui' ? form.count : 0, message: form.message.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (body && 'open' in body) {
        state.open = body.open !== false;
        if ('response' in body) state.response = body.response;
        state.table = body.table || null;
        if ('max' in body) state.max = body.max;
      }
      if (!res.ok || !body.ok) {
        sheet.err.textContent = (body && body.message) || 'La réponse n’a pas pu être enregistrée. Réessayez.';
        render(true);
        return;
      }
      render(true);
      close();
      toast(form.answer === 'oui' ? 'Merci ! Votre venue est enregistrée.' : 'Merci de nous avoir prévenus.');
    } catch (e) {
      sheet.err.textContent = 'Connexion impossible. Vérifiez votre réseau et réessayez.';
    } finally {
      sending = false;
      sheet.send.disabled = false;
    }
  }

  // Interception en phase de capture : le script d'origine (toast « bientôt ») ne reçoit pas le clic.
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target instanceof Element ? e.target.closest('#rsvpYes, #rsvpNo') : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (state.response) openSheet(state.response.answer);
      else openSheet(a.id === 'rsvpYes' ? 'oui' : 'non');
    },
    true,
  );
})();
