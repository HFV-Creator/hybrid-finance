/* ============================================================
   CONFIG.JS — LE SEUL FICHIER QUE TU DOIS REMPLIR.

   Colle tes deux valeurs Supabase entre les guillemets ci-dessous.
   Où les trouver : dans Supabase, menu de gauche → Project Settings →
   API. Voir la PARTIE B du fichier GUIDE-INSTALLATION.md.

   Tant que les deux valeurs sont vides, l'application démarre en
   MODE DÉMO avec des données fictives : c'est normal, et c'est fait
   exprès pour que tu puisses la regarder avant de la brancher.

   Ne change rien d'autre dans ce fichier. Garde les guillemets.
   ============================================================ */

window.HF_CONFIG = {

  // 1) Project URL — ressemble à : https://abcdefghijklm.supabase.co
  SUPABASE_URL: "https://otryuythfppqsijeqpsa.supabase.co",

  // 2) Clé PUBLIQUE du projet. Selon l'âge de ton projet, Supabase l'appelle :
  //       - « Publishable key » : elle commence par  sb_publishable_
  //       - ou « anon public »  : elle commence par  eyJ
  //    Les deux fonctionnent ici. Prends celle que TON projet affiche.
  //    Elle est conçue pour être publique, sans danger : voir la section
  //    « Pourquoi la clé publique peut être publiée sans danger » du guide.
  //    Ne colle JAMAIS ici la clé secrète (sb_secret_… ou service_role).
  SUPABASE_ANON_KEY: "sb_publishable_-ZZjtIpatBEMEB7gaXGHlQ_kduqa60a"

};
