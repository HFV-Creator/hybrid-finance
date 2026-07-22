-- =====================================================================
-- Hybrid Finance — schéma de la base de données
-- =====================================================================
--
-- À FAIRE : copier TOUT ce fichier et le coller dans le SQL Editor de
-- Supabase, puis cliquer « Run ».
--
-- Ce fichier est IDEMPOTENT : tu peux l'exécuter deux fois (ou dix fois)
-- de suite sans jamais provoquer d'erreur et sans jamais dupliquer de
-- données. Si tu as un doute, relance-le, ça ne casse rien.
--
-- Sécurité : chaque table a la « Row Level Security » (RLS) activée.
-- En clair : personne ne peut lire ou écrire quoi que ce soit sans être
-- connecté avec un courriel et un mot de passe valides. Les deux associés
-- (Steph et Alex) voient exactement les mêmes données : il n'y a pas de
-- cloisonnement entre eux, c'est voulu.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Table « settings » — les réglages de l'entreprise.
-- Il n'y a qu'UNE SEULE ligne dans cette table (toujours celle avec id = 1),
-- c'est pour ça qu'on force id = 1 avec une contrainte.
-- On y garde : le nom de l'entreprise, le nom et le courriel des deux
-- associés, le pourcentage de partage du profit et le budget publicitaire
-- quotidien de référence.
-- ---------------------------------------------------------------------
create table if not exists settings (
  id               int primary key default 1,
  business_name    text           not null default 'Hybrid Coaching',
  partner_a_name   text           not null default 'Steph',
  partner_b_name   text           not null default 'Alex',
  partner_a_email  text,           -- se remplit plus tard DANS l'application, écran Réglages
  partner_b_email  text,           -- idem
  split_a_pct      numeric(5,2)   not null default 50,   -- part de l'associé A ; la part de B = 100 - split_a_pct
  daily_ad_budget  numeric(12,2)  not null default 120,
  monthly_goal     numeric(12,2),  -- objectif de revenu mensuel ; vide (NULL) = pas d'objectif
  monthly_goal_overrides jsonb    not null default '{}',  -- exceptions mois par mois, ex. {"2026-07": 15000}
  updated_at       timestamptz    default now(),
  -- Le pourcentage de partage tel qu'il était convenu MOIS PAR MOIS,
  -- ex. {"2026-05": 60, "2026-06": 50}. Sans ça, changer le partage
  -- aujourd'hui recalculerait les mois passés avec le nouveau chiffre.
  split_history    jsonb          not null default '{}',
  constraint settings_id_unique_row check (id = 1),
  constraint settings_split_a_pct_valide check (split_a_pct >= 0 and split_a_pct <= 100)
);

-- La ligne unique de réglages. « on conflict do nothing » = si elle existe
-- déjà, on n'y touche pas (donc relancer ce fichier n'efface pas tes réglages).
insert into settings (id) values (1) on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- Table « clients » — la liste de tes clients de coaching.
-- « archived » sert à retirer un client de l'affichage sans effacer son
-- historique de paiements.
-- ---------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  notes       text,
  archived    boolean     not null default false,
  created_by  text,        -- courriel de la personne qui a saisi la ligne (rempli par l'application)
  created_at  timestamptz default now(),
  deleted_at  timestamptz  -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
);


-- ---------------------------------------------------------------------
-- Table « sales » — les ventes rattachées à un client.
-- Trois types de vente :
--   'pif'         = payé en une seule fois       -> on utilise total_amount
--   'versements'  = payé en X mensualités        -> on utilise total_amount + installments_count
--   'abonnement'  = montant récurrent chaque mois -> on utilise monthly_amount (+ end_date si ça s'arrête)
-- Supprimer un client supprime automatiquement ses ventes (on delete cascade).
-- ---------------------------------------------------------------------
create table if not exists sales (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid          not null references clients(id) on delete cascade,
  type               text          not null,
  label              text,           -- ex. « Coaching premium »
  total_amount       numeric(12,2),  -- pour 'pif' et 'versements'
  monthly_amount     numeric(12,2),  -- pour 'abonnement'
  installments_count int,            -- pour 'versements'
  start_date         date          not null,
  end_date           date,           -- optionnel, surtout pour 'abonnement'
  archived           boolean       not null default false,
  created_by         text,
  created_at         timestamptz   default now(),
  deleted_at         timestamptz,   -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
  constraint sales_type_valide check (type in ('pif', 'versements', 'abonnement'))
);

create index if not exists sales_client_id_idx on sales (client_id);


-- ---------------------------------------------------------------------
-- Table « payments » — les paiements ATTENDUS, générés par l'application
-- à partir des ventes (un plan de 6 versements crée 6 lignes ici).
--
-- IMPORTANT — le statut « en retard » n'existe PAS dans la base.
-- Il n'y a que trois statuts stockés : 'pending' (en attente), 'paid' (payé)
-- et 'saute' (échéance sautée, qu'on ne compte plus attendre).
-- « En retard » est CALCULÉ par l'application : c'est un paiement non payé
-- dont l'échéance est dépassée de plus de 5 jours. Comme ça, un paiement
-- devient « en retard » tout seul avec le temps, sans qu'on ait besoin de
-- faire tourner quoi que ce soit dans la base.
--
-- La contrainte « unique (sale_id, due_date) » garantit qu'une même vente
-- ne peut jamais avoir deux paiements à la même date : si l'application
-- regénère les paiements d'un abonnement, elle ne crée pas de doublons.
-- ---------------------------------------------------------------------
create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid          not null references sales(id) on delete cascade,
  client_id   uuid          not null references clients(id) on delete cascade,
  due_date    date          not null,
  amount      numeric(12,2) not null,
  status      text          not null default 'pending',
  paid_date   date,
  reminded_date date,        -- date de la dernière relance manuelle (« Relancer ») ; vide = jamais relancé
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz,   -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
  constraint payments_status_valide check (status in ('pending', 'paid', 'saute')),
  constraint payments_sale_due_unique unique (sale_id, due_date)
);

create index if not exists payments_sale_id_idx  on payments (sale_id);
create index if not exists payments_client_id_idx on payments (client_id);
create index if not exists payments_due_date_idx on payments (due_date);


-- ---------------------------------------------------------------------
-- Table « ad_spend » — les dépenses publicitaires, jour par jour.
-- Une seule ligne par journée : c'est pour ça que « day » est unique.
-- L'application écrase la valeur du jour si tu la saisis à nouveau (upsert).
-- ---------------------------------------------------------------------
create table if not exists ad_spend (
  id          uuid primary key default gen_random_uuid(),
  day         date          not null unique,
  amount      numeric(12,2) not null,
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz    -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
);


-- ---------------------------------------------------------------------
-- Table « recurring_expenses » — les dépenses qui reviennent chaque mois
-- (logiciels, sous-traitance, frais bancaires...).
-- « end_date » vide (NULL) = la dépense est toujours active.
-- Pour arrêter une dépense, on lui met une date de fin ; on ne l'efface pas,
-- comme ça l'historique des mois passés reste juste.
-- ---------------------------------------------------------------------
create table if not exists recurring_expenses (
  id          uuid primary key default gen_random_uuid(),
  label       text          not null,
  amount      numeric(12,2) not null,
  category    text          not null default 'autre',
  start_date  date          not null,
  end_date    date,          -- NULL = toujours active
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz,   -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
  constraint recurring_expenses_category_valide
    check (category in ('ads', 'logiciels', 'sous-traitance', 'frais-bancaires', 'autre'))
);


-- ---------------------------------------------------------------------
-- Table « one_off_expenses » — les dépenses ponctuelles, qui n'arrivent
-- qu'une fois (un achat, un contrat unique, des frais exceptionnels...).
-- ---------------------------------------------------------------------
create table if not exists one_off_expenses (
  id          uuid primary key default gen_random_uuid(),
  label       text          not null,
  amount      numeric(12,2) not null,
  category    text          not null default 'autre',
  date        date          not null,
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz,   -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
  constraint one_off_expenses_category_valide
    check (category in ('ads', 'logiciels', 'sous-traitance', 'frais-bancaires', 'autre'))
);

create index if not exists one_off_expenses_date_idx on one_off_expenses (date);


-- ---------------------------------------------------------------------
-- Table « payouts » — l'argent qu'on se VERSE, à Steph ou à Alex.
-- Ce n'est PAS une dépense : une dépense sort de l'entreprise (ads,
-- logiciels...), un versement transfère à un associé une part du profit
-- déjà gagné. Un versement ne change donc jamais les revenus, les
-- dépenses, le profit, la marge ni le ROAS : il réduit seulement ce que
-- l'entreprise doit encore à cet associé.
-- « partner » vaut 'a' (associé A) ou 'b' (associé B), rien d'autre.
-- ---------------------------------------------------------------------
create table if not exists payouts (
  id          uuid primary key default gen_random_uuid(),
  partner     text          not null,          -- 'a' = associé A, 'b' = associé B
  date        date          not null,
  amount      numeric(12,2) not null,
  note        text,           -- libre : « virement Desjardins », « avance de juin »...
  created_by  text,
  created_at  timestamptz   default now(),
  deleted_at  timestamptz,   -- vide (NULL) = vivant ; une date = dans la corbeille (30 jours)
  constraint payouts_partner_valide check (partner in ('a', 'b'))
);

create index if not exists payouts_date_idx on payouts (date);


-- =====================================================================
-- SÉCURITÉ — Row Level Security (RLS)
-- =====================================================================
-- On active la RLS sur chaque table. Sans politique explicite, RLS bloque
-- TOUT : c'est le comportement voulu pour les visiteurs non connectés.
--
-- Ensuite, on crée une politique par table qui donne le droit de lire,
-- ajouter, modifier et supprimer UNIQUEMENT au rôle « authenticated »,
-- c'est-à-dire à une personne connectée avec un courriel et un mot de passe
-- valides. Les deux associés sont tous les deux « authenticated », donc ils
-- voient et modifient les mêmes données.
--
-- « drop policy if exists » avant chaque « create policy » : c'est ce qui
-- permet de relancer ce fichier autant de fois qu'on veut sans erreur.
-- =====================================================================

alter table settings           enable row level security;
alter table clients            enable row level security;
alter table sales              enable row level security;
alter table payments           enable row level security;
alter table ad_spend           enable row level security;
alter table recurring_expenses enable row level security;
alter table one_off_expenses   enable row level security;
alter table payouts            enable row level security;

drop policy if exists "acces_associes_settings" on settings;
create policy "acces_associes_settings" on settings
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_clients" on clients;
create policy "acces_associes_clients" on clients
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_sales" on sales;
create policy "acces_associes_sales" on sales
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_payments" on payments;
create policy "acces_associes_payments" on payments
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_ad_spend" on ad_spend;
create policy "acces_associes_ad_spend" on ad_spend
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_recurring_expenses" on recurring_expenses;
create policy "acces_associes_recurring_expenses" on recurring_expenses
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_one_off_expenses" on one_off_expenses;
create policy "acces_associes_one_off_expenses" on one_off_expenses
  for all to authenticated using (true) with check (true);

drop policy if exists "acces_associes_payouts" on payouts;
create policy "acces_associes_payouts" on payouts
  for all to authenticated using (true) with check (true);


-- =====================================================================
-- Confirmation : ce message doit s'afficher dans Supabase quand tout est bon.
-- =====================================================================
select 'Schéma Hybrid Finance installé avec succès.' as resultat;
