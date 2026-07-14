/* Hybrid Finance — backend MODE DÉMO : tout est en mémoire.
   Sert aussi de backend aux tests. Aucune donnée n'est sauvegardée :
   recharger la page remet les données fictives à zéro. C'est voulu. */
(function (root) {
  'use strict';

  var CLE_SESSION = 'hf_demo_session';

  function creer(dbInitiale) {
    var db = null;
    var compteurs = {};

    function nextId(table) {
      compteurs[table] = (compteurs[table] || 0) + 1;
      return 'demo-' + table + '-' + compteurs[table];
    }

    function amorcer() {
      if (db) return db;
      db = dbInitiale || root.HF.demoData.build();
      // les compteurs démarrent après les identifiants déjà présents
      Object.keys(db).forEach(function (t) {
        if (Array.isArray(db[t])) compteurs[t] = db[t].length + 100;
      });
      return db;
    }

    function lireSession() {
      try {
        var v = root.localStorage && root.localStorage.getItem(CLE_SESSION);
        return v ? JSON.parse(v) : null;
      } catch (e) { return null; }
    }

    /* Le backend garde SA base ; la couche de données garde SA copie de travail.
       Sans cette séparation, les deux poussent la même ligne dans le même tableau
       et chaque création apparaît en double. C'est aussi ce que fait Supabase :
       le serveur a ses lignes, le navigateur en a une copie. */
    function copie(row) { return Object.assign({}, row); }
    function copieProfonde(o) { return JSON.parse(JSON.stringify(o)); }

    return {
      name: 'demo',

      signIn: function (email, password) {
        if (!email || !password) {
          var err = new Error('Entre un courriel et un mot de passe.');
          err.code = 'champs_vides';
          return Promise.reject(err);
        }
        var user = { email: String(email).trim().toLowerCase() };
        try { root.localStorage.setItem(CLE_SESSION, JSON.stringify(user)); } catch (e) { /* mode privé */ }
        return Promise.resolve(user);
      },

      signOut: function () {
        try { root.localStorage.removeItem(CLE_SESSION); } catch (e) { /* ignore */ }
        return Promise.resolve();
      },

      getSession: function () { return Promise.resolve(lireSession()); },

      check: function () { return Promise.resolve({ ok: true, problems: [] }); },

      checkReglages: function () { return Promise.resolve({ ok: true, problems: [] }); },

      fetchAll: function () { return Promise.resolve(copieProfonde(amorcer())); },

      insert: function (table, row) {
        amorcer();
        var ligne = Object.assign({}, row, { id: row.id || nextId(table) });
        db[table].push(ligne);
        return Promise.resolve(copie(ligne));
      },

      insertMany: function (table, rows) {
        amorcer();
        var out = rows.map(function (r) {
          var ligne = Object.assign({}, r, { id: r.id || nextId(table) });
          db[table].push(ligne);
          return copie(ligne);
        });
        return Promise.resolve(out);
      },

      update: function (table, id, patch) {
        amorcer();
        var row = db[table].find(function (r) { return r.id === id; });
        if (row) Object.assign(row, patch);
        return Promise.resolve(row ? copie(row) : null);
      },

      remove: function (table, id) {
        amorcer();
        db[table] = db[table].filter(function (r) { return r.id !== id; });
        return Promise.resolve();
      },

      upsertAdSpend: function (row) {
        amorcer();
        var exist = db.ad_spend.find(function (a) { return a.day === row.day; });
        if (exist) {
          exist.amount = row.amount;
          exist.created_by = row.created_by;
          return Promise.resolve(copie(exist));
        }
        return this.insert('ad_spend', row);
      },

      saveSettings: function (patch) {
        amorcer();
        Object.assign(db.settings, patch);
        return Promise.resolve(copie(db.settings));
      }
    };
  }

  var api = { creer: creer, CLE_SESSION: CLE_SESSION };
  root.HF = root.HF || {};
  root.HF.backendDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
