-- =====================================================================
-- Hybrid Finance — mise à jour v2b de la base de données
-- =====================================================================
--
-- À FAIRE : copier TOUT ce fichier et le coller dans le SQL Editor de
-- Supabase, puis cliquer « Run ».
--
-- IMPORTANT — ce fichier ne fait QU'AJOUTER des choses : une nouvelle
-- table (les versements aux associés) et une nouvelle colonne dans les
-- réglages. Il ne supprime rien, ne vide rien et ne modifie AUCUNE de
-- tes lignes existantes. Tes réglages, tes clients, tes ventes, tes
-- paiements et tes dépenses restent exactement tels quels.
--
-- Ce fichier est IDEMPOTENT : tu peux l'exécuter deux fois (ou dix fois)
-- de suite sans jamais provoquer d'erreur et sans jamais rien dupliquer.
-- Si tu as un doute, relance-le, ça ne casse rien.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Nouvelle table « payouts » — l'argent qu'on se VERSE, à Steph ou à Alex.
--
-- À ne pas confondre avec une dépense : une dépense sort de l'entreprise
-- (les ads, les logiciels...), un versement transfère à un associé une
-- part du profit déjà gagné. C'est pour ça qu'un versement ne change
-- JAMAIS les revenus, les dépenses, le profit, la marge ni le ROAS : il
-- ne fait que réduire ce que l'entreprise doit encore à cet associé.
--
-- « partner » vaut 'a' (associé A, Steph par défaut) ou 'b' (associé B,
-- Alex par défaut) ; la contrainte plus bas refuse toute autre valeur.
-- « note » est libre : « virement Desjardins », « avance de juin »...
-- « deleted_at » vide (NULL) = ligne vivante ; une date = corbeille,
-- exactement comme pour les autres tables.
-- ---------------------------------------------------------------------
create table if not exists payouts (
  id          uuid primary key default gen_random_uuid(),
  partner     text          not null,          -- 'a' = associé A, 'b' = associé B
  date        date          not null,
  amount      numeric(12,2) not null,
  note        text,
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz,
  constraint payouts_partner_valide check (partner in ('a', 'b'))
);

-- Index sur la date : le relevé d'un associé se lit toujours par période.
create index if not exists payouts_date_idx on payouts (date);

-- Même sécurité que les autres tables : la RLS bloque tout par défaut,
-- puis une politique ouvre la lecture et l'écriture aux personnes
-- connectées (« authenticated »), c'est-à-dire aux deux associés.
-- Le duo « drop … if exists » puis « create » rend le fichier rejouable.
alter table payouts enable row level security;
drop policy if exists "acces_associes_payouts" on payouts;
create policy "acces_associes_payouts" on payouts
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
-- 2) Réglages — l'historique du pourcentage de partage.
--
-- Jusqu'ici un seul pourcentage servait pour TOUS les mois : le jour où
-- vous le changez, les mois déjà passés étaient recalculés avec le
-- nouveau chiffre — donc faux. « split_history » garde, mois par mois,
-- le pourcentage réellement convenu à l'époque, par exemple
-- {"2026-05": 60, "2026-06": 50}. Commence vide ; l'application le
-- remplit toute seule quand vous modifiez le partage.
-- ---------------------------------------------------------------------
alter table settings add column if not exists split_history jsonb not null default '{}';


-- ---------------------------------------------------------------------
-- 3) On fige les mois qui ont DÉJÀ des données, au pourcentage actuel.
--
-- Pourquoi : tes mois passés ont été partagés au pourcentage d'aujourd'hui.
-- On l'écrit noir sur blanc dans l'historique pour qu'ils gardent ces
-- chiffres-là pour toujours, même si vous changez le partage demain.
--
-- Un mois « a des données » s'il contient au moins un paiement attendu,
-- une dépense ponctuelle ou une journée d'ads. (Les dépenses récurrentes
-- ne comptent pas : elles s'étalent sur tous les mois et ne prouvent donc
-- pas qu'un mois a été travaillé.) Les trois colonnes lues ici sont
-- obligatoires en base, il n'y a donc jamais de mois vide dans la liste.
--
-- Rejouable sans danger : « and s.split_history = '{}' » veut dire
-- « seulement si l'historique est encore vide ». Au deuxième passage il
-- ne l'est plus, la ligne n'est donc pas retouchée et rien ne bouge.
-- ---------------------------------------------------------------------
with mois as (
  select distinct to_char(due_date, 'YYYY-MM') as m from payments
  union select distinct to_char(date, 'YYYY-MM') from one_off_expenses
  union select distinct to_char(day,  'YYYY-MM') from ad_spend
)
update settings s
set split_history = coalesce((select jsonb_object_agg(m, to_jsonb(s.split_a_pct)) from mois), '{}'::jsonb)
where s.id = 1 and s.split_history = '{}'::jsonb;


-- =====================================================================
-- Confirmation : ce message doit s'afficher dans Supabase quand tout est bon.
-- =====================================================================
select 'Mise à jour v2b appliquée avec succès.' as resultat;
