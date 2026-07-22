/* Hybrid Finance — backend SUPABASE (le vrai).
   Même interface que le backend démo : signIn / getSession / check / fetchAll /
   insert / update / remove / upsertAdSpend / saveSettings. */
(function (root) {
  'use strict';

  var TABLES = ['settings', 'clients', 'sales', 'payments', 'ad_spend',
    'recurring_expenses', 'one_off_expenses'];

  var PAGE = 1000;   // Supabase renvoie au maximum 1000 lignes par requête

  function creer(url, key) {
    if (!root.supabase || !root.supabase.createClient) {
      throw new Error('bibliotheque_absente');
    }
    var sb = root.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    /* Traduit une erreur de requête en cause compréhensible. */
    function classer(err) {
      var msg = String((err && err.message) || err || '');
      var code = String((err && err.code) || '');
      if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return 'reseau';
      if (code === 'PGRST205' || code === '42P01' ||
        /schema cache|does not exist|not find the table/i.test(msg)) return 'table_absente';
      if (/api key|jwt|invalid authentication|unauthorized/i.test(msg) ||
        code === '401' || code === 'PGRST301') return 'cle_invalide';
      return 'inconnu';
    }

    async function pageComplete(table) {
      var out = [], from = 0;
      while (true) {
        var res = await sb.from(table).select('*').range(from, from + PAGE - 1);
        if (res.error) throw res.error;
        out = out.concat(res.data || []);
        if (!res.data || res.data.length < PAGE) break;
        from += PAGE;
      }
      return out;
    }

    return {
      name: 'supabase',
      client: sb,

      async signIn(email, password) {
        var res;
        try {
          res = await sb.auth.signInWithPassword({
            email: String(email || '').trim(), password: password || ''
          });
        } catch (e) {
          var er = new Error('reseau'); er.code = 'reseau'; throw er;
        }
        if (res.error) {
          var m = String(res.error.message || '');
          var err = new Error(m);
          if (/invalid login credentials/i.test(m)) err.code = 'identifiants';
          else if (/email not confirmed/i.test(m)) err.code = 'non_confirme';
          else if (/logins are disabled|signups not allowed|provider is not enabled/i.test(m)) err.code = 'login_desactive';
          else if (/failed to fetch|network/i.test(m)) err.code = 'reseau';
          else err.code = 'inconnu';
          throw err;
        }
        return { email: res.data.user.email };
      },

      async signOut() { await sb.auth.signOut(); },

      async getSession() {
        var res = await sb.auth.getSession();
        var s = res.data && res.data.session;
        return s && s.user ? { email: s.user.email } : null;
      },

      /* Vérification de branchement, exécutée au chargement quand config.js est rempli.
         ATTENTION — elle tourne AVANT la connexion, donc en visiteur anonyme.
         La Row Level Security cache alors TOUTES les lignes : chaque table répond
         « 200 [] ». Un résultat vide n'est donc PAS un problème, c'est au contraire
         la preuve que la sécurité fonctionne. On ne vérifie ici que ce qui est
         observable sans être connecté : joindre le projet, la clé, l'existence des
         tables (détectée par le CODE D'ERREUR, jamais par un résultat vide).
         La présence de la ligne de réglages, elle, se vérifie après la connexion,
         dans checkReglages(). */
      async check() {
        var problems = [];
        var technical = '';

        // 1) Joindre Supabase et lire la table settings
        try {
          var sonde = await sb.from('settings').select('id').limit(1);
          if (sonde.error) {
            var cause = classer(sonde.error);
            technical = sonde.error.message || '';
            if (cause === 'reseau') {
              problems.push({
                what: 'Impossible de joindre Supabase.',
                fix: 'Cause la plus fréquente : <b>ton projet Supabase est en pause</b> (le plan gratuit le met en veille après environ une semaine sans activité). Va sur supabase.com, ouvre le projet et clique <b>« Restore »</b>, attends une minute, puis recharge cette page. Si le projet est bien actif, c\'est que l\'adresse (SUPABASE_URL) dans <b>config.js</b> est erronée : refais la <b>PARTIE B</b> du guide.'
              });
              return { ok: false, problems: problems, technical: technical };
            }
            if (cause === 'cle_invalide') {
              problems.push({
                what: 'La clé de connexion est refusée par Supabase.',
                fix: 'La clé publique (SUPABASE_ANON_KEY) dans <b>config.js</b> est incomplète ou provient d\'un autre projet. Recopie-la en entier depuis Supabase → Project Settings → API Keys : c\'est la clé <b>Publishable key</b> (elle commence par <b>sb_publishable_</b>), ou l\'ancienne clé <b>anon public</b> (elle commence par <b>eyJ</b>) si ton projet l\'affiche encore. Voir la <b>PARTIE B</b> du guide.'
              });
              return { ok: false, problems: problems, technical: technical };
            }
            if (cause === 'table_absente') {
              problems.push({
                what: 'Les tables de la base de données n\'existent pas encore.',
                fix: 'Le fichier <b>supabase/schema.sql</b> n\'a pas encore été exécuté. Refais la section <b>« Installer les tables (le fichier schema.sql) »</b> de la PARTIE A du guide : Supabase → SQL Editor → New query → colle tout le contenu de schema.sql → Run.'
              });
              return { ok: false, problems: problems, technical: technical };
            }
            problems.push({
              what: 'Supabase a répondu une erreur inattendue.',
              fix: 'Vérifie que les deux valeurs de <b>config.js</b> viennent bien du même projet Supabase, et que <b>schema.sql</b> a été exécuté sans erreur (<b>PARTIES A et B</b> du guide).'
            });
            return { ok: false, problems: problems, technical: technical };
          }

          // 2) Toutes les tables existent-elles ?
          //    Une table absente se reconnaît à son CODE D'ERREUR (PGRST205 / 42P01).
          //    Surtout pas à un résultat vide : anonyme, tout est vide.
          var manquantes = [];
          for (var i = 0; i < TABLES.length; i++) {
            var r = await sb.from(TABLES[i]).select('id').limit(1);
            if (r.error && classer(r.error) === 'table_absente') manquantes.push(TABLES[i]);
          }
          if (manquantes.length) {
            problems.push({
              what: 'Il manque des tables : ' + manquantes.join(', ') + '.',
              fix: 'Le fichier <b>supabase/schema.sql</b> n\'a pas été exécuté en entier. Refais la section <b>« Installer les tables (le fichier schema.sql) »</b> de la PARTIE A du guide : recopie TOUT le fichier dans le SQL Editor, puis clique Run.'
            });
          }
        } catch (e) {
          technical = String(e && e.message || e);
          problems.push({
            what: 'Impossible de joindre Supabase.',
            fix: 'Vérifie ta connexion Internet, puis les deux valeurs de <b>config.js</b> (<b>PARTIE B</b> du guide).'
          });
        }

        return { ok: problems.length === 0, problems: problems, technical: technical };
      },

      /* Vérification faite APRÈS la connexion. Là, l'utilisateur est authentifié :
         la Row Level Security le laisse voir les lignes. Si la table settings est
         TOUJOURS vide à ce moment-là, c'est que la ligne manque vraiment.
         On demande aussi la colonne monthly_goal : elle n'existe que depuis la
         version 2. Si la base répond « colonne inconnue », c'est que le fichier
         supabase/migration-v2.sql n'a pas encore été exécuté. */
      async checkReglages() {
        var res;
        try {
          res = await sb.from('settings').select('id, monthly_goal').limit(1);
        } catch (e) {
          return {
            ok: false, technical: String(e && e.message || e), problems: [{
              what: 'Impossible de joindre Supabase.',
              fix: 'Vérifie ta connexion Internet, puis recharge la page.'
            }]
          };
        }
        if (res.error) {
          var codeCol = String(res.error.code || '');
          var msgCol = String(res.error.message || '');
          if (codeCol === '42703' || /monthly_goal/.test(msgCol)) {
            return {
              ok: false, technical: msgCol, problems: [{
                what: 'La base de données n\'est pas encore à jour pour la version 2.',
                fix: 'Exécute le fichier <b>supabase/migration-v2.sql</b> dans le SQL Editor de Supabase, en suivant la section <b>« Mettre la base de données à jour »</b> du guide <b>MISE-A-JOUR-V2.md</b>. Il ajoute seulement des colonnes : tes données ne bougent pas.'
              }]
            };
          }
          return {
            ok: false, technical: res.error.message || '', problems: [{
              what: 'Supabase a répondu une erreur inattendue.',
              fix: 'Vérifie que <b>supabase/schema.sql</b> a été exécuté sans erreur (<b>PARTIE A</b> du guide).'
            }]
          };
        }
        if (!res.data || !res.data.length) {
          return {
            ok: false, technical: 'settings: 0 ligne pour un utilisateur connecté', problems: [{
              what: 'La ligne de réglages par défaut est absente.',
              fix: 'Ré-exécute <b>supabase/schema.sql</b> en entier (section <b>« Installer les tables (le fichier schema.sql) »</b> de la PARTIE A du guide). Le fichier peut être exécuté deux fois sans danger.'
            }]
          };
        }
        return { ok: true, problems: [], technical: '' };
      },

      async fetchAll() {
        var noms = TABLES.slice(1);   // settings à part (une seule ligne)
        var res = await Promise.all(noms.map(pageComplete));
        var reg = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
        if (reg.error) throw reg.error;
        var db = { settings: reg.data };
        noms.forEach(function (n, i) { db[n] = res[i]; });
        return db;
      },

      async insert(table, row) {
        var res = await sb.from(table).insert(row).select().single();
        if (res.error) throw res.error;
        return res.data;
      },

      async insertMany(table, rows) {
        if (!rows.length) return [];
        var res = await sb.from(table).insert(rows).select();
        if (res.error) throw res.error;
        return res.data;
      },

      async update(table, id, patch) {
        var res = await sb.from(table).update(patch).eq('id', id).select().single();
        if (res.error) throw res.error;
        return res.data;
      },

      async remove(table, id) {
        var res = await sb.from(table).delete().eq('id', id);
        if (res.error) throw res.error;
      },

      async upsertAdSpend(row) {
        var res = await sb.from('ad_spend').upsert(row, { onConflict: 'day' }).select().single();
        if (res.error) throw res.error;
        return res.data;
      },

      async saveSettings(patch) {
        var res = await sb.from('settings').update(patch).eq('id', 1).select().single();
        if (res.error) throw res.error;
        return res.data;
      },

      /* Changement du mot de passe de la personne connectée (écran « Mon compte »).
         On re-vérifie d'abord le mot de passe ACTUEL par une vraie connexion :
         sans ça, n'importe qui devant un ordinateur resté ouvert pourrait changer
         le mot de passe sans le connaître. */
      async changePassword(email, actuel, nouveau) {
        var res;
        try {
          res = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: actuel || '' });
        } catch (e) {
          var er = new Error('reseau'); er.code = 'reseau'; throw er;
        }
        if (res.error) {
          var err = new Error(String(res.error.message || ''));
          err.code = /invalid login credentials/i.test(err.message) ? 'mauvais_mdp' : 'inconnu';
          throw err;
        }
        var up = await sb.auth.updateUser({ password: nouveau });
        if (up.error) {
          var e2 = new Error(String(up.error.message || ''));
          if (/different from the old/i.test(e2.message) || /should be different/i.test(e2.message)) e2.code = 'meme_mdp';
          else if (/at least|too short|password/i.test(e2.message)) e2.code = 'mdp_faible';
          else e2.code = 'inconnu';
          throw e2;
        }
        return true;
      }
    };
  }

  var api = { creer: creer, TABLES: TABLES };
  root.HF = root.HF || {};
  root.HF.backendSupabase = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
