/* Hybrid Finance — assemblage de l'application : écrans, vues, événements. */
(function (root) {
  'use strict';

  var C = root.HF.calc, F = root.HF.format, D = root.HF.data, U = root.HF.ui;
  var $ = U.$, $$ = U.$$, esc = U.esc;

  var etat = {
    mois: C.monthKey(C.todayISO()),
    vue: 'dashboard',
    chartN: 6,
    chartMode: 'attendu',   // 'attendu' ou 'encaisse' — la bascule du graphique
    simBudget: null,
    horizon: C.addMonths(C.monthKey(C.todayISO()), 3),
    montrerArchives: false,
    // Le BILAN démarre sur « depuis le début » : l'entreprise a commencé avant
    // l'application, la période par défaut doit donc couvrir tout l'historique.
    bilanPeriode: { type: 'debut', debut: null, fin: null }
  };

  function db() { return D.db; }
  function reglages() { return db().settings || {}; }
  function nomA() { return reglages().partner_a_name || 'Steph'; }
  function nomB() { return reglages().partner_b_name || 'Alex'; }
  function today() { return C.todayISO(); }

  /* Dernières valeurs saisies, pour pré-remplir les formulaires. */
  function memo(cle, valeur) {
    try {
      if (valeur === undefined) return root.localStorage.getItem('hf_memo_' + cle);
      root.localStorage.setItem('hf_memo_' + cle, valeur);
    } catch (e) { /* navigation privée : tant pis */ }
    return null;
  }

  /* ================= Écrans ================= */

  function montrer(id) {
    $$('.screen').forEach(function (s) { s.classList.remove('active'); });
    $('#' + id).classList.add('active');
  }

  function montrerDiag(res) {
    montrer('screen-diag');
    $('#diag-list').innerHTML = (res.problems || []).map(function (p) {
      return '<div class="diag-item"><div class="what">' + esc(p.what) + '</div>' +
        '<div class="fix">' + p.fix + '</div></div>';   // p.fix contient du gras volontaire
    }).join('');
    $('#diag-tech').textContent = res.technical ? 'Détail technique : ' + res.technical : '';
  }

  /* ================= Démarrage ================= */

  /* Le nom de l'entreprise vit en base, donc on ne le connaît pas AVANT la connexion.
     On le retient à chaque chargement pour habiller l'écran de connexion et l'onglet
     du navigateur dès la visite suivante — sans quoi une entreprise dupliquée verrait
     « Hybrid Coaching » sur sa propre page de login. */
  function marque(nom) {
    if (nom) { try { root.localStorage.setItem('hf_marque', nom); } catch (e) { /* ignore */ } }
    var n = nom;
    if (!n) { try { n = root.localStorage.getItem('hf_marque'); } catch (e) { /* ignore */ } }
    n = n || 'Hybrid Coaching';
    $('#login-mark').textContent = U.initiales(n);
    $('#login-title').textContent = n;
    root.document.title = n + ' — Cockpit financier';
    return n;
  }

  async function demarrer() {
    marque(null);
    // la couleur de la barre du navigateur suit theme.css (promesse de rhabillage)
    var fond = getComputedStyle(root.document.documentElement).getPropertyValue('--bg').trim();
    var metaTheme = $('meta[name="theme-color"]');
    if (fond && metaTheme) metaTheme.setAttribute('content', fond);

    var res = await D.init();
    var demo = D.etat.mode === 'demo';

    $('#login-demo-note').hidden = !demo;
    $('#badge-demo').hidden = !demo;
    if (demo) {
      $('#login-email').value = root.HF.demoData.EMAIL_B;
      $('#login-password').value = 'demo';
    }

    if (!res.ok) { montrerDiag(res); return; }

    var user = await D.session();
    if (user) { await entrer(); } else { montrer('screen-login'); }
  }

  $('#form-login').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('#login-submit');
    var err = $('#login-error');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Connexion…';
    try {
      await D.signIn($('#login-email').value, $('#login-password').value);
      await entrer();
    } catch (ex) {
      err.innerHTML = messageConnexion(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Se connecter';
    }
  });

  function messageConnexion(ex) {
    switch (ex && ex.code) {
      case 'identifiants':
        /* Supabase répond exprès la même erreur pour un courriel inconnu et un
           mauvais mot de passe. La cause est presque toujours une coquille :
           on commence par là, et le compte inexistant vient en dernier. */
        return 'Connexion refusée. Dans la très grande majorité des cas, c\'est une <b>faute de frappe</b> : ' +
          'vérifie l\'orthographe du <b>courriel</b> ET du <b>mot de passe</b>. Sur téléphone, méfie-toi de la ' +
          '<b>majuscule automatique</b> au début du mot de passe et de l\'<b>espace</b> qui se glisse à la fin. ' +
          '(Supabase répond exprès la même chose que le courriel soit inconnu ou le mot de passe erroné.) ' +
          'Si tout est bien tapé et que ça refuse encore, alors seulement, vérifie dans Supabase que le compte existe : ' +
          'section <b>« Créer les deux utilisateurs »</b> du guide d\'installation.';
      case 'non_confirme':
        return 'Ce compte existe mais n\'est <b>pas confirmé</b>. Dans Supabase, supprime l\'utilisateur et recrée-le en activant <b>« Auto Confirm User »</b> (section <b>« Créer les deux utilisateurs »</b> du guide).';
      case 'login_desactive':
        return 'La connexion par courriel est <b>désactivée</b> dans Supabase. Va dans Authentication → Sign In / Providers → Email et réactive-la (garde « Allow new users to sign up » désactivé).';
      case 'reseau':
        return 'Impossible de joindre Supabase. Vérifie ta connexion Internet et l\'adresse du projet dans <b>config.js</b>.';
      case 'champs_vides':
        return 'Entre un courriel et un mot de passe.';
      default:
        return 'La connexion a échoué. ' + esc((ex && ex.message) || '');
    }
  }

  async function entrer() {
    // maintenant qu'on est connecté, la Row Level Security nous laisse voir les
    // lignes : c'est le bon moment pour vérifier que la ligne de réglages existe.
    var v = await D.verifierApresConnexion();
    if (!v.ok) { montrerDiag(v); return; }

    await D.load();
    etat.simBudget = Number(reglages().daily_ad_budget) || 120;
    montrer('screen-app');
    rendreTout();
  }

  $('#btn-logout').addEventListener('click', async function () {
    await D.signOut();
    root.location.reload();
  });

  /* ================= Rendu global ================= */

  function rendreTout() {
    rendreEnTete();
    rendreMoisPicker();
    rendreVue();
  }

  function rendreEnTete() {
    var s = reglages();
    var nom = marque(s.business_name || 'Hybrid Coaching');
    $('#brand-mark').textContent = U.initiales(nom);
    $('#brand-name').innerHTML = esc(nom) + ' <span>/ Finances</span>';
    $('#who').textContent = D.courriel() ? D.identite(D.courriel()) : '';
    $('#footer').textContent = D.etat.mode === 'demo'
      ? 'MODE DÉMO — DONNÉES FICTIVES · RIEN N\'EST SAUVEGARDÉ'
      : esc(nom).toUpperCase() + ' · DONNÉES PROTÉGÉES PAR LOGIN + ROW LEVEL SECURITY';
  }

  function rendreMoisPicker() {
    var p = $('#month-picker');
    var mois = [C.addMonths(etat.mois, -2), C.addMonths(etat.mois, -1), etat.mois];
    var html = '<button class="arrow" data-delta="-1" data-testid="mois-prec">‹</button>';
    mois.forEach(function (m) {
      var actif = m === etat.mois;
      html += '<button data-mois="' + m + '" class="' + (actif ? 'active' : '') + '"' +
        (actif ? ' data-testid="mois-actif"' : '') + '>' +
        esc(actif ? F.moisLong(m) : F.moisSeul(m)) + '</button>';
    });
    html += '<button class="arrow" data-delta="1" data-testid="mois-suiv">›</button>';
    p.innerHTML = html;
  }

  $('#month-picker').addEventListener('click', async function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.delta) etat.mois = C.addMonths(etat.mois, Number(b.dataset.delta));
    else if (b.dataset.mois) etat.mois = b.dataset.mois;
    // si on va au-delà de l'horizon des abonnements, on prolonge les échéanciers
    if (C.monthsBetween(etat.horizon, etat.mois) > 0) {
      etat.horizon = C.addMonths(etat.mois, 1);
      await D.ensurePayments(etat.horizon);
    }
    rendreMoisPicker();
    rendreVue();
  });

  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    etat.vue = b.dataset.vue;
    $$('#tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    rendreVue();
  });

  function rendreVue() {
    ['dashboard', 'traiter', 'bilan', 'clients', 'depenses', 'reglages'].forEach(function (v) {
      $('#vue-' + v).hidden = (v !== etat.vue);
    });
    // Le BILAN a son propre sélecteur de période : afficher en plus le sélecteur
    // de mois global donnerait deux commandes de temps sur le même écran, dont
    // une sans effet. On le retire là, et seulement là.
    $('#month-picker').parentNode.hidden = (etat.vue === 'bilan');
    if (etat.vue === 'dashboard') rendreDashboard();
    if (etat.vue === 'traiter') rendreTraiter();
    if (etat.vue === 'bilan') rendreBilan();
    if (etat.vue === 'clients') rendreClients();
    if (etat.vue === 'depenses') rendreDepenses();
    if (etat.vue === 'reglages') rendreReglages();
    rafraichirFiche();   // si une fiche client est ouverte, elle suit
  }

  /* Change d'onglet par le code (bandeau, liens internes). */
  function allerVue(vue) {
    etat.vue = vue;
    $$('#tabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.vue === vue); });
    rendreVue();
  }

  /* ================= Tableau de bord ================= */

  function rendreDashboard() {
    var m = etat.mois;
    var s = C.monthSummary(db(), m, today());
    var prec = C.monthSummary(db(), C.addMonths(m, -1), today());
    var ytd = C.ytdShares(db(), m, today());

    // Bandeau « à traiter » : discret, seulement quand des paiements attendent
    var at = C.aTraiter(db(), today());
    var banniere = $('#banner-traiter');
    banniere.hidden = at.nb === 0;
    if (at.nb > 0) {
      var texteMois = at.parMois.length === 1
        ? ' de ' + F.moisSeul(at.parMois[0].month).toLowerCase()
        : '';
      banniere.textContent = at.nb + ' paiement' + (at.nb > 1 ? 's' : '') + texteMois +
        ' attend' + (at.nb > 1 ? 'ent' : '') + ' une décision';
    }

    // Hero — le profit est calculé sur les revenus ATTENDUS du mois (définition v1)
    $('#hero-eyebrow').textContent = 'Profit net — ' + F.moisLong(m);
    var pb = $('#profit-big');
    pb.textContent = F.money(s.profit);
    pb.classList.toggle('negatif', s.profit < 0);
    $('#profit-sub').innerHTML = 'Revenus attendus <b>' + F.money(s.revenue) + '</b> − Dépenses ' +
      '<span class="dep">' + F.money(s.depenses.total) + '</span> · marge <b>' + F.pourcent(s.marge) + '</b>';

    // Objectif de revenus du mois : barre de progression sur l'ENCAISSÉ
    var obj = C.goalProgress(db(), m, today());
    var barreObj = $('#goal-bar');
    barreObj.hidden = !obj;
    if (obj) {
      var pctAffiche = Math.min(100, Math.max(0, obj.pct));
      var remplir = $('#goal-fill');
      remplir.style.width = pctAffiche + '%';
      remplir.classList.toggle('atteint', obj.pct >= 100);
      $('#goal-lab').innerHTML = '<b>' + F.pourcent(obj.pct) + '</b> de l\'objectif de ' +
        F.money(obj.objectif) + ' encaissé' +
        (obj.joursRestants > 0 ? ' · <b>' + obj.joursRestants + '</b> jour' + (obj.joursRestants > 1 ? 's' : '') + ' restant' + (obj.joursRestants > 1 ? 's' : '') : '');
    }

    // Barre de répartition
    var sp = s.split;
    $('#split-eyebrow').textContent = 'Répartition du profit (' + F.nombre(sp.pctA, sp.pctA % 1 ? 1 : 0) +
      ' / ' + F.nombre(sp.pctB, sp.pctB % 1 ? 1 : 0) + ')';
    var barre = $('#split-bar');
    barre.classList.toggle('perte', s.profit < 0);
    var largeurA = Math.min(92, Math.max(8, sp.pctA));   // toujours lisible, même à 0 %
    $('#side-a').style.width = largeurA + '%';
    $('#side-b').style.width = (100 - largeurA) + '%';
    $('#side-a').innerHTML = esc(nomA().toUpperCase()) + ' · ' + F.money(sp.a);
    $('#side-b').innerHTML = esc(nomB().toUpperCase()) + ' · ' + F.money(sp.b);
    $('#split-ytd').innerHTML = 'Cumul ' + ytd.annee + ' : <b>' + F.money(ytd.a) + '</b> / <b>' + F.money(ytd.b) + '</b>';

    // Le compteur, tous mois confondus : ce qui reste dû à chacun aujourd'hui.
    var perTot = C.periodeDepuisLeDebut(db(), today());
    var bTot = C.bilan(db(), perTot.debut, perTot.fin, today());
    $('#solde-ligne').hidden = false;
    $('#solde-ligne').innerHTML = 'Solde à ce jour — ' +
      morceauSolde(nomA(), bTot.partenaires.a.solde) + ' · ' +
      morceauSolde(nomB(), bTot.partenaires.b.solde);

    // KPI — le gros chiffre des revenus est l'ENCAISSÉ (l'argent réellement reçu) ;
    // l'attendu du mois est affiché juste dessous. Chaque KPI dit sur quoi il repose.
    $('#kpi-rev').textContent = F.money(s.encaisse);
    $('#kpi-attendu').innerHTML = 'Attendu ce mois-ci : <b>' + F.money(s.revenue) + '</b>';
    $('#kpi-rev-delta').innerHTML = delta(s.encaisse, prec.encaisse, prec.month, true);
    $('#kpi-dep').textContent = F.money(s.depenses.total);
    $('#kpi-dep-delta').innerHTML = delta(s.depenses.total, prec.depenses.total, prec.month, false);
    $('#kpi-ads').textContent = F.money(s.depenses.ads);
    $('#kpi-ads-delta').textContent = F.money(s.adsParJour) + ' / jour en moyenne';
    $('#kpi-roas').textContent = F.roas(s.roas);
    $('#kpi-roas-delta').innerHTML = s.roas == null
      ? '<span class="warn">Aucune dépense ads ce mois-ci</span>'
      : '<span class="up">Chaque 1 $ d\'ads → ' + F.money(s.roas) + ' de ventes attendues</span>';

    // Tableau des revenus
    var lignes = s.paiements.slice().sort(function (a, b) { return C.compareDates(a.due_date, b.due_date); });
    $('#rev-hint').textContent = s.clientsActifs + ' client' + (s.clientsActifs > 1 ? 's' : '') +
      ' actif' + (s.clientsActifs > 1 ? 's' : '') + ' · ' + F.money(s.revenue) + ' attendus';
    $('#rev-body').innerHTML = lignes.length ? lignes.map(function (p) {
      var v = db().sales.find(function (x) { return x.id === p.sale_id; });
      var st = C.paymentStatus(p, today());
      return '<tr><td>' + lienClient(p.client_id) + '</td>' +
        '<td class="sub col-plan">' + esc(v ? C.saleLabel(v) : '—') + '</td>' +
        '<td class="money">' + F.money(p.amount) + '</td>' +
        '<td>' + pillPaiement(p.id, st) + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">Aucun paiement attendu ce mois-ci.</td></tr>';
    $('#rev-foot').innerHTML = lignes.length
      ? '<tr><td>Total</td><td class="col-plan"></td>' +
        '<td class="money">' + F.money(s.revenue) + '</td>' +
        '<td class="money ' + (s.aRecuperer > 0 ? 't-gold' : 't-teal') + '">' + F.money(s.aRecuperer) +
        '<br><span class="sub">à récupérer</span></td></tr>'
      : '';

    // Autres dépenses (hors ads)
    var autres = C.recurringOfMonth(db(), m).map(function (r) {
      return { label: r.label, amount: r.amount, type: 'Récurrente' };
    }).concat(C.oneOffOfMonth(db(), m).map(function (e) {
      return { label: e.label, amount: e.amount, type: 'Ponctuelle' };
    }));
    $('#autres-body').innerHTML = autres.length ? autres.map(function (a) {
      return '<tr><td>' + esc(a.label) + '<br><span class="sub">' + a.type + '</span></td>' +
        '<td class="money">' + F.money(a.amount) + '</td></tr>';
    }).join('') + '<tr><td><b>Total hors ads</b></td><td class="money"><b>' + F.money(s.depenses.horsAds) + '</b></td></tr>'
      : '<tr><td class="empty">Aucune dépense hors ads ce mois-ci.</td></tr>';

    // Simulateur
    rendreSimulateur(s);

    // Graphique + signaux
    rendreGraphique();
    rendreSignaux();
  }

  function morceauSolde(nom, solde) {
    if (Math.abs(solde) < 0.005) return esc(nom) + ' : à jour';
    if (solde > 0) return esc(nom) + ' : <b>' + F.money(solde) + '</b> dû';
    return esc(nom) + ' : <b>' + F.money(Math.abs(solde)) + '</b> versés en trop';
  }

  $('#solde-ligne').addEventListener('click', function () { allerVue('bilan'); });

  function delta(actuel, precedent, moisPrec, hausseEstBonne) {
    if (!precedent) return '<span class="warn">Pas de comparaison pour ' + esc(F.moisSeul(moisPrec).toLowerCase()) + '</span>';
    var v = Math.round((actuel - precedent) / precedent * 100);
    var bon = hausseEstBonne ? v >= 0 : v <= 0;
    return '<span class="' + (bon ? 'up' : 'down') + '">' + (v >= 0 ? '▲ +' : '▼ ') + v + ' % vs ' +
      esc(F.moisSeul(moisPrec).toLowerCase()) + '</span>';
  }

  function nomClient(id) {
    var c = db().clients.find(function (x) { return x.id === id; });
    return c ? c.name : '(client supprimé)';
  }

  /* Nom de client cliquable : ouvre sa fiche. */
  function lienClient(id) {
    return '<button class="link-client" data-client-sheet="' + id + '" ' +
      'title="Ouvrir la fiche du client">' + esc(nomClient(id)) + '</button>';
  }

  function pillPaiement(id, statut) {
    var cls = statut === 'paid' ? 'ok'
      : (statut === 'late' ? 'late' : (statut === 'saute' ? 'skip' : 'wait'));
    return '<button class="pill ' + cls + '" data-paiement="' + id + '" data-testid="pill-' + id + '" ' +
      'title="Un clic fait tourner le statut : payé, sauté, en attente">' + C.statusLabel(statut) + '</button>';
  }

  /* Un clic sur une pastille fait tourner le statut :
     en attente / en retard → payé → sauté → en attente. */
  doc_on('click', '[data-paiement]', async function (b) {
    await D.cyclePayment(b.dataset.paiement);
    rendreVue();
  });

  /* ---------- Dates modifiables en place ----------
     La date affichée est un bouton ; cliquer le remplace par un champ date.
     Changer enregistre ; Échap ou cliquer ailleurs annule. Aucune modale. */

  function dateEditable(table, id, champ, valeur) {
    return '<button class="date-edit' + (valeur ? '' : ' vide') + '" data-edit-date="' + table + '" ' +
      'data-id="' + id + '" data-champ="' + champ + '" data-testid="edit-' + champ + '-' + id + '" ' +
      'title="Cliquer pour modifier la date">' +
      (valeur ? esc(F.dateCourte(valeur)) : '—') + '</button>';
  }

  doc_on('click', '[data-edit-date]', function (b) {
    if (b.dataset.ouvert) return;
    b.dataset.ouvert = '1';
    var table = b.dataset.editDate, id = b.dataset.id, champ = b.dataset.champ;
    var brute = ligneDe(table, id);
    var input = root.document.createElement('input');
    input.type = 'date';
    input.className = 'date-inline';
    input.value = (brute && brute[champ]) || today();
    input.setAttribute('data-testid', 'date-inline-' + champ + '-' + id);
    b.replaceWith(input);
    input.focus();

    var fini = false;
    async function valider() {
      if (fini) return;
      fini = true;
      var v = input.value;
      if (v && (!brute || v !== brute[champ])) {
        var patch = {};
        patch[champ] = v;
        if (table === 'payments') await D.updatePayment(id, patch);
        else if (table === 'payouts') await D.updatePayout(id, patch);
        else await D.updateOneOff(id, patch);
        U.toast('Date modifiée : ' + F.dateCourte(v) + '.');
      }
      rendreVue();
    }
    function annuler() {
      if (fini) return;
      fini = true;
      rendreVue();
    }
    input.addEventListener('change', valider);
    input.addEventListener('blur', function () { setTimeout(valider, 0); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') annuler();
      if (e.key === 'Enter') { e.preventDefault(); valider(); }
    });
  });

  function ligneDe(table, id) {
    return (db()[table] || []).find(function (r) { return r.id === id; });
  }

  function rendreSimulateur(s) {
    var sl = $('#sim-slider');
    if (etat.simBudget == null) etat.simBudget = Number(reglages().daily_ad_budget) || 120;
    // le maximum s'adapte au budget choisi : on doit toujours pouvoir monter au-dessus
    sl.max = Math.max(500, Math.ceil(etat.simBudget * 2 / 50) * 50);
    sl.value = etat.simBudget;
    $('#sim-name-a').textContent = nomA();
    $('#sim-name-b').textContent = nomB();
    $('#sim-cpa').textContent = s.coutAcquisition == null ? '—' : F.money(s.coutAcquisition);
    $('#sim-seuil').textContent = F.money(s.seuilAdsJournalier);
    majSimulateur();
  }

  function majSimulateur() {
    var s = C.monthSummary(db(), etat.mois, today());
    var sim = C.simulate(etat.simBudget, etat.mois, s.revenue, s.depenses.horsAds,
      reglages().split_a_pct == null ? 50 : reglages().split_a_pct);
    $('#sim-out').textContent = F.money(sim.budgetJournalier);
    $('#sim-ads').textContent = F.money(sim.adsProjete);
    var pp = $('#sim-profit');
    pp.textContent = F.money(sim.profitProjete);
    pp.className = 'num ' + (sim.profitProjete < 0 ? 't-red' : 't-teal');
    $('#sim-part-a').textContent = F.money(sim.split.a);
    $('#sim-part-b').textContent = F.money(sim.split.b);
  }

  $('#sim-slider').addEventListener('input', function (e) {
    etat.simBudget = Number(e.target.value);
    majSimulateur();
  });

  /* La bascule Attendu / Encaissé change la série des revenus. En vue « encaissé »,
     le profit affiché devient encaissé − dépenses (étiqueté comme tel) ; la
     définition v1 du profit du mois, elle, ne bouge pas. */
  function rendreGraphique() {
    var enc = etat.chartMode === 'encaisse';
    var pts = C.evolution(db(), etat.mois, etat.chartN, today());
    var max = 1;
    pts.forEach(function (p) {
      var rev = enc ? p.encaisse : p.revenue;
      var prof = enc ? C.round2(p.encaisse - p.depenses) : p.profit;
      max = Math.max(max, rev, p.depenses, Math.abs(prof));
    });
    var objectif = C.goalForMonth(reglages(), etat.mois);
    if (objectif) max = Math.max(max, objectif);

    $('#chart').innerHTML = pts.map(function (p) {
      var rev = enc ? p.encaisse : p.revenue;
      var prof = enc ? C.round2(p.encaisse - p.depenses) : p.profit;
      function h(v) { return Math.max(2, Math.round(Math.abs(v) / max * 100)); }
      return '<div class="bar-group" title="' + esc(F.moisLong(p.month)) +
        ' — ' + (enc ? 'encaissé ' : 'revenus attendus ') + F.money(rev) +
        ', dépenses ' + F.money(p.depenses) +
        ', profit ' + (enc ? 'sur encaissé ' : '') + F.money(prof) + '">' +
        '<div class="bars">' +
        '<div class="bar r" style="height:' + h(rev) + '%"></div>' +
        '<div class="bar d" style="height:' + h(p.depenses) + '%"></div>' +
        '<div class="bar p' + (prof < 0 ? ' neg' : '') + '" style="height:' + h(prof) + '%"></div>' +
        '</div><div class="bar-lab">' + F.moisCourt(p.month) + '</div></div>';
    }).join('');

    $('#legend-rev').textContent = enc ? 'Encaissé' : 'Revenus attendus';

    // Ligne d'objectif : posée à la hauteur de l'objectif du mois affiché.
    // Les barres font 150 px de haut et reposent à 32 px du bas du graphique
    // (étiquettes des mois) — mêmes mesures que dans app.css.
    var ligne = $('#chart-goal');
    ligne.hidden = !objectif;
    if (objectif) {
      ligne.style.bottom = Math.round(32 + (objectif / max) * 150) + 'px';
      $('span', ligne).textContent = 'objectif ' + F.moneyCourt(objectif);
    }
  }

  $('#chart-6').addEventListener('click', function () { basculeChart(6); });
  $('#chart-12').addEventListener('click', function () { basculeChart(12); });
  function basculeChart(n) {
    etat.chartN = n;
    $('#chart-6').classList.toggle('active', n === 6);
    $('#chart-12').classList.toggle('active', n === 12);
    rendreGraphique();
  }

  $('#chart-attendu').addEventListener('click', function () { basculeMode('attendu'); });
  $('#chart-encaisse').addEventListener('click', function () { basculeMode('encaisse'); });
  function basculeMode(mode) {
    etat.chartMode = mode;
    $('#chart-attendu').classList.toggle('active', mode === 'attendu');
    $('#chart-encaisse').classList.toggle('active', mode === 'encaisse');
    rendreGraphique();
  }

  $('#banner-traiter').addEventListener('click', function () { allerVue('traiter'); });

  function rendreSignaux() {
    // les signaux du mois + les signaux de rétention, dans la même grille
    var sig = C.signals(db(), etat.mois, today())
      .concat(C.retention(db(), etat.mois, today()).tiles);
    $('#signals').innerHTML = sig.map(function (x) {
      return '<div class="signal"><div class="num t-' + x.tone + '">' + esc(x.num) + '</div>' +
        '<p>' + x.text + '</p></div>';   // x.text contient du gras volontaire
    }).join('');
  }

  /* ================= À traiter ================= */

  function rendreTraiter() {
    var at = C.aTraiter(db(), today());
    var total = $('#traiter-total');
    var liste = $('#traiter-liste');

    if (!at.nb) {
      total.hidden = true;
      liste.innerHTML = '<div class="traiter-vide" data-testid="traiter-vide">' +
        '<b>Rien à traiter.</b> Tous les paiements dus ont leur réponse — payé, sauté ou déjà relancé. ' +
        'Reviens-y au fil du mois : les nouvelles échéances arriveront ici toutes seules.</div>';
      return;
    }

    total.hidden = false;
    total.innerHTML = '<b>' + F.money(at.total) + '</b>' +
      at.nb + ' paiement' + (at.nb > 1 ? 's' : '') + ' en attente d\'une décision — du plus ancien au plus récent';

    liste.innerHTML = at.parMois.map(function (g) {
      return '<div class="traiter-mois">' + esc(F.moisLong(g.month)) + '</div>' +
        g.items.map(function (p) {
          var v = db().sales.find(function (x) { return x.id === p.sale_id; });
          var st = C.paymentStatus(p, today());
          var relance = p.reminded_date
            ? ' · relancé ' + F.ilYA(C.dayDiff(p.reminded_date, today()))
            : '';
          return '<div class="traiter-ligne" data-testid="traiter-ligne-' + p.id + '">' +
            '<div class="qui">' + lienClient(p.client_id) +
            '<span class="sub">' + esc(F.dateCourte(p.due_date)) +
            (v ? ' · ' + esc(C.saleLabel(v)) : '') +
            (st === 'late' ? ' · <span class="down">en retard</span>' : '') +
            esc(relance) + '</span></div>' +
            '<div class="combien">' + F.money(p.amount) + '</div>' +
            '<div class="traiter-actions">' +
            '<button class="btn-traiter paye" data-traiter-paye="' + p.id + '" data-testid="traiter-paye-' + p.id + '">Payé</button>' +
            '<button class="btn-traiter saute" data-traiter-saute="' + p.id + '" data-testid="traiter-saute-' + p.id + '">Sauté</button>' +
            '<button class="btn-traiter" data-traiter-relance="' + p.id + '" data-testid="traiter-relance-' + p.id + '">Relancer</button>' +
            '</div></div>';
        }).join('');
    }).join('');
  }

  doc_on('click', '[data-traiter-paye]', async function (b) {
    await D.setPaymentStatus(b.dataset.traiterPaye, 'paid');
    U.toast('Paiement marqué payé.');
    rendreVue();
  });
  doc_on('click', '[data-traiter-saute]', async function (b) {
    await D.setPaymentStatus(b.dataset.traiterSaute, 'saute');
    U.toast('Paiement sauté : il ne sera plus attendu, mais reste dans l\'historique.');
    rendreVue();
  });
  doc_on('click', '[data-traiter-relance]', async function (b) {
    await D.relancer(b.dataset.traiterRelance);
    U.toast('Relance notée en date d\'aujourd\'hui. (Aucun courriel n\'est envoyé.)');
    rendreVue();
  });

  /* ================= Bilan ================= */

  function nomPartenaire(lettre) { return lettre === 'a' ? nomA() : nomB(); }

  /* La période affichée. « Depuis le début » part du plus ancien enregistrement
     de la base, quel qu'il soit — l'entreprise tournait avant l'application. */
  function periodeCourante() {
    var p = etat.bilanPeriode;
    if (p.type === 'annee') return C.periodeAnnee(C.monthKey(today()).slice(0, 4));
    if (p.type === 'perso' && p.debut && p.fin && C.compareDates(p.debut, p.fin) <= 0) {
      return { debut: p.debut, fin: p.fin };
    }
    return C.periodeDepuisLeDebut(db(), today());
  }

  function ligneChiffre(lab, val, opts) {
    opts = opts || {};
    return '<div class="bloc-chiffre' + (opts.fort ? ' fort' : '') + '">' +
      '<span class="lab">' + esc(lab) + '</span>' +
      '<span class="val ' + (opts.ton || '') + '"' +
      (opts.testid ? ' data-testid="' + opts.testid + '"' : '') + '>' + esc(val) + '</span></div>';
  }

  function rendreBilan() {
    var per = periodeCourante();
    var b = C.bilan(db(), per.debut, per.fin, today());

    $$('#bilan-periode button').forEach(function (x) {
      x.classList.toggle('active', x.dataset.periode === etat.bilanPeriode.type);
    });
    // On affiche les bornes RÉELLEMENT calculées, pas celles demandées : le bilan
    // raisonne en mois entiers (une part de profit n'existe que par mois), donc une
    // date en milieu de mois tire tout le mois. Le dire évite un écart invisible
    // entre ce que l'écran annonce et ce qu'il additionne.
    $('#bilan-perso').hidden = etat.bilanPeriode.type !== 'perso';
    if (etat.bilanPeriode.type === 'perso') {
      $('#bilan-du').value = b.debut;
      $('#bilan-au').value = b.fin;
      etat.bilanPeriode.debut = b.debut;
      etat.bilanPeriode.fin = b.fin;
    }

    $('#bilan-portee').innerHTML = 'Du <b>' + esc(F.dateLongue(b.debut)) + '</b> au <b>' +
      esc(F.dateLongue(b.fin)) + '</b> · ' + b.mois.length + ' mois' +
      (etat.bilanPeriode.type === 'perso'
        ? ' <span class="sub">(le bilan compte des mois entiers)</span>'
        : '');

    // Ce que l'entreprise a fait : ces totaux sont EXACTEMENT la somme des mois
    // affichés sur le tableau de bord, pour que les deux écrans ne se contredisent jamais.
    $('#bilan-totaux').innerHTML =
      '<div class="eyebrow">Ce que l\'entreprise a fait</div>' +
      ligneChiffre('Revenus attendus', F.money(b.revenus), { testid: 'bilan-revenus' }) +
      ligneChiffre('Revenus encaissés', F.money(b.encaisse), { testid: 'bilan-encaisse' }) +
      ligneChiffre('Dépenses', F.money(b.depenses.total), { testid: 'bilan-depenses-total' }) +
      ligneChiffre('Profit sur l\'attendu', F.money(b.profit), { testid: 'bilan-profit' }) +
      ligneChiffre('Profit encaissé', F.money(b.profitEncaisse), { fort: true, testid: 'bilan-profit-encaisse' }) +
      '<p class="aide-bloc">Les parts des associés se calculent sur le <b>profit encaissé</b> :' +
      ' on ne partage que l\'argent réellement reçu.</p>';

    var cats = b.depenses.parCategorie || {};
    $('#bilan-depenses').innerHTML =
      '<div class="eyebrow">Dépenses par catégorie</div>' +
      Object.keys(C.CATEGORIES).map(function (k) {
        return ligneChiffre(C.CATEGORIES[k], F.money(cats[k] || 0), { testid: 'bilan-cat-' + k });
      }).join('') +
      ligneChiffre('Total', F.money(b.depenses.total), { fort: true });

    // Le solde dû : le chiffre qui domine la carte de chaque associé.
    $('#bilan-partenaires').innerHTML = ['a', 'b'].map(function (l) {
      return carteAssocie(l, b.partenaires[l]);
    }).join('');

    $('#bilan-releves').innerHTML = ['a', 'b'].map(function (l) {
      return releveHtml(l, per);
    }).join('');

    rendreVersements(b);
    rendreBilanMois(b);
  }

  function carteAssocie(lettre, p) {
    var nom = nomPartenaire(lettre);
    var carre = Math.abs(p.solde) < 0.005;
    var cls = carre ? 'carre' : (p.solde > 0 ? 'du' : 'trop');
    var quoi = carre
      ? 'à jour — il ne reste rien à verser'
      : (p.solde > 0
        ? 'que l\'entreprise doit encore à ' + esc(nom)
        : 'versés en trop à ' + esc(nom));
    return '<div class="carte-associe ' + lettre + '">' +
      '<div class="qui">' + esc(nom) + '</div>' +
      '<div class="solde-big ' + cls + '" data-testid="solde-' + lettre + '">' +
      F.money(Math.abs(p.solde)) + '</div>' +
      '<div class="solde-quoi">' + quoi + '</div>' +
      ligneChiffre('Part gagnée', F.money(p.gagne), { testid: 'gagne-' + lettre }) +
      ligneChiffre('Part versée', F.money(p.verse), { testid: 'verse-' + lettre }) +
      '</div>';
  }

  /* Le compteur : un mouvement par ligne, et le solde après chacun.
     C'est la colonne « Solde » que l'œil suit — la dernière valeur est
     exactement le solde dû affiché plus haut. */
  function releveHtml(lettre, per) {
    var lignes = C.ledger(db(), lettre, per.debut, per.fin, today());
    if (!lignes.length) {
      return '<div class="releve"><div class="releve-titre">' + esc(nomPartenaire(lettre)) + '</div>' +
        '<div class="card"><p class="empty">Aucun mouvement sur cette période.</p></div></div>';
    }
    return '<div class="releve"><div class="releve-titre">' + esc(nomPartenaire(lettre)) + '</div>' +
      '<div class="card"><div class="table-scroll"><table>' +
      '<thead><tr><th>Date</th><th>Mouvement</th><th class="right">Montant</th><th class="right">Solde</th></tr></thead>' +
      '<tbody data-testid="releve-' + lettre + '">' +
      lignes.map(function (l) {
        var positif = l.montant >= 0;
        return '<tr class="' + (l.type === 'versement' ? 'ligne-versement' : '') + '">' +
          '<td class="sub">' + esc(F.dateCourte(l.date)) + '</td>' +
          '<td>' + esc(l.libelle) + '</td>' +
          '<td class="money"><span class="' + (positif ? 'mvt-plus' : 'mvt-moins') + '">' +
          (positif ? '+ ' : '− ') + F.money(Math.abs(l.montant)) + '</span></td>' +
          '<td class="solde-col">' + F.money(l.solde) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div></div>';
  }

  function rendreVersements(b) {
    var vs = b.versements;
    $('#versements-body').innerHTML = vs.length ? vs.map(function (v) {
      return '<tr><td class="sub">' + dateEditable('payouts', v.id, 'date', v.date) + '</td>' +
        '<td>' + esc(nomPartenaire(v.partner)) + '</td>' +
        '<td class="money">' + F.money(v.amount) + '</td>' +
        '<td class="sub">' + esc(v.note || '—') + '</td>' +
        '<td class="sub">' + esc(D.identite(v.created_by)) + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn-mini" data-vers-editer="' + v.id + '" data-testid="vers-editer-' + v.id + '">Modifier</button>' +
        '<button class="btn-mini danger" data-vers-suppr="' + v.id + '" data-testid="vers-suppr-' + v.id + '">Supprimer</button>' +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">Aucun versement sur cette période. ' +
      'Enregistre ici l\'argent que vous vous êtes réellement versé.</td></tr>';
  }

  function rendreBilanMois(b) {
    var entete = '<table><thead><tr><th>Mois</th><th class="right">Attendu</th>' +
      '<th class="right">Encaissé</th><th class="right">Dépenses</th>' +
      '<th class="right">Profit encaissé</th>' +
      // Les colonnes « Part » viennent du profit ENCAISSÉ, comme les cartes de
      // solde plus haut — l'en-tête le dit, pour qu'aucune colonne ne laisse
      // deviner sa base de calcul.
      '<th class="right">Part ' + esc(nomA()) + ' (encaissé)</th>' +
      '<th class="right">Part ' + esc(nomB()) + ' (encaissé)</th>' +
      '<th class="right">Versé ' + esc(nomA()) + '</th><th class="right">Versé ' + esc(nomB()) + '</th></tr></thead>';
    var corps = b.parMois.map(function (m) {
      return '<tr><td class="sub">' + esc(F.moisAnnee(m.month + '-01')) + '</td>' +
        '<td class="money">' + F.money(m.revenue) + '</td>' +
        '<td class="money">' + F.money(m.encaisse) + '</td>' +
        '<td class="money">' + F.money(m.depenses) + '</td>' +
        '<td class="money">' + F.money(m.profitEncaisse) + '</td>' +
        '<td class="money">' + F.money(m.partA) + '</td>' +
        '<td class="money">' + F.money(m.partB) + '</td>' +
        '<td class="money">' + F.money(m.verseA) + '</td>' +
        '<td class="money">' + F.money(m.verseB) + '</td></tr>';
    }).join('');
    $('#bilan-mois').innerHTML = entete + '<tbody data-testid="bilan-mois-body">' + corps + '</tbody></table>';
  }

  $('#bilan-periode').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    etat.bilanPeriode.type = b.dataset.periode;
    if (b.dataset.periode === 'perso' && !etat.bilanPeriode.debut) {
      var def = C.periodeDepuisLeDebut(db(), today());
      etat.bilanPeriode.debut = def.debut;
      etat.bilanPeriode.fin = def.fin;
    }
    rendreBilan();
  });

  ['#bilan-du', '#bilan-au'].forEach(function (sel) {
    $(sel).addEventListener('change', function () {
      var du = $('#bilan-du').value, au = $('#bilan-au').value;
      if (!du || !au) return;
      if (C.compareDates(du, au) > 0) { U.toast('La date de fin doit venir après la date de début.', true); return; }
      etat.bilanPeriode.debut = du;
      etat.bilanPeriode.fin = au;
      rendreBilan();
    });
  });

  /* ---------- Versements ---------- */

  function modaleVersement(existant) {
    var titre = existant ? 'Modifier le versement' : 'Enregistrer un versement';
    var html =
      '<label class="field"><span>Associé payé</span>' +
      '<select data-champ="partner" data-testid="f-vers-partner">' +
      '<option value="a">' + esc(nomA()) + '</option>' +
      '<option value="b">' + esc(nomB()) + '</option></select></label>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant versé ($)</span>' +
      '<input type="number" step="0.01" min="0" data-champ="montant" data-testid="f-vers-montant"></label>' +
      '<label class="field"><span>Date du versement</span>' +
      '<input type="date" data-champ="date" data-testid="f-vers-date"></label>' +
      '</div>' +
      '<label class="field"><span>Note (facultatif)</span>' +
      '<input type="text" data-champ="note" data-testid="f-vers-note" placeholder="Ex. Virement Interac"></label>' +
      '<p class="aide-bloc">Ce n\'est pas une dépense : un versement distribue un profit déjà gagné. ' +
      'Le profit, les dépenses et les parts ne bougent pas — seul le solde dû à l\'associé baisse.</p>';

    var m = U.modal(titre, existant ? '' : 'L\'argent réellement sorti vers un associé.', html, {
      valider: existant ? 'Enregistrer' : 'Enregistrer le versement',
      onSubmit: async function (form, close, erreur) {
        var montant = Number(form.querySelector('[data-champ="montant"]').value);
        var date = form.querySelector('[data-champ="date"]').value;
        var partner = form.querySelector('[data-champ="partner"]').value;
        var note = form.querySelector('[data-champ="note"]').value.trim();
        if (!(montant > 0)) return erreur('Le montant versé doit être supérieur à 0.');
        if (!date) return erreur('Choisis la date du versement.');
        if (existant) await D.updatePayout(existant.id, { partner: partner, date: date, amount: montant, note: note || null });
        else await D.addPayout({ partner: partner, date: date, amount: montant, note: note || null });
        close();
        U.toast(existant ? 'Versement modifié.' : 'Versement enregistré.');
        rendreVue();
      }
    });

    $('[data-champ="date"]', m.root).value = existant ? existant.date : today();
    if (existant) {
      $('[data-champ="partner"]', m.root).value = existant.partner;
      $('[data-champ="montant"]', m.root).value = existant.amount;
      $('[data-champ="note"]', m.root).value = existant.note || '';
    }
  }

  $('#btn-add-versement').addEventListener('click', function () { modaleVersement(null); });

  doc_on('click', '[data-vers-editer]', function (b) {
    var v = db().payouts.find(function (x) { return x.id === b.dataset.versEditer; });
    if (v) modaleVersement(v);
  });

  doc_on('click', '[data-vers-suppr]', function (b) {
    var v = db().payouts.find(function (x) { return x.id === b.dataset.versSuppr; });
    if (!v) return;
    U.confirmer('Supprimer ce versement ?',
      'Le versement de ' + F.money(v.amount) + ' à ' + nomPartenaire(v.partner) +
      ' part à la Corbeille. Le solde dû remontera d\'autant. Récupérable 30 jours.',
      async function () {
        await D.deletePayout(v.id);
        U.toast('Versement envoyé à la Corbeille.');
        rendreVue();
      });
  });

  /* ================= Clients & ventes ================= */

  function rendreClients() {
    var tous = db().clients;
    var actifs = tous.filter(function (c) { return !c.archived; });
    var archives = tous.filter(function (c) { return c.archived; });
    $('#clients-hint').textContent = actifs.length + ' client' + (actifs.length > 1 ? 's' : '') + ' au dossier';

    // Archiver est réversible : on peut revoir les archivés et les réactiver.
    var btnArch = $('#btn-archives');
    var nbArchives = archives.length +
      db().sales.filter(function (s) { return s.archived && !s.deleted_at; }).length;
    btnArch.hidden = nbArchives === 0;
    btnArch.textContent = etat.montrerArchives
      ? 'Masquer les archivés'
      : 'Afficher les archivés (' + nbArchives + ')';

    var lignes = [];
    var visibles = etat.montrerArchives ? tous : actifs;
    visibles.forEach(function (c) {
      var ventes = db().sales.filter(function (s) {
        return s.client_id === c.id && (etat.montrerArchives || !s.archived);
      });
      var marqueClient = c.archived ? ' <span class="pill neutre">Archivé</span>' : '';
      if (!ventes.length) {
        lignes.push('<tr><td>' + lienClient(c.id) + marqueClient + '</td><td class="sub">Aucune vente</td><td class="money">—</td>' +
          '<td class="sub">—</td><td class="sub">' + esc(D.identite(c.created_by)) + '</td>' +
          '<td><div class="row-actions">' + boutonsClient(c) + '</div></td></tr>');
        return;
      }
      ventes.forEach(function (v, i) {
        lignes.push('<tr><td>' + (i === 0 ? lienClient(c.id) + marqueClient : '<span class="sub">↳</span>') + '</td>' +
          '<td>' + esc(C.saleLabel(v)) +
          (v.archived ? ' <span class="pill neutre">Archivée</span>' : '') +
          '<br><span class="sub">' + esc(C.TYPES_VENTE[v.type]) +
          (v.end_date ? ' · fin ' + F.dateCourte(v.end_date) : '') + '</span></td>' +
          '<td class="money">' + F.money(C.saleTotal(v)) + (v.type === 'abonnement' ? ' <span class="sub">/mois</span>' : '') + '</td>' +
          '<td class="sub">' + F.dateCourte(v.start_date) + '</td>' +
          '<td class="sub">' + esc(D.identite(v.created_by)) + '</td>' +
          '<td><div class="row-actions">' +
          (v.archived
            ? '<button class="btn-mini" data-reactiver-vente="' + v.id + '" data-testid="reactiver-vente-' + v.id + '">Réactiver</button>'
            : '<button class="btn-mini" data-archiver-vente="' + v.id + '" title="Retire la vente des vues courantes. L\'historique payé reste compté.">Archiver</button>') +
          '<button class="btn-mini danger" data-suppr-vente="' + v.id + '" data-testid="suppr-vente-' + v.id + '" title="Efface la vente et tous ses paiements, passés compris.">Supprimer</button>' +
          (i === 0 ? boutonsClient(c) : '') +
          '</div></td></tr>');
      });
    });
    $('#clients-body').innerHTML = lignes.length ? lignes.join('')
      : '<tr><td colspan="6" class="empty">Aucun client. Ajoute le premier avec le bouton ci-dessous.</td></tr>';

    // Paiements du mois affiché — l'échéance vient du contrat, la date « payée le »
    // dit quand l'argent est vraiment entré. Les deux se corrigent d'un clic.
    var pays = C.paymentsOfMonth(db(), etat.mois)
      .slice().sort(function (a, b) { return C.compareDates(a.due_date, b.due_date); });
    $('#paiements-body').innerHTML = pays.length ? pays.map(function (p) {
      var v = db().sales.find(function (x) { return x.id === p.sale_id; });
      return '<tr><td class="sub">' + dateEditable('payments', p.id, 'due_date', p.due_date) + '</td>' +
        '<td>' + lienClient(p.client_id) + '</td>' +
        '<td class="sub col-plan">' + esc(v ? C.saleLabel(v) : '—') + '</td>' +
        '<td class="money">' + F.money(p.amount) + '</td>' +
        '<td class="sub">' + (p.status === 'paid'
          ? dateEditable('payments', p.id, 'paid_date', p.paid_date)
          : '<span class="sub">—</span>') + '</td>' +
        '<td>' + pillPaiement(p.id, C.paymentStatus(p, today())) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">Aucun paiement attendu en ' +
      esc(F.moisLong(etat.mois).toLowerCase()) + '.</td></tr>';
  }

  /* Archiver et Supprimer sont deux gestes différents, et l'infobulle le dit :
     archiver range un client qui est parti (l'historique compte toujours),
     supprimer efface une saisie erronée (tout disparaît des totaux). */
  function boutonsClient(c) {
    if (c.archived) {
      return '<button class="btn-mini" data-reactiver-client="' + c.id + '" data-testid="reactiver-client-' + c.id + '">Réactiver</button>' +
        '<button class="btn-mini danger" data-suppr-client="' + c.id + '" data-testid="suppr-client-' + c.id + '">Supprimer</button>';
    }
    return '<button class="btn-mini" data-vente-pour="' + c.id + '">+ Vente</button>' +
      '<button class="btn-mini" data-editer-client="' + c.id + '">Modifier</button>' +
      '<button class="btn-mini" data-archiver-client="' + c.id + '" title="Le client sort des vues courantes. Tout son historique reste compté.">Archiver</button>' +
      '<button class="btn-mini danger" data-suppr-client="' + c.id + '" data-testid="suppr-client-' + c.id + '" title="Efface le client, ses ventes et ses paiements de tous les totaux, passés compris.">Supprimer</button>';
  }

  $('#btn-archives').addEventListener('click', function () {
    etat.montrerArchives = !etat.montrerArchives;
    rendreVue();
  });

  doc_on('click', '[data-reactiver-client]', async function (b) {
    var id = b.dataset.reactiverClient;
    await D.reactiverClient(id);
    U.toast('Client réactivé, avec ses ventes.');
    rendreVue();
  });

  doc_on('click', '[data-reactiver-vente]', async function (b) {
    await D.reactiverSale(b.dataset.reactiverVente);
    U.toast('Vente réactivée : ses prochaines échéances repartent.');
    rendreVue();
  });

  /* ---------- Fiche client ---------- */

  doc_on('click', '[data-client-sheet]', function (b) {
    var c = db().clients.find(function (x) { return x.id === b.dataset.clientSheet; });
    if (!c) return;
    ouvrirFicheClient(c.id);
  });

  var ficheOuverte = null;   // id du client dont la fiche est affichée, sinon null

  function corpsFiche(clientId) {
    var st = C.clientStats(db(), clientId, today());

    var stats =
      '<div class="sheet-stats">' +
      '<div class="mini"><div class="lab">Client depuis</div><div class="num">' +
      (st.depuis ? esc(F.moisAnnee(st.depuis)) : '—') + '</div></div>' +
      '<div class="mini"><div class="lab">Total payé à ce jour</div><div class="num t-teal" data-testid="sheet-total">' +
      F.money(st.totalPaye) + '</div></div>' +
      '<div class="mini"><div class="lab">Plan actuel</div><div class="num">' +
      (st.planActuel ? esc(st.planActuel) : '—') + '</div></div>' +
      '<div class="mini"><div class="lab">Mois sautés</div><div class="num" data-testid="sheet-sautes">' + st.nbSautes + '</div></div>' +
      '<div class="mini"><div class="lab">Paiements en retard</div><div class="num' + (st.nbRetards > 0 ? ' t-red' : '') + '">' +
      st.nbRetards + '</div></div>' +
      '<div class="mini"><div class="lab">Retard moyen</div><div class="num" data-testid="sheet-retard-moyen">' +
      (st.retardMoyenJours == null ? '—' : st.retardMoyenJours + ' j') + '</div></div>' +
      '</div>';

    var histo = st.historique.length
      ? '<div class="sheet-histo"><table><thead><tr><th>Échéance</th><th class="right">Montant</th><th>Payée le</th><th>Statut</th><th></th></tr></thead><tbody data-testid="sheet-histo">' +
      st.historique.map(function (p) {
        return '<tr><td class="sub">' + dateEditable('payments', p.id, 'due_date', p.due_date) + '</td>' +
          '<td class="money">' + F.money(p.amount) + '</td>' +
          '<td class="sub">' + (p.status === 'paid'
            ? dateEditable('payments', p.id, 'paid_date', p.paid_date)
            : '—') + '</td>' +
          '<td>' + pillPaiement(p.id, C.paymentStatus(p, today())) + '</td>' +
          '<td><button class="btn-mini danger" data-suppr-paiement="' + p.id + '" title="Envoyer ce paiement à la Corbeille">×</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<p class="empty">Aucun paiement pour ce client.</p>';

    return '<div data-fiche-corps>' + stats + histo + '</div>';
  }

  function ouvrirFicheClient(clientId) {
    var c = db().clients.find(function (x) { return x.id === clientId; });
    if (!c) return;
    var m = U.modal(c.name, 'La fiche complète du client — tout se modifie ici aussi.',
      corpsFiche(clientId), { valider: 'Fermer', onSubmit: function (form, close) { close(); } });
    m.root.setAttribute('data-testid', 'client-sheet');
    $('[data-annuler]', m.root).hidden = true;   // une fiche se ferme, elle ne s'annule pas
    ficheOuverte = clientId;
  }

  /* Après un changement fait DEPUIS la fiche (pastille, date, suppression),
     rendreVue() rafraîchit l'écran derrière ; ici on rafraîchit la fiche
     elle-même, en place. Si elle a été fermée entre-temps, on l'oublie. */
  function rafraichirFiche() {
    if (!ficheOuverte) return;
    var backdrop = $('#modal-root [data-testid="client-sheet"]');
    if (!backdrop) { ficheOuverte = null; return; }
    var corps = $('[data-fiche-corps]', backdrop);
    if (corps) corps.outerHTML = corpsFiche(ficheOuverte);
  }

  /* ---- Modale : ajouter un client et/ou une vente ---- */

  function modaleClientVente(clientId) {
    var clientsActifs = db().clients.filter(function (c) { return !c.archived; });
    var typeDefaut = memo('type') || 'abonnement';
    var montantDefaut = memo('montant') || '';
    var html =
      '<label class="field"><span>Client</span>' +
      '<select data-champ="client" data-testid="f-client">' +
      '<option value="">— Nouveau client —</option>' +
      clientsActifs.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === clientId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('') +
      '</select></label>' +

      '<div data-bloc="nouveau"' + (clientId ? ' hidden' : '') + '>' +
      '<label class="field"><span>Nom du nouveau client</span>' +
      '<input type="text" data-champ="nom" data-testid="f-nom" placeholder="Ex. Marc-André T."></label>' +
      '<label class="field"><span>Notes (facultatif)</span>' +
      '<textarea data-champ="notes" data-testid="f-notes"></textarea></label>' +
      '</div>' +

      '<label class="field"><span>Type de vente</span></label>' +
      '<div class="seg" data-seg style="margin:-8px 0 16px">' +
      ['pif', 'versements', 'abonnement'].map(function (t) {
        return '<button type="button" data-type="' + t + '" data-testid="f-type-' + t + '"' +
          (t === typeDefaut ? ' class="active"' : '') + '>' + esc(C.TYPES_VENTE[t]) + '</button>';
      }).join('') +
      '</div>' +

      '<label class="field"><span>Nom du plan (facultatif)</span>' +
      '<input type="text" data-champ="label" data-testid="f-label" placeholder="Ex. Coaching premium"></label>' +

      '<div data-bloc="pif" hidden>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant ($)</span><input type="number" step="0.01" min="0" data-champ="pif-montant" data-testid="f-pif-montant"></label>' +
      '<label class="field"><span>Date du paiement</span><input type="date" data-champ="pif-date" data-testid="f-pif-date"></label>' +
      '</div></div>' +

      '<div data-bloc="versements" hidden>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant TOTAL du plan ($)</span>' +
      '<input type="number" step="0.01" min="0" data-champ="vers-total" data-testid="f-vers-total">' +
      '<span class="aide">Le total du plan, pas le montant par mois : il sera divisé par le nombre de versements.</span></label>' +
      '<label class="field"><span>Nombre de versements</span><input type="number" step="1" min="2" max="36" value="3" data-champ="vers-n" data-testid="f-vers-n"></label>' +
      '</div>' +
      '<label class="field"><span>Date du 1<sup>er</sup> versement</span><input type="date" data-champ="vers-date" data-testid="f-vers-date">' +
      '<span class="aide">Les versements suivants tombent le même jour, chaque mois.</span></label>' +
      '</div>' +

      '<div data-bloc="abonnement" hidden>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant mensuel ($)</span><input type="number" step="0.01" min="0" data-champ="abo-montant" data-testid="f-abo-montant"></label>' +
      '<label class="field"><span>Date de début</span><input type="date" data-champ="abo-debut" data-testid="f-abo-debut"></label>' +
      '</div>' +
      '<label class="field"><span>Date de fin (facultatif)</span><input type="date" data-champ="abo-fin" data-testid="f-abo-fin">' +
      '<span class="aide">Laisse vide si l\'abonnement continue indéfiniment.</span></label>' +
      '</div>' +

      // Aperçu vivant du plan : ce qui sera créé, à mesure que l'utilisateur tape.
      '<div class="apercu" data-apercu data-testid="apercu-vente" hidden></div>' +

      // Aperçu rétroactif : apparaît dès que la date choisie crée des échéances passées.
      '<div class="retro-note" data-retro data-testid="retro-preview" hidden>' +
      '<div data-retro-texte></div>' +
      '<div class="retro-chx">' +
      '<label><input type="radio" name="retro" value="paid" checked data-testid="retro-paye"> déjà payés</label>' +
      '<label><input type="radio" name="retro" value="pending" data-testid="retro-verifier"> à vérifier (ils iront dans À traiter)</label>' +
      '</div></div>';

    var m = U.modal('Ajouter un client / une vente', 'Le paiement attendu est créé automatiquement.', html, {
      valider: 'Enregistrer',
      onSubmit: async function (form, close, erreur) {
        var v = function (n) { var el = form.querySelector('[data-champ="' + n + '"]'); return el ? el.value.trim() : ''; };
        var type = form.querySelector('[data-seg] button.active').dataset.type;
        var cid = v('client');

        if (!cid && !v('nom')) return erreur('Donne un nom au nouveau client.');

        var data = { type: type, label: v('label') || null };
        if (type === 'pif') {
          data.total_amount = Number(v('pif-montant'));
          data.start_date = v('pif-date');
          if (!(data.total_amount > 0)) return erreur('Le montant doit être supérieur à 0.');
          if (!data.start_date) return erreur('Choisis la date du paiement.');
        } else if (type === 'versements') {
          data.total_amount = Number(v('vers-total'));
          data.installments_count = Number(v('vers-n'));
          data.start_date = v('vers-date');
          if (!(data.total_amount > 0)) return erreur('Le montant total doit être supérieur à 0.');
          if (!(data.installments_count >= 2)) return erreur('Il faut au moins 2 versements.');
          if (!data.start_date) return erreur('Choisis la date du 1er versement.');
        } else {
          data.monthly_amount = Number(v('abo-montant'));
          data.start_date = v('abo-debut');
          data.end_date = v('abo-fin') || null;
          if (!(data.monthly_amount > 0)) return erreur('Le montant mensuel doit être supérieur à 0.');
          if (!data.start_date) return erreur('Choisis la date de début.');
          if (data.end_date && C.compareDates(data.end_date, data.start_date) < 0) {
            return erreur('La date de fin doit venir après la date de début.');
          }
        }

        // Garde-fou des doublons : « Ève Conte » et « Eve Conte » ont déjà été
        // créés comme deux clients distincts. On avertit sans bloquer — deux
        // personnes peuvent vraiment porter le même nom.
        if (!cid) {
          var similaires = C.clientsSimilaires(db(), v('nom'));
          if (similaires.length && !form.dataset.doublonAccepte) {
            avertirDoublon(form, similaires[0]);
            return;
          }
        }

        try {
          if (!cid) {
            var c = await D.addClient({ name: v('nom'), notes: v('notes') });
            cid = c.id;
          }
          data.client_id = cid;
          // le choix de l'aperçu rétroactif ne s'applique qu'aux échéances passées
          var retroChoix = form.querySelector('input[name="retro"]:checked');
          await D.addSale(data, { statutPasses: retroChoix ? retroChoix.value : 'paid' });
          memo('type', type);
          memo('montant', String(data.total_amount || data.monthly_amount || ''));
          close();
          U.toast('Vente enregistrée.');
          rendreVue();
        } catch (ex) {
          erreur('Enregistrement impossible : ' + ((ex && ex.message) || 'erreur inconnue'));
        }
      }
    });

    // segmenté : affiche le bon bloc de champs
    var seg = $('[data-seg]', m.root);
    function majBlocs() {
      var t = $('button.active', seg).dataset.type;
      ['pif', 'versements', 'abonnement'].forEach(function (x) {
        $('[data-bloc="' + x + '"]', m.root).hidden = (x !== t);
      });
    }
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      $$('button', seg).forEach(function (x) { x.classList.toggle('active', x === b); });
      majBlocs();
      majApercu();
      majRetro();
    });
    $('[data-champ="client"]', m.root).addEventListener('change', function (e) {
      $('[data-bloc="nouveau"]', m.root).hidden = !!e.target.value;
    });

    /* La vente telle qu'elle serait créée avec ce qui est saisi en ce moment. */
    function venteSaisie() {
      var v = function (n) { var el = m.root.querySelector('[data-champ="' + n + '"]'); return el ? el.value.trim() : ''; };
      var t = $('button.active', seg).dataset.type;
      if (t === 'pif' && v('pif-date')) {
        return { type: 'pif', total_amount: Number(v('pif-montant')) || 0, start_date: v('pif-date') };
      }
      if (t === 'versements' && v('vers-date')) {
        return {
          type: 'versements', total_amount: Number(v('vers-total')) || 0,
          installments_count: Number(v('vers-n')) || 2, start_date: v('vers-date')
        };
      }
      if (t === 'abonnement' && v('abo-debut')) {
        return {
          type: 'abonnement', monthly_amount: Number(v('abo-montant')) || 0,
          start_date: v('abo-debut'), end_date: v('abo-fin') || null
        };
      }
      return null;
    }

    /* Aperçu vivant : dire AVANT d'enregistrer ce que le plan va produire.
       Un associé a saisi 700 en pensant « 700 par mois », a vu 233,33 $ et a
       conclu que le calcul était cassé — l'aperçu répond à ça pendant la frappe. */
    function majApercu() {
      var boite = $('[data-apercu]', m.root);
      var essai = venteSaisie();
      var texte = essai ? C.apercuVente(essai) : '';
      boite.hidden = !texte;
      if (texte) boite.innerHTML = '<b>Ce qui sera créé :</b> ' + esc(texte);
    }

    /* Aperçu rétroactif : si la date de début est passée, on annonce précisément
       les échéances qui seront créées, avec le choix « déjà payés / à vérifier ».
       Pas de case « rétroactif » : la date dit déjà tout. */
    function majRetro() {
      var boite = $('[data-retro]', m.root);
      var essai = venteSaisie();
      if (!essai || C.compareDates(essai.start_date, today()) >= 0) { boite.hidden = true; return; }

      var horizon = C.addMonths(C.monthKey(today()), 3);
      var passes = C.generatePayments(essai, horizon).filter(function (p) {
        return C.compareDates(p.due_date, today()) < 0;
      });
      if (!passes.length) { boite.hidden = true; return; }

      var dates = passes.map(function (p) { return F.dateCourte(p.due_date); });
      var affiche = dates.length > 6 ? dates.slice(0, 6).join(', ') + '…' : dates.join(', ');
      $('[data-retro-texte]', m.root).innerHTML =
        '<b>' + passes.length + ' paiement' + (passes.length > 1 ? 's' : '') + ' passé' + (passes.length > 1 ? 's' : '') +
        (passes.length > 1 ? ' seront créés' : ' sera créé') + '</b> : ' + esc(affiche);
      boite.hidden = false;
    }
    m.root.querySelector('form').addEventListener('input', function () { majApercu(); majRetro(); });

    // valeurs par défaut : aujourd'hui, et le dernier montant saisi
    ['pif-date', 'vers-date', 'abo-debut'].forEach(function (n) {
      $('[data-champ="' + n + '"]', m.root).value = today();
    });
    if (montantDefaut) {
      ['pif-montant', 'vers-total', 'abo-montant'].forEach(function (n) {
        $('[data-champ="' + n + '"]', m.root).value = montantDefaut;
      });
    }
    majBlocs();
    majApercu();
    majRetro();
  }

  /* L'avertissement de doublon s'insère dans le formulaire lui-même, au-dessus
     des boutons : impossible de le manquer, et il laisse les deux issues
     ouvertes — reprendre le client existant, ou créer quand même. */
  function avertirDoublon(form, existant) {
    var ancien = form.querySelector('[data-doublon]');
    if (ancien) ancien.remove();
    var boite = root.document.createElement('div');
    boite.className = 'doublon';
    boite.setAttribute('data-doublon', '');
    boite.setAttribute('data-testid', 'doublon');
    boite.innerHTML = '<b>' + esc(existant.name) + '</b> existe déjà dans tes clients. ' +
      'Est-ce la même personne ?' +
      '<div class="actions">' +
      '<button type="button" class="btn-mini" data-doublon-utiliser data-testid="doublon-utiliser">Oui, utiliser ' + esc(existant.name) + '</button>' +
      '<button type="button" class="btn-mini" data-doublon-forcer data-testid="doublon-forcer">Non, créer quand même</button>' +
      '</div>';
    form.querySelector('.modal-actions').insertAdjacentElement('beforebegin', boite);

    boite.querySelector('[data-doublon-utiliser]').addEventListener('click', function () {
      form.querySelector('[data-champ="client"]').value = existant.id;
      form.querySelector('[data-bloc="nouveau"]').hidden = true;
      boite.remove();
      U.toast('Vente rattachée à ' + existant.name + '.');
    });
    boite.querySelector('[data-doublon-forcer]').addEventListener('click', function () {
      form.dataset.doublonAccepte = '1';
      boite.remove();
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  $('#btn-add-client').addEventListener('click', function () { modaleClientVente(null); });
  $('#btn-add-client-2').addEventListener('click', function () { modaleClientVente(null); });

  doc_on('click', '[data-vente-pour]', function (b) { modaleClientVente(b.dataset.ventePour); });

  doc_on('click', '[data-editer-client]', function (b) {
    var c = db().clients.find(function (x) { return x.id === b.dataset.editerClient; });
    U.modal('Modifier le client', c.name,
      '<label class="field"><span>Nom</span><input type="text" data-champ="nom" value="' + esc(c.name) + '"></label>' +
      '<label class="field"><span>Notes</span><textarea data-champ="notes">' + esc(c.notes || '') + '</textarea></label>',
      {
        onSubmit: async function (form, close, erreur) {
          var nom = form.querySelector('[data-champ="nom"]').value.trim();
          if (!nom) return erreur('Le nom ne peut pas être vide.');
          await D.updateClient(c.id, { name: nom, notes: form.querySelector('[data-champ="notes"]').value.trim() || null });
          close();
          U.toast('Client modifié.');
          rendreVue();
        }
      });
  });

  doc_on('click', '[data-archiver-client]', function (b) {
    var c = db().clients.find(function (x) { return x.id === b.dataset.archiverClient; });
    U.confirmer('Archiver ' + c.name + ' ?',
      'Pour un client qui a quitté. Il sort des listes courantes, mais tout ce qu\'il a payé ' +
      'reste dans l\'historique et continue de compter dans les mois passés. Ses paiements non ' +
      'payés cessent d\'être attendus, et aucun nouveau ne sera généré. Réversible : « Afficher les archivés ».',
      async function () {
        await D.archiveClient(c.id);
        U.toast('Client archivé. Son historique payé reste compté.');
        rendreVue();
      });
  });

  doc_on('click', '[data-archiver-vente]', function (b) {
    U.confirmer('Archiver cette vente ?',
      'Pour un plan terminé ou remplacé. Les paiements déjà encaissés restent comptés dans leur mois ; ' +
      'ses paiements non payés cessent d\'être attendus et n\'apparaissent plus nulle part. ' +
      'Réversible : « Afficher les archivés ».',
      async function () {
        await D.archiveSale(b.dataset.archiverVente);
        U.toast('Vente archivée. Ses échéances impayées ne sont plus comptées.');
        rendreVue();
      });
  });

  /* ---------- Suppression douce : tout passe par la Corbeille ---------- */

  /* Supprimer n'est pas archiver. On annonce les conséquences EXACTES, avec les
     vrais chiffres, avant de toucher à quoi que ce soit — et c'est « Annuler »
     qui garde le focus. */
  function listeMois(mois) {
    if (mois.length > 4) return mois.length + ' mois';
    var memeAnnee = mois.every(function (m) { return m.slice(0, 4) === mois[0].slice(0, 4); });
    var noms = mois.map(function (m) {
      return memeAnnee ? F.moisSeul(m).toLowerCase() : F.moisAnnee(m + '-01');
    });
    if (noms.length === 1) return noms[0];
    return noms.slice(0, -1).join(', ') + ' et ' + noms[noms.length - 1];
  }

  function texteSuppression(table, id, nom) {
    var im = C.impactSuppression(db(), table, id);
    var bouts = [];
    if (im.nbVentes) bouts.push('<b>' + im.nbVentes + ' vente' + (im.nbVentes > 1 ? 's' : '') + '</b>');
    bouts.push('<b>' + im.nbPaiements + ' paiement' + (im.nbPaiements > 1 ? 's' : '') + '</b>');
    var txt = 'Supprimer ' + esc(nom) + ' effacera ' + bouts.join(' et ');
    if (im.montantEncaisse > 0) {
      txt += ', dont <b>' + F.money(im.montantEncaisse) + ' déjà encaissés</b>';
    }
    txt += '.';
    if (im.mois.length) {
      txt += ' Les revenus de ' + esc(listeMois(im.mois)) + ' vont baisser.';
    }
    txt += ' Récupérable 30 jours dans la Corbeille.';
    return txt;
  }

  doc_on('click', '[data-suppr-client]', function (b) {
    var c = db().clients.find(function (x) { return x.id === b.dataset.supprClient; });
    if (!c) return;
    U.confirmerDanger('Supprimer ' + c.name + ' ?',
      texteSuppression('clients', c.id, c.name),
      'Supprimer définitivement',
      async function () {
        await D.supprimer('clients', c.id);
        U.toast('Client envoyé à la Corbeille (restaurable 30 jours).');
        rendreVue();
      });
  });

  doc_on('click', '[data-suppr-vente]', function (b) {
    var v = db().sales.find(function (x) { return x.id === b.dataset.supprVente; });
    if (!v) return;
    U.confirmerDanger('Supprimer cette vente ?',
      texteSuppression('sales', v.id, 'la vente « ' + C.saleLabel(v) + ' » de ' + nomClient(v.client_id)),
      'Supprimer définitivement',
      async function () {
        await D.supprimer('sales', v.id);
        U.toast('Vente envoyée à la Corbeille (restaurable 30 jours).');
        rendreVue();
      });
  });

  doc_on('click', '[data-suppr-paiement]', function (b) {
    U.confirmer('Supprimer ce paiement ?',
      'Il part à la Corbeille et ne compte plus nulle part. Restaurable pendant 30 jours.',
      async function () {
        await D.supprimer('payments', b.dataset.supprPaiement);
        U.toast('Paiement envoyé à la Corbeille.');
        rendreVue();
      });
  });

  doc_on('click', '[data-restaurer-id]', async function (b) {
    await D.restaurer(b.dataset.restaurerTable, b.dataset.restaurerId);
    U.toast('Restauré : tout est revenu comme avant.');
    rendreVue();
  });

  /* ================= Dépenses ================= */

  function rendreDepenses() {
    var m = etat.mois;
    var jours = C.adSpendOfMonth(db(), m).slice()
      .sort(function (a, b) { return C.compareDates(b.day, a.day); });
    var totalAds = C.sum(jours, function (a) { return a.amount; });
    $('#ads-hint').textContent = F.moisLong(m) + ' · ' + F.money(totalAds) + ' au total';

    $('#ads-body').innerHTML = jours.length ? jours.map(function (a) {
      return '<tr><td>' + F.dateCourte(a.day) + '</td>' +
        '<td class="money">' + F.money(a.amount) + '</td>' +
        '<td class="sub">' + esc(D.identite(a.created_by)) + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="btn-mini" data-ads-editer="' + a.day + '" data-montant="' + a.amount + '">Modifier</button>' +
        '<button class="btn-mini danger" data-ads-suppr="' + a.id + '">Supprimer</button>' +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">Aucune dépense ads enregistrée pour ce mois.</td></tr>';
    $('#ads-foot').innerHTML = jours.length
      ? '<tr><td>Total du mois</td><td class="money">' + F.money(totalAds) + '</td><td colspan="2"></td></tr>' : '';

    // valeurs par défaut du formulaire
    var jourDefaut = (C.monthKey(today()) === m) ? today() : C.lastDayOfMonth(m);
    $('#ads-day').value = jourDefaut;
    if (!$('#ads-amount').value) {
      $('#ads-amount').value = memo('ads') || reglages().daily_ad_budget || '';
    }

    // Récurrentes
    var recs = db().recurring_expenses.slice().sort(function (a, b) { return b.amount - a.amount; });
    var moisCourant = C.monthKey(today());
    $('#recur-body').innerHTML = recs.length ? recs.map(function (r) {
      var arretee = r.end_date && C.monthsBetween(moisCourant, C.monthKey(r.end_date)) < 0;
      return '<tr><td>' + esc(r.label) + '<br><span class="sub">' + esc(C.CATEGORIES[r.category] || r.category) +
        ' · depuis ' + F.moisAnnee(r.start_date) +
        (r.end_date ? ' · arrêtée en ' + F.moisAnnee(r.end_date) : '') +
        ' · ajoutée par ' + esc(D.identite(r.created_by)) + '</span></td>' +
        '<td class="money">' + F.money(r.amount) + '</td>' +
        '<td>' + (arretee
          ? '<span class="pill neutre">Arrêtée</span>'
          : '<span class="pill info">Active</span>') + '</td>' +
        '<td><div class="row-actions">' +
        (arretee ? '' : '<button class="btn-mini" data-recur-stop="' + r.id + '">Arrêter</button>') +
        '<button class="btn-mini danger" data-recur-suppr="' + r.id + '">Supprimer</button>' +
        '</div></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">Aucune dépense récurrente.</td></tr>';

    // Ponctuelles du mois affiché
    var po = C.oneOffOfMonth(db(), m).slice()
      .sort(function (a, b) { return C.compareDates(b.date, a.date); });
    $('#ponct-body').innerHTML = po.length ? po.map(function (e) {
      return '<tr><td class="sub">' + dateEditable('one_off_expenses', e.id, 'date', e.date) + '</td>' +
        '<td>' + esc(e.label) + '<br><span class="sub">' + esc(C.CATEGORIES[e.category] || e.category) +
        ' · ajoutée par ' + esc(D.identite(e.created_by)) + '</span></td>' +
        '<td class="money">' + F.money(e.amount) + '</td>' +
        '<td><div class="row-actions"><button class="btn-mini danger" data-ponct-suppr="' + e.id + '">Supprimer</button></div></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">Aucune dépense ponctuelle en ' +
      esc(F.moisLong(m).toLowerCase()) + '.</td></tr>';
  }

  $('#form-ads').addEventListener('submit', async function (e) {
    e.preventDefault();
    var jour = $('#ads-day').value;
    var montant = Number($('#ads-amount').value);
    if (!jour || !(montant >= 0)) { U.toast('Entre un jour et un montant.', true); return; }
    await D.setAdSpend(jour, montant);
    memo('ads', String(montant));
    U.toast('Dépense ads du ' + F.dateCourte(jour) + ' enregistrée.');
    if (C.monthKey(jour) !== etat.mois) etat.mois = C.monthKey(jour);
    rendreMoisPicker();
    rendreVue();
  });

  doc_on('click', '[data-ads-editer]', function (b) {
    $('#ads-day').value = b.dataset.adsEditer;
    $('#ads-amount').value = b.dataset.montant;
    $('#ads-amount').focus();
  });

  doc_on('click', '[data-ads-suppr]', async function (b) {
    await D.deleteAdSpend(b.dataset.adsSuppr);
    U.toast('Dépense envoyée à la Corbeille (restaurable 30 jours).');
    rendreVue();
  });

  function champsCategorie(sel) {
    return '<label class="field"><span>Catégorie</span><select data-champ="categorie" data-testid="f-categorie">' +
      Object.keys(C.CATEGORIES).map(function (k) {
        return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(C.CATEGORIES[k]) + '</option>';
      }).join('') + '</select></label>';
  }

  function modaleRecurrente() {
    var m = U.modal('Ajouter une dépense récurrente', 'Elle sera comptée chaque mois jusqu\'à ce que tu l\'arrêtes.',
      '<label class="field"><span>Libellé</span><input type="text" data-champ="label" data-testid="f-rec-label" placeholder="Ex. GoHighLevel"></label>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant par mois ($)</span><input type="number" step="0.01" min="0" data-champ="montant" data-testid="f-rec-montant"></label>' +
      '<label class="field"><span>Premier mois</span><input type="month" data-champ="mois" data-testid="f-rec-mois" value="' + C.monthKey(today()) + '"></label>' +
      '</div>' + champsCategorie('logiciels') +
      '<div class="retro-note" data-retro-rec data-testid="retro-rec" hidden></div>',
      {
        onSubmit: async function (form, close, erreur) {
          var label = form.querySelector('[data-champ="label"]').value.trim();
          var montant = Number(form.querySelector('[data-champ="montant"]').value);
          var mois = form.querySelector('[data-champ="mois"]').value;
          if (!label) return erreur('Donne un libellé à la dépense.');
          if (!(montant > 0)) return erreur('Le montant doit être supérieur à 0.');
          if (!mois) return erreur('Choisis le premier mois.');
          await D.addRecurring({
            label: label, amount: montant,
            category: form.querySelector('[data-champ="categorie"]').value,
            start_date: mois + '-01'
          });
          close();
          U.toast('Dépense récurrente ajoutée.');
          rendreVue();
        }
      });

    /* Aperçu rétroactif : un premier mois dans le passé veut dire que la dépense
       sera comptée dans des mois déjà écoulés. On l'annonce, sans rien demander :
       une dépense n'a pas de statut, il n'y a pas de décision à prendre. */
    function majRetroRec() {
      var boite = $('[data-retro-rec]', m.root);
      var mois = m.root.querySelector('[data-champ="mois"]').value;
      var mkCourant = C.monthKey(today());
      if (!mois || C.monthsBetween(mois, mkCourant) <= 0) { boite.hidden = true; return; }
      var noms = [];
      for (var mk = mois; C.monthsBetween(mk, mkCourant) > 0 && noms.length < 7; mk = C.addMonths(mk, 1)) {
        noms.push(F.moisSeul(mk).toLowerCase());
      }
      var affiche = noms.length > 6 ? noms.slice(0, 6).join(', ') + '…' : noms.join(', ');
      var n = C.monthsBetween(mois, mkCourant);
      boite.innerHTML = '<b>Cette dépense comptera aussi dans ' + n + ' mois passé' + (n > 1 ? 's' : '') +
        '</b> : ' + esc(affiche) + '. Les totaux de ces mois-là vont changer.';
      boite.hidden = false;
    }
    m.root.querySelector('form').addEventListener('input', majRetroRec);
    majRetroRec();
  }

  /* ---------- Reprendre les dépenses ponctuelles du mois dernier ---------- */

  function modaleCopieDepenses() {
    var mkPrec = C.addMonths(etat.mois, -1);
    var sources = C.oneOffOfMonth(db(), mkPrec)
      .slice().sort(function (a, b) { return C.compareDates(a.date, b.date); });
    if (!sources.length) {
      U.toast('Aucune dépense ponctuelle en ' + F.moisLong(mkPrec).toLowerCase() + ' : rien à reprendre.', true);
      return;
    }
    var html = sources.map(function (e) {
      return '<label class="copie-ligne">' +
        '<input type="checkbox" checked data-copie="' + e.id + '" data-testid="copie-' + e.id + '">' +
        '<span class="quoi">' + esc(e.label) +
        '<br><span class="sub">' + esc(F.dateCourte(C.addMonthsToDate(e.date, 1))) + ' · ' +
        esc(C.CATEGORIES[e.category] || e.category) + '</span></span>' +
        '<span class="combien">' + F.money(e.amount) + '</span></label>';
    }).join('');

    U.modal('Reprendre les dépenses du mois dernier',
      'Voici les dépenses ponctuelles de ' + F.moisLong(mkPrec).toLowerCase() +
      '. Décoche ce qui ne se répète pas, puis confirme : rien n\'est créé avant.',
      html, {
        valider: 'Créer ces dépenses',
        onSubmit: async function (form, close, erreur) {
          var choisies = $$('input[data-copie]:checked', form).map(function (x) { return x.dataset.copie; });
          if (!choisies.length) return erreur('Tout est décoché : il n\'y a rien à créer.');
          for (var i = 0; i < choisies.length; i++) {
            var e = sources.find(function (s) { return s.id === choisies[i]; });
            await D.addOneOff({
              label: e.label, amount: e.amount, category: e.category,
              date: C.addMonthsToDate(e.date, 1)
            });
          }
          close();
          U.toast(choisies.length + ' dépense' + (choisies.length > 1 ? 's' : '') + ' recréée' +
            (choisies.length > 1 ? 's' : '') + ' pour ' + F.moisLong(etat.mois).toLowerCase() + '.');
          rendreVue();
        }
      });
  }

  $('#btn-copier-depenses').addEventListener('click', modaleCopieDepenses);

  function modalePonctuelle() {
    U.modal('Ajouter une dépense ponctuelle', 'Une seule fois, à une date précise.',
      '<label class="field"><span>Libellé</span><input type="text" data-champ="label" data-testid="f-po-label" placeholder="Ex. Shooting photo"></label>' +
      '<div class="form-row">' +
      '<label class="field"><span>Montant ($)</span><input type="number" step="0.01" min="0" data-champ="montant" data-testid="f-po-montant"></label>' +
      '<label class="field"><span>Date</span><input type="date" data-champ="date" data-testid="f-po-date" value="' + today() + '"></label>' +
      '</div>' + champsCategorie('autre'),
      {
        onSubmit: async function (form, close, erreur) {
          var label = form.querySelector('[data-champ="label"]').value.trim();
          var montant = Number(form.querySelector('[data-champ="montant"]').value);
          var date = form.querySelector('[data-champ="date"]').value;
          if (!label) return erreur('Donne un libellé à la dépense.');
          if (!(montant > 0)) return erreur('Le montant doit être supérieur à 0.');
          if (!date) return erreur('Choisis une date.');
          await D.addOneOff({
            label: label, amount: montant, date: date,
            category: form.querySelector('[data-champ="categorie"]').value
          });
          close();
          U.toast('Dépense ponctuelle ajoutée.');
          if (C.monthKey(date) !== etat.mois) { etat.mois = C.monthKey(date); rendreMoisPicker(); }
          rendreVue();
        }
      });
  }

  $('#btn-add-recur').addEventListener('click', modaleRecurrente);
  $('#btn-add-ponct').addEventListener('click', modalePonctuelle);

  /* Depuis le tableau de bord : on demande d'abord quel genre de dépense. */
  $('#btn-add-depense').addEventListener('click', function () {
    var m = U.modal('Ajouter une dépense', 'De quel genre de dépense s\'agit-il ?',
      '<div class="seg" data-genre>' +
      '<button type="button" data-g="ponctuelle" data-testid="g-ponctuelle">Ponctuelle (une fois)</button>' +
      '<button type="button" data-g="recurrente" data-testid="g-recurrente">Récurrente (chaque mois)</button>' +
      '<button type="button" data-g="ads" data-testid="g-ads">Ads du jour</button>' +
      '</div>', { valider: 'Fermer' });
    m.root.querySelector('[data-testid="modal-submit"]').hidden = true;
    $('[data-genre]', m.root).addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      m.close();
      if (b.dataset.g === 'ponctuelle') modalePonctuelle();
      else if (b.dataset.g === 'recurrente') modaleRecurrente();
      else {
        etat.vue = 'depenses';
        $$('#tabs button').forEach(function (x) { x.classList.toggle('active', x.dataset.vue === 'depenses'); });
        rendreVue();
        $('#ads-amount').focus();
      }
    });
  });

  doc_on('click', '[data-recur-stop]', function (b) {
    U.confirmer('Arrêter cette dépense récurrente ?',
      'Elle sera comptée jusqu\'à la fin du mois en cours, puis plus jamais. L\'historique est conservé.',
      async function () {
        await D.stopRecurring(b.dataset.recurStop);
        U.toast('Dépense arrêtée.');
        rendreVue();
      });
  });

  doc_on('click', '[data-recur-suppr]', function (b) {
    U.confirmer('Supprimer cette dépense récurrente ?',
      'Elle ne comptera plus dans AUCUN mois, y compris l\'historique — pour la garder dans l\'historique, choisis plutôt « Arrêter ». Elle part à la Corbeille, restaurable 30 jours.',
      async function () {
        await D.deleteRecurring(b.dataset.recurSuppr);
        U.toast('Dépense envoyée à la Corbeille.');
        rendreVue();
      });
  });

  doc_on('click', '[data-ponct-suppr]', async function (b) {
    await D.deleteOneOff(b.dataset.ponctSuppr);
    U.toast('Dépense envoyée à la Corbeille (restaurable 30 jours).');
    rendreVue();
  });

  /* ================= Réglages ================= */

  function rendreReglages() {
    var s = reglages();
    $('#set-business').value = s.business_name || 'Hybrid Coaching';
    $('#set-name-a').value = s.partner_a_name || 'Steph';
    $('#set-name-b').value = s.partner_b_name || 'Alex';
    $('#set-email-a').value = s.partner_a_email || '';
    $('#set-email-b').value = s.partner_b_email || '';
    $('#set-split').value = s.split_a_pct == null ? 50 : s.split_a_pct;
    $('#set-budget').value = s.daily_ad_budget == null ? 120 : s.daily_ad_budget;
    $('#lab-split-a').textContent = s.partner_a_name || 'Steph';

    // objectif de revenus : la valeur habituelle, et l'exception du mois affiché
    $('#set-goal').value = s.monthly_goal == null ? '' : s.monthly_goal;
    $('#lab-goal-mois').textContent = F.moisLong(etat.mois).toLowerCase();
    var exception = (s.monthly_goal_overrides || {})[etat.mois];
    $('#set-goal-mois').value = exception == null ? '' : exception;

    $('#reglages-info').textContent = D.etat.mode === 'demo'
      ? 'Mode démo : les données sont fictives et vivent uniquement dans cette page. Recharger remet tout à zéro. Pour brancher la vraie base, remplis config.js en suivant GUIDE-INSTALLATION.md.'
      : 'Les données sont dans ta base Supabase. Elles ne sont visibles qu\'après connexion, grâce à la Row Level Security activée sur chaque table.';
    majApercuSplit();
    rendreCorbeille();
  }

  function rendreCorbeille() {
    var items = D.corbeille();
    $('#corbeille').innerHTML = items.length ? items.map(function (it) {
      return '<div class="corbeille-ligne">' +
        '<span class="quoi">' + esc(it.label) + '</span>' +
        '<span class="quand">supprimé ' + esc(F.ilYA(C.dayDiff(String(it.quand).slice(0, 10), today()))) + '</span>' +
        '<button class="btn-mini" data-restaurer-table="' + it.table + '" data-restaurer-id="' + it.row.id + '" ' +
        'data-testid="restaurer-' + it.row.id + '">Restaurer</button></div>';
    }).join('') : '<p class="empty">La corbeille est vide. Tout ce que tu supprimes dans l\'application y reste récupérable pendant 30 jours.</p>';
  }

  function majApercuSplit() {
    var pct = Number($('#set-split').value);
    if (!isFinite(pct)) pct = 50;
    pct = Math.min(100, Math.max(0, pct));
    var a = Math.min(92, Math.max(8, pct));
    $('#prev-a').style.width = a + '%';
    $('#prev-b').style.width = (100 - a) + '%';
    $('#prev-a').textContent = F.pourcentPrecis(pct);
    $('#prev-b').textContent = F.pourcentPrecis(100 - pct);
    $('#lab-split-a').textContent = $('#set-name-a').value || 'Steph';
  }

  $('#set-split').addEventListener('input', majApercuSplit);
  $('#set-name-a').addEventListener('input', majApercuSplit);

  $('#form-reglages').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#reglages-err');
    err.hidden = true;
    var pct = Number($('#set-split').value);
    var budget = Number($('#set-budget').value);
    var objectif = $('#set-goal').value.trim();
    var objectifMois = $('#set-goal-mois').value.trim();
    if (!$('#set-business').value.trim()) { err.textContent = 'Le nom de l\'entreprise ne peut pas être vide.'; err.hidden = false; return; }
    if (!(pct >= 0 && pct <= 100)) { err.textContent = 'La part doit être un nombre entre 0 et 100.'; err.hidden = false; return; }
    if (!(budget >= 0)) { err.textContent = 'Le budget ads journalier doit être un nombre positif.'; err.hidden = false; return; }
    if (objectif !== '' && !(Number(objectif) > 0)) { err.textContent = 'L\'objectif de revenus doit être un montant supérieur à 0 (ou vide).'; err.hidden = false; return; }
    if (objectifMois !== '' && !(Number(objectifMois) > 0)) { err.textContent = 'L\'objectif du mois doit être un montant supérieur à 0 (ou vide).'; err.hidden = false; return; }

    // l'exception vaut pour le mois affiché ; vide = on retire l'exception
    var exceptions = Object.assign({}, reglages().monthly_goal_overrides || {});
    if (objectifMois === '') delete exceptions[etat.mois];
    else exceptions[etat.mois] = Number(objectifMois);

    await D.saveSettings({
      business_name: $('#set-business').value.trim(),
      partner_a_name: $('#set-name-a').value.trim() || 'Steph',
      partner_b_name: $('#set-name-b').value.trim() || 'Alex',
      partner_a_email: $('#set-email-a').value.trim().toLowerCase() || null,
      partner_b_email: $('#set-email-b').value.trim().toLowerCase() || null,
      split_a_pct: pct,
      daily_ad_budget: budget,
      monthly_goal: objectif === '' ? null : Number(objectif),
      monthly_goal_overrides: exceptions
    });
    etat.simBudget = budget;   // le curseur suit le nouveau budget par défaut, sans rechargement
    U.toast('Réglages enregistrés.');
    rendreTout();
  });

  /* ---------- Mon compte : changer son propre mot de passe ---------- */

  $('#form-compte').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#compte-err'), ok = $('#compte-ok');
    err.hidden = true;
    ok.hidden = true;
    var actuel = $('#cpt-actuel').value;
    var nouveau = $('#cpt-nouveau').value;
    var confirme = $('#cpt-confirme').value;
    if (nouveau.length < 6) { err.textContent = 'Le nouveau mot de passe doit faire au moins 6 caractères.'; err.hidden = false; return; }
    if (nouveau !== confirme) { err.textContent = 'La confirmation ne correspond pas au nouveau mot de passe. Retape les deux champs.'; err.hidden = false; return; }

    var btn = $('#btn-cpt');
    btn.disabled = true;
    btn.textContent = 'Changement…';
    try {
      await D.changePassword(actuel, nouveau);
      ok.textContent = 'C\'est fait : ton mot de passe est changé. Utilise le nouveau dès ta prochaine connexion.';
      ok.hidden = false;
      $('#cpt-actuel').value = '';
      $('#cpt-nouveau').value = '';
      $('#cpt-confirme').value = '';
    } catch (ex) {
      err.innerHTML = messageCompte(ex);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Changer mon mot de passe';
    }
  });

  function messageCompte(ex) {
    switch (ex && ex.code) {
      case 'mauvais_mdp':
        return 'Le mot de passe <b>actuel</b> n\'est pas le bon. Attention à la majuscule automatique du téléphone et aux espaces en trop.';
      case 'meme_mdp':
        return 'Le nouveau mot de passe doit être <b>différent</b> de l\'actuel.';
      case 'mdp_faible':
        return 'Ce mot de passe est refusé par Supabase (trop court ou trop simple). Choisis-en un plus long.';
      case 'reseau':
        return 'Impossible de joindre Supabase. Vérifie ta connexion Internet et réessaie.';
      default:
        return 'Le changement a échoué. ' + esc((ex && ex.message) || '');
    }
  }

  /* ================= Export CSV ================= */

  function exporterMois() {
    var nom = 'hybrid-finance-' + etat.mois + '.csv';
    U.telechargerCSV(nom, C.csvMonth(db(), etat.mois, today()));
    U.toast('Export du mois téléchargé.');
  }
  function exporterAnnee() {
    var annee = etat.mois.slice(0, 4);
    U.telechargerCSV('hybrid-finance-' + annee + '.csv', C.csvYear(db(), annee, today()));
    U.toast('Export de l\'année téléchargé.');
  }
  $('#btn-export-mois').addEventListener('click', exporterMois);
  $('#btn-export-annee').addEventListener('click', exporterAnnee);
  $('#btn-export-mois-2').addEventListener('click', exporterMois);
  $('#btn-export-annee-2').addEventListener('click', exporterAnnee);

  /* ================= Utilitaire : délégation d'événements ================= */

  function doc_on(type, selecteur, handler) {
    root.document.addEventListener(type, function (e) {
      var cible = e.target.closest(selecteur);
      if (cible) handler(cible, e);
    });
  }

  demarrer();
})(typeof globalThis !== 'undefined' ? globalThis : this);
