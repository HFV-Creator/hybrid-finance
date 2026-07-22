/* Hybrid Finance — cœur de calcul (100 % pur, aucune dépendance au navigateur).
   Toutes les dates sont des chaînes civiles "AAAA-MM-JJ" : aucun piège de fuseau horaire.
   Expose HF.calc (navigateur) et module.exports (tests Node). */
(function (root) {
  'use strict';

  var F = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./format.js')
    : root.HF.format;

  var LATE_AFTER_DAYS = 5;     // en retard = échéance dépassée de plus de 5 jours
  var TIMEZONE = 'America/Toronto';

  var CATEGORIES = {
    ads: 'Ads',
    logiciels: 'Logiciels',
    'sous-traitance': 'Sous-traitance',
    'frais-bancaires': 'Frais bancaires',
    autre: 'Autre'
  };

  var TYPES_VENTE = {
    pif: 'PIF (un versement)',
    versements: 'Plan à versements',
    abonnement: 'Abonnement récurrent'
  };

  /* ---------- dates civiles ---------- */

  function todayISO(tz) {
    var d = new Date();
    // en-CA donne "2026-07-14"
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  }

  function parts(iso) {
    var p = String(iso).split('-');
    return { y: Number(p[0]), m: Number(p[1]), d: Number(p[2] || 1) };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function monthKey(iso) { return String(iso).slice(0, 7); }

  function daysInMonth(mk) {
    var p = parts(mk);
    return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  }

  function addMonths(mk, n) {
    var p = parts(mk);
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    return y + '-' + pad2(m);
  }

  /* Ajoute n mois à une date, en ramenant au dernier jour du mois si besoin
     (31 janvier + 1 mois = 28 février). */
  function addMonthsToDate(iso, n) {
    var p = parts(iso);
    var mk = addMonths(p.y + '-' + pad2(p.m), n);
    var dim = daysInMonth(mk);
    return mk + '-' + pad2(Math.min(p.d, dim));
  }

  function compareDates(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /* Nombre de jours entre deux dates civiles (b - a). */
  function dayDiff(a, b) {
    var pa = parts(a), pb = parts(b);
    var ua = Date.UTC(pa.y, pa.m - 1, pa.d);
    var ub = Date.UTC(pb.y, pb.m - 1, pb.d);
    return Math.round((ub - ua) / 86400000);
  }

  function monthsBetween(mkA, mkB) {
    var a = parts(mkA), b = parts(mkB);
    return (b.y * 12 + b.m) - (a.y * 12 + a.m);
  }

  function lastDayOfMonth(mk) { return mk + '-' + pad2(daysInMonth(mk)); }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function sum(arr, f) {
    var t = 0;
    for (var i = 0; i < arr.length; i++) t += Number(f ? f(arr[i]) : arr[i]) || 0;
    return round2(t);
  }

  /* ---------- échéanciers ---------- */

  /* Construit la liste des paiements attendus pour une vente.
     horizonMonth : jusqu'où matérialiser les abonnements sans date de fin ("2027-01"). */
  function generatePayments(sale, horizonMonth) {
    var out = [];
    var i, due;

    if (sale.type === 'pif') {
      out.push({ due_date: sale.start_date, amount: round2(sale.total_amount) });

    } else if (sale.type === 'versements') {
      var n = Math.max(1, Number(sale.installments_count) || 1);
      var total = round2(sale.total_amount);
      var base = Math.floor((total / n) * 100) / 100;   // arrondi vers le bas
      var cumul = 0;
      for (i = 0; i < n; i++) {
        var amount = (i === n - 1) ? round2(total - cumul) : base;  // le dernier absorbe les cents restants
        cumul = round2(cumul + amount);
        out.push({ due_date: addMonthsToDate(sale.start_date, i), amount: amount });
      }

    } else if (sale.type === 'abonnement') {
      var horizon = horizonMonth || addMonths(monthKey(sale.start_date), 12);
      var limite = sale.end_date ? sale.end_date : lastDayOfMonth(horizon);
      i = 0;
      while (i < 600) { // garde-fou
        due = addMonthsToDate(sale.start_date, i);
        if (compareDates(due, limite) > 0) break;
        out.push({ due_date: due, amount: round2(sale.monthly_amount) });
        i++;
      }
    }

    for (i = 0; i < out.length; i++) {
      out[i].sale_id = sale.id;
      out[i].client_id = sale.client_id;
      out[i].status = 'pending';
      out[i].paid_date = null;
    }
    return out;
  }

  /* Statut affiché d'un paiement : sauté / payé / en retard / en attente.
     « Sauté » prime sur tout : c'est une information (le client a passé son
     mois), pas une dette — un paiement sauté n'est jamais « en retard ». */
  function paymentStatus(payment, todayIso) {
    if (payment.status === 'saute') return 'saute';
    if (payment.status === 'paid') return 'paid';
    if (dayDiff(payment.due_date, todayIso) > LATE_AFTER_DAYS) return 'late';
    return 'pending';
  }

  function statusLabel(s) {
    if (s === 'paid') return 'Payé';
    if (s === 'late') return 'En retard';
    if (s === 'saute') return 'Sauté';
    return 'En attente';
  }

  /* Montant total d'une vente (utile pour l'affichage). */
  function saleTotal(sale) {
    if (sale.type === 'abonnement') return round2(sale.monthly_amount);
    return round2(sale.total_amount);
  }

  /* Libellé du plan affiché dans le tableau des revenus. */
  function saleLabel(sale) {
    if (sale.label) return sale.label;
    if (sale.type === 'pif') return 'PIF — un versement';
    if (sale.type === 'versements') return 'Versements ' + (sale.installments_count || 0) + '×';
    return 'Abonnement mensuel';
  }

  /* ---------- sélections par mois ---------- */

  /* Une ligne portant deleted_at (dans la corbeille) n'existe plus pour AUCUN
     calcul. Le filtre vit ici, au plus près des chiffres, en plus de celui de
     la couche de données : un total qui compte une ligne supprimée est le genre
     de bug qu'on ne remarque qu'au bilan. */
  function vivants(rows) {
    return (rows || []).filter(function (r) { return !r.deleted_at; });
  }

  function paymentsOfMonth(db, mk) {
    return vivants(db.payments).filter(function (p) { return monthKey(p.due_date) === mk; });
  }

  function adSpendOfMonth(db, mk) {
    return vivants(db.ad_spend).filter(function (a) { return monthKey(a.day) === mk; });
  }

  function recurringOfMonth(db, mk) {
    return vivants(db.recurring_expenses).filter(function (r) {
      if (monthsBetween(monthKey(r.start_date), mk) < 0) return false;             // pas encore commencé
      if (r.end_date && monthsBetween(mk, monthKey(r.end_date)) < 0) return false; // déjà arrêté
      return true;
    });
  }

  function oneOffOfMonth(db, mk) {
    return vivants(db.one_off_expenses).filter(function (e) { return monthKey(e.date) === mk; });
  }

  /* ---------- répartition du profit ---------- */

  /* Le partenaire A (Steph, orange) reçoit pctA % ; B (Alex, bleu) le reste. */
  function splitProfit(profit, pctA) {
    var pa = Number(pctA);
    if (!isFinite(pa)) pa = 50;
    pa = Math.min(100, Math.max(0, pa));
    var a = round2(profit * pa / 100);
    var b = round2(profit - a);   // B absorbe l'arrondi : a + b === profit exactement
    return { a: a, b: b, pctA: pa, pctB: round2(100 - pa) };
  }

  /* ---------- synthèse d'un mois ---------- */

  function monthSummary(db, mk, todayIso) {
    var today = todayIso || todayISO();
    var s = db.settings || {};
    var pays = paymentsOfMonth(db, mk);

    // Un paiement « sauté » n'est plus attendu : il sort des revenus et du
    // « à récupérer », mais reste dans la liste du mois — l'historique ne ment pas.
    var attendus = pays.filter(function (p) { return paymentStatus(p, today) !== 'saute'; });

    var revenue = sum(attendus, function (p) { return p.amount; });
    var encaisse = sum(pays.filter(function (p) { return paymentStatus(p, today) === 'paid'; }), function (p) { return p.amount; });
    var enRetard = pays.filter(function (p) { return paymentStatus(p, today) === 'late'; });
    var enAttente = pays.filter(function (p) { return paymentStatus(p, today) === 'pending'; });
    var aRecuperer = round2(revenue - encaisse);

    var ads = sum(adSpendOfMonth(db, mk), function (a) { return a.amount; });
    var recur = sum(recurringOfMonth(db, mk), function (r) { return r.amount; });
    var ponct = sum(oneOffOfMonth(db, mk), function (e) { return e.amount; });
    var depenses = round2(ads + recur + ponct);
    var horsAds = round2(recur + ponct);

    var profit = round2(revenue - depenses);
    var split = splitProfit(profit, s.split_a_pct == null ? 50 : s.split_a_pct);
    var dim = daysInMonth(mk);
    var nouveaux = newClientsInMonth(db, mk).length;
    // dans le mois EN COURS, la moyenne se fait sur les jours déjà passés
    var joursEcoules = (mk === monthKey(today)) ? Number(today.slice(8, 10)) : dim;

    return {
      month: mk,
      revenue: revenue,
      encaisse: encaisse,
      aRecuperer: aRecuperer,
      nbARecuperer: enRetard.length + enAttente.length,
      nbEnRetard: enRetard.length,
      nbSautes: pays.length - attendus.length,
      paiements: pays,
      depenses: { ads: ads, recurrentes: recur, ponctuelles: ponct, horsAds: horsAds, total: depenses },
      profit: profit,
      marge: revenue > 0 ? round2(profit / revenue * 100) : 0,
      roas: ads > 0 ? round2(revenue / ads) : null,
      adsParJour: joursEcoules > 0 ? round2(ads / joursEcoules) : 0,
      joursEcoules: joursEcoules,
      split: split,
      joursDuMois: dim,
      clientsActifs: clientsActifsDuMois(db, mk).length,
      nouveauxClients: nouveaux,
      coutAcquisition: costPerAcquisition(ads, nouveaux),
      seuilAdsJournalier: breakEvenDailyAds(revenue, horsAds, dim)
    };
  }

  /* Clients ayant au moins un paiement attendu dans le mois.
     Choix assumé : un client dont le SEUL paiement du mois est « sauté » reste
     un client actif — sauter un mois n'en fait pas un ex-client. */
  function clientsActifsDuMois(db, mk) {
    var ids = {};
    paymentsOfMonth(db, mk).forEach(function (p) { ids[p.client_id] = true; });
    return vivants(db.clients).filter(function (c) { return ids[c.id]; });
  }

  /* Nouveaux clients = clients dont la première vente démarre dans le mois. */
  function newClientsInMonth(db, mk) {
    var premiere = {};
    vivants(db.sales).forEach(function (s) {
      if (!premiere[s.client_id] || compareDates(s.start_date, premiere[s.client_id]) < 0) {
        premiere[s.client_id] = s.start_date;
      }
    });
    return vivants(db.clients).filter(function (c) {
      return premiere[c.id] && monthKey(premiere[c.id]) === mk;
    });
  }

  /* Coût d'acquisition = ads du mois ÷ nouveaux clients du mois. */
  function costPerAcquisition(adSpend, nouveaux) {
    if (!nouveaux) return null;
    return round2(adSpend / nouveaux);
  }

  /* Budget ads journalier au-delà duquel le mois devient déficitaire. */
  function breakEvenDailyAds(revenue, depensesHorsAds, jours) {
    if (!jours) return 0;
    return round2(Math.max(0, (revenue - depensesHorsAds) / jours));
  }

  /* Simulateur : que se passe-t-il si on met X $/jour en ads ce mois-ci ? */
  function simulate(budgetJournalier, mk, revenue, depensesHorsAds, splitPctA) {
    var jours = daysInMonth(mk);
    var adsProjete = round2(budgetJournalier * jours);
    var depensesTotal = round2(adsProjete + depensesHorsAds);
    var profit = round2(revenue - depensesTotal);
    return {
      budgetJournalier: round2(budgetJournalier),
      adsProjete: adsProjete,
      depensesTotal: depensesTotal,
      profitProjete: profit,
      marge: revenue > 0 ? round2(profit / revenue * 100) : 0,
      roas: adsProjete > 0 ? round2(revenue / adsProjete) : null,
      split: splitProfit(profit, splitPctA)
    };
  }

  /* Cumul de l'année (janvier → mois affiché) de la part de chaque partenaire. */
  function ytdShares(db, mk, todayIso) {
    var annee = mk.slice(0, 4);
    var jusqua = Number(mk.slice(5, 7));
    var a = 0, b = 0, profit = 0, revenue = 0, depenses = 0;
    for (var m = 1; m <= jusqua; m++) {
      var s = monthSummary(db, annee + '-' + pad2(m), todayIso);
      a += s.split.a; b += s.split.b;
      profit += s.profit; revenue += s.revenue; depenses += s.depenses.total;
    }
    return { annee: annee, a: round2(a), b: round2(b), profit: round2(profit), revenue: round2(revenue), depenses: round2(depenses) };
  }

  /* Les n derniers mois jusqu'à mk inclus, pour le graphique. */
  function evolution(db, mk, n, todayIso) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var m = addMonths(mk, -i);
      var s = monthSummary(db, m, todayIso);
      out.push({ month: m, revenue: s.revenue, encaisse: s.encaisse, depenses: s.depenses.total, profit: s.profit });
    }
    return out;
  }

  /* ---------- à traiter ---------- */

  /* L'écran de décision mensuel : chaque paiement dont l'échéance est atteinte
     (aujourd'hui inclus) réclame un choix — encaissé ? sauté ? à relancer ?
     Seuls les paiements encore « pending » en base attendent quelque chose :
     ni les payés ni les sautés n'ont besoin d'une décision. */
  function aTraiter(db, todayIso) {
    var today = todayIso || todayISO();
    var items = vivants(db.payments)
      .filter(function (p) {
        return p.status !== 'paid' && p.status !== 'saute' && compareDates(p.due_date, today) <= 0;
      })
      .sort(function (a, b) { return compareDates(a.due_date, b.due_date); });

    var parMois = [];
    var groupe = null;
    items.forEach(function (p) {
      var mk = monthKey(p.due_date);
      if (!groupe || groupe.month !== mk) {
        groupe = { month: mk, items: [] };
        parMois.push(groupe);
      }
      groupe.items.push(p);
    });

    return { total: sum(items, function (p) { return p.amount; }), nb: items.length, parMois: parMois };
  }

  /* ---------- rétention ---------- */

  /* Les définitions ci-dessous SONT la spécification de la fidélité :
     - ancienneté d'un client au mois mk = monthsBetween(premier mois d'échéance,
       min(dernier mois d'échéance, mk)) + 1. Les paiements « sautés » comptent :
       un mois sauté reste un mois d'abonnement.
     - dureeVieMoyenne = ancienneté moyenne des clients arrivés au plus tard en mk
       (1 décimale, null si aucun).
     - perdus (pendant mk) = clients dont la dernière échéance date de mk − 2
       (on n'attend plus rien d'eux depuis deux mois) + clients dont une vente se
       termine (end_date) dans mk sans aucune échéance après mk (un abonnement
       actif qui prend fin). Chaque client compté une seule fois.
     - moisMoyenActifs = ancienneté moyenne des clients ayant une échéance dans mk
       (1 décimale, null si aucun). */
  function retention(db, mk, todayIso) {
    var infos = {};   // client_id -> { first, last, actif (échéance dans mk) }
    vivants(db.payments).forEach(function (p) {
      var m = monthKey(p.due_date);
      var i = infos[p.client_id] || (infos[p.client_id] = { first: m, last: m, actif: false });
      if (m < i.first) i.first = m;
      if (m > i.last) i.last = m;
      if (m === mk) i.actif = true;
    });

    var clients = vivants(db.clients).filter(function (c) { return infos[c.id]; });

    function anciennete(i) {
      var fin = i.last < mk ? i.last : mk;
      return monthsBetween(i.first, fin) + 1;
    }
    function moyenne(liste) {
      if (!liste.length) return null;
      var t = 0;
      liste.forEach(function (c) { t += anciennete(infos[c.id]); });
      return Math.round(t / liste.length * 10) / 10;
    }

    var dureeVieMoyenne = moyenne(clients.filter(function (c) { return infos[c.id].first <= mk; }));
    var moisMoyenActifs = moyenne(clients.filter(function (c) { return infos[c.id].actif; }));

    var finies = {};   // clients dont une vente se termine dans mk
    vivants(db.sales).forEach(function (v) {
      if (v.end_date && monthKey(v.end_date) === mk) finies[v.client_id] = true;
    });
    var mkMoins2 = addMonths(mk, -2);
    var perdus = clients.filter(function (c) {
      var i = infos[c.id];
      if (i.last === mkMoins2) return true;         // deux mois de silence
      return !!finies[c.id] && i.last <= mk;        // vente terminée, rien attendu après
    }).length;

    function enMois(v) { return F.nombre(v, Number.isInteger(v) ? 0 : 1) + ' mois'; }

    var tiles = [];
    if (dureeVieMoyenne != null) {
      tiles.push({
        num: enMois(dureeVieMoyenne),
        tone: 'blue',
        text: 'de durée de vie moyenne par client. Multipliée par le prix mensuel, <b>c\'est ce que vaut vraiment un nouveau client</b> — et le maximum raisonnable à payer pour l\'acquérir.'
      });
    }
    tiles.push(perdus > 0
      ? {
        num: perdus + ' client' + (perdus > 1 ? 's' : ''),
        tone: 'red',
        text: (perdus > 1 ? 'perdus' : 'perdu') + ' ce mois-ci (plus aucune échéance depuis deux mois, ou abonnement terminé). <b>Un message personnel vaut la peine</b> : un client parti sans nouvelles revient rarement tout seul.'
      }
      : {
        num: '0 client',
        tone: 'teal',
        text: 'perdu ce mois-ci. <b>Personne n\'est parti</b> — continue ce qui fidélise.'
      });
    if (moisMoyenActifs != null) {
      tiles.push({
        num: enMois(moisMoyenActifs),
        tone: 'teal',
        text: 'd\'ancienneté moyenne chez les clients actifs ce mois-ci. Si ce chiffre monte, <b>la clientèle se fidélise</b> ; s\'il chute, les nouveaux remplacent des habitués partis.'
      });
    }

    return { dureeVieMoyenne: dureeVieMoyenne, perdus: perdus, moisMoyenActifs: moisMoyenActifs, tiles: tiles };
  }

  /* ---------- objectif de revenus ---------- */

  /* L'objectif propre au mois (override) prime sur l'objectif par défaut ;
     null = pas d'objectif, la barre de progression disparaît. Une valeur
     invalide ou ≤ 0 est ignorée plutôt que d'afficher une barre absurde. */
  function goalForMonth(settings, mk) {
    var s = settings || {};
    var o = s.monthly_goal_overrides || {};
    var v = Number(o[mk]);
    if (isFinite(v) && v > 0) return v;
    var g = Number(s.monthly_goal);
    return (isFinite(g) && g > 0) ? g : null;
  }

  /* Progression vers l'objectif : on mesure l'ENCAISSÉ, pas l'attendu — un
     objectif se célèbre avec l'argent réellement reçu. joursRestants = jours
     APRÈS aujourd'hui (le 20 d'un mois de 31 jours → 11) ; 0 pour un mois
     passé, le mois entier pour un mois futur. */
  function goalProgress(db, mk, todayIso) {
    var today = todayIso || todayISO();
    var objectif = goalForMonth(db.settings || {}, mk);
    if (objectif == null) return null;
    var s = monthSummary(db, mk, today);
    var todayMk = monthKey(today);
    var joursRestants;
    if (mk === todayMk) joursRestants = daysInMonth(mk) - Number(today.slice(8, 10));
    else if (mk < todayMk) joursRestants = 0;
    else joursRestants = daysInMonth(mk);
    return {
      objectif: objectif,
      encaisse: s.encaisse,
      pct: round2(s.encaisse / objectif * 100),   // peut dépasser 100
      joursRestants: joursRestants
    };
  }

  /* ---------- fiche client ---------- */

  /* Tout ce que la fiche d'un client affiche, toutes années confondues. */
  function clientStats(db, clientId, todayIso) {
    var today = todayIso || todayISO();
    var ventes = vivants(db.sales).filter(function (v) { return v.client_id === clientId; });
    var pays = vivants(db.payments)
      .filter(function (p) { return p.client_id === clientId; })
      .sort(function (a, b) { return compareDates(a.due_date, b.due_date); });

    var depuis = null;
    ventes.forEach(function (v) {
      if (!depuis || compareDates(v.start_date, depuis) < 0) depuis = v.start_date;
    });

    var payes = pays.filter(function (p) { return p.status === 'paid'; });

    // « Il paie en retard » doit rester visible même une fois le paiement réglé :
    // on compte les retards en cours ET les paiements réglés plus de
    // LATE_AFTER_DAYS jours après leur échéance.
    var nbRetards = pays.filter(function (p) {
      if (paymentStatus(p, today) === 'late') return true;
      return p.status === 'paid' && p.paid_date && dayDiff(p.due_date, p.paid_date) > LATE_AFTER_DAYS;
    }).length;

    // Retard moyen sur les paiements réglés (payé d'avance = 0, jamais négatif).
    var avecDate = payes.filter(function (p) { return p.paid_date; });
    var retardMoyenJours = null;
    if (avecDate.length) {
      var total = 0;
      avecDate.forEach(function (p) { total += Math.max(0, dayDiff(p.due_date, p.paid_date)); });
      retardMoyenJours = Math.round(total / avecDate.length);
    }

    // Plan actuel = la vente la plus récente (par date de début) ni archivée ni supprimée.
    var derniere = null;
    ventes.forEach(function (v) {
      if (v.archived) return;
      if (!derniere || compareDates(v.start_date, derniere.start_date) > 0) derniere = v;
    });

    return {
      depuis: depuis,
      totalPaye: sum(payes, function (p) { return p.amount; }),
      nbSautes: pays.filter(function (p) { return p.status === 'saute'; }).length,
      nbRetards: nbRetards,
      retardMoyenJours: retardMoyenJours,
      planActuel: derniere ? saleLabel(derniere) : null,
      historique: pays   // tout l'historique, sautés inclus : la fiche raconte la vraie relation
    };
  }

  /* ---------- signaux business (règles simples, aucun appel IA) ---------- */

  function signals(db, mk, todayIso) {
    var today = todayIso || todayISO();
    var s = monthSummary(db, mk, today);
    var prec = monthSummary(db, addMonths(mk, -1), today);
    var out = [];

    // Mois complètement vide : on dit quoi faire plutôt que de laisser une page nue.
    if (s.revenue === 0 && s.depenses.total === 0) {
      return [
        {
          num: '0 $', tone: 'gold',
          text: 'Aucune donnée pour ce mois. Commence par <b>ajouter un client et sa vente</b> : le paiement attendu apparaîtra ici tout seul.'
        },
        {
          num: 'Ads', tone: 'orange',
          text: 'Note ta dépense publicitaire du jour dans l\'onglet <b>Dépenses</b>. C\'est ce qui fait vivre le ROAS et le simulateur.'
        },
        {
          num: 'Fixes', tone: 'blue',
          text: 'Ajoute tes <b>dépenses récurrentes</b> (logiciels, sous-traitance) une seule fois : elles seront comptées chaque mois automatiquement.'
        }
      ];
    }

    // 1. Paiements à récupérer
    if (s.aRecuperer > 0) {
      out.push({
        num: s.nbARecuperer + ' paiement' + (s.nbARecuperer > 1 ? 's' : ''),
        tone: s.nbEnRetard > 0 ? 'red' : 'gold',
        text: (s.nbEnRetard > 0
          ? 'dont <b>' + s.nbEnRetard + ' en retard</b>. Total à récupérer : <b>' + F.money(s.aRecuperer) + '</b>. Relance suggérée cette semaine.'
          : 'en attente = <b>' + F.money(s.aRecuperer) + ' à récupérer.</b> Rien n\'est encore en retard.')
      });
    } else if (s.revenue > 0) {
      out.push({
        num: '100 %',
        tone: 'teal',
        text: 'des paiements du mois sont <b>encaissés</b>. Aucun montant à relancer.'
      });
    }

    // 2. ROAS
    if (s.roas == null) {
      out.push({ num: '0 $', tone: 'gold', text: 'dépensé en ads ce mois-ci. <b>Aucun ROAS calculable.</b>' });
    } else if (s.roas >= 3) {
      out.push({
        num: F.roas(s.roas), tone: 'blue',
        text: 'de ROAS. Au-dessus de 3, <b>il reste de la place pour monter le budget ads.</b>'
      });
    } else if (s.roas >= 2) {
      out.push({
        num: F.roas(s.roas), tone: 'gold',
        text: 'de ROAS. Entre 2 et 3, <b>c\'est correct mais à surveiller</b> avant d\'augmenter les ads.'
      });
    } else {
      out.push({
        num: F.roas(s.roas), tone: 'red',
        text: 'de ROAS. Sous 2, <b>chaque dollar d\'ads rapporte trop peu</b> : revoir les pubs avant d\'ajouter du budget.'
      });
    }

    // 3. Tendance des revenus vs mois précédent
    if (prec.revenue > 0) {
      var variation = round2((s.revenue - prec.revenue) / prec.revenue * 100);
      out.push({
        num: (variation >= 0 ? '+' : '−') + F.pourcent(Math.abs(variation)),
        tone: variation >= 0 ? 'teal' : 'red',
        text: 'de revenus vs <b>' + F.moisSeul(prec.month).toLowerCase() + '</b> (' + F.money(prec.revenue) + ' → ' + F.money(s.revenue) + ').'
      });
    }

    // 4. Revenu moyen par client
    if (s.clientsActifs > 0) {
      out.push({
        num: F.money(round2(s.revenue / s.clientsActifs)),
        tone: 'teal',
        text: 'de revenu moyen par client, sur <b>' + s.clientsActifs + ' clients actifs</b> ce mois-ci.'
      });
    }

    // 5. Coût d'acquisition
    if (s.coutAcquisition != null) {
      out.push({
        num: F.money(s.coutAcquisition),
        tone: 'orange',
        text: 'pour acquérir un client ce mois-ci (<b>' + s.nouveauxClients + ' nouveau' + (s.nouveauxClients > 1 ? 'x' : '') + '</b> via ' + F.money(s.depenses.ads) + ' d\'ads).'
      });
    }

    return out.slice(0, 5);
  }

  /* ---------- export CSV (séparateur ; et virgule décimale : Excel français) ---------- */

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvMontant(n) {
    return String(round2(n)).replace('.', ',');
  }

  function csvLignes(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
  }

  function nomClient(db, id) {
    var c = vivants(db.clients).find(function (x) { return x.id === id; });
    return c ? c.name : '(client supprimé)';
  }

  /* Nom d'affichage associé à une adresse courriel (« Ajouté par Alex »).
     Les deux courriels des associés sont dans les réglages, saisis dans l'application. */
  function identite(db, email) {
    var s = (db && db.settings) || {};
    var e = String(email || '').trim().toLowerCase();
    if (!e) return '';
    if (s.partner_a_email && String(s.partner_a_email).toLowerCase() === e) return s.partner_a_name || 'Steph';
    if (s.partner_b_email && String(s.partner_b_email).toLowerCase() === e) return s.partner_b_name || 'Alex';
    return email;
  }

  function vente(db, id) {
    return vivants(db.sales).find(function (x) { return x.id === id; });
  }

  /* CSV d'un mois : revenus détaillés + dépenses détaillées + totaux. */
  function csvMonth(db, mk, todayIso) {
    var today = todayIso || todayISO();
    var s = monthSummary(db, mk, today);
    var rows = [];
    rows.push(['Hybrid Finance — Export ' + F.moisLong(mk)]);
    rows.push([]);
    rows.push(['REVENUS']);
    rows.push(['Date', 'Client', 'Plan', 'Montant', 'Statut', 'Payée le', 'Ajouté par']);
    // Les paiements sautés sont listés (l'export raconte le mois complet) mais
    // les totaux viennent de monthSummary, qui les exclut déjà des revenus.
    s.paiements.slice().sort(function (a, b) { return compareDates(a.due_date, b.due_date); })
      .forEach(function (p) {
        var v = vente(db, p.sale_id);
        rows.push([p.due_date, nomClient(db, p.client_id), v ? saleLabel(v) : '',
          csvMontant(p.amount), statusLabel(paymentStatus(p, today)), p.paid_date || '',
          identite(db, p.created_by)]);
      });
    rows.push(['', '', 'Total revenus', csvMontant(s.revenue)]);
    rows.push(['', '', 'Encaissé', csvMontant(s.encaisse)]);
    rows.push(['', '', 'À récupérer', csvMontant(s.aRecuperer)]);
    rows.push([]);
    rows.push(['DÉPENSES']);
    rows.push(['Date', 'Libellé', 'Catégorie', 'Montant', 'Type', 'Ajouté par']);
    adSpendOfMonth(db, mk).slice().sort(function (a, b) { return compareDates(a.day, b.day); })
      .forEach(function (a) {
        rows.push([a.day, 'Ads du ' + F.dateCourte(a.day), 'ads', csvMontant(a.amount), 'Ads journaliers', identite(db, a.created_by)]);
      });
    recurringOfMonth(db, mk).forEach(function (r) {
      rows.push([mk + '-01', r.label, r.category, csvMontant(r.amount), 'Récurrente', identite(db, r.created_by)]);
    });
    oneOffOfMonth(db, mk).slice().sort(function (a, b) { return compareDates(a.date, b.date); })
      .forEach(function (e) {
        rows.push([e.date, e.label, e.category, csvMontant(e.amount), 'Ponctuelle', identite(db, e.created_by)]);
      });
    rows.push(['', '', 'Total dépenses', csvMontant(s.depenses.total)]);
    rows.push([]);
    rows.push(['RÉSUMÉ']);
    var st = db.settings || {};
    rows.push(['Profit net', csvMontant(s.profit)]);
    rows.push(['Marge (%)', csvMontant(s.marge)]);
    rows.push(['ROAS', s.roas == null ? '' : csvMontant(s.roas)]);
    rows.push(['Part ' + (st.partner_a_name || 'Steph') + ' (' + s.split.pctA + ' %)', csvMontant(s.split.a)]);
    rows.push(['Part ' + (st.partner_b_name || 'Alex') + ' (' + s.split.pctB + ' %)', csvMontant(s.split.b)]);
    return csvLignes(rows);
  }

  /* CSV d'une année : une ligne par mois + total. */
  function csvYear(db, annee, todayIso) {
    var today = todayIso || todayISO();
    var st = db.settings || {};
    var rows = [];
    rows.push(['Hybrid Finance — Export année ' + annee]);
    rows.push([]);
    rows.push(['Mois', 'Revenus', 'Encaissé', 'À récupérer', 'Ads', 'Dépenses récurrentes',
      'Dépenses ponctuelles', 'Dépenses totales', 'Profit net',
      'Part ' + (st.partner_a_name || 'Steph'), 'Part ' + (st.partner_b_name || 'Alex'), 'ROAS']);
    var tot = { r: 0, e: 0, ar: 0, ads: 0, rec: 0, po: 0, dep: 0, p: 0, a: 0, b: 0 };
    for (var m = 1; m <= 12; m++) {
      var mk = annee + '-' + pad2(m);
      var s = monthSummary(db, mk, today);
      rows.push([F.moisSeul(mk), csvMontant(s.revenue), csvMontant(s.encaisse), csvMontant(s.aRecuperer),
        csvMontant(s.depenses.ads), csvMontant(s.depenses.recurrentes), csvMontant(s.depenses.ponctuelles),
        csvMontant(s.depenses.total), csvMontant(s.profit), csvMontant(s.split.a), csvMontant(s.split.b),
        s.roas == null ? '' : csvMontant(s.roas)]);
      tot.r += s.revenue; tot.e += s.encaisse; tot.ar += s.aRecuperer; tot.ads += s.depenses.ads;
      tot.rec += s.depenses.recurrentes; tot.po += s.depenses.ponctuelles; tot.dep += s.depenses.total;
      tot.p += s.profit; tot.a += s.split.a; tot.b += s.split.b;
    }
    rows.push(['TOTAL', csvMontant(tot.r), csvMontant(tot.e), csvMontant(tot.ar), csvMontant(tot.ads),
      csvMontant(tot.rec), csvMontant(tot.po), csvMontant(tot.dep), csvMontant(tot.p),
      csvMontant(tot.a), csvMontant(tot.b), tot.ads > 0 ? csvMontant(round2(tot.r / tot.ads)) : '']);
    return csvLignes(rows);
  }

  var api = {
    LATE_AFTER_DAYS: LATE_AFTER_DAYS,
    TIMEZONE: TIMEZONE,
    CATEGORIES: CATEGORIES,
    TYPES_VENTE: TYPES_VENTE,
    todayISO: todayISO,
    monthKey: monthKey,
    daysInMonth: daysInMonth,
    addMonths: addMonths,
    addMonthsToDate: addMonthsToDate,
    lastDayOfMonth: lastDayOfMonth,
    dayDiff: dayDiff,
    monthsBetween: monthsBetween,
    compareDates: compareDates,
    round2: round2,
    sum: sum,
    generatePayments: generatePayments,
    paymentStatus: paymentStatus,
    statusLabel: statusLabel,
    saleTotal: saleTotal,
    identite: identite,
    saleLabel: saleLabel,
    paymentsOfMonth: paymentsOfMonth,
    adSpendOfMonth: adSpendOfMonth,
    recurringOfMonth: recurringOfMonth,
    oneOffOfMonth: oneOffOfMonth,
    splitProfit: splitProfit,
    monthSummary: monthSummary,
    clientsActifsDuMois: clientsActifsDuMois,
    newClientsInMonth: newClientsInMonth,
    costPerAcquisition: costPerAcquisition,
    breakEvenDailyAds: breakEvenDailyAds,
    simulate: simulate,
    ytdShares: ytdShares,
    evolution: evolution,
    aTraiter: aTraiter,
    retention: retention,
    goalForMonth: goalForMonth,
    goalProgress: goalProgress,
    clientStats: clientStats,
    signals: signals,
    csvMonth: csvMonth,
    csvYear: csvYear
  };

  root.HF = root.HF || {};
  root.HF.calc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
