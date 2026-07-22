-- =====================================================================
-- Hybrid Finance — mise à jour v2 de la base de données
-- =====================================================================
--
-- À FAIRE : copier TOUT ce fichier et le coller dans le SQL Editor de
-- Supabase, puis cliquer « Run ».
--
-- IMPORTANT — ce fichier ne fait QU'AJOUTER des choses : quelques
-- nouvelles colonnes et un statut de paiement supplémentaire. Il ne
-- supprime rien, ne vide rien et ne modifie AUCUNE de tes lignes
-- existantes. Tes réglages, tes clients, tes ventes, tes paiements et
-- tes dépenses restent exactement tels quels.
--
-- Ce fichier est IDEMPOTENT : tu peux l'exécuter deux fois (ou dix fois)
-- de suite sans jamais provoquer d'erreur et sans jamais rien dupliquer.
-- Si tu as un doute, relance-le, ça ne casse rien.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Paiements — un troisième statut : 'saute' (échéance sautée).
-- Jusqu'ici la base n'acceptait que 'pending' (en attente) et 'paid'
-- (payé). On remplace la règle de validation pour accepter aussi 'saute'.
-- Le duo « drop … if exists » puis « add » permet de relancer ce fichier
-- sans erreur : on retire la règle si elle existe, puis on remet la
-- version à jour.
-- ---------------------------------------------------------------------
alter table payments drop constraint if exists payments_status_valide;
alter table payments add constraint payments_status_valide check (status in ('pending', 'paid', 'saute'));

-- ---------------------------------------------------------------------
-- 2) Paiements — date de la dernière relance manuelle.
-- Vide (NULL) = jamais relancé. L'application la remplit quand tu
-- cliques « Relancer » sur un paiement.
-- ---------------------------------------------------------------------
alter table payments add column if not exists reminded_date date;

-- ---------------------------------------------------------------------
-- 3) Corbeille — colonne « deleted_at » sur les six tables de données.
-- Vide (NULL) = la ligne est vivante et s'affiche normalement.
-- Une date = la ligne est dans la corbeille (elle reste récupérable
-- pendant 30 jours dans l'application). Rien n'est effacé ici : on
-- ajoute juste la colonne, vide pour toutes tes lignes actuelles.
-- ---------------------------------------------------------------------
alter table clients            add column if not exists deleted_at timestamptz;
alter table sales              add column if not exists deleted_at timestamptz;
alter table payments           add column if not exists deleted_at timestamptz;
alter table recurring_expenses add column if not exists deleted_at timestamptz;
alter table one_off_expenses   add column if not exists deleted_at timestamptz;
alter table ad_spend           add column if not exists deleted_at timestamptz;

-- ---------------------------------------------------------------------
-- 4) Réglages — l'objectif de revenu mensuel.
-- « monthly_goal » : l'objectif par défaut, vide (NULL) = pas d'objectif.
-- « monthly_goal_overrides » : les exceptions mois par mois, par exemple
-- {"2026-07": 15000} pour viser 15 000 $ juste en juillet. Commence vide.
-- ---------------------------------------------------------------------
alter table settings add column if not exists monthly_goal numeric(12,2);
alter table settings add column if not exists monthly_goal_overrides jsonb not null default '{}';


-- =====================================================================
-- Confirmation : ce message doit s'afficher dans Supabase quand tout est bon.
-- =====================================================================
select 'Mise à jour v2 appliquée avec succès.' as resultat;
