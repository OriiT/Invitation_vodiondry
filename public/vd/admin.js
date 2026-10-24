// Petits comportements communs de l'administration (aucun script en ligne : CSP « script-src 'self' »).
//   [data-copy="texte"]        → copie le texte dans le presse-papiers
//   [data-confirm="question"]  → demande confirmation avant d'envoyer le formulaire / suivre le lien
//   select[data-autosubmit]    → envoie le formulaire dès que la valeur change
//   [data-print]               → lance l'impression
(() => {
  'use strict';

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Repli pour les navigateurs sans API presse-papiers.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  document.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const copyBtn = target.closest('[data-copy]');
    if (copyBtn) {
      e.preventDefault();
      const ok = await copy(copyBtn.getAttribute('data-copy') || '');
      const label = copyBtn.dataset.label || copyBtn.textContent;
      copyBtn.dataset.label = label;
      copyBtn.textContent = ok ? 'Copié ✓' : 'Échec de la copie';
      copyBtn.classList.toggle('copied', ok);
      setTimeout(() => { copyBtn.textContent = label; copyBtn.classList.remove('copied'); }, 1800);
      return;
    }

    const confirmEl = target.closest('a[data-confirm], button[data-confirm]');
    if (confirmEl && !window.confirm(confirmEl.getAttribute('data-confirm'))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (target.closest('[data-print]')) {
      e.preventDefault();
      window.print();
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
      e.preventDefault();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && el.hasAttribute('data-autosubmit') && el.form) el.form.submit();
  });
})();

// Fiche invité :
//   input[data-select-all]      → sélectionne tout le texte au focus (lien personnel)
//   form[data-response-form]    → le champ « nombre de personnes » n'est actif que pour une réponse « oui »
(() => {
  'use strict';

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.hasAttribute('data-select-all')) el.select();
  });

  function syncResponseForm(form) {
    const wrap = form.querySelector('[data-count-field]');
    const count = wrap && wrap.querySelector('input');
    if (!count) return;
    const checked = form.querySelector('input[name="answer"]:checked');
    const no = !!checked && checked.value === 'non';
    count.disabled = no;
    count.required = !!checked && checked.value === 'oui';
    wrap.classList.toggle('is-disabled', no);
  }

  document.querySelectorAll('form[data-response-form]').forEach(syncResponseForm);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.name !== 'answer') return;
    const form = el.closest('form[data-response-form]');
    if (form) syncResponseForm(form);
  });
})();
