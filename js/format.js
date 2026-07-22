/* Hybrid Finance — formatage (argent, dates, mois) en français du Québec.
   Chargé comme script classique : expose HF.format. Aussi utilisable par Node (tests). */
(function (root) {
  'use strict';

  var NBSP = ' '; // espace insécable : "12 850 $"

  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MOIS_COURTS = ['JANV', 'FÉV', 'MARS', 'AVR', 'MAI', 'JUIN',
    'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
  // abréviations françaises correctes : « nov. », jamais « nove. »
  var MOIS_ABREGES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  /* 12850 -> "12 850", 1234.5 -> "1 234,50" */
  function groupe(n, decimales) {
    var neg = n < 0;
    var abs = Math.abs(n);
    var s = abs.toFixed(decimales);
    var parts = s.split('.');
    var entier = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    var out = parts.length > 1 ? entier + ',' + parts[1] : entier;
    return (neg ? '−' + NBSP : '') + out;
  }

  /* Argent : 0 décimale si le montant est rond, 2 sinon. "12 850 $" / "1 234,50 $" */
  function money(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    var dec = Number.isInteger(v) ? 0 : 2;
    return groupe(v, dec) + NBSP + '$';
  }

  /* Argent compact pour les grands nombres de graphique : "12,9 k$" */
  function moneyCourt(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) >= 10000) return groupe(v / 1000, 1) + NBSP + 'k$';
    return money(v);
  }

  function nombre(n, decimales) {
    return groupe(Number(n) || 0, decimales == null ? 0 : decimales);
  }

  function pourcent(n) {
    return Math.round(Number(n) || 0) + NBSP + '%';
  }

  /* Comme pourcent(), mais garde une décimale si le pourcentage n'est pas rond
     (un partage 62,5 / 37,5 doit rester exact à l'écran). */
  function pourcentPrecis(n) {
    var v = Number(n) || 0;
    return groupe(v, Number.isInteger(v) ? 0 : 1) + NBSP + '%';
  }

  /* ROAS : 3.5 -> "3,5×" ; null -> "—" */
  function roas(n) {
    if (n == null || !isFinite(n)) return '—';
    return groupe(n, 1) + '×';
  }

  /* "2026-07" -> "Juillet 2026" */
  function moisLong(monthKey) {
    var p = String(monthKey).split('-');
    var m = MOIS[Number(p[1]) - 1];
    return m.charAt(0).toUpperCase() + m.slice(1) + ' ' + p[0];
  }

  /* "2026-07" -> "Juillet" */
  function moisSeul(monthKey) {
    var p = String(monthKey).split('-');
    var m = MOIS[Number(p[1]) - 1];
    return m.charAt(0).toUpperCase() + m.slice(1);
  }

  /* "2026-07" -> "JUIL" */
  function moisCourt(monthKey) {
    var p = String(monthKey).split('-');
    return MOIS_COURTS[Number(p[1]) - 1];
  }

  /* "2026-07-14" -> "14 juillet 2026" */
  function dateLongue(iso) {
    var p = String(iso).split('-');
    return Number(p[2]) + ' ' + MOIS[Number(p[1]) - 1] + ' ' + p[0];
  }

  /* "2026-07-14" -> "14 juil." */
  function dateCourte(iso) {
    var p = String(iso).split('-');
    return Number(p[2]) + ' ' + MOIS_ABREGES[Number(p[1]) - 1];
  }

  /* "2025-11-01" -> "nov. 2025" — pour les dépenses récurrentes, où l'année compte. */
  function moisAnnee(iso) {
    var p = String(iso).split('-');
    return MOIS_ABREGES[Number(p[1]) - 1] + ' ' + p[0];
  }

  /* « relancé il y a 3 jours » : 0 -> "aujourd'hui", 1 -> "hier", n -> "il y a n jours".
     Une valeur invalide ou négative retombe sur "aujourd'hui" plutôt que d'afficher
     une phrase cassée. */
  function ilYA(jours) {
    var n = Math.round(Number(jours) || 0);
    if (n <= 0) return 'aujourd\'hui';
    if (n === 1) return 'hier';
    return 'il y a ' + n + ' jours';
  }

  var api = {
    NBSP: NBSP,
    money: money,
    moneyCourt: moneyCourt,
    nombre: nombre,
    pourcent: pourcent,
    pourcentPrecis: pourcentPrecis,
    roas: roas,
    moisLong: moisLong,
    moisSeul: moisSeul,
    moisCourt: moisCourt,
    moisAnnee: moisAnnee,
    dateLongue: dateLongue,
    dateCourte: dateCourte,
    ilYA: ilYA
  };

  root.HF = root.HF || {};
  root.HF.format = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
