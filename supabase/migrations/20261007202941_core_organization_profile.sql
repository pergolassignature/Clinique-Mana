-- =============================================================================
-- Organization profile: identity, tax numbers, signatory, Loi 25
-- =============================================================================
-- Design:  docs/plans/2026-10-07-phase-2-core-settings-design.md §3.2
-- Every value printed on a document comes from here (design §3 rule).
-- Readable by every member of the org (contracts and invoices show them);
-- writable with settings.manage through the existing organizations_update
-- policy and the column grant below. Audited by organizations_audit.
-- Checks mirror the Zod schemas in src/core/settings/organization/schemas.ts.
-- =============================================================================

alter table public.organizations
  add column legal_name text,
  add column neq text,
  add column address_line1 text,
  add column address_line2 text,
  add column city text,
  add column province text,
  add column postal_code text,
  add column country text not null default 'CA',
  add column phone text,
  add column email text,
  add column website text,
  add column gst_number text,
  add column qst_number text,
  add column signatory_name text,
  add column signatory_title text,
  add column privacy_officer_name text,
  add column privacy_officer_email text,
  add column privacy_policy_url text,
  add column record_retention_years smallint;

-- Free text: non-blank when set (a null passes, as for every check). btrim strips
-- spaces, tabs and line breaks (plain trim() only strips spaces). One constraint
-- per column so a violation names the column.
alter table public.organizations
  add constraint organizations_legal_name_check check (length(btrim(legal_name, E' \t\r\n')) between 1 and 200),
  add constraint organizations_address_line1_check check (length(btrim(address_line1, E' \t\r\n')) between 1 and 200),
  add constraint organizations_address_line2_check check (length(btrim(address_line2, E' \t\r\n')) between 1 and 200),
  add constraint organizations_city_check check (length(btrim(city, E' \t\r\n')) between 1 and 100),
  add constraint organizations_signatory_name_check check (length(btrim(signatory_name, E' \t\r\n')) between 1 and 120),
  add constraint organizations_signatory_title_check check (length(btrim(signatory_title, E' \t\r\n')) between 1 and 120),
  add constraint organizations_privacy_officer_name_check check (length(btrim(privacy_officer_name, E' \t\r\n')) between 1 and 120),
-- Formats use [0-9], never \d: with the ICU locale provider \d also matches
-- non-ASCII digits (fullwidth, Arabic-Indic), which would break normalisation.
  add constraint organizations_neq_check check (neq ~ '^[0-9]{10}$'),
  add constraint organizations_province_check check (
    province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  add constraint organizations_postal_code_check check (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  add constraint organizations_country_check check (country ~ '^[A-Z]{2}$'),
  add constraint organizations_phone_check check (phone ~ '^\+1[0-9]{10}$'),
  add constraint organizations_email_check check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint organizations_privacy_officer_email_check check (privacy_officer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add constraint organizations_website_check check (website ~ '^https://\S+$'),
  add constraint organizations_privacy_policy_url_check check (privacy_policy_url ~ '^https://\S+$'),
  add constraint organizations_gst_number_check check (gst_number ~ '^[0-9]{9}RT[0-9]{4}$'),
  add constraint organizations_qst_number_check check (qst_number ~ '^[0-9]{10}TQ[0-9]{4}$'),
  add constraint organizations_record_retention_years_check check (record_retention_years between 1 and 50);

-- country stays 'CA' (no UI): the clinic is in Quebec and every check above is Canadian.
grant update (
  legal_name, neq, address_line1, address_line2, city, province, postal_code,
  phone, email, website, gst_number, qst_number, signatory_name, signatory_title,
  privacy_officer_name, privacy_officer_email, privacy_policy_url, record_retention_years
) on public.organizations to authenticated;
