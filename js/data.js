/* Hybrid Finance — couche de données.
   Choisit le backend (démo ou Supabase), garde la base en mémoire,
   et expose les opérations métier utilisées par l'interface. */
(function (root) {
  'use strict';

  var C = (typeof require !== 'undefined' && typeof module !== 'undefined')
    ? require('./calc.js') : root.HF.calc;

  var etat = {
    mode: 'demo',       // 'demo' ou 'supabase'
    backend: null,
    db: null,
    user: null,         // { email }
    erreurDemarrage: null
  };

  function config() {
    var c = root.HF_CONFIG || {};
    return {
      url: String(c.SUPABASE_URL || '').trim(),
      key: String(c.SUPABASE_ANON_KEY || '').trim()
    };
  }

  function estConfigure() {
    var c = config();
    return !!(c.url && c.key);
  }

  /* Décode la charge utile d'un jeton JWT (les anciennes clés « anon » en sont).
     Renvoie null si ce n'est pas décodable : on ne fait aucune supposition. */
  function charge(jwt) {
    try {
      var p = String(jwt).split('.')[1];
      if (!p) return null;
      var b64 = p.replace(/-/g, '+').replace(/_/g, '/');
      var txt = (typeof atob === 'function')
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(txt);
    } catch (e) { return null; }
  }

  /* Supabase a renommé sa clé publique. Les DEUX formes sont valides et
     publiables sans danger :
       - la nouvelle : sb_publishable_...
       - l'ancienne  : eyJ... (appelée « anon »)
     Ce qu'il ne faut JAMAIS mettre ici, c'est la clé secrète (sb_secret_...,
     autrefois service_role) : elle contourne la Row Level Security. */
  function validerCle(cle) {
    if (/^sb_secret_/i.test(cle)) {
      return {
        ok: false, problem: {
          what: 'C\'est la clé SECRÈTE qui est dans config.js. Danger.',
          fix: 'Une clé qui commence par <b>sb_secret_</b> donne un accès total à tes données et <b>ne doit jamais être publiée</b>. Remplace-la par la clé <b>publiable</b> (elle commence par <b>sb_publishable_</b>), dans Supabase → Project Settings → API Keys. Si tu l\'as déjà envoyée sur GitHub, révoque-la dans Supabase.'
        }
      };
    }
    var p = charge(cle);
    if (p && p.role === 'service_role') {
      return {
        ok: false, problem: {
          what: 'C\'est la clé « service_role » qui est dans config.js. Danger.',
          fix: 'Cette clé donne un accès total à tes données et <b>ne doit jamais être publiée</b>. Remplace-la par la clé publique (<b>sb_publishable_…</b> ou l\'ancienne <b>anon</b>), dans Supabase → Project Settings → API Keys. Si tu l\'as déjà envoyée sur GitHub, révoque-la dans Supabase.'
        }
      };
    }
    if (/^sb_publishable_/i.test(cle) || /^eyJ/.test(cle)) return { ok: true };
    return {
      ok: false, problem: {
        what: 'La clé dans config.js ne ressemble pas à une clé Supabase.',
        fix: 'Elle doit commencer par <b>sb_publishable_</b> (clé publiable, la forme actuelle) ou par <b>eyJ</b> (ancienne clé « anon »). Recopie-la en entier depuis Supabase → Project Settings → API Keys. Voir la <b>PARTIE B</b> du guide.'
      }
    };
  }

  /* Démarrage : crée le backend et vérifie le branchement. */
  async function init() {
    if (!estConfigure()) {
      etat.mode = 'demo';
      etat.backend = root.HF.backendDemo.creer();
      return { ok: true, mode: 'demo' };
    }

    etat.mode = 'supabase';
    var c = config();
    try {
      etat.backend = root.HF.backendSupabase.creer(c.url, c.key);
    } catch (e) {
      return {
        ok: false, mode: 'supabase', problems: [{
          what: 'La bibliothèque Supabase n\'a pas pu être chargée.',
          fix: 'Vérifie ta connexion Internet, puis recharge la page. Si tu ouvres le fichier index.html par double-clic, essaie plutôt l\'adresse de ton site GitHub Pages.'
        }], technical: String(e && e.message || e)
      };
    }

    if (!/^https:\/\/.+\.supabase\.(co|in)$/i.test(c.url)) {
      return {
        ok: false, mode: 'supabase', problems: [{
          what: 'L\'adresse du projet Supabase ne ressemble pas à une adresse valide.',
          fix: 'Dans <b>config.js</b>, SUPABASE_URL doit ressembler à <b>https://abcdefghijklm.supabase.co</b>, sans barre oblique à la fin. Refais la <b>PARTIE B</b> du guide.'
        }], technical: 'SUPABASE_URL = ' + c.url
      };
    }

    var k = validerCle(c.key);
    if (!k.ok) {
      return { ok: false, mode: 'supabase', problems: [k.problem], technical: 'clé de ' + c.key.length + ' caractères' };
    }

    var v = await etat.backend.check();
    return { ok: v.ok, mode: 'supabase', problems: v.problems, technical: v.technical };
  }

  /* Vérification faite une fois la personne connectée : c'est seulement à ce
     moment-là que la Row Level Security laisse voir les lignes, donc c'est le
     seul moment où « la table settings est vide » veut dire quelque chose. */
  async function verifierApresConnexion() {
    if (etat.mode !== 'supabase') return { ok: true, problems: [] };
    var v = await etat.backend.checkReglages();
    return { ok: v.ok, mode: 'supabase', problems: v.problems, technical: v.technical };
  }

  async function session() {
    etat.user = await etat.backend.getSession();
    return etat.user;
  }

  async function signIn(email, password) {
    etat.user = await etat.backend.signIn(email, password);
    return etat.user;
  }

  async function signOut() {
    await etat.backend.signOut();
    etat.user = null;
  }

  function courriel() { return (etat.user && etat.user.email) || ''; }

  /* Nom d'affichage associé à une adresse courriel (« Ajouté par Alex »). */
  function identite(email) {
    var s = (etat.db && etat.db.settings) || {};
    var e = String(email || '').trim().toLowerCase();
    if (!e) return '—';
    if (s.partner_a_email && s.partner_a_email.toLowerCase() === e) return s.partner_a_name || 'Steph';
    if (s.partner_b_email && s.partner_b_email.toLowerCase() === e) return s.partner_b_name || 'Alex';
    return email;
  }

  /* Charge toute la base et complète les échéanciers d'abonnement. */
  async function load() {
    etat.db = await etat.backend.fetchAll();
    ['clients', 'sales', 'payments', 'ad_spend', 'recurring_expenses', 'one_off_expenses']
      .forEach(function (t) { if (!etat.db[t]) etat.db[t] = []; });
    if (!etat.db.settings) etat.db.settings = { split_a_pct: 50, daily_ad_budget: 120 };
    await ensurePayments(C.addMonths(C.monthKey(C.todayISO()), 3));
    return etat.db;
  }

  /* Génère les paiements d'abonnement manquants jusqu'au mois horizon. */
  async function ensurePayments(horizonMonth) {
    var db = etat.db;
    var aCreer = [];
    db.sales.filter(function (s) { return s.type === 'abonnement' && !s.archived; })
      .forEach(function (s) {
        var existants = {};
        db.payments.forEach(function (p) { if (p.sale_id === s.id) existants[p.due_date] = true; });
        C.generatePayments(s, horizonMonth).forEach(function (p) {
          if (!existants[p.due_date]) {
            aCreer.push({
              sale_id: s.id, client_id: s.client_id, due_date: p.due_date,
              amount: p.amount, status: 'pending', paid_date: null,
              created_by: s.created_by || courriel()
            });
          }
        });
      });
    if (!aCreer.length) return 0;
    var crees = await etat.backend.insertMany('payments', aCreer);
    db.payments = db.payments.concat(crees);
    return crees.length;
  }

  /* ---------- Clients et ventes ---------- */

  async function addClient(data) {
    var row = await etat.backend.insert('clients', {
      name: data.name, notes: data.notes || null, archived: false, created_by: courriel()
    });
    etat.db.clients.push(row);
    return row;
  }

  async function updateClient(id, patch) {
    var row = await etat.backend.update('clients', id, patch);
    var i = etat.db.clients.findIndex(function (c) { return c.id === id; });
    if (i >= 0) etat.db.clients[i] = row;
    return row;
  }

  async function archiveClient(id) {
    await updateClient(id, { archived: true });
    // les ventes du client sont archivées avec lui, et leurs paiements futurs non payés disparaissent
    var ventes = etat.db.sales.filter(function (s) { return s.client_id === id && !s.archived; });
    for (var i = 0; i < ventes.length; i++) await archiveSale(ventes[i].id);
  }

  async function addSale(data) {
    var row = await etat.backend.insert('sales', {
      client_id: data.client_id,
      type: data.type,
      label: data.label || null,
      total_amount: data.type === 'abonnement' ? null : Number(data.total_amount),
      monthly_amount: data.type === 'abonnement' ? Number(data.monthly_amount) : null,
      installments_count: data.type === 'versements' ? Number(data.installments_count) : null,
      start_date: data.start_date,
      end_date: data.end_date || null,
      archived: false,
      created_by: courriel()
    });
    etat.db.sales.push(row);

    var horizon = C.addMonths(C.monthKey(C.todayISO()), 3);
    var lignes = C.generatePayments(row, horizon).map(function (p) {
      return {
        sale_id: row.id, client_id: row.client_id, due_date: p.due_date,
        amount: p.amount, status: 'pending', paid_date: null, created_by: courriel()
      };
    });
    var crees = await etat.backend.insertMany('payments', lignes);
    etat.db.payments = etat.db.payments.concat(crees);
    return row;
  }

  /* Archiver une vente : on la retire de la vue et on supprime ses paiements
     non payés à venir. L'historique déjà encaissé est conservé. */
  async function archiveSale(id) {
    var today = C.todayISO();
    await etat.backend.update('sales', id, { archived: true });
    var vente = etat.db.sales.find(function (s) { return s.id === id; });
    if (vente) vente.archived = true;

    var aSupprimer = etat.db.payments.filter(function (p) {
      return p.sale_id === id && p.status !== 'paid' && C.compareDates(p.due_date, today) > 0;
    });
    for (var i = 0; i < aSupprimer.length; i++) {
      await etat.backend.remove('payments', aSupprimer[i].id);
    }
    var ids = {};
    aSupprimer.forEach(function (p) { ids[p.id] = true; });
    etat.db.payments = etat.db.payments.filter(function (p) { return !ids[p.id]; });
  }

  /* Bascule payé / en attente en un clic. */
  async function togglePayment(id) {
    var p = etat.db.payments.find(function (x) { return x.id === id; });
    if (!p) return null;
    var paye = p.status === 'paid';
    var patch = paye
      ? { status: 'pending', paid_date: null }
      : { status: 'paid', paid_date: C.todayISO() };
    var row = await etat.backend.update('payments', id, patch);
    Object.assign(p, row || patch);
    return p;
  }

  /* ---------- Dépenses ---------- */

  async function setAdSpend(day, amount) {
    var row = await etat.backend.upsertAdSpend({
      day: day, amount: Number(amount), created_by: courriel()
    });
    var i = etat.db.ad_spend.findIndex(function (a) { return a.day === day; });
    if (i >= 0) etat.db.ad_spend[i] = row; else etat.db.ad_spend.push(row);
    return row;
  }

  async function deleteAdSpend(id) {
    await etat.backend.remove('ad_spend', id);
    etat.db.ad_spend = etat.db.ad_spend.filter(function (a) { return a.id !== id; });
  }

  async function addRecurring(data) {
    var row = await etat.backend.insert('recurring_expenses', {
      label: data.label, amount: Number(data.amount), category: data.category,
      start_date: data.start_date, end_date: data.end_date || null, created_by: courriel()
    });
    etat.db.recurring_expenses.push(row);
    return row;
  }

  async function updateRecurring(id, patch) {
    var row = await etat.backend.update('recurring_expenses', id, patch);
    var i = etat.db.recurring_expenses.findIndex(function (r) { return r.id === id; });
    if (i >= 0) etat.db.recurring_expenses[i] = row;
    return row;
  }

  /* Arrêter une dépense récurrente = lui donner une date de fin (fin du mois en cours). */
  async function stopRecurring(id) {
    var fin = C.lastDayOfMonth(C.monthKey(C.todayISO()));
    return updateRecurring(id, { end_date: fin });
  }

  async function deleteRecurring(id) {
    await etat.backend.remove('recurring_expenses', id);
    etat.db.recurring_expenses = etat.db.recurring_expenses.filter(function (r) { return r.id !== id; });
  }

  async function addOneOff(data) {
    var row = await etat.backend.insert('one_off_expenses', {
      label: data.label, amount: Number(data.amount),
      category: data.category, date: data.date, created_by: courriel()
    });
    etat.db.one_off_expenses.push(row);
    return row;
  }

  async function deleteOneOff(id) {
    await etat.backend.remove('one_off_expenses', id);
    etat.db.one_off_expenses = etat.db.one_off_expenses.filter(function (e) { return e.id !== id; });
  }

  /* ---------- Réglages ---------- */

  async function saveSettings(patch) {
    var row = await etat.backend.saveSettings(patch);
    Object.assign(etat.db.settings, row || patch);
    return etat.db.settings;
  }

  root.HF = root.HF || {};
  root.HF.data = {
    etat: etat,
    estConfigure: estConfigure,
    validerCle: validerCle,
    init: init,
    verifierApresConnexion: verifierApresConnexion,
    session: session,
    signIn: signIn,
    signOut: signOut,
    courriel: courriel,
    identite: identite,
    load: load,
    ensurePayments: ensurePayments,
    addClient: addClient,
    updateClient: updateClient,
    archiveClient: archiveClient,
    addSale: addSale,
    archiveSale: archiveSale,
    togglePayment: togglePayment,
    setAdSpend: setAdSpend,
    deleteAdSpend: deleteAdSpend,
    addRecurring: addRecurring,
    updateRecurring: updateRecurring,
    stopRecurring: stopRecurring,
    deleteRecurring: deleteRecurring,
    addOneOff: addOneOff,
    deleteOneOff: deleteOneOff,
    saveSettings: saveSettings,
    get db() { return etat.db; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HF.data;
})(typeof globalThis !== 'undefined' ? globalThis : this);
