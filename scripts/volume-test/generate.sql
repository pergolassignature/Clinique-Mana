-- Volume test (local only, fictional): production-scale synthetic data in the seed's clinic.
-- 60 professionals, 3 000 clients, ~40 000 past appointments over 2 years (+ the next 4 weeks),
-- ~15 000 invoices with lines and payments, ~4 000 requests. Run by scripts/volume-test/run.sh (local only).
\set ON_ERROR_STOP on
select setseed(0.42);
select pg_catalog.set_config('app.audit_source', 'volume:generate', false);

create temp table v_ctx as
select '00000000-0000-0000-0000-000000000001'::uuid as org,
       (select id from public.profession_titles where org_id = '00000000-0000-0000-0000-000000000001' and key = 'psychologue') as title,
       (select id from public.services where org_id = '00000000-0000-0000-0000-000000000001' and code = 10150) as service,
       (select id from public.languages where org_id = '00000000-0000-0000-0000-000000000001' and code = 'fr') as fr,
       (now() at time zone 'America/Toronto')::date as today;

-- Rapports on (the seed leaves it off).
insert into public.org_modules (org_id, module_key, enabled)
select org, 'reports', true from v_ctx
on conflict (org_id, module_key) do update set enabled = true;

-- 60 professionals, psychologists, available Monday to Friday 9:00–17:00.
create temp table v_pros as
select gen_random_uuid() as id, g as n from generate_series(1, 60) g;
insert into public.professionals (id, org_id, first_name, last_name, email, status)
select p.id, c.org, 'Pro' || p.n, 'Volume' || p.n, 'pro' || p.n || '@volume.test', 'active' from v_pros p, v_ctx c;
insert into public.professional_public_profiles (org_id, professional_id) select c.org, p.id from v_pros p, v_ctx c;
insert into public.professional_matching_profiles (org_id, professional_id, accepting_new_clients) select c.org, p.id, p.n % 3 <> 0 from v_pros p, v_ctx c;
insert into public.professional_languages (org_id, professional_id, language_id) select c.org, p.id, c.fr from v_pros p, v_ctx c;
insert into public.professional_professions (org_id, professional_id, profession_title_id, licence_number, is_primary)
select c.org, p.id, c.title, 'V-' || p.n, true from v_pros p, v_ctx c;
insert into public.availability_rules (org_id, professional_id, weekday, start_time, end_time, valid_from)
select c.org, p.id, d, '09:00', '17:00', c.today - 800 from v_pros p, v_ctx c, generate_series(1, 5) d;

-- 3 000 clients, each followed by one professional (n % 60).
create temp table v_clients as
select gen_random_uuid() as id, g as n from generate_series(1, 3000) g;
insert into public.clients (id, org_id, first_name, last_name, birthday, email, mobile_e164, language)
select v.id, c.org,
       (array['Alice','Benoît','Chloé','David','Émilie','François','Gabrielle','Hugo','Isabelle','Jacob','Karine','Louis','Maude','Nicolas','Océane','Philippe'])[1 + v.n % 16],
       'Essai' || v.n,
       date '1960-01-01' + (v.n * 37 % 20000),
       case when v.n % 7 = 0 then null else 'client' || v.n || '@volume.test' end,
       case when v.n % 5 = 0 then null else '+1555' || lpad((1000000 + v.n)::text, 7, '0') end,
       case when v.n % 9 = 0 then 'en' else 'fr' end
  from v_clients v, v_ctx c;

-- Appointments: per professional and weekday, each hour slot taken with some chance.
create temp table v_appts as
select gen_random_uuid() as id, p.id as pro, p.n as pro_n, d.day, h.hr,
       ((d.day + pg_catalog.make_time(h.hr, 0, 0)) at time zone 'America/Toronto') as starts_at,
       random() as r, random() as r2
  from v_pros p
 cross join v_ctx c
 cross join lateral (select (c.today - 730 + g)::date as day from generate_series(0, 758) g) d
 cross join (values (9), (10), (11), (13), (14), (15), (16)) as h(hr)
 where extract(isodow from d.day) < 6
   and d.day <> c.today
   and random() < case when d.day < c.today then 0.185 else 0.5 end;

insert into public.appointments (id, org_id, professional_id, service_id, starts_at, ends_at, blocks_until, mode, state,
                                 completed_at, cancelled_at, cancel_late)
select a.id, c.org, a.pro, c.service, a.starts_at, a.starts_at + interval '50 minutes', a.starts_at + interval '60 minutes',
       case when a.r2 < 0.8 then 'video' else 'phone' end,
       case when a.day > c.today then 'booked'
            when a.r < 0.85 then 'completed'
            when a.r < 0.97 then 'cancelled'
            else 'booked' end,
       case when a.day < c.today and a.r < 0.85 then a.starts_at + interval '50 minutes' end,
       case when a.day < c.today and a.r >= 0.85 and a.r < 0.97 then a.starts_at - interval '20 hours' end,
       case when a.day < c.today and a.r >= 0.85 and a.r < 0.97 then a.r2 < 0.3 end
  from v_appts a, v_ctx c;

-- Each appointment's client: one of the professional's 50 (clients n ≡ pro n mod 60).
insert into public.appointment_participants (appointment_id, client_id, org_id, role, presence)
select a.id, v.id, c.org, 'client',
       case when a.day < c.today and a.r >= 0.97 then 'absent'
            when a.day < c.today and a.r < 0.85 then 'present' else 'expected' end
  from v_appts a
  cross join v_ctx c
  join v_clients v on v.n = a.pro_n + 60 * (abs(hashtext(a.id::text)) % 50);
-- (clients 1..3000: pro_n - 1 + 60·k, k in 1..50, gives each professional her own 50)

-- Invoices: ~15 000 of the completed sessions, numbered per year, 90 % paid.
create temp table v_inv as
select gen_random_uuid() as id, a.id as appt, a.pro, a.day, p.client_id,
       row_number() over (partition by extract(year from a.day) order by a.day, a.id) as seq, random() as r
  from v_appts a
  join public.appointment_participants p on p.appointment_id = a.id
 cross join v_ctx c
 where a.day < c.today - 1 and a.r < 0.85 and a.r2 < 0.49;
insert into public.invoices (id, org_id, number, year, seq, status, client_id, payer_client_id, issued_on, due_on,
                             subtotal_cents, total_cents, paid_cents, payment_status, source_type, source_id, finalized_at)
select i.id, c.org, extract(year from i.day)::int || '-' || i.seq, extract(year from i.day)::int, i.seq, 'issued',
       i.client_id, i.client_id, i.day, i.day, 17500, 17500, 0, 'unpaid', 'appointment', i.appt,
       (i.day + time '18:00') at time zone 'America/Toronto'
  from v_inv i, v_ctx c;
insert into public.invoice_lines (org_id, invoice_id, position, line_type, appointment_id, professional_id, service_id, service_code,
                                  description, quantity, unit_price_cents, subtotal_cents, total_cents, credited, tax_rule, price_source)
select c.org, i.id, 1, 'service', i.appt, i.pro, c.service, 10150, 'Consultation individuelle 50 min', 1, 17500, 17500, 17500,
       false, 'exempt', 'grid'
  from v_inv i, v_ctx c;
insert into public.payments (org_id, invoice_id, payer_client_id, mode_code, amount_cents, paid_on)
select c.org, i.id, i.client_id, (array['interac', 'stripe', 'cheque'])[1 + (abs(hashtext(i.id::text)) % 3)], 17500, i.day + 2
  from v_inv i, v_ctx c
 where i.r < 0.9 and i.day + 2 < c.today;
update public.invoices v set paid_cents = 17500, payment_status = 'paid'
  from v_inv i where v.id = i.id and i.r < 0.9 and i.day + 2 < (select today from v_ctx);

-- Requests: ~4 000 over two years, most matched or closed, a few hundred open.
create temp table v_dem as
select g as n, (c.today - 730 + (g * 730 / 4000))::date as day, random() as r from generate_series(1, 4000) g, v_ctx c;
insert into public.demandes (org_id, reference, reference_year, reference_seq, received_at, channel, contact_name, contact_email,
                             contact_phone_e164, state, closed_reason, closed_at, matched_professional_id, matched_at, client_id)
select c.org,
       'DEM-' || extract(year from d.day)::int || '-' || lpad((row_number() over (partition by extract(year from d.day) order by d.n))::text, 4, '0'),
       extract(year from d.day)::int,
       row_number() over (partition by extract(year from d.day) order by d.n),
       (d.day + time '10:00') at time zone 'America/Toronto',
       (array['phone', 'email', 'web_form', 'booking_page'])[1 + d.n % 4],
       'Personne Essai ' || d.n,
       'demande' || d.n || '@volume.test',
       '+1555' || lpad((2000000 + d.n)::text, 7, '0'),
       case when d.day > c.today - 20 and d.r < 0.6 then (array['new', 'evaluating', 'accepted', 'proposed'])[1 + d.n % 4]
            when d.r < 0.6 then 'matched' when d.r < 0.66 then 'waitlist' else 'closed' end,
       case when not (d.day > c.today - 20 and d.r < 0.6) and d.r >= 0.66 then 'no_answer' end,
       case when not (d.day > c.today - 20 and d.r < 0.6) and d.r >= 0.66 then (d.day + 7 + time '12:00') at time zone 'America/Toronto' end,
       case when not (d.day > c.today - 20 and d.r < 0.6) and d.r < 0.6 then (select id from v_pros where n = 1 + d.n % 60) end,
       case when not (d.day > c.today - 20 and d.r < 0.6) and d.r < 0.6 then (d.day + 3 + time '12:00') at time zone 'America/Toronto' end,
       case when d.r < 0.6 then (select id from v_clients where n = 1 + (d.n * 7) % 3000) end
  from v_dem d, v_ctx c;

select pg_catalog.set_config('app.audit_source', '', false);
analyze;
select (select count(*) from public.professionals) as pros, (select count(*) from public.clients) as clients,
       (select count(*) from public.appointments) as appts, (select count(*) from public.invoices) as invoices,
       (select count(*) from public.payments) as payments, (select count(*) from public.demandes) as demandes;
