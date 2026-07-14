/* Hybrid Finance — données fictives du MODE DÉMO.
   Générées autour de la date du jour pour que le tableau de bord soit toujours vivant.
   Le générateur est « semé » (seed fixe) : les mêmes données à chaque rechargement. */
(function (root) {
  'use strict';

  var C = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./calc.js') : root.HF.calc;

  /* Générateur pseudo-aléatoire déterministe (mulberry32). */
  function rng(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      var r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  var EMAIL_A = 'steph@hybridcoaching.ca';
  var EMAIL_B = 'alex@hybridcoaching.ca';

  function build(todayIso) {
    var today = todayIso || C.todayISO();
    var mk = C.monthKey(today);
    var rand = rng(20260714);
    var db = {
      settings: {
        id: 1,
        business_name: 'Hybrid Coaching',
        partner_a_name: 'Steph',
        partner_b_name: 'Alex',
        partner_a_email: EMAIL_A,
        partner_b_email: EMAIL_B,
        split_a_pct: 50,
        daily_ad_budget: 120
      },
      clients: [], sales: [], payments: [],
      ad_spend: [], recurring_expenses: [], one_off_expenses: []
    };

    var nc = 0, ns = 0, np = 0, na = 0, nr = 0, no = 0;
    function jour(mkX, d) { return mkX + '-' + (d < 10 ? '0' + d : d); }

    /* --- 14 clients, répartis sur les trois types de vente --- */
    var CLIENTS = [
      // nom,                type,          montant, options
      ['Marc-André T.', 'abonnement', 1200, { moisAvant: 8, label: 'Coaching premium' }],
      ['Jessica L.', 'pif', 2400, { moisAvant: 0, label: 'PIF — 12 semaines', jour: 4 }],
      ['Kevin B.', 'abonnement', 950, { moisAvant: 5 }],
      ['Sarah-Maude D.', 'versements', 2400, { moisAvant: 2, n: 3, label: 'Versements 3×' }],
      ['Alexandre P.', 'abonnement', 950, { moisAvant: 6 }],
      ['Émilie R.', 'abonnement', 800, { moisAvant: 4, label: 'Abonnement relance' }],
      ['Vincent G.', 'abonnement', 1100, { moisAvant: 9 }],
      ['Camille F.', 'versements', 1800, { moisAvant: 1, n: 2, label: 'Versements 2×' }],
      ['Anthony L.', 'abonnement', 950, { moisAvant: 3 }],
      ['Maude S.', 'abonnement', 800, { moisAvant: 7, finApres: 1, label: 'Abonnement relance' }],
      ['Jonathan C.', 'pif', 1450, { moisAvant: 1, label: 'PIF — 8 semaines', jour: 12 }],
      ['Laurie B.', 'abonnement', 1000, { moisAvant: 0, jour: 6 }],
      ['Félix M.', 'abonnement', 900, { moisAvant: 10 }],
      ['Noémie D.', 'abonnement', 850, { moisAvant: 0, jour: 9 }]
    ];

    CLIENTS.forEach(function (row, i) {
      var nom = row[0], type = row[1], montant = row[2], o = row[3] || {};
      var cid = 'c' + (++nc);
      db.clients.push({
        id: cid, name: nom, notes: '', archived: false,
        created_by: i % 2 === 0 ? EMAIL_A : EMAIL_B,
        created_at: today
      });

      var startMk = C.addMonths(mk, -o.moisAvant);
      // jours 1 à 13 : les échéances du mois courant sont donc déjà arrivées
      // le 14, ce qui rend la démo lisible (majorité payée, un retard, une attente).
      var jourDebut = o.jour || (1 + Math.floor(rand() * 13));
      var start = jour(startMk, Math.min(jourDebut, C.daysInMonth(startMk)));

      var sale = {
        id: 's' + (++ns), client_id: cid, type: type,
        label: o.label || null,
        total_amount: type === 'abonnement' ? null : montant,
        monthly_amount: type === 'abonnement' ? montant : null,
        installments_count: type === 'versements' ? o.n : null,
        start_date: start,
        end_date: o.finApres != null ? C.lastDayOfMonth(C.addMonths(mk, o.finApres)) : null,
        archived: false,
        created_by: i % 2 === 0 ? EMAIL_A : EMAIL_B,
        created_at: today
      };
      db.sales.push(sale);

      C.generatePayments(sale, C.addMonths(mk, 3)).forEach(function (p) {
        p.id = 'p' + (++np);
        p.created_by = sale.created_by;
        p.created_at = today;
        db.payments.push(p);
      });
    });

    /* --- Statuts des paiements ---
       Tout ce qui est ancien est payé. Dans le mois courant, on laisse volontairement
       un paiement en retard et deux en attente, pour que le tableau de bord ait
       quelque chose à raconter (« paiements à récupérer »). */
    var retardLaisse = 0, attenteLaisse = 0;
    db.payments.forEach(function (p) {
      var age = C.dayDiff(p.due_date, today);   // > 0 = échéance passée
      if (age < 0) return;                      // futur : reste en attente
      if (C.monthKey(p.due_date) !== mk) {      // mois passés : tout est encaissé
        p.status = 'paid';
        p.paid_date = p.due_date;
        return;
      }
      if (age > C.LATE_AFTER_DAYS && retardLaisse < 1) { retardLaisse++; return; }  // laissé en retard
      if (age <= C.LATE_AFTER_DAYS && attenteLaisse < 1) { attenteLaisse++; return; } // laissé en attente
      p.status = 'paid';
      p.paid_date = p.due_date;
    });

    /* --- Ads journaliers : 12 mois d'historique, jusqu'à aujourd'hui --- */
    for (var m = 11; m >= 0; m--) {
      var amk = C.addMonths(mk, -m);
      var base = 92 + (11 - m) * 2.6;                 // le budget monte doucement dans le temps
      var dim = C.daysInMonth(amk);
      var dernier = (amk === mk) ? Number(today.slice(8, 10)) : dim;
      for (var d = 1; d <= dernier; d++) {
        var montant = Math.round(base + (rand() - 0.45) * 34);
        if (rand() < 0.05) montant = 0;               // quelques jours sans pub
        db.ad_spend.push({
          id: 'a' + (++na), day: jour(amk, d), amount: montant,
          created_by: EMAIL_B, created_at: today
        });
      }
    }

    /* --- Dépenses récurrentes --- */
    [
      ['Trainerize + logiciels', 310, 'logiciels', 14, null],
      ['GoHighLevel', 497, 'logiciels', 10, null],
      ['Montage vidéo (sous-traitance)', 650, 'sous-traitance', 8, null],
      ['Frais Stripe / transactions', 433, 'frais-bancaires', 14, null],
      ['Assistante virtuelle (arrêtée)', 400, 'sous-traitance', 12, 2]   // arrêtée il y a 2 mois
    ].forEach(function (r) {
      db.recurring_expenses.push({
        id: 'r' + (++nr), label: r[0], amount: r[1], category: r[2],
        start_date: C.addMonths(mk, -r[3]) + '-01',
        end_date: r[4] == null ? null : C.lastDayOfMonth(C.addMonths(mk, -r[4])),
        created_by: EMAIL_B, created_at: today
      });
    });

    /* --- Dépenses ponctuelles --- */
    [
      ['Shooting photo — nouvelle offre', 850, 'autre', 0, 8],
      ['Ordinateur portable (montage)', 1800, 'autre', 4, 17],
      ['Formation copywriting', 495, 'autre', 2, 21],
      ['Frais comptable annuel', 1200, 'autre', 5, 3]
    ].forEach(function (e) {
      var emk = C.addMonths(mk, -e[3]);
      db.one_off_expenses.push({
        id: 'o' + (++no), label: e[0], amount: e[1], category: e[2],
        date: jour(emk, Math.min(e[4], C.daysInMonth(emk))),
        created_by: EMAIL_A, created_at: today
      });
    });

    return db;
  }

  var api = { build: build, EMAIL_A: EMAIL_A, EMAIL_B: EMAIL_B };
  root.HF = root.HF || {};
  root.HF.demoData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
