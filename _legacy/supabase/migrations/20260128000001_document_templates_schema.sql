-- Migration: document_templates_schema
-- Module: document-templates
-- Created: 2026-01-28
-- Description: Reusable document template system with versioning, publishing,
--              and instance tracking (replaces hardcoded contract generation)

-- ============================================================================
-- DOCUMENT TEMPLATES TABLE
-- Versioned HTML templates with {{variable}} placeholders
-- ============================================================================

create table public.document_templates (
  id uuid primary key default gen_random_uuid(),

  -- Template identity
  key text not null,
  version int not null default 1,
  title text not null,
  description text,

  -- Template content
  format text not null default 'html'
    check (format in ('html')),
  content text not null,

  -- Lifecycle: draft → published → archived
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),

  -- Authorship tracking
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),

  -- Lifecycle timestamps
  published_at timestamptz,
  archived_at timestamptz,

  -- Standard timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Only one version number per template key
  unique (key, version)
);

-- Only one published version per template key at any time
create unique index document_templates_one_published_per_key
  on public.document_templates (key)
  where status = 'published';

-- ============================================================================
-- DOCUMENT INSTANCES TABLE
-- Generated documents from templates, with signing/storage tracking
-- ============================================================================

create table public.document_instances (
  id uuid primary key default gen_random_uuid(),

  -- Link to template
  template_id uuid references public.document_templates(id),

  -- Denormalized copies for audit trail (immutable record of what was used)
  template_key text not null,
  template_version int not null,

  -- Subject (who this document is for)
  subject_type text not null
    check (subject_type in ('professional', 'client')),
  subject_id uuid not null,

  -- Frozen data used to render the template at generation time
  render_data jsonb not null,

  -- Lifecycle: generated → sent_to_docuseal → signed (or cancelled)
  status text not null default 'generated'
    check (status in ('generated', 'sent_to_docuseal', 'signed', 'cancelled')),

  -- Generated PDF storage
  pdf_storage_path text,
  pdf_sha256 text,

  -- DocuSeal integration (TEXT, not bigint — DocuSeal IDs can exceed JS safe int)
  docuseal_submission_id text,
  docuseal_audit_log jsonb,

  -- Signed PDF storage
  signed_pdf_storage_path text,

  -- Signing metadata
  signed_at timestamptz,
  clinic_signer_name text,
  clinic_signed_at timestamptz,

  -- Who generated this instance
  generated_by uuid references public.profiles(id),

  -- Standard timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- document_templates indexes
create index document_templates_key_idx
  on public.document_templates(key);

create index document_templates_status_idx
  on public.document_templates(status);

-- document_instances indexes
create index document_instances_template_idx
  on public.document_instances(template_id);

create index document_instances_subject_idx
  on public.document_instances(subject_type, subject_id);

create index document_instances_docuseal_idx
  on public.document_instances(docuseal_submission_id);

create index document_instances_status_idx
  on public.document_instances(status);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp on document_templates
create trigger document_templates_set_updated_at
  before update on public.document_templates
  for each row
  execute function public.set_updated_at();

-- Auto-update updated_at timestamp on document_instances
create trigger document_instances_set_updated_at
  before update on public.document_instances
  for each row
  execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.document_templates enable row level security;
alter table public.document_instances enable row level security;

-- document_templates: SELECT — admin + staff can read all
create policy "document_templates_select"
  on public.document_templates for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- document_templates: INSERT — admin only
create policy "document_templates_insert"
  on public.document_templates for insert
  to authenticated
  with check (
    (select public.get_my_role()) = 'admin'
  );

-- document_templates: UPDATE — admin only
create policy "document_templates_update"
  on public.document_templates for update
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- document_templates: DELETE — admin only
create policy "document_templates_delete"
  on public.document_templates for delete
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
  );

-- document_instances: SELECT — admin + staff can read all
create policy "document_instances_select"
  on public.document_instances for select
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- document_instances: INSERT — admin + staff can insert
create policy "document_instances_insert"
  on public.document_instances for insert
  to authenticated
  with check (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- document_instances: UPDATE — admin + staff can update
create policy "document_instances_update"
  on public.document_instances for update
  to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'staff')
  );

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Publish a draft template, archiving any previously published version
create or replace function public.rpc_publish_template(p_template_id uuid)
returns public.document_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.document_templates;
  v_role text;
begin
  -- 1. Check caller is admin
  v_role := public.get_my_role();
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can publish templates';
  end if;

  -- 2. Fetch and validate the template
  select * into v_template
    from public.document_templates
    where id = p_template_id;

  if not found then
    raise exception 'Template not found: %', p_template_id;
  end if;

  if v_template.status <> 'draft' then
    raise exception 'Only draft templates can be published (current status: %)', v_template.status;
  end if;

  -- 3. Archive any existing published template with the same key
  update public.document_templates
    set status = 'archived',
        archived_at = now()
    where key = v_template.key
      and status = 'published';

  -- 4. Publish the target template
  update public.document_templates
    set status = 'published',
        published_at = now()
    where id = p_template_id
    returning * into v_template;

  return v_template;
end;
$$;

comment on function public.rpc_publish_template(uuid) is
  'Publishes a draft template, archiving any previously published version with the same key';

-- Create a new draft version of a template by cloning content from an existing version
create or replace function public.rpc_create_new_template_version(
  p_key text,
  p_base_from_version int default null
)
returns public.document_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.document_templates;
  v_new public.document_templates;
  v_max_version int;
  v_role text;
begin
  -- 1. Check caller is admin
  v_role := public.get_my_role();
  if v_role is distinct from 'admin' then
    raise exception 'Only admins can create new template versions';
  end if;

  -- 2. Refuse if a draft already exists for this key
  if exists (
    select 1 from public.document_templates
    where key = p_key and status = 'draft'
  ) then
    raise exception 'A draft already exists for key "%". Edit or discard the existing draft first.', p_key;
  end if;

  -- 3. Find the source template
  if p_base_from_version is not null then
    -- Use the specified version
    select * into v_source
      from public.document_templates
      where key = p_key and version = p_base_from_version;

    if not found then
      raise exception 'No template found for key "%" version %', p_key, p_base_from_version;
    end if;
  else
    -- Use the published version
    select * into v_source
      from public.document_templates
      where key = p_key and status = 'published';

    if not found then
      raise exception 'No published template found for key "%"', p_key;
    end if;
  end if;

  -- 4. Determine the next version number
  select coalesce(max(version), 0) into v_max_version
    from public.document_templates
    where key = p_key;

  -- 5. Create the new draft version
  insert into public.document_templates (
    key, version, title, description, format, content, status
  ) values (
    p_key,
    v_max_version + 1,
    v_source.title,
    v_source.description,
    v_source.format,
    v_source.content,
    'draft'
  )
  returning * into v_new;

  return v_new;
end;
$$;

comment on function public.rpc_create_new_template_version(text, int) is
  'Creates a new draft version of a template by cloning from a specified or published version';

-- ============================================================================
-- COMMENTS
-- ============================================================================

-- document_templates table
comment on table public.document_templates is
  'Versioned HTML document templates with {{variable}} placeholders for generating contracts and other documents';

comment on column public.document_templates.key is
  'Logical template identifier, e.g. contrat_service. Multiple versions share the same key.';

comment on column public.document_templates.version is
  'Incrementing version number within a key. Unique per key.';

comment on column public.document_templates.format is
  'Template format. Currently only html is supported.';

comment on column public.document_templates.content is
  'HTML template body with {{variable}} placeholders for rendering.';

comment on column public.document_templates.status is
  'Lifecycle status: draft (editable), published (active, one per key), archived (superseded).';

comment on column public.document_templates.published_at is
  'Timestamp when this version was published. NULL for drafts and archived templates that were never published.';

comment on column public.document_templates.archived_at is
  'Timestamp when this version was archived (superseded by a newer published version).';

-- document_instances table
comment on table public.document_instances is
  'Generated document instances from templates, tracking rendering data, PDF storage, and signing status';

comment on column public.document_instances.template_key is
  'Denormalized copy of template key at generation time for audit trail.';

comment on column public.document_instances.template_version is
  'Denormalized copy of template version at generation time for audit trail.';

comment on column public.document_instances.subject_type is
  'Type of entity this document is for: professional or client.';

comment on column public.document_instances.subject_id is
  'UUID of the subject entity (professionals.id or clients.id).';

comment on column public.document_instances.render_data is
  'Frozen snapshot of all data used to render the template. Immutable after generation.';

comment on column public.document_instances.status is
  'Lifecycle: generated → sent_to_docuseal → signed (or cancelled).';

comment on column public.document_instances.docuseal_submission_id is
  'DocuSeal submission ID (stored as TEXT because DocuSeal IDs can exceed JS Number.MAX_SAFE_INTEGER).';

comment on column public.document_instances.pdf_sha256 is
  'SHA-256 hash of the generated PDF for integrity verification.';

comment on column public.document_instances.signed_pdf_storage_path is
  'Supabase Storage path for the signed PDF returned by DocuSeal.';

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Insert the initial service contract template (v1, published)
insert into public.document_templates (
  key, version, title, description, format, content, status, published_at, created_by, updated_by
) values (
  'contrat_service',
  1,
  'Contrat de service professionnel',
  'Convention de prestation de service entre le professionnel et Clinique MANA',
  'html',
  $tpl$<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Convention de prestation de service - {{professional.full_name}}</title>
  <style>
    @page {
      size: letter;
      margin: 2.5cm 2cm;
    }

    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
      margin: 0;
      padding: 0;
    }

    .page-break {
      page-break-before: always;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
    }

    .header h1 {
      font-size: 16pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 0;
    }

    .parties-section {
      margin-bottom: 25px;
    }

    .party-block {
      margin-bottom: 20px;
    }

    .party-label {
      font-weight: bold;
      margin-bottom: 10px;
    }

    .party-info {
      margin-left: 20px;
    }

    .party-info p {
      margin: 5px 0;
    }

    .designation {
      font-style: italic;
      margin-top: 10px;
    }

    .attendu {
      margin: 25px 0;
      font-style: italic;
    }

    .consequence {
      font-weight: bold;
      text-align: center;
      margin: 30px 0;
      text-transform: uppercase;
    }

    .clause {
      margin-bottom: 20px;
    }

    .clause-title {
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .clause-content {
      margin-left: 0;
    }

    .clause-content p {
      margin: 8px 0;
      text-align: justify;
    }

    .clause-content .sub-item {
      margin-left: 20px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 10pt;
    }

    th, td {
      border: 1px solid #000;
      padding: 8px 10px;
      text-align: left;
    }

    th {
      background-color: #f5f5f5;
      font-weight: bold;
    }

    .table-payment-terms {
      margin: 15px 0;
    }

    /* Signature section */
    .signature-section {
      margin-top: 40px;
    }

    .signature-header {
      font-weight: bold;
      margin-bottom: 30px;
    }

    .signature-grid {
      display: flex;
      justify-content: space-between;
      margin-top: 30px;
    }

    .signature-block {
      width: 45%;
    }

    .signature-field {
      border-bottom: 1px solid #000;
      height: 60px;
      margin-bottom: 5px;
    }

    .signature-label {
      font-size: 10pt;
      color: #666;
    }

    .date-city-line {
      display: flex;
      gap: 40px;
      margin-bottom: 30px;
    }

    .date-field, .city-field {
      flex: 1;
    }

    .field-line {
      border-bottom: 1px solid #000;
      min-width: 200px;
      display: inline-block;
    }

    /* Annexe A */
    .annexe-header {
      text-align: center;
      margin-bottom: 30px;
    }

    .annexe-header h2 {
      font-size: 14pt;
      margin: 0 0 5px 0;
    }

    .annexe-header h3 {
      font-size: 12pt;
      font-weight: normal;
      text-transform: uppercase;
      margin: 0;
    }

    .pricing-table th,
    .pricing-table td {
      text-align: center;
      font-size: 9pt;
    }

    .pricing-table th:first-child,
    .pricing-table td:first-child {
      text-align: left;
    }

    .portion-text {
      font-size: 8pt;
      color: #666;
    }

    /* Footer with initials */
    @page {
      @bottom-right {
        content: element(page-initials);
      }
    }

    .page-initials-container {
      position: running(page-initials);
      text-align: right;
      font-size: 9pt;
    }

    .initials-field-container {
      margin: 20px 0;
      text-align: right;
      page-break-inside: avoid;
    }

    .docuseal-field {
      display: inline-block;
      min-width: 150px;
      min-height: 30px;
      border-bottom: 1px solid #ccc;
      background-color: #fffde7;
    }

    .docuseal-signature {
      display: block;
      width: 200px;
      height: 60px;
      border: 1px dashed #999;
      background-color: #fffde7;
    }

    .docuseal-initials {
      display: inline-block;
      width: 60px;
      height: 30px;
      border: 1px dashed #999;
      background-color: #fffde7;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <h1>Convention de prestation de service</h1>
  </div>

  <!-- Parties -->
  <div class="parties-section">
    <div class="party-block">
      <div class="party-label">ENTRE :</div>
      <div class="party-info">
        <p><strong>{{clinic.name}}</strong>, {{clinic.legal_form}}, représentée aux présentes par {{clinic.representative}}, {{clinic.representative_title}},</p>
        <p>Ayant son siège social au : {{clinic.address}}</p>
        <p class="designation">(ci-après désignée comme « Clinique MANA »)</p>
      </div>
    </div>

    <div class="party-block">
      <div class="party-label">ET</div>
      <div class="party-info">
        <p><strong>Nom :</strong> {{professional.full_name}}</p>
        <p><strong>Adresse :</strong> {{professional.address}}</p>
        <p><strong>Téléphone :</strong> {{professional.phone}}</p>
        <p class="designation">(ci-après désigné(e) comme le « Professionnel »)</p>
      </div>
    </div>
  </div>

  <!-- ATTENDU -->
  <div class="attendu">
    <p>ATTENDU QUE le Professionnel déclare et représente exercer une profession liée au domaine de la santé, soit {{professional.profession}} et déclare être membre en règle de son ordre professionnel;</p>
  </div>
  <div class="consequence">
    <p>EN CONSÉQUENCE DE QUOI, LES PARTIES CONVIENNENT DE CE QUI SUIT :</p>
  </div>

  <!-- Clause 1 -->
  <div class="clause">
    <div class="clause-title">1. PRÉAMBULE</div>
    <div class="clause-content">
      <p>1.1. Les parties à la présente convention déclarent avoir pris connaissance des attendus et déclarations qui précèdent, reconnaissent la véracité de ces attendus et déclarations et acceptent que ces attendus et déclarations fassent partie intégrante de la présente convention.</p>
    </div>
  </div>

  <!-- Clause 2 -->
  <div class="clause">
    <div class="clause-title">2. LOCATION DE SERVICE</div>
    <div class="clause-content">
      <p>2.1. Clinique MANA référencera ses clients au Professionnel en fonction des besoins du client, de l'expertise offerte par le Professionnel et de ses disponibilités;</p>
      <p>2.2. Clinique MANA fournira les services généraux d'administration durant les heures normales d'affaires;</p>
      <p>2.3. Clinique MANA fournira les services de gestion de la prise de rendez-vous clients et de la liste d'attente clients ainsi que de la facturation des services professionnels et frais liés et la perception des paiements auprès de la clientèle du Professionnel;</p>
      <p>2.4. Le Professionnel consent à ce que les services mentionnés en 2.1, 2.2 et 2.3 ci-dessus soient accomplis exclusivement par Clinique MANA et s'engage à utiliser tout formulaire de services ou autre fournis par Clinique MANA. Toutefois, lorsque le choix du Professionnel est d'exercer ses activités le soir ou les fins de semaine, ce dernier reconnait et convient que Clinique MANA n'aura pas de ressource sur place et ne fournira pas tout service afférent;</p>
    </div>
  </div>

  <!-- Clause 3 -->
  <div class="clause">
    <div class="clause-title">3. PAIEMENT DES SERVICES</div>
    <div class="clause-content">
      <p>3.1. Pendant la durée complète de ce contrat, le Professionnel accepte de payer pour les services ci-avant décrits, avant toute taxe applicable, s'il y a lieu, un montant équivalent à une proportion des honoraires facturés pour tout acte professionnel de ce dernier, ayant fait l'objet d'une facturation, le pourcentage applicable tel que déterminé au tableau ci-dessous;</p>

      <table class="table-payment-terms">
        <thead>
          <tr>
            <th>Type de service</th>
            <th style="width: 100px;">Pourcentage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ateliers et Conférences</td>
            <td style="text-align: center;">25 %</td>
          </tr>
          <tr>
            <td>Consultation en ligne ou en personne au bureau du professionnel</td>
            <td style="text-align: center;">30 %</td>
          </tr>
          <tr>
            <td>Annulation tardive ou absence non motivée</td>
            <td style="text-align: center;">30 %</td>
          </tr>
          <tr>
            <td>Autres frais</td>
            <td style="text-align: center;">15 %</td>
          </tr>
        </tbody>
      </table>

      <p>3.3. La portion retenue des honoraires applicables, viendra réduire les paiements d'honoraires au Professionnel à chacun des paiements faits au Professionnel. Chaque premier du mois, la Clinique transmet un résumé des interventions du mois précédent afin que le Professionnel puisse produire sa facture; tout retard dans l'envoi de celle-ci entraînera un report du paiement au jeudi suivant sa réception.</p>
      <p>3.4. Les honoraires établis par Clinique MANA sont mentionnés à l'Annexe A.</p>
      <p>3.5. Une bonification des honoraires de 0,50$/50 minutes et de 0,25$/30 minutes pour chaque tranche de 50 rendez-vous réalisés jusqu'à concurrence de 25% est applicable.</p>
      <p class="sub-item">3.5.1. Si le client ou le professionnel met fin à la démarche après le premier rendez-vous, cette rencontre ne sera pas comptabilisée.</p>
      <p class="sub-item">3.5.2. Les annulations tardives ou absences non motivées ne sont pas touchées par les bonifications, la compensation de 30% est applicable.</p>
    </div>
  </div>

  <!-- Clause 4 -->
  <div class="clause">
    <div class="clause-title">4. RESPONSABILITÉS DU PROFESSIONNEL(LE)</div>
    <div class="clause-content">
      <p>4.1. Le Professionnel s'engage à proposer un minimum de trois (3) plages horaires par semaine pour les clients de MANA.</p>
      <p>4.2. Le Professionnel s'engage à inscrire ses disponibilités dans Go Rendez-vous au moins 2 semaines au préalable. Advenant une modification de ses disponibilités, le Professionnel doit assurer un suivi avec ses clients impactés par ce changement et doit aviser Clinique MANA.</p>
      <p>4.3. Le Professionnel s'engage à indiquer dans le système de Go Rendez-vous dans « note sur le client » le statut du suivi, soit : en cours, en pause ou arrêt du suivi.</p>
      <p>4.4. Lors d'une situation d'annulation tardive (moins de 24h) ou d'absence non motivée, c'est le Professionnel qui prend la décision d'appliquer les frais stipulés dans le formulaire de consentement ou non. Clinique MANA assurera le suivi auprès du client. Le risque financier est partagé entre le Professionnel et Clinique MANA. Les frais seront payés au Professionnel seulement si le client paye les frais.</p>
      <p>4.5. Le Professionnel s'engage à vérifier dans Go Rendez-vous si le formulaire de consentement MANA a été accepté pour chaque client. Si le client n'a pas accepté le formulaire, le Professionnel assure le suivi pour que le formulaire soit bien accepté.</p>
      <p>4.6. Le Professionnel s'engage à fournir une photo professionnelle</p>
      <p class="sub-item">4.6.1. Dans un souci d'assurer une image cohérente, professionnelle et représentative de la Clinique MANA, chaque professionnel s'engage à fournir une photographie conforme aux standards établis par la Clinique.</p>
    </div>
  </div>

  <!-- Clause 5 -->
  <div class="clause">
    <div class="clause-title">5. DURÉE DE LA CONVENTION</div>
    <div class="clause-content">
      <p>5.1. La présente convention débutera le jour de sa signature et demeurera en vigueur pour une période de douze (12) mois;</p>
      <p>5.2. Le Professionnel et Clinique MANA ne pourra résilier cette convention avant son terme sauf s'il a fait le choix d'un préavis écrit d'au moins trente (30) jours, adressé et remis à l'autre partie;</p>
      <p>5.3. Les parties gardent une ouverture à discuter et convenir ensemble des ajustements à la présente entente pouvant s'avérer requis.</p>
      <p>5.4. À défaut par le professionnel d'envoyer l'avis écrit, la convention sera réputée renouvelée selon les termes et conditions alors en vigueur.</p>
    </div>
  </div>

  <!-- Clause 6 -->
  <div class="clause">
    <div class="clause-title">6. INCESSIBILITÉ DES DROITS</div>
    <div class="clause-content">
      <p>6.1. Aucun droit et/ou privilège octroyé par la présente convention au Professionnel ne peut être cédé à un tiers;</p>
    </div>
  </div>

  <!-- Clause 7 -->
  <div class="clause">
    <div class="clause-title">7. EXERCICE PROFESSIONNEL ET DÉPENSES</div>
    <div class="clause-content">
      <p>7.1. Il est entendu que le Professionnel assume toute responsabilité professionnelle et tous les frais liés à l'exercice de sa profession et à la conduite et au développement de ses affaires y compris tous frais liés à l'assurance responsabilité et à la formation professionnelle;</p>
      <p>7.2. Le Professionnel fournit concurremment à la présente, la preuve de son adhésion à l'ordre professionnel, une preuve de l'assurance responsabilité et s'engage à divulguer sans délai tout changement de statut ou événement pouvant affecter sa pratique;</p>
      <p>7.3. Le Professionnel pourra utiliser le nom de Clinique MANA. De plus, le Professionnel permet que son nom soit mentionné comme faisant partie de l'équipe MANA;</p>
    </div>
  </div>

  <!-- Clause 8 -->
  <div class="clause">
    <div class="clause-title">8. AUCUNE ASSOCIATION / NON-RESPONSABILITÉ</div>
    <div class="clause-content">
      <p>8.1. Sauf pour les actes spécifiques mentionnés à la présente entente, aucune disposition de la présente ne doit être interprétée, comme créant entre les parties, une relation de mandant à mandataire, d'agence, d'association ou créant une société ou entreprise conjointe entre elles et il est expressément convenu que le Professionnel est un contractant indépendant et qu'il n'est, d'aucune façon, autorisé à faire et signer aucun contrat, aucune convention, ni à fournir ou donner aucune garantie ou représentation pour le compte de Clinique MANA ni à créer aucune dette ou obligation, expresse ou implicite, pour le compte de Clinique MANA ou à sa charge;</p>
      <p>8.2. Clinique MANA n'encourra aucune responsabilité, de quelque nature que ce soit, relativement au traitement fiscal de toute somme payée au Professionnel, notamment en ce qui a trait à toute taxe ou impôt, y compris ceux qui auraient pu faire l'objet d'une retenue à la source par Clinique MANA, le Professionnel s'engageant par les présentes à tenir Clinique MANA indemne et à couvert de tout impôt, pénalité ou intérêt que Clinique MANA pourrait être amenée à payer à cet égard et de tout frais ou responsabilité (incluant frais raisonnables et les honoraires judiciaires et extrajudiciaires d'avocats) que Clinique MANA pourrait subir ou encourir en raison de toute demande des autorités fiscales;</p>
      <p>8.3. Le Professionnel déclare être totalement et entièrement autonome et indépendant de Clinique MANA et s'engage à s'acquitter de tous les droits et cotisations qui seraient dus aux ministères du Revenu provincial et fédéral ou à d'autres ministères ou autorités publiques;</p>
    </div>
  </div>

  <!-- Clause 9 -->
  <div class="clause">
    <div class="clause-title">9. ENGAGEMENT DE CONFIDENTIALITÉ</div>
    <div class="clause-content">
      <p>9.1. Le Professionnel s'engage à maintenir confidentielle toute propriété intellectuelle ainsi que toute information afférente à Clinique MANA et ce, concernant toute information dont il aura eu, directement ou indirectement, accès dans le cadre de la présente convention. Sans limiter la généralité de ce qui précède, les parties considèrent et reconnaissent comme confidentielles les informations suivantes : tout formulaire conçu par Clinique MANA, tout secret commercial (procédé, formule, méthode de commercialisation, etc), tout programme d'ordinateur sous toutes ses formes, tout code d'accès à un programme informatique ainsi que tout contrat, soumission, liste de prix et liste de clients;</p>
      <p>9.2. Subséquemment à la terminaison de la présente convention, le Professionnel s'engage à maintenir et respecter son obligation de confidentialité;</p>
    </div>
  </div>

  <!-- Clause 10 -->
  <div class="clause">
    <div class="clause-title">10. NON-CONCURRENCE / NON-SOLLICITATION</div>
    <div class="clause-content">
      <p>10.1. Pendant la durée de la présente convention et de tout renouvellement, s'il y a lieu, et pour une période d'un an après cette période, le Professionnel ne devra en aucune façon :</p>
      <p class="sub-item">10.1.1. Détourner ou tenter de détourner directement ou indirectement et de quelque façon que ce soit, toute affaire ou tout client de Clinique MANA vers tout autre établissement concurrent, par offre directe ou indirecte ou autrement;</p>
      <p class="sub-item">10.1.2. Employer ou chercher à employer toute personne qui à ce moment est employée par Clinique MANA ou amener autrement, directement ou indirectement, telle personne à quitter son emploi;</p>
    </div>
  </div>

  <!-- Clause 11 -->
  <div class="clause">
    <div class="clause-title">11. NOM, MARQUE DE COMMERCE ET RÉPUTATION</div>
    <div class="clause-content">
      <p>11.1. Le Professionnel reconnait de plus que le nom Clinique MANA et toute marque de commerce liée est la propriété de Clinique MANA, et qu'il n'a aucun droit de quelque nature que ce soit sur cette marque de commerce et ne peut l'utiliser de quelque façon et sous quelque forme que ce soit mise à part de mentionner comme faisant partie de l'équipe MANA;</p>
      <p>11.2. Le Professionnel ne devra en aucune façon publier sur le web et/ou les réseaux sociaux des avis pouvant nuire à la réputation de Clinique MANA, le Professionnel devra verser un montant de 1 000$ par jour à Clinique MANA en guise de dédommagement.</p>
    </div>
  </div>

  <!-- Clause 12 -->
  <div class="clause">
    <div class="clause-title">12. AVIS</div>
    <div class="clause-content">
      <p>12.1. Tous les avis et autres communications en vertu des présentes, devront être donnés par écrit et seront présumés avoir été préalablement donnés s'ils sont remis en main propre ou postés par courrier recommandé ou sous pli affranchi et adressés à l'adresse apparaissant à la première page ou à toute autre adresse faisant suite à un avis de changement expédié par une partie à l'autre;</p>
    </div>
  </div>

  <!-- Clause 13 -->
  <div class="clause">
    <div class="clause-title">13. TERMINAISON</div>
    <div class="clause-content">
      <p>13.1. En plus des causes de terminaison mentionnées à la présente convention, Clinique MANA pourra mettre fin à la présente convention après avoir donné un préavis écrit de trente (30) jours au Professionnel, advenant l'un ou l'autre des événements suivants;</p>
      <p class="sub-item">13.1.1. Le Professionnel fait défaut d'être en règle avec son ordre professionnel;</p>
      <p class="sub-item">13.1.2. Le Professionnel fait défaut ou refuse d'accomplir une quelconque obligation lui incombant en vertu des présentes, suivi de son omission d'y remédier dans les dix (10) jours de la réception d'un avis de défaut;</p>
      <p class="sub-item">13.1.3. Si Clinique MANA cesse de faire affaires;</p>
      <p class="sub-item">13.1.4. Si l'une des parties aux présentes, est mise en faillite, entame des procédures de protection vis-à-vis ses créanciers, de liquidation ou de dissolution, volontairement ou par ordonnance de quelque tribunal ayant juridiction sur ses affaires;</p>
      <p>13.2. La terminaison de cette convention par entente ou par défaut aura les effets et comportera les conséquences suivantes :</p>
      <p class="sub-item">13.2.1. Tous les droits accordés au Professionnel seront éteints y compris, de faire usage du nom Clinique MANA ainsi que tous autres noms connexes ainsi que tout autres droits reliés aux droits consentis;</p>
      <p class="sub-item">13.2.2. Le Professionnel devra éviter d'agir de façon à laisser croire à des tiers qu'il est lié à Clinique MANA;</p>
      <p class="sub-item">13.2.3. À compter de la date de résiliation, le Professionnel doit remettre sans délai à Clinique MANA tous documents fournis antérieurement au Professionnel par la Clinique MANA et ce sous quelque forme que ce soit et qui se trouvent en possession du Professionnel, dans les Locaux ou ailleurs;</p>
      <p class="sub-item">13.2.4. À compter de la terminaison de la présente convention, aucune partie ne sera responsable envers l'autre partie pour tout dommage, perte, incluant, mais sans limiter la généralité de ce qui précède, aux pertes de profit causées par la terminaison de la présente convention;</p>
      <p class="sub-item">13.2.5. Le professionnel s'engage à conserver une copie de ses dossiers pour une durée de 5 ans.</p>
    </div>
  </div>

  <!-- Clause 14 -->
  <div class="clause">
    <div class="clause-title">14. GÉNÉRALITÉS</div>
    <div class="clause-content">
      <p>14.1. Chaque disposition des présentes formes un tout distinct, de sorte que nonobstant toute décision d'un tribunal à l'effet que l'une des dispositions des présentes est déclarée nulle, sans effet, illégale, invalide ou réputée non-écrite ou non exécutoire envers toute personne ou pour toute circonstance, cette disposition sera réputée être indépendante, disjointe et divisible du reste de la convention et son invalidité, sa non-exécution ou son illégalité ne devra pas affecter ou invalider le reste de la convention, qui demeurera exécutoire entre les parties;</p>
      <p>14.2. Cette convention lie par ailleurs les parties aux présentes ainsi que leurs héritiers, administrateurs, représentants légaux et successeurs;</p>
      <p>14.3. La présente convention est régie et doit être interprétée selon les lois applicables dans la province de Québec. Tout litige découlant des présentes devra obligatoirement être intenté devant le tribunal ayant compétence dans le district judiciaire de Québec;</p>
      <p>14.4. La présente convention remplace ou annule, s'il y a lieu, toute autre convention, entente, lettre d'entente, communication verbale ou écrite, ou autre document ayant trait aux présentes et qui aurait précédé sa date d'entrée en vigueur;</p>
    </div>
  </div>

  <!-- Signature Section -->
  <div class="signature-section">
    <div class="signature-header">EN FOI DE QUOI, LES PARTIES ONT SIGNÉ :</div>

    <div class="date-city-line">
      <div class="city-field">
        <span>À </span>
        <text-field name="city" role="First Party" required="true" title="Ville" style="width: 150px; height: 24px; display: inline-block;"></text-field>
      </div>
    </div>

    <div class="signature-grid">
      <div class="signature-block">
        <signature-field name="professional_signature" role="First Party" required="true" style="width: 200px; height: 60px; display: inline-block;"></signature-field>
        <div class="signature-label">{{professional.full_name}}</div>
        <div style="margin-top: 5px;">
          <span style="font-size: 9pt;">Date: </span>
          <date-field name="date_professionnel" role="First Party" required="true" style="width: 100px; height: 20px; display: inline-block;"></date-field>
        </div>
      </div>
      <div class="signature-block">
        <div style="font-family: 'Brush Script MT', 'Segoe Script', cursive; font-size: 20pt; color: #1a237e; padding: 10px 0;">Christine Sirois</div>
        <div class="signature-label">Christine Sirois, Clinique MANA inc.</div>
        <div style="margin-top: 5px;">
          <span style="font-size: 9pt;">Date: {{today}}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Annexe A -->
  <div class="page-break"></div>
  <div class="annexe-header">
    <h2>Annexe A</h2>
    <h3>Honoraires et autres frais</h3>
  </div>

  {{pricing.annexe_a_html}}

</body>
</html>$tpl$,
  'published',
  now(),
  null,
  null
);
