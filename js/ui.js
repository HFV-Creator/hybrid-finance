/* Hybrid Finance — briques d'interface : sélecteurs, modales, notifications, téléchargement. */
(function (root) {
  'use strict';

  var doc = root.document;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  /* Échappe le texte venant de l'utilisateur avant de l'injecter en HTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Initiales du macaron rond : « Hybrid Coaching » → « HC ». */
  function initiales(nom) {
    var mots = String(nom || 'Hybrid Coaching').trim().split(/\s+/).filter(Boolean);
    return mots.slice(0, 3).map(function (m) { return m[0]; }).join('').toUpperCase() || 'HC';
  }

  var toastTimer = null;
  function toast(message, estErreur) {
    var r = $('#toast-root');
    r.innerHTML = '<div class="toast' + (estErreur ? ' err' : '') + '" data-testid="toast">' + esc(message) + '</div>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { r.innerHTML = ''; }, 3600);
  }

  /* Ouvre une modale. contenu = HTML interne. Renvoie { root, close }. */
  function modal(titre, sousTitre, contenuHtml, options) {
    options = options || {};
    var back = doc.createElement('div');
    back.className = 'modal-backdrop';
    back.setAttribute('data-testid', 'modal');
    back.innerHTML =
      '<form class="modal" novalidate>' +
      '<h3>' + esc(titre) + '</h3>' +
      (sousTitre ? '<div class="sub">' + esc(sousTitre) + '</div>' : '') +
      '<div class="form-err" data-err hidden></div>' +
      contenuHtml +
      '<div class="modal-actions">' +
      '<button type="button" class="btn-ghost" style="flex:1" data-annuler data-testid="modal-annuler">Annuler</button>' +
      '<button type="submit" class="btn' + (options.danger ? ' danger' : '') + '" data-testid="modal-submit">' +
      esc(options.valider || 'Enregistrer') + '</button>' +
      '</div></form>';

    function close() {
      back.remove();
      doc.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    $('[data-annuler]', back).addEventListener('click', close);
    doc.addEventListener('keydown', onKey);

    var form = $('form', back);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (options.onSubmit) options.onSubmit(form, close, function (msg) {
        var box = $('[data-err]', back);
        box.textContent = msg;
        box.hidden = false;
      });
    });

    $('#modal-root').appendChild(back);
    var premier = $('input,select,textarea', back);
    if (premier) premier.focus();
    return { root: back, close: close };
  }

  /* Petite confirmation « oui / non ». */
  function confirmer(titre, texte, onOui) {
    modal(titre, texte, '', {
      valider: 'Confirmer',
      onSubmit: function (form, close) { close(); onOui(); }
    });
  }

  /* Confirmation d'un geste qui efface vraiment quelque chose.
     Trois différences avec confirmer() : le texte peut contenir des chiffres en
     gras (c'est le but — on annonce les conséquences exactes), le bouton dit ce
     qu'il fait plutôt qu'« OK », et c'est ANNULER qui garde le focus, pour
     qu'une touche Entrée réflexe n'efface rien. */
  function confirmerDanger(titre, htmlTexte, labelValider, onOui) {
    var m = modal(titre, '', '<div class="danger-note" data-testid="danger-note">' + htmlTexte + '</div>', {
      valider: labelValider,
      danger: true,
      onSubmit: function (form, close) { close(); onOui(); }
    });
    /* Le focus est mis sur Annuler ET rendu VISIBLE. Un focus posé par le code
       après un clic de souris n'active pas « :focus-visible » dans Chrome : sans
       cette classe, le bouton serait sélectionné sans que ça se voie, et la
       protection ne protégerait que sur le papier. */
    var annuler = $('[data-annuler]', m.root);
    annuler.classList.add('focus-visible-force');
    annuler.focus();
    return m;
  }

  /* Télécharge un fichier CSV (BOM UTF-8 pour qu'Excel affiche les accents). */
  function telechargerCSV(nomFichier, contenu) {
    var blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = nomFichier;
    a.setAttribute('data-testid', 'csv-link');
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 0);
  }

  root.HF = root.HF || {};
  root.HF.ui = {
    $: $, $$: $$, esc: esc, initiales: initiales,
    toast: toast, modal: modal, confirmer: confirmer, confirmerDanger: confirmerDanger,
    telechargerCSV: telechargerCSV
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
