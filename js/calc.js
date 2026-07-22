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

  /* LA RÈGLE D'ARCHIVAGE, et elle seule : un paiement NON PAYÉ dont la vente OU
     le client est archivé n'existe pour AUCUNE vue et AUCUN total. Archiver une
     vente, c'est dire « celle-là n'aura pas lieu » ; laisser ses échéances dans
     les revenus attendus fait apparaître le client deux fois et gonfle le mois.
     Un paiement DÉJÀ PAYÉ reste toujours compté, archivé ou non : cet argent a
     réellement circulé, l'effacer réécrirait l'histoire.
     Filtre de CALCUL, jamais de suppression de lignes : une base déjà polluée se
     remet d'aplomb toute seule, sans qu'on touche à un seul enregistrement.
     Tous les sélecteurs de paiements passent par ici — deux écrans qui filtrent
     chacun de leur côté finissent toujours par ne plus dire la même chose. */
  function paiementsActifs(db) {
    var ventesArchivees = {};
    var clientsArchives = {};
    ((db && db.sales) || []).forEach(function (v) { if (v.archived) ventesArchivees[v.id] = true; });
    ((db && db.clients) || []).forEach(function (c) { if (c.archived) clientsArchives[c.id] = true; });
    return vivants(db && db.payments).filter(function (p) {
      if (p.status === 'paid') return true;
      return !ventesArchivees[p.sale_id] && !clientsArchives[p.client_id];
    });
  }

  function paymentsOfMonth(db, mk) {
    return paiementsActifs(db).filter(function (p) { return monthKey(p.due_date) === mk; });
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

  /* Le pourcentage d'un mois est FIGÉ dans settings.split_history au moment où
     les associés changent leur entente : un mois déjà vécu doit garder les
     chiffres sur lesquels ils s'étaient entendus, sinon changer le partage
     réécrirait rétroactivement tout l'historique des parts.
     Sans valeur figée pour ce mois : le pourcentage courant. Sans réglage du
     tout : 50/50. Une valeur absente, vide ou hors bornes n'est pas une entente,
     c'est du bruit — on retombe sur le pourcentage courant. */
  function splitPctForMonth(db, mk) {
    var s = (db && db.settings) || {};
    var h = s.split_history || {};
    if (h[mk] != null && h[mk] !== '') {
      var fige = Number(h[mk]);
      if (isFinite(fige) && fige >= 0 && fige <= 100) return fige;
    }
    if (s.split_a_pct != null && s.split_a_pct !== '') {
      var courant = Number(s.split_a_pct);
      if (isFinite(courant)) return courant;
    }
    return 50;
  }

  /* ---------- synthèse d'un mois ---------- */

  function monthSummary(db, mk, todayIso) {
    var today = todayIso || todayISO();
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
    var split = splitProfit(profit, splitPctForMonth(db, mk));
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
    var items = paiementsActifs(db)
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
    paiementsActifs(db).forEach(function (p) {
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
    var pays = paiementsActifs(db)
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

  /* ---------- versements aux associés ---------- */

  /* Un versement n'est PAS une dépense : c'est du profit DÉJÀ gagné qui change
     de poche. Il ne touche donc ni les revenus, ni les dépenses, ni le profit,
     ni la marge, ni le ROAS, ni la part calculée de qui que ce soit —
     monthSummary() ne lit jamais db.payouts, et c'est volontaire. Le compter en
     dépense amputerait le profit une deuxième fois, et l'erreur se propagerait
     à chaque mois suivant. Un versement ne bouge qu'une seule chose : le SOLDE
     dû à l'associé. */
  function payoutsOfPeriod(db, debut, fin) {
    return vivants(db && db.payouts)
      .filter(function (v) {
        return compareDates(v.date, debut) >= 0 && compareDates(v.date, fin) <= 0;
      })
      .sort(function (a, b) { return compareDates(b.date, a.date); });   // du plus récent au plus ancien
  }

  /* Nom d'affichage d'un associé ('a' / 'b'), tel que saisi dans les réglages. */
  function nomAssocie(db, partenaire) {
    var s = (db && db.settings) || {};
    return (partenaire === 'b') ? (s.partner_b_name || 'Alex') : (s.partner_a_name || 'Steph');
  }

  /* ---------- périodes ---------- */

  /* « Depuis le début » part du mois du PLUS ANCIEN enregistrement, quelle que
     soit la table : la première trace de l'entreprise peut très bien être une
     dépense publicitaire faite des mois avant la première vente. Aucun mois de
     démarrage n'est codé en dur — une base reprise en cours de route ou
     restaurée doit s'afficher en entier, pas à partir d'une date inventée.
     Base vide : le mois courant, pour ne jamais rendre une période inversée. */
  function periodeDepuisLeDebut(db, todayIso) {
    var today = todayIso || todayISO();
    var min = null;
    function voir(iso) {
      if (!iso) return;
      var s = String(iso);
      if (min === null || compareDates(s, min) < 0) min = s;
    }
    paiementsActifs(db).forEach(function (p) { voir(p.due_date); });
    vivants(db && db.sales).forEach(function (v) { voir(v.start_date); });
    vivants(db && db.ad_spend).forEach(function (a) { voir(a.day); });
    vivants(db && db.one_off_expenses).forEach(function (e) { voir(e.date); });
    vivants(db && db.recurring_expenses).forEach(function (r) { voir(r.start_date); });
    vivants(db && db.payouts).forEach(function (v) { voir(v.date); });
    return {
      debut: (min === null ? monthKey(today) : monthKey(min)) + '-01',
      fin: lastDayOfMonth(monthKey(today))
    };
  }

  function periodeAnnee(annee) {
    var a = String(annee);
    return { debut: a + '-01-01', fin: a + '-12-31' };
  }

  /* Liste inclusive des mois d'une période. Une fin antérieure au début rend une
     liste vide plutôt qu'une boucle infinie. */
  function moisDeLaPeriode(debut, fin) {
    var out = [];
    var m = monthKey(debut);
    var dernier = monthKey(fin);
    var garde = 0;
    while (compareDates(m, dernier) <= 0 && garde++ < 1200) {
      out.push(m);
      m = addMonths(m, 1);
    }
    return out;
  }

  /* ---------- bilan d'une période ---------- */

  /* Les définitions ci-dessous SONT la spécification du bilan :
     - revenus, encaisse, depenses et profit sont la SOMME des monthSummary()
       des mois de la période, jamais un calcul parallèle. Deux écrans qui
       montrent le même argent doivent afficher le même chiffre au cent près ;
       recalculer autrement, c'est se garantir deux vérités.
     - depenses.parCategorie ventile le MÊME total par catégorie de dépense :
       les ads journaliers comptent en « ads », les dépenses récurrentes et
       ponctuelles dans LEUR catégorie (une récurrente catégorisée « ads » va
       donc bien en « ads »). Les cinq clés existent toujours, à 0 s'il n'y a
       rien, pour que la liste affichée ne change pas de forme d'un mois à
       l'autre. Une catégorie inconnue tombe dans « autre » : la somme des
       catégories doit rester EXACTEMENT le total, sans quoi le bilan ment.
     - profitEncaisse d'un mois = encaissé du mois − dépenses du mois. C'est le
       seul argent qui existe vraiment, donc le seul qu'on puisse se verser.
     - part d'un associé = splitProfit(profitEncaisse du mois, pourcentage FIGÉ
       de ce mois-là). Un mois déficitaire retranche (contribution négative) :
       ramener une perte à zéro la ferait disparaître du solde.
     - verse = somme de SES versements de la période ; solde = gagné − versé.
       Un solde négatif n'est pas une erreur : l'associé a reçu une avance.

     LE BILAN RAISONNE EN MOIS ENTIERS, parce qu'une part de profit n'existe que
     par mois : il n'y a pas de « part du 1er au 15 ». Une date choisie au milieu
     d'un mois tire donc TOUT ce mois-là — son profit ET ses versements.
     La fenêtre est calculée une seule fois, à partir des mois réellement
     additionnés, et sert aussi bien au profit qu'aux versements. Filtrer les
     versements sur les dates DEMANDÉES pendant qu'on additionne des mois entiers
     donnerait un solde faux sans jamais lever d'erreur : le profit d'un mois
     complet crédité à l'associé, mais le versement déjà fait ce mois-là oublié —
     l'entreprise paraîtrait devoir plus qu'elle ne doit.
     Les bornes effectives sont RENVOYÉES (elles écrasent celles demandées) pour
     que l'écran affiche la période réellement calculée. */
  function bilan(db, debut, fin, todayIso) {
    var today = todayIso || todayISO();
    var mois = moisDeLaPeriode(monthKey(debut), monthKey(fin));
    var debutEffectif = mois.length ? mois[0] + '-01' : debut;
    var finEffective = mois.length ? lastDayOfMonth(mois[mois.length - 1]) : fin;
    var versements = payoutsOfPeriod(db, debutEffectif, finEffective);

    var revenus = 0, encaisse = 0, ads = 0, recurrentes = 0, ponctuelles = 0;
    var profit = 0, profitEncaisse = 0, gagneA = 0, gagneB = 0;

    var parCategorie = {};
    Object.keys(CATEGORIES).forEach(function (k) { parCategorie[k] = 0; });
    function ajouterCategorie(cat, montant) {
      var k = (cat && parCategorie[cat] !== undefined) ? cat : 'autre';
      parCategorie[k] = round2(parCategorie[k] + (Number(montant) || 0));
    }

    var parMois = mois.map(function (m) {
      var s = monthSummary(db, m, today);
      var pe = round2(s.encaisse - s.depenses.total);
      var part = splitProfit(pe, splitPctForMonth(db, m));

      adSpendOfMonth(db, m).forEach(function (a) { ajouterCategorie('ads', a.amount); });
      recurringOfMonth(db, m).forEach(function (r) { ajouterCategorie(r.category, r.amount); });
      oneOffOfMonth(db, m).forEach(function (e) { ajouterCategorie(e.category, e.amount); });

      var vA = sum(versements.filter(function (v) { return v.partner === 'a' && monthKey(v.date) === m; }),
        function (v) { return v.amount; });
      var vB = sum(versements.filter(function (v) { return v.partner === 'b' && monthKey(v.date) === m; }),
        function (v) { return v.amount; });

      revenus = round2(revenus + s.revenue);
      encaisse = round2(encaisse + s.encaisse);
      ads = round2(ads + s.depenses.ads);
      recurrentes = round2(recurrentes + s.depenses.recurrentes);
      ponctuelles = round2(ponctuelles + s.depenses.ponctuelles);
      profit = round2(profit + s.profit);
      profitEncaisse = round2(profitEncaisse + pe);
      gagneA = round2(gagneA + part.a);
      gagneB = round2(gagneB + part.b);

      return {
        month: m,
        revenue: s.revenue,
        encaisse: s.encaisse,
        depenses: s.depenses.total,
        profit: s.profit,
        profitEncaisse: pe,
        pctA: part.pctA,
        partA: part.a,
        partB: part.b,
        verseA: vA,
        verseB: vB
      };
    });

    var verseA = sum(versements.filter(function (v) { return v.partner === 'a'; }), function (v) { return v.amount; });
    var verseB = sum(versements.filter(function (v) { return v.partner === 'b'; }), function (v) { return v.amount; });

    return {
      debut: debutEffectif,
      fin: finEffective,
      mois: mois,
      revenus: revenus,
      encaisse: encaisse,
      depenses: {
        ads: ads,
        recurrentes: recurrentes,
        ponctuelles: ponctuelles,
        horsAds: round2(recurrentes + ponctuelles),
        total: round2(ads + recurrentes + ponctuelles),
        parCategorie: parCategorie
      },
      profit: profit,
      profitEncaisse: profitEncaisse,
      partenaires: {
        a: { gagne: gagneA, verse: verseA, solde: round2(gagneA - verseA) },
        b: { gagne: gagneB, verse: verseB, solde: round2(gagneB - verseB) }
      },
      parMois: parMois,
      versements: versements
    };
  }

  /* « Profit d'avril », jamais « Profit de avril » : le français élide « de »
     devant une voyelle ou un h muet. Les deux associés lisent ce relevé chaque
     mois — une faute d'accord à cet endroit-là se voit tout de suite.
     Aucun mois ne commence par un h, mais la règle est écrite en entier pour
     qu'un libellé ajouté plus tard ne la contourne pas par accident. */
  function elision(mot) {
    var c = String(mot).charAt(0).toLowerCase();
    return 'aàâäeéèêëiîïoôöuùûüyh'.indexOf(c) >= 0 ? 'd\'' : 'de ';
  }

  /* Le relevé d'un associé raconte le bilan ligne par ligne : une ligne de
     profit par mois (datée au DERNIER jour du mois — un mois se solde une fois
     fini), une ligne par versement à sa vraie date. À date égale le profit passe
     AVANT le versement : on ne peut pas se verser un mois avant de l'avoir
     gagné, et l'ordre inverse afficherait un solde négatif fantôme.
     Le solde de la dernière ligne est, par construction, le « solde dû » du
     bilan : c'est ce qui rend le relevé vérifiable à l'œil.
     Les versements sont pris dans `bilan().versements`, jamais re-filtrés ici :
     un second filtrage pourrait retenir une liste différente de celle qui a servi
     au solde, et le relevé cesserait de tomber juste sur une plage personnalisée. */
  function ledger(db, partenaire, debut, fin, todayIso) {
    var qui = (partenaire === 'b') ? 'b' : 'a';
    var cle = (qui === 'b') ? 'partB' : 'partA';
    var b = bilan(db, debut, fin, todayIso);
    var lignes = [];

    b.parMois.forEach(function (m) {
      var nom = F.moisSeul(m.month).toLowerCase();
      lignes.push({
        date: lastDayOfMonth(m.month),
        type: 'profit',
        libelle: 'Profit ' + elision(nom) + nom,
        montant: m[cle]
      });
    });
    b.versements.forEach(function (v) {
      if (v.partner !== qui) return;
      lignes.push({
        date: v.date,
        type: 'versement',
        libelle: v.note || 'Versement',
        montant: round2(0 - Number(v.amount))
      });
    });

    lignes.sort(function (x, y) {
      var c = compareDates(x.date, y.date);
      if (c !== 0) return c;
      if (x.type === y.type) return 0;
      return x.type === 'profit' ? -1 : 1;
    });

    var solde = 0;
    lignes.forEach(function (l) {
      solde = round2(solde + l.montant);
      l.solde = solde;
    });
    return lignes;
  }

  /* ---------- garde-fou contre les doublons de clients ---------- */

  /* Deux fiches pour la même personne, c'est un revenu compté deux fois et un
     historique coupé en deux. La comparaison ignore donc tout ce qui varie sans
     changer l'identité : casse, accents, espaces en trop. */
  function normaliserNom(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')   // diacritiques détachés par NFD, écrits en échappement : invisibles dans le source
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  function clientsSimilaires(db, nom) {
    var cible = normaliserNom(nom);
    if (!cible) return [];
    return vivants(db && db.clients).filter(function (c) { return normaliserNom(c.name) === cible; });
  }

  /* ---------- ce qu'une suppression emporterait ---------- */

  /* La phrase de confirmation doit annoncer des chiffres VRAIS : « 2 ventes,
     7 paiements, 3 400 $ encaissés, de mai à juillet ». On compte donc les
     lignes vivantes qui partiraient réellement — y compris celles qu'un
     archivage rend invisibles à l'écran, parce que la suppression, elle, les
     emporte quand même. */
  function impactSuppression(db, table, id) {
    var ventes = [];
    if (table === 'clients') {
      ventes = vivants(db && db.sales).filter(function (v) { return v.client_id === id; });
    } else if (table === 'sales') {
      var v = vivants(db && db.sales).find(function (x) { return x.id === id; });
      if (v) ventes = [v];
    }
    var idsVentes = {};
    ventes.forEach(function (x) { idsVentes[x.id] = true; });

    var pays = vivants(db && db.payments).filter(function (p) {
      if (table === 'clients') return p.client_id === id || !!idsVentes[p.sale_id];
      return !!idsVentes[p.sale_id];
    });

    var mois = [];
    pays.forEach(function (p) {
      var m = monthKey(p.due_date);
      if (mois.indexOf(m) < 0) mois.push(m);
    });
    mois.sort();

    return {
      nbVentes: ventes.length,
      nbPaiements: pays.length,
      montantEncaisse: sum(pays.filter(function (p) { return p.status === 'paid'; }), function (p) { return p.amount; }),
      mois: mois
    };
  }

  /* ---------- aperçu du formulaire de vente ---------- */

  /* La phrase affichée sous le formulaire est construite À PARTIR de
     generatePayments() : un aperçu qui recalculerait les montants de son côté
     pourrait annoncer autre chose que ce qui sera créé, et c'est exactement le
     mensonge qu'on ne peut pas se permettre juste avant de signer.
     Chaîne vide tant que les champs ne permettent pas de conclure — mieux vaut
     rien afficher qu'une phrase à trous. */
  function apercuVente(sale) {
    var v = sale || {};
    var debut = String(v.start_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) return '';

    if (v.type === 'pif') {
      var total = Number(v.total_amount);
      if (!isFinite(total) || total <= 0) return '';
      var pif = generatePayments({ type: 'pif', start_date: debut, total_amount: total });
      return '1 paiement de ' + F.moneyExact(pif[0].amount) + ' le ' + F.dateJourMois(pif[0].due_date);
    }

    if (v.type === 'versements') {
      var t = Number(v.total_amount);
      var n = Number(v.installments_count);
      if (!isFinite(t) || t <= 0) return '';
      if (!isFinite(n) || n < 1 || Math.floor(n) !== n) return '';
      var pays = generatePayments({ type: 'versements', start_date: debut, total_amount: t, installments_count: n });
      var base = pays[0].amount;
      var dernier = pays[pays.length - 1].amount;
      var texte = pays.length + ' versement' + (pays.length > 1 ? 's' : '') + ' de ' + F.moneyExact(base);
      if (dernier !== base) texte += ' (le dernier de ' + F.moneyExact(dernier) + ')';
      return texte + ' — total ' + F.moneyExact(sum(pays, function (p) { return p.amount; }));
    }

    if (v.type === 'abonnement') {
      var mensuel = Number(v.monthly_amount);
      if (!isFinite(mensuel) || mensuel <= 0) return '';
      var abo = generatePayments({ type: 'abonnement', start_date: debut, monthly_amount: mensuel });
      return F.moneyExact(abo[0].amount) + ' le ' + Number(debut.slice(8, 10)) +
        ' de chaque mois à partir du ' + F.dateJourMois(debut);
    }

    return '';
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

  /* Sections « associés » communes aux deux exports : les versements réels, le
     solde dû de chacun, puis son relevé complet. Elles s'ajoutent APRÈS le
     contenu existant et ne modifient aucune ligne ni aucun total déjà exporté —
     un export qu'on relit d'une année sur l'autre ne doit pas changer de forme
     en dessous de la ligne où on l'avait laissé.
     Les versements sont listés du plus ancien au plus récent, comme le reste de
     l'export : dans un tableur, on lit une colonne de dates dans un seul sens. */
  function csvSectionsAssocies(db, debut, fin, today) {
    var b = bilan(db, debut, fin, today);
    var rows = [];

    rows.push([]);
    rows.push(['VERSEMENTS AUX ASSOCIÉS']);
    rows.push(['Date', 'Associé', 'Montant', 'Note', 'Ajouté par']);
    b.versements.slice().sort(function (x, y) { return compareDates(x.date, y.date); })
      .forEach(function (v) {
        rows.push([v.date, nomAssocie(db, v.partner), csvMontant(v.amount),
          v.note || '', identite(db, v.created_by)]);
      });

    rows.push([]);
    rows.push(['SOLDE PAR ASSOCIÉ']);
    // « sur encaissé » : ce n'est PAS le même chiffre que la part du tableau
    // mensuel, calculée sur l'attendu. Les deux sont justes, ils ne répondent
    // pas à la même question — l'étiquette doit le dire.
    rows.push(['Associé', 'Part gagnée (sur encaissé)', 'Part versée', 'Solde dû']);
    ['a', 'b'].forEach(function (k) {
      var p = b.partenaires[k];
      rows.push([nomAssocie(db, k), csvMontant(p.gagne), csvMontant(p.verse), csvMontant(p.solde)]);
    });

    ['a', 'b'].forEach(function (k) {
      rows.push([]);
      rows.push(['RELEVÉ (sur encaissé) — ' + nomAssocie(db, k)]);
      rows.push(['Date', 'Libellé', 'Montant', 'Solde']);
      ledger(db, k, debut, fin, today).forEach(function (l) {
        rows.push([l.date, l.libelle, csvMontant(l.montant), csvMontant(l.solde)]);
      });
    });

    return rows;
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
    // « sur attendu » : ces deux lignes partagent le profit ATTENDU, alors que la
    // section SOLDE PAR ASSOCIÉ, plus bas dans le MÊME fichier, partage l'ENCAISSÉ.
    // Deux chiffres justes qui ne répondent pas à la même question : sans la base
    // dans l'étiquette, le lecteur doit deviner lequel est « sa part ».
    rows.push(['Part ' + (st.partner_a_name || 'Steph') + ' (' + s.split.pctA + ' %, sur attendu)', csvMontant(s.split.a)]);
    rows.push(['Part ' + (st.partner_b_name || 'Alex') + ' (' + s.split.pctB + ' %, sur attendu)', csvMontant(s.split.b)]);
    rows = rows.concat(csvSectionsAssocies(db, mk + '-01', lastDayOfMonth(mk), today));
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
      // « sur attendu » dans l'en-tête : le même fichier contient plus bas des parts
      // calculées sur l'ENCAISSÉ. Sans la base, deux chiffres différents portent le
      // même nom et le lecteur doit deviner lequel est « sa part ».
      'Part ' + (st.partner_a_name || 'Steph') + ' (sur attendu)',
      'Part ' + (st.partner_b_name || 'Alex') + ' (sur attendu)', 'ROAS']);
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
    var per = periodeAnnee(annee);
    rows = rows.concat(csvSectionsAssocies(db, per.debut, per.fin, today));
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
    paiementsActifs: paiementsActifs,
    paymentsOfMonth: paymentsOfMonth,
    adSpendOfMonth: adSpendOfMonth,
    recurringOfMonth: recurringOfMonth,
    oneOffOfMonth: oneOffOfMonth,
    payoutsOfPeriod: payoutsOfPeriod,
    nomAssocie: nomAssocie,
    periodeDepuisLeDebut: periodeDepuisLeDebut,
    periodeAnnee: periodeAnnee,
    moisDeLaPeriode: moisDeLaPeriode,
    bilan: bilan,
    ledger: ledger,
    normaliserNom: normaliserNom,
    clientsSimilaires: clientsSimilaires,
    impactSuppression: impactSuppression,
    apercuVente: apercuVente,
    splitProfit: splitProfit,
    splitPctForMonth: splitPctForMonth,
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
