-- =============================================================================
-- Professionnels: the service contract (template, printed terms, readiness, card, history)
-- =============================================================================
-- Design:  docs/plans/2026-10-08-professionals-module-design.md §3.8 (A5)
-- Plan:    docs/plans/2026-10-08-professionals-module-plan.md Task 4d.1 (P4-17, P4-18, P4-151,
--          P4-430 … P4-449)
-- Needs:   Phase 3 signing (…_core_signing.sql, …_core_signing_function_support.sql,
--          …_core_signing_envelope.sql), the retention program (…_professionals_compensation_private.sql),
--          the readiness of 4b and 4c (…_professionals_onboarding.sql, …_professionals_documents.sql)
--          and the history (…_professionals_places_and_note.sql, …_professionals_documents.sql)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * Permission professionals.contracts.send (admin): « Préparer et envoyer », « Renvoyer »,
--   « Régénérer » (the professionals-contract-send function, which also requires
--   professionals.compensation: the contract prints the professional's pay, P4-436).
-- * The template (P3-20): one `professionals.service_contract` « Contrat de service » per clinic
--   (view professionals.view, edit professionals.settings), with a DRAFT version 1 built from the
--   legacy contract's structure with variables, its first line « Texte à faire valider par la
--   direction avant publication ». Nothing is published (Mise en service item 11). Inserted
--   directly (create_document_template needs settings.manage; the core header allows a module's
--   migration to insert its templates), for every clinic and by a trigger for new ones. Real names,
--   addresses and rates never appear in it: they are variables. Annexe A is a block placeholder,
--   `{{pricing.annexe_a}}` alone in a paragraph, which the function replaces with the tables it
--   builds from the printed terms (P4-433; the filler has no repeated rows).
-- * The printed terms (P4-432, the retention program P4-180 … P4-194, not the plan's margins):
--   private.professional_contract_terms builds, for the professional's primary title, the grid in
--   force on the clinic's today: the client price per duration, the pay per duration for each tier
--   of cumulative sessions (client price × (1 − the tier's retention), private.retention_pay_cents),
--   the professional's count and tier today, the pay at the rate in force when one is decided, and
--   the other kinds' rates in force (Ateliers et conférences, Annulation tardive, Autres frais).
--   Client agreements are not printed (one client each, and a client reference: Loi 25). No primary
--   title, or no grid for it: a French refusal with HINT `profession` / `pricing`.
-- * The snapshot (P4-151, P4-434): professional_contract_snapshots keeps, per request idempotency
--   key, the values, the Annexe A terms, the signers and the template version printed. First write
--   wins: a retry of the same action renders what the first attempt computed, and a signed contract
--   never re-reads the compensation. Joined to signature_requests on (org_id, idempotency_key); a
--   snapshot without a request is an attempt that never reached create_signature_request. Read with
--   professionals.compensation; audited with the values redacted (they hold the professional's
--   address and the signers' addresses), the terms kept (compensation is audited with its values,
--   P4-149).
-- * prepare_professional_contract (SERVICE ROLE, p_actor as Task 3.18): the actor re-checked (an
--   active member holding professionals.contracts.send and professionals.compensation, module gate
--   included); `send` resumes the open draft under its own key (a failed send is retried as the
--   same request, whatever key the page drew), refuses while a contract is out (sent or viewed);
--   `regenerate` names the open request to close first (never the action's own request: a double
--   click is the same action); `resend` names the open request's envelope and its next signer. A
--   signed contract is refused (« déjà signé »): its renewal is a follow-up.
-- * Requests carry view_permission professionals.compensation, not the plan's professionals.view
--   (P4-435): the PDF prints the pay, which only compensation holders read. So the card reads
--   get_professional_contract (definer, professionals.view: the state, the dates and the signers'
--   progress for every reader; the signed file and the rejection reason only for those who may read
--   the request), and readiness reads private.professional_signed_contracts() (definer, the
--   caller's clinic, filtered like professional_login_email_mismatches), so `ready` is the same for
--   every reader.
-- * Readiness (as 4b and 4c): `contract_signed` is appended to 4c's professionals_readiness and
--   `ready` requires it, after the documents: the professional's latest service-contract request is `signed` (rejected,
--   expired, cancelled and abandoned do not count, A10.9). get_professional_readiness gains the item.
-- * History: list_professional_history also returns the audit rows of the professional's contract
--   requests and their signers (by subject, one lookup), only the rows that move a status: « envoyé »,
--   « signé », « refusé », « annulé », « expiré », and each signer's « consulté » / « signé ». Titles,
--   names, addresses and rejection reasons are redacted by core's audit triggers.
-- * Every statement is scoped to the actor's or the caller's clinic; messages never repeat a value.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_contracts', true);

-- -----------------------------------------------------------------------------
-- Permission (template row; the Task 2.20 trigger copies it to every clinic)
-- -----------------------------------------------------------------------------
insert into public.permissions (key, module_key, description) values
  ('professionals.contracts.send', 'professionals', 'Préparer, envoyer et régénérer le contrat de service')
on conflict do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'professionals.contracts.send')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- The template « Contrat de service » (a draft per clinic; nothing published)
-- -----------------------------------------------------------------------------
-- Version 1's content: the body (a PdfDocument, supabase/functions/_shared/pdf/model.ts), its
-- variables, signers and Documenso invitation. One copy, read by the seed below and by the
-- function's test (professionals-contract-send/template.test.ts reads this file).
create function private.professionals_contract_template()
returns jsonb
language sql
immutable
set search_path = ''
as $tpl$
  select $json${
  "body": {
    "title": "Contrat de service",
    "header": {"text": "Contrat de service", "initialsFor": ["professional"]},
    "footer": {"text": "Convention de prestation de services"},
    "blocks": [
      {"type": "paragraph", "runs": [{"text": "Texte à faire valider par la direction avant publication", "bold": true}]},
      {"type": "heading", "level": 1, "text": "Convention de prestation de services"},
      {"type": "paragraph", "runs": [{"text": "ENTRE :", "bold": true}]},
      {"type": "paragraph", "runs": [{"text": "{{contract.clinic_legal_name}}", "bold": true}, {"text": ", personne morale dont l’établissement est situé au {{contract.clinic_address}}, représentée par {{clinic.signatory_name}}, {{clinic.signatory_title}}, dûment autorisée aux fins des présentes;"}]},
      {"type": "paragraph", "runs": [{"text": "(ci-après désignée « la Clinique »)"}]},
      {"type": "paragraph", "runs": [{"text": "ET :", "bold": true}]},
      {"type": "paragraph", "runs": [{"text": "{{professional.full_name}}", "bold": true}, {"text": ", dont l’adresse est le {{professional.address}} et l’adresse courriel {{professional.email}};"}]},
      {"type": "paragraph", "runs": [{"text": "(ci-après désigné(e) « le Professionnel »)"}]},
      {"type": "paragraph", "runs": [{"text": "ATTENDU QUE le Professionnel déclare exercer une profession liée au domaine de la santé et des relations humaines, soit {{professional.profession}} ({{professional.membership}}), et, s’il s’agit d’une profession réglementée, être membre en règle de son ordre professionnel;"}]},
      {"type": "paragraph", "runs": [{"text": "EN CONSÉQUENCE DE QUOI, LES PARTIES CONVIENNENT DE CE QUI SUIT :", "bold": true}]},
      {"type": "heading", "level": 2, "text": "1. Préambule"},
      {"type": "paragraph", "runs": [{"text": "1.1. Les parties déclarent avoir pris connaissance des attendus et déclarations qui précèdent, en reconnaissent la véracité et acceptent qu’ils fassent partie intégrante de la présente convention."}]},
      {"type": "heading", "level": 2, "text": "2. Services offerts par la Clinique"},
      {"type": "paragraph", "runs": [{"text": "2.1. La Clinique dirige ses clients vers le Professionnel en fonction de leurs besoins, de l’expertise offerte par le Professionnel et de ses disponibilités."}]},
      {"type": "paragraph", "runs": [{"text": "2.2. La Clinique fournit les services généraux d’administration durant les heures normales d’affaires."}]},
      {"type": "paragraph", "runs": [{"text": "2.3. La Clinique fournit les services de gestion de la prise de rendez-vous et de la liste d’attente des clients, ainsi que la facturation des services professionnels et des frais liés et la perception des paiements auprès de la clientèle du Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "2.4. Le Professionnel consent à ce que les services mentionnés aux articles 2.1 à 2.3 soient accomplis exclusivement par la Clinique et s’engage à utiliser les formulaires et les outils fournis par la Clinique. Lorsque le Professionnel choisit d’exercer ses activités le soir ou la fin de semaine, il reconnaît que la Clinique n’aura pas de ressource disponible et ne fournira pas les services afférents."}]},
      {"type": "heading", "level": 2, "text": "3. Paiement des services"},
      {"type": "paragraph", "runs": [{"text": "3.1. Pendant toute la durée de la présente convention, le Professionnel accepte de payer à la Clinique, pour les services décrits à l’article 2, une portion des honoraires facturés pour chacun de ses actes professionnels ayant fait l’objet d’une facturation, avant toute taxe applicable. Cette portion est retenue sur les honoraires versés au Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "3.2. Les honoraires facturés aux clients et les montants versés au Professionnel, avant taxes, sont présentés à l’Annexe A, qui fait partie intégrante de la présente convention."}]},
      {"type": "paragraph", "runs": [{"text": "3.3. Pour les consultations, le montant versé au Professionnel augmente selon le nombre cumulatif de séances qu’il a réalisées avec les clients de la Clinique, par paliers, comme le présente l’Annexe A. Une séance de 50 ou de 60 minutes compte pour une séance; une séance de 30 minutes compte pour une demi-séance. La Clinique fait le suivi du nombre de séances chaque mois."}]},
      {"type": "paragraph", "runs": [{"text": "3.4. Si le client ou le Professionnel met fin à la démarche après le premier rendez-vous, cette rencontre n’est pas comptée dans le nombre cumulatif de séances."}]},
      {"type": "paragraph", "runs": [{"text": "3.5. Les frais d’annulation tardive ou d’absence non motivée sont versés au Professionnel selon la part prévue à l’Annexe A, seulement si le client les paie. Ils ne comptent pas dans le nombre cumulatif de séances."}]},
      {"type": "paragraph", "runs": [{"text": "3.6. Chaque premier du mois, la Clinique transmet au Professionnel un résumé des interventions du mois précédent afin qu’il puisse produire sa facture. Tout retard dans l’envoi de la facture reporte le paiement au jeudi suivant sa réception."}]},
      {"type": "heading", "level": 2, "text": "4. Responsabilités du Professionnel"},
      {"type": "paragraph", "runs": [{"text": "4.1. Le Professionnel s’engage à offrir au moins trois (3) plages horaires par semaine aux clients de la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "4.2. Le Professionnel s’engage à inscrire ses disponibilités dans le système de prise de rendez-vous de la Clinique au moins deux (2) semaines à l’avance. S’il modifie ses disponibilités, il assure le suivi auprès des clients touchés et en avise la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "4.3. Le Professionnel s’engage à indiquer, dans le dossier administratif du client, le statut du suivi : en cours, en pause ou terminé."}]},
      {"type": "paragraph", "runs": [{"text": "4.4. Lors d’une annulation tardive (moins de 24 heures) ou d’une absence non motivée, le Professionnel décide d’appliquer ou non les frais prévus au formulaire de consentement. La Clinique assure le suivi auprès du client. Le risque financier est partagé entre le Professionnel et la Clinique : les frais sont versés au Professionnel seulement si le client les paie."}]},
      {"type": "paragraph", "runs": [{"text": "4.5. Le Professionnel s’engage à vérifier que le client a accepté le formulaire de consentement de la Clinique et, à défaut, à faire le suivi nécessaire pour qu’il soit accepté."}]},
      {"type": "paragraph", "runs": [{"text": "4.6. Le Professionnel s’engage à fournir une photographie professionnelle conforme aux standards établis par la Clinique, afin d’assurer une image cohérente et représentative de la Clinique."}]},
      {"type": "heading", "level": 2, "text": "5. Durée de la convention"},
      {"type": "paragraph", "runs": [{"text": "5.1. La présente convention débute le jour de sa signature et demeure en vigueur pour une période de douze (12) mois."}]},
      {"type": "paragraph", "runs": [{"text": "5.2. Le Professionnel ou la Clinique peut résilier la présente convention avant son terme en donnant à l’autre partie un préavis écrit d’au moins trente (30) jours."}]},
      {"type": "paragraph", "runs": [{"text": "5.3. Les parties demeurent ouvertes à discuter et à convenir ensemble des ajustements à la présente convention qui pourraient s’avérer nécessaires."}]},
      {"type": "paragraph", "runs": [{"text": "5.4. À défaut d’un avis écrit, la convention est réputée renouvelée selon les termes et conditions alors en vigueur."}]},
      {"type": "heading", "level": 2, "text": "6. Incessibilité des droits"},
      {"type": "paragraph", "runs": [{"text": "6.1. Aucun droit ni privilège accordé au Professionnel par la présente convention ne peut être cédé à un tiers."}]},
      {"type": "heading", "level": 2, "text": "7. Exercice professionnel et dépenses"},
      {"type": "paragraph", "runs": [{"text": "7.1. Le Professionnel assume toute la responsabilité professionnelle et tous les frais liés à l’exercice de sa profession et à la conduite et au développement de ses affaires, y compris les frais d’assurance responsabilité et de formation professionnelle."}]},
      {"type": "paragraph", "runs": [{"text": "7.2. Le Professionnel fournit, avec la présente convention, la preuve de son inscription à son ordre professionnel, s’il y a lieu, et une preuve de son assurance responsabilité, et s’engage à divulguer sans délai tout changement de statut ou tout événement pouvant toucher sa pratique."}]},
      {"type": "paragraph", "runs": [{"text": "7.3. Le Professionnel peut mentionner le nom de la Clinique et permet que son nom soit mentionné comme membre de l’équipe de la Clinique."}]},
      {"type": "heading", "level": 2, "text": "8. Aucune association et non-responsabilité"},
      {"type": "paragraph", "runs": [{"text": "8.1. Sauf pour les actes précis prévus à la présente convention, aucune disposition ne doit être interprétée comme créant entre les parties une relation de mandant à mandataire, d’agence ou d’association, ni comme créant une société ou une entreprise conjointe. Le Professionnel est un travailleur autonome. Il n’est autorisé ni à conclure ou signer un contrat ou une convention, ni à donner une garantie ou une représentation au nom de la Clinique, ni à créer une dette ou une obligation, expresse ou implicite, au nom ou à la charge de la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "8.2. La Clinique n’assume aucune responsabilité quant au traitement fiscal des sommes versées au Professionnel, notamment à l’égard de toute taxe ou de tout impôt, y compris ceux qui auraient pu faire l’objet d’une retenue à la source. Le Professionnel s’engage à tenir la Clinique indemne de tout impôt, pénalité ou intérêt qu’elle pourrait devoir payer à cet égard, et de tous les frais (y compris les honoraires judiciaires et extrajudiciaires raisonnables) qu’elle pourrait subir en raison d’une demande des autorités fiscales."}]},
      {"type": "paragraph", "runs": [{"text": "8.3. Le Professionnel déclare être entièrement autonome et indépendant de la Clinique et s’engage à acquitter tous les droits et cotisations dus aux autorités fiscales provinciales et fédérales et à toute autre autorité publique."}]},
      {"type": "heading", "level": 2, "text": "9. Engagement de confidentialité"},
      {"type": "paragraph", "runs": [{"text": "9.1. Le Professionnel s’engage à garder confidentielle toute propriété intellectuelle et toute information concernant la Clinique dont il prend connaissance, directement ou indirectement, dans le cadre de la présente convention. Sont notamment confidentiels : les formulaires conçus par la Clinique, ses secrets commerciaux (procédés, méthodes de commercialisation, etc.), ses programmes informatiques et codes d’accès, ainsi que ses contrats, soumissions, listes de prix et listes de clients."}]},
      {"type": "paragraph", "runs": [{"text": "9.2. Cette obligation de confidentialité demeure après la fin de la présente convention."}]},
      {"type": "heading", "level": 2, "text": "10. Non-concurrence et non-sollicitation"},
      {"type": "paragraph", "runs": [{"text": "10.1. Pendant la durée de la présente convention et de tout renouvellement, et pendant un (1) an après sa fin, le Professionnel s’engage à ne pas :"}]},
      {"type": "paragraph", "runs": [{"text": "10.1.1. détourner ou tenter de détourner, directement ou indirectement, une affaire ou un client de la Clinique vers un établissement concurrent;"}]},
      {"type": "paragraph", "runs": [{"text": "10.1.2. embaucher ou tenter d’embaucher une personne employée par la Clinique, ni l’inciter, directement ou indirectement, à quitter son emploi."}]},
      {"type": "heading", "level": 2, "text": "11. Nom, marque de commerce et réputation"},
      {"type": "paragraph", "runs": [{"text": "11.1. Le Professionnel reconnaît que le nom de la Clinique et toute marque de commerce qui y est liée sont la propriété de la Clinique et qu’il n’a aucun droit sur ceux-ci, sauf celui de mentionner qu’il fait partie de l’équipe de la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "11.2. Le Professionnel s’engage à ne pas publier sur le Web ou dans les médias sociaux de propos pouvant nuire à la réputation de la Clinique. À défaut, il devra verser à la Clinique un montant de 1 000 $ par jour à titre de dédommagement."}]},
      {"type": "heading", "level": 2, "text": "12. Avis"},
      {"type": "paragraph", "runs": [{"text": "12.1. Tous les avis prévus à la présente convention sont donnés par écrit et sont réputés donnés s’ils sont remis en main propre, envoyés par courrier recommandé ou par courriel à l’adresse indiquée en première page, ou à toute autre adresse communiquée par avis écrit."}]},
      {"type": "heading", "level": 2, "text": "13. Fin de la convention"},
      {"type": "paragraph", "runs": [{"text": "13.1. En plus des cas prévus à la présente convention, la Clinique peut mettre fin à la convention par un préavis écrit de trente (30) jours au Professionnel dans l’un des cas suivants :"}]},
      {"type": "paragraph", "runs": [{"text": "13.1.1. le Professionnel n’est plus en règle avec son ordre professionnel, s’il y a lieu;"}]},
      {"type": "paragraph", "runs": [{"text": "13.1.2. le Professionnel ne remplit pas une obligation prévue à la présente convention et n’y remédie pas dans les dix (10) jours d’un avis de défaut;"}]},
      {"type": "paragraph", "runs": [{"text": "13.1.3. la Clinique cesse ses activités;"}]},
      {"type": "paragraph", "runs": [{"text": "13.1.4. l’une des parties fait faillite, entreprend des procédures de protection contre ses créanciers, de liquidation ou de dissolution, volontairement ou par ordonnance d’un tribunal compétent."}]},
      {"type": "paragraph", "runs": [{"text": "13.2. La fin de la présente convention, par entente ou par défaut, a les effets suivants :"}]},
      {"type": "paragraph", "runs": [{"text": "13.2.1. tous les droits accordés au Professionnel prennent fin, y compris celui d’utiliser le nom de la Clinique;"}]},
      {"type": "paragraph", "runs": [{"text": "13.2.2. le Professionnel évite d’agir de façon à laisser croire qu’il est toujours lié à la Clinique;"}]},
      {"type": "paragraph", "runs": [{"text": "13.2.3. le Professionnel remet sans délai à la Clinique tous les documents qu’elle lui a fournis, sous quelque forme que ce soit;"}]},
      {"type": "paragraph", "runs": [{"text": "13.2.4. aucune partie n’est responsable envers l’autre des dommages ou des pertes, y compris les pertes de profits, causés par la fin de la convention;"}]},
      {"type": "paragraph", "runs": [{"text": "13.2.5. le Professionnel conserve une copie de ses dossiers pendant cinq (5) ans."}]},
      {"type": "heading", "level": 2, "text": "14. Dispositions générales"},
      {"type": "paragraph", "runs": [{"text": "14.1. Chaque disposition de la présente convention est distincte. Si un tribunal déclare une disposition nulle, invalide ou inapplicable, cette disposition est réputée séparée du reste de la convention, qui demeure en vigueur."}]},
      {"type": "paragraph", "runs": [{"text": "14.2. La présente convention lie les parties ainsi que leurs héritiers, administrateurs, représentants légaux et successeurs."}]},
      {"type": "paragraph", "runs": [{"text": "14.3. La présente convention est régie par les lois applicables au Québec. Tout litige qui en découle est soumis au tribunal compétent du district judiciaire de Québec."}]},
      {"type": "paragraph", "runs": [{"text": "14.4. La présente convention remplace toute convention, entente, lettre d’entente ou communication antérieure, verbale ou écrite, portant sur le même objet."}]},
      {"type": "paragraph", "runs": [{"text": "14.5. Les parties signent la présente convention électroniquement; elle prend effet à la date de la dernière signature. Document préparé le {{today}}."}]},
      {"type": "pageBreak"},
      {"type": "heading", "level": 1, "text": "Annexe A — Honoraires et montants versés"},
      {"type": "paragraph", "runs": [{"text": "{{pricing.annexe_a}}"}]},
      {"type": "signaturePage", "signers": [{"role": "professional", "label": "Le Professionnel : {{professional.full_name}}"}, {"role": "clinic", "label": "Pour la Clinique : {{clinic.signatory_name}}"}]}
    ]
  },
  "variables": [
    {"path": "clinic.name", "label": "Nom de la clinique", "sample": "Clinique MANA", "required": true, "kind": "text"},
    {"path": "clinic.signatory_name", "label": "Signataire de la clinique", "sample": "Dominique Exemple", "required": true, "kind": "text"},
    {"path": "clinic.signatory_title", "label": "Titre du signataire", "sample": "présidente", "required": true, "kind": "text"},
    {"path": "contract.clinic_legal_name", "label": "Nom légal de la clinique", "sample": "Clinique Exemple inc.", "required": true, "kind": "text"},
    {"path": "contract.clinic_address", "label": "Adresse de la clinique", "sample": "100, rue Principale, Québec (QC) G1A 1A1", "required": true, "kind": "text"},
    {"path": "professional.full_name", "label": "Nom du professionnel", "sample": "Camille Exemple", "required": true, "kind": "text"},
    {"path": "professional.first_name", "label": "Prénom du professionnel", "sample": "Camille", "required": true, "kind": "text"},
    {"path": "professional.email", "label": "Courriel de connexion du professionnel", "sample": "camille@exemple.ca", "required": true, "kind": "text"},
    {"path": "professional.address", "label": "Adresse du professionnel", "sample": "200, avenue Exemple, Lévis (QC) G6V 1A1", "required": true, "kind": "text"},
    {"path": "professional.profession", "label": "Profession", "sample": "psychologue", "required": true, "kind": "text"},
    {"path": "professional.membership", "label": "Ordre et permis", "sample": "membre de l’Ordre des psychologues du Québec, permis nº 12345-67", "required": true, "kind": "text"},
    {"path": "today", "label": "Date du jour", "sample": "2026-10-08", "required": true, "kind": "date"},
    {"path": "pricing.annexe_a", "label": "Tableau de l’Annexe A", "sample": "(le tableau des honoraires du professionnel)", "required": true, "kind": "text"}
  ],
  "signers": [{"role": "professional", "label": "Professionnel", "order": 1, "required": true}, {"role": "clinic", "label": "Signataire de la clinique", "order": 2, "required": false}],
  "email_subject": "Votre contrat de service avec {{clinic.name}}",
  "email_message": "Bonjour {{professional.first_name}},\n\nVoici votre contrat de service avec {{clinic.name}}. Prenez le temps de le lire, paraphez chaque page et signez la dernière page.\n\nPour toute question, communiquez avec la clinique.\n\nMerci!"
}$json$::jsonb
$tpl$;
revoke all on function private.professionals_contract_template() from public, anon, authenticated, service_role;

create function private.seed_professionals_contract_template(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_template uuid;
  v_content jsonb := private.professionals_contract_template();
begin
  perform pg_catalog.set_config('app.audit_source', 'seed:professionals_contract', true);
  insert into public.document_templates as t
    (org_id, key, module_key, title, description, view_permission, edit_permission)
  values
    (p_org, 'professionals.service_contract', 'professionals', 'Contrat de service',
     'Convention de prestation de services envoyée au professionnel pour signature électronique.',
     'professionals.view', 'professionals.settings')
  on conflict (org_id, key) do nothing
  returning t.id into v_template;
  -- A clinic that already has the template keeps it as it is.
  if v_template is not null then
    insert into public.document_template_versions
      (template_id, org_id, version, body, variables, signers, email_subject, email_message)
    values
      (v_template, p_org, 1, v_content -> 'body', v_content -> 'variables', v_content -> 'signers',
       v_content ->> 'email_subject', v_content ->> 'email_message');
  end if;
  perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
end;
$$;

create function private.seed_professionals_contract_template_on_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_professionals_contract_template(new.id);
  return null;
end;
$$;

create trigger organizations_seed_professionals_template
  after insert on public.organizations
  for each row execute function private.seed_professionals_contract_template_on_org();

revoke all on function private.seed_professionals_contract_template(uuid),
                       private.seed_professionals_contract_template_on_org()
  from public, anon, authenticated, service_role;

-- Existing organizations (staging).
select private.seed_professionals_contract_template(o.id) from public.organizations o;

-- -----------------------------------------------------------------------------
-- The printed terms (granted to no role; prepare_professional_contract calls it)
-- -----------------------------------------------------------------------------
-- {title, values, annexe, signers} for p_id of p_org on the clinic's today (header). values:
-- professional {full_name, first_name, email (the file's address: the login's once linked, A5.3),
-- address (one line, null without a first line), profession (the titles in the professional's
-- form, the primary first, joined by « et »), membership (« membre de l'Ordre …, permis nº … », or
-- « profession non réglementée par un ordre professionnel »)}, contract {clinic_legal_name (else
-- the clinic's name), clinic_address (one line, null without a first line)}, today
-- (yyyy-mm-dd), pricing {annexe_a} (the placeholder's text when no table replaces it). Refused
-- (P0001): an unknown professional, no primary title (HINT profession), no grid for it (HINT
-- pricing).
create function private.professional_contract_terms(p_org uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_pro public.professionals;
  v_state record;
  v_org public.organizations;
  v_annexe jsonb;
  v_values jsonb;
  v_signers jsonb;
begin
  select * into v_org from public.organizations o where o.id = p_org;
  select * into v_pro from public.professionals p where p.id = p_id and p.org_id = p_org;
  if v_pro.id is null or v_org.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;
  v_today := (pg_catalog.now() at time zone v_org.timezone)::date;

  select o.* into v_state
    from private.retention_overview(p_org, pg_catalog.date_trunc('month', v_today)::date, v_today) o
   where o.professional_id = p_id;
  if v_state.title_id is null then
    raise exception 'Ajoutez la profession principale du professionnel avant d''envoyer le contrat.'
      using errcode = 'P0001', hint = 'profession';
  end if;
  if v_state.grid_id is null then
    raise exception 'Les tarifs de cette profession ne sont pas encore configurés (Paramètres → Rémunération).'
      using errcode = 'P0001', hint = 'pricing';
  end if;

  select pg_catalog.jsonb_build_object(
           'on', v_today,
           'title_label', v_state.title_label,
           'grid_id', g.id,
           'grid_effective_from', g.effective_from,
           'prices', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'duration', gp.duration, 'client_price_cents', gp.client_price_cents)
                              order by gp.duration desc), '[]'::jsonb)
                        from public.retention_grid_prices gp where gp.grid_id = g.id and gp.org_id = p_org),
           'tiers', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'from', t.threshold_sessions,
                               'to', t.next_threshold - 1,
                               'retention_pct', t.retention_pct,
                               'pay', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                                'duration', gp.duration,
                                                'cents', private.retention_pay_cents(gp.client_price_cents, t.retention_pct))
                                              order by gp.duration desc), '[]'::jsonb)
                                         from public.retention_grid_prices gp
                                        where gp.grid_id = g.id and gp.org_id = p_org))
                             order by t.threshold_sessions), '[]'::jsonb)
                       from (select x.threshold_sessions, x.retention_pct,
                                    pg_catalog.lead(x.threshold_sessions) over (order by x.threshold_sessions) as next_threshold
                               from public.retention_grid_tiers x
                              where x.grid_id = g.id and x.org_id = p_org) t),
           'sessions_total', v_state.sessions_total,
           'current_tier_from', v_state.suggested_threshold,
           'in_force', case when v_state.in_force_pct is null then null else pg_catalog.jsonb_build_object(
                         'retention_pct', v_state.in_force_pct,
                         'pay', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                          'duration', gp.duration,
                                          'cents', private.retention_pay_cents(gp.client_price_cents, v_state.in_force_pct))
                                        order by gp.duration desc), '[]'::jsonb)
                                   from public.retention_grid_prices gp where gp.grid_id = g.id and gp.org_id = p_org)) end,
           'other', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'kind', k.key, 'name', k.name, 'retention_pct', c.retention_pct)
                             order by k.sort_order, k.key), '[]'::jsonb)
                       from public.compensation_kinds k
                       left join public.compensation_rates c
                         on c.org_id = p_org and c.kind = k.key
                        and c.effective_from <= v_today and (c.effective_to is null or v_today < c.effective_to)))
    into v_annexe
    from public.retention_grids g
   where g.id = v_state.grid_id and g.org_id = p_org;

  v_values := pg_catalog.jsonb_build_object(
    'professional', pg_catalog.jsonb_build_object(
      'full_name', v_pro.first_name || ' ' || v_pro.last_name,
      'first_name', v_pro.first_name,
      'email', v_pro.email,
      'address', case when v_pro.address_line1 is not null then
                   pg_catalog.concat_ws(', ', v_pro.address_line1, v_pro.address_line2,
                     pg_catalog.concat_ws(' ', v_pro.city,
                                          case when v_pro.province is not null then '(' || v_pro.province || ')' end,
                                          v_pro.postal_code)) end,
      -- In the sentence « soit psychologue (…) »: the label's first letter in lower case.
      'profession', (select pg_catalog.string_agg(
                              pg_catalog.lower(pg_catalog.left(l.label, 1)) || pg_catalog.substr(l.label, 2),
                              ' et ' order by x.is_primary desc, x.created_at, x.id)
                       from public.professional_professions x
                       join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id
                       cross join lateral (select private.profession_title_label(t.name, t.name_feminine, t.name_masculine,
                                                                                 v_pro.gender) as label) l
                      where x.professional_id = p_id and x.org_id = p_org),
      'membership', (select case when o.id is null then 'profession non réglementée par un ordre professionnel'
                                 else 'membre de l’' || o.name
                                      || case when x.licence_number is not null then ', permis nº ' || x.licence_number else '' end
                            end
                       from public.professional_professions x
                       join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id
                       left join public.professional_orders o on o.org_id = t.org_id and o.id = t.order_id
                      where x.professional_id = p_id and x.org_id = p_org and x.is_primary)),
    'contract', pg_catalog.jsonb_build_object(
      'clinic_legal_name', coalesce(v_org.legal_name, v_org.name),
      'clinic_address', case when v_org.address_line1 is not null then
                          pg_catalog.concat_ws(', ', v_org.address_line1, v_org.address_line2,
                            pg_catalog.concat_ws(' ', v_org.city,
                                                 case when v_org.province is not null then '(' || v_org.province || ')' end,
                                                 v_org.postal_code)) end),
    'today', v_today,
    'pricing', pg_catalog.jsonb_build_object('annexe_a', 'Annexe A'));

  -- The professional first, then the clinic's signer from Settings « Signataire » when it has
  -- both a name and an address (optional second signer, A5.8).
  v_signers := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                 'role', 'professional', 'name', v_pro.first_name || ' ' || v_pro.last_name,
                 'email', v_pro.email, 'order', 1));
  if nullif(pg_catalog.btrim(v_org.signatory_name), '') is not null
     and nullif(pg_catalog.btrim(v_org.signatory_email), '') is not null then
    v_signers := v_signers || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                   'role', 'clinic', 'name', pg_catalog.btrim(v_org.signatory_name),
                   'email', pg_catalog.btrim(v_org.signatory_email), 'order', 2));
  end if;

  return pg_catalog.jsonb_build_object(
    'title', 'Contrat de service — ' || v_pro.first_name || ' ' || v_pro.last_name,
    'values', v_values,
    'annexe', v_annexe,
    'signers', v_signers);
end;
$$;
revoke all on function private.professional_contract_terms(uuid, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The snapshot of what a request prints (P4-151, P4-434)
-- -----------------------------------------------------------------------------
create table public.professional_contract_snapshots (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null,
  professional_id uuid not null,
  -- signature_requests.idempotency_key of the request it prints.
  idempotency_key text not null,
  template_version_id uuid not null,
  title text not null,
  -- The template values (the professional's address among them: redacted from the audit).
  template_values jsonb not null,
  -- The Annexe A terms (amounts in cents, retention percentages, the grid and tier).
  annexe jsonb not null,
  -- [{role, name, email, order}], as sent to create_signature_request (redacted from the audit).
  signers jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(user_id) on delete set null,
  -- PK starts with professional_id: audit record ids start with it (P4-36).
  constraint professional_contract_snapshots_pkey primary key (professional_id, id),
  constraint professional_contract_snapshots_id_key unique (id),
  constraint professional_contract_snapshots_key_key unique (org_id, idempotency_key),
  constraint professional_contract_snapshots_professional_fkey foreign key (org_id, professional_id)
    references public.professionals (org_id, id) on delete cascade,
  constraint professional_contract_snapshots_version_fkey foreign key (template_version_id, org_id)
    references public.document_template_versions (id, org_id),
  constraint professional_contract_snapshots_key_check check (idempotency_key ~ '^[A-Za-z0-9_:.-]{1,200}$'),
  constraint professional_contract_snapshots_title_check check (char_length(title) between 1 and 200),
  constraint professional_contract_snapshots_values_check check (
    pg_catalog.jsonb_typeof(template_values) = 'object' and pg_catalog.pg_column_size(template_values) <= 65536),
  constraint professional_contract_snapshots_annexe_check check (
    pg_catalog.jsonb_typeof(annexe) = 'object' and pg_catalog.pg_column_size(annexe) <= 65536),
  constraint professional_contract_snapshots_signers_check check (
    pg_catalog.jsonb_typeof(signers) = 'array' and pg_catalog.jsonb_array_length(signers) between 1 and 3)
);
create index professional_contract_snapshots_org_idx on public.professional_contract_snapshots (org_id, professional_id);
create index professional_contract_snapshots_version_idx on public.professional_contract_snapshots (template_version_id);
create index professional_contract_snapshots_created_by_idx on public.professional_contract_snapshots (created_by);

revoke all on public.professional_contract_snapshots from anon, authenticated;
grant select on public.professional_contract_snapshots to authenticated;
alter table public.professional_contract_snapshots enable row level security;
create policy professional_contract_snapshots_select on public.professional_contract_snapshots
  for select to authenticated
  using (org_id = (select private.current_user_org_id()) and (select private.has_permission('professionals.compensation')));
create trigger professional_contract_snapshots_audit
  after insert or update or delete on public.professional_contract_snapshots
  for each row execute function private.audit_trigger('template_values', 'signers');

-- -----------------------------------------------------------------------------
-- prepare_professional_contract (service role; the function's one read before a send)
-- -----------------------------------------------------------------------------
-- p_action:
--   send        the open draft's own key when there is one (a retry of the same request), else
--               'professionals.service_contract:<id>:<p_idempotency_key>'; refused while a
--               contract is sent or viewed (HINT contract);
--   regenerate  a new key from p_idempotency_key; `cancel` names the open request to close first,
--               unless it is this key's own request (a double click);
--   resend      no key: `resend` names the open sent or viewed request's envelope and its next
--               signer's Documenso recipient (the first one who has not signed).
-- Returns {idempotency_key, template_version_id, title, values, annexe, signers, cancel:
-- {request_id, envelope_id, status} | null} for send and regenerate (the snapshot's, written here
-- the first time), {resend: {request_id, envelope_id, recipient_ids}} for resend. Refused (P0001,
-- HINT): an inactive file (status), a signed contract (contract), no published template (template),
-- a draft whose version is no longer published (regenerate), and the terms' refusals; the actor
-- not allowed → 42501; bad arguments → 22023.
create function public.prepare_professional_contract(p_actor uuid, p_id uuid, p_action text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_row public.professionals;
  v_open public.signature_requests;
  v_latest_status text;
  v_key text;
  v_cancel jsonb;
  v_snapshot public.professional_contract_snapshots;
  v_version uuid;
  v_terms jsonb;
  v_prev_source text := pg_catalog.current_setting('app.audit_source', true);
  v_prev_actor text := pg_catalog.current_setting('app.audit_actor', true);
begin
  if p_actor is null or p_id is null or p_action is null or p_action not in ('send', 'regenerate', 'resend')
     or (p_action <> 'resend' and coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9_-]{1,100}$') then
    raise exception 'Arguments invalides : acteur, professionnel, action et clé attendus.' using errcode = '22023';
  end if;
  -- The actor's org unlocked, the professional's lock, then the actor's permissions (Task 3.18).
  select p.org_id into v_org from public.profiles p where p.user_id = p_actor;
  select * into v_row from public.professionals p where p.id = p_id and p.org_id = v_org for no key update;
  v_keys := private.permission_keys_for(p_actor);
  if not (v_keys @> array['professionals.contracts.send', 'professionals.compensation'])
     or not exists (select 1 from public.profiles p where p.user_id = p_actor and p.org_id = v_org and p.status = 'active') then
    raise exception 'Permission refusée : professionals.contracts.send' using errcode = '42501';
  end if;
  if v_row.id is null then
    raise exception 'Professionnel introuvable.' using errcode = 'P0001';
  end if;

  select * into v_open from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
     and (r.status in ('sent', 'viewed') or (r.status = 'draft' and coalesce(r.last_error, '') <> 'abandoned'));

  if p_action = 'resend' then
    if v_open.id is null or v_open.status not in ('sent', 'viewed') then
      raise exception 'Aucun contrat n''attend de signature.' using errcode = 'P0001', hint = 'contract';
    end if;
    return pg_catalog.jsonb_build_object('resend', pg_catalog.jsonb_build_object(
      'request_id', v_open.id,
      'envelope_id', v_open.envelope_id,
      'recipient_ids', coalesce((select pg_catalog.jsonb_agg(s.documenso_recipient_id)
                                   from (select x.documenso_recipient_id from public.signature_request_signers x
                                          where x.request_id = v_open.id and x.status in ('pending', 'viewed')
                                            and x.documenso_recipient_id is not null
                                          order by x.signing_order limit 1) s), '[]'::jsonb)));
  end if;

  if v_row.status = 'inactive' then
    raise exception 'Un dossier inactif ne peut pas recevoir de contrat.' using errcode = 'P0001', hint = 'status';
  end if;
  select r.status into v_latest_status from public.signature_requests r
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
   order by r.created_at desc, r.id desc
   limit 1;
  if v_latest_status = 'signed' then
    raise exception 'Le contrat de service de ce professionnel est déjà signé.' using errcode = 'P0001', hint = 'contract';
  end if;

  v_key := 'professionals.service_contract:' || p_id || ':' || p_idempotency_key;
  if p_action = 'send' then
    if v_open.status in ('sent', 'viewed') then
      raise exception 'Un contrat attend déjà la signature. Utilisez « Renvoyer » ou « Régénérer ».'
        using errcode = 'P0001', hint = 'contract';
    end if;
    -- A draft is the same request sent again (its send failed, or is under way: the send claim
    -- decides), under its own key.
    if v_open.id is not null then
      v_key := v_open.idempotency_key;
    end if;
  elsif v_open.id is not null and v_open.idempotency_key <> v_key then
    v_cancel := pg_catalog.jsonb_build_object('request_id', v_open.id, 'envelope_id', v_open.envelope_id,
                                              'status', v_open.status);
  end if;

  select * into v_snapshot from public.professional_contract_snapshots s
   where s.org_id = v_org and s.idempotency_key = v_key;
  if v_snapshot.id is not null then
    if not exists (select 1 from public.document_template_versions v
                    join public.document_templates t on t.id = v.template_id
                   where v.id = v_snapshot.template_version_id and v.status = 'published' and t.is_active) then
      raise exception 'Le modèle de contrat a changé depuis cet envoi. Utilisez « Régénérer ».'
        using errcode = 'P0001', hint = 'regenerate';
    end if;
  else
    select v.id into v_version
      from public.document_templates t
      join public.document_template_versions v on v.template_id = t.id and v.status = 'published'
     where t.org_id = v_org and t.key = 'professionals.service_contract' and t.is_active;
    if v_version is null then
      raise exception 'Aucun modèle de contrat publié. Publiez « Contrat de service » dans Paramètres → Contrats.'
        using errcode = 'P0001', hint = 'template';
    end if;
    v_terms := private.professional_contract_terms(v_org, p_id);

    perform pg_catalog.set_config('app.audit_source', 'rpc:prepare_professional_contract', true);
    perform pg_catalog.set_config('app.audit_actor', p_actor::text, true);
    insert into public.professional_contract_snapshots as s
      (org_id, professional_id, idempotency_key, template_version_id, title, template_values, annexe, signers, created_by)
    values
      (v_org, p_id, v_key, v_version, v_terms ->> 'title', v_terms -> 'values', v_terms -> 'annexe',
       v_terms -> 'signers', p_actor)
    returning * into v_snapshot;
    perform pg_catalog.set_config('app.audit_source', coalesce(v_prev_source, ''), true);
    perform pg_catalog.set_config('app.audit_actor', coalesce(v_prev_actor, ''), true);
  end if;

  return pg_catalog.jsonb_build_object(
    'idempotency_key', v_snapshot.idempotency_key,
    'template_version_id', v_snapshot.template_version_id,
    'title', v_snapshot.title,
    'values', v_snapshot.template_values,
    'annexe', v_snapshot.annexe,
    'signers', v_snapshot.signers,
    'cancel', v_cancel);
end;
$$;
revoke all on function public.prepare_professional_contract(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.prepare_professional_contract(uuid, uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- The contract card (professionals.view)
-- -----------------------------------------------------------------------------
-- {template: {id, published_version_id, published_version, published_at, draft_version_id} | null
-- (none, or retired), clinic_signer (Settings « Signataire » has a name and an address),
-- request: the latest service-contract request or null: {id, status, last_error, template_version,
-- created_at, sent_at, viewed_at, completed_at, rejected_at, cancelled_at, expired_at, expires_at,
-- can_read (the caller holds its view permission), signed_file_id and rejection_reason (only then),
-- signers: [{role, name, status, signing_order, viewed_at, signed_at, rejected_at}]}}. Null for a
-- professional the caller cannot read (another clinic's).
create function public.get_professional_contract(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.current_user_org_id();
  v_perms text[] := private.current_permission_keys()::text[];
  v_request jsonb;
begin
  if not ('professionals.view' = any (v_perms)) then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.professionals p where p.id = p_id and p.org_id = v_org) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
           'id', r.id, 'status', r.status, 'last_error', r.last_error, 'template_version', v.version,
           'created_at', r.created_at, 'sent_at', r.sent_at, 'viewed_at', r.viewed_at,
           'completed_at', r.completed_at, 'rejected_at', r.rejected_at, 'cancelled_at', r.cancelled_at,
           'expired_at', r.expired_at, 'expires_at', r.expires_at,
           'can_read', r.view_permission = any (v_perms),
           'signed_file_id', case when r.view_permission = any (v_perms) then r.signed_file_id end,
           'rejection_reason', case when r.view_permission = any (v_perms) then r.rejection_reason end,
           'signers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'role', s.role, 'name', s.name, 'status', s.status,
                                         'signing_order', s.signing_order, 'viewed_at', s.viewed_at,
                                         'signed_at', s.signed_at, 'rejected_at', s.rejected_at)
                                       order by s.signing_order)
                                  from public.signature_request_signers s where s.request_id = r.id), '[]'::jsonb))
    into v_request
    from public.signature_requests r
    left join public.document_template_versions v on v.id = r.template_version_id
   where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
     and r.purpose = 'professionals.service_contract'
   order by r.created_at desc, r.id desc
   limit 1;

  return pg_catalog.jsonb_build_object(
    'template', (select pg_catalog.jsonb_build_object(
                          'id', t.id, 'published_version_id', p.id, 'published_version', p.version,
                          'published_at', p.published_at, 'draft_version_id', d.id)
                   from public.document_templates t
                   left join public.document_template_versions p on p.template_id = t.id and p.status = 'published'
                   left join public.document_template_versions d on d.template_id = t.id and d.status = 'draft'
                  where t.org_id = v_org and t.key = 'professionals.service_contract' and t.is_active),
    'clinic_signer', (select nullif(pg_catalog.btrim(o.signatory_name), '') is not null
                             and nullif(pg_catalog.btrim(o.signatory_email), '') is not null
                        from public.organizations o where o.id = v_org),
    'request', v_request);
end;
$$;
revoke all on function public.get_professional_contract(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_professional_contract(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Readiness: « Contrat de service signé » (the onboarding view replaced, a column appended)
-- -----------------------------------------------------------------------------
-- The professionals of the caller's clinic whose latest service-contract request is signed, for
-- the invoker views: every professional for professionals.view, else the caller's own file
-- (professionals.self), as professional_login_email_mismatches. One scan of
-- signature_requests_subject_idx per statement.
create function private.professional_signed_contracts()
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 50
as $$
  select l.subject_id
    from (select distinct on (r.subject_id) r.subject_id, r.status
            from public.signature_requests r
           where r.org_id = (select private.current_user_org_id())
             and r.subject_type = 'professional'
             and r.purpose = 'professionals.service_contract'
             and ((select private.has_permission('professionals.view'))
                  or (r.subject_id = (select private.current_professional_id())
                      and (select private.has_permission('professionals.self'))))
           order by r.subject_id, r.created_at desc, r.id desc) l
   where l.status = 'signed'
$$;
-- The invoker views below call it with the reader's privileges (not service_role: no clinic).
revoke all on function private.professional_signed_contracts() from public, anon, authenticated, service_role;
grant execute on function private.professional_signed_contracts() to authenticated;

-- Same columns and joins as *_professionals_documents.sql (4c.2: the documents and the insurance),
-- then contract_signed; `ready` requires it.
create or replace view public.professionals_readiness with (security_invoker = true) as
select r.professional_id, r.org_id, r.has_profession, r.licences_ok, r.restricted_motifs_ok, r.has_language,
       r.has_clientele, r.has_motif, r.matching_complete, r.email_matches_login,
       (r.matching_complete and r.account_created and r.submission_approved and r.documents_ok
        and r.contract_signed) as ready,
       r.account_created, r.submission_approved,
       r.photo_ok, r.insurance_ok, r.consent_ok, r.documents_ok, r.documents_done, r.documents_required,
       r.documents_missing, r.insurance_status, r.insurance_expires_on, r.contract_signed
  from (
    select p.id as professional_id,
           p.org_id,
           (pr.n is not null)                                                  as has_profession,
           (coalesce(pr.missing_licences, 0) = 0)                              as licences_ok,
           (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0) as restricted_motifs_ok,
           (l.professional_id is not null)                                     as has_language,
           (c.professional_id is not null)                                     as has_clientele,
           (m.professional_id is not null)                                     as has_motif,
           (pr.n is not null and coalesce(pr.missing_licences, 0) = 0
            and (not coalesce(m.has_restricted, false) or coalesce(pr.regulated, 0) > 0)
            and l.professional_id is not null and c.professional_id is not null
            and m.professional_id is not null)                                 as matching_complete,
           (em.id is null)                                                     as email_matches_login,
           (p.profile_id is not null)                                          as account_created,
           (sa.professional_id is not null)                                    as submission_approved,
           coalesce(dc.photo_ok, false)                                        as photo_ok,
           coalesce(dc.insurance_ok, false)                                    as insurance_ok,
           coalesce(dc.consent_ok, false)                                      as consent_ok,
           (coalesce(dc.required_done, 0) = coalesce(dc.required_n, 0))        as documents_ok,
           coalesce(dc.required_done, 0)::int                                  as documents_done,
           coalesce(dc.required_n, 0)::int                                     as documents_required,
           pg_catalog.array_remove(array[
             case when dc.photo_missing then 'photo' end,
             case when dc.insurance_missing then
               case when dc.insurance_expires_on is null then 'insurance' else 'insurance_expired' end end,
             case when dc.consent_missing then 'image_consent' end,
             case when dc.other_missing then 'other_documents' end]::text[], null) as documents_missing,
           coalesce(dc.insurance_status, 'missing')                            as insurance_status,
           dc.insurance_expires_on,
           (sc.id is not null)                                                 as contract_signed
      from public.professionals p
      left join (select x.professional_id,
                        count(*) as n,
                        count(*) filter (where t.order_id is not null and x.licence_number is null) as missing_licences,
                        count(*) filter (where t.order_id is not null) as regulated
                   from public.professional_professions x
                   join public.profession_titles t on t.org_id = x.org_id and t.id = x.profession_title_id and t.is_active
                  group by x.professional_id) pr on pr.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_languages x
                   join public.languages g on g.org_id = x.org_id and g.id = x.language_id and g.is_active) l on l.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_clienteles x
                   join public.clienteles k on k.org_id = x.org_id and k.id = x.clientele_id and k.is_active) c on c.professional_id = p.id
      left join (select x.professional_id, bool_or(mo.is_restricted) as has_restricted
                   from public.professional_motifs x
                   join public.motifs mo on mo.org_id = x.org_id and mo.id = x.motif_id and mo.is_active
                  group by x.professional_id) m on m.professional_id = p.id
      left join (select distinct x.professional_id from public.professional_submissions x
                  where x.kind = 'onboarding' and x.status = 'approved') sa on sa.professional_id = p.id
      left join private.professional_login_email_mismatches() as em(id) on em.id = p.id
      left join private.professional_signed_contracts() as sc(id) on sc.id = p.id
      -- One row per professional and active type of the clinic: satisfied or not, on the clinic's
      -- today; then one row per professional (grouped once per statement).
      left join (
        select s.professional_id,
               count(*) filter (where s.required) as required_n,
               count(*) filter (where s.required and s.ok) as required_done,
               bool_or(s.key = 'photo' and s.ok) as photo_ok,
               bool_or(s.key = 'insurance' and s.ok) as insurance_ok,
               bool_or(s.key = 'image_consent' and s.ok) as consent_ok,
               bool_or(s.key = 'photo' and s.required and not s.ok) as photo_missing,
               bool_or(s.key = 'insurance' and s.required and not s.ok) as insurance_missing,
               bool_or(s.key = 'image_consent' and s.required and not s.ok) as consent_missing,
               bool_or(not s.is_system and s.required and not s.ok) as other_missing,
               max(s.last_known) filter (where s.key = 'insurance') as insurance_expires_on,
               max(s.insurance_status) filter (where s.key = 'insurance') as insurance_status
          from (
            select x.id as professional_id, t.key, t.is_system, t.required,
                   (case when t.expiry_rule = 'none' then coalesce(d.any_verified, false)
                         else coalesce(d.valid_until >= x.today, false) end
                    or (t.key = 'image_consent' and coalesce(k.valid_until >= x.today, false))) as ok,
                   d.last_known,
                   case when t.key <> 'insurance' then null
                        when t.expiry_rule = 'none' then case when coalesce(d.any_verified, false) then 'valid' else 'missing' end
                        when d.valid_until >= x.today then
                          case when t.max_days > 0 and d.valid_until - x.today <= t.max_days then 'expiring' else 'valid' end
                        when d.last_known is not null then 'expired'
                        else 'missing'
                   end as insurance_status
              from (select p2.id, p2.org_id, (pg_catalog.now() at time zone o.timezone)::date as today
                      from public.professionals p2
                      join public.organizations o on o.id = p2.org_id) x
              join (select dt.*, coalesce((select max(n) from pg_catalog.unnest(dt.reminder_days) n), 0) as max_days
                      from public.document_types dt where dt.is_active) t on t.org_id = x.org_id
              left join (select y.professional_id, y.document_type_id,
                                bool_or(y.status = 'verified') as any_verified,
                                max(y.expires_on) filter (where y.status = 'verified') as valid_until,
                                max(y.expires_on) filter (where y.status in ('verified', 'expired')) as last_known
                           from public.professional_documents y
                          group by y.professional_id, y.document_type_id) d
                     on d.professional_id = x.id and d.document_type_id = t.id
              -- An e-consent is in force until its last day, or the day before its withdrawal takes effect.
              left join (select z.professional_id,
                                max(case when z.withdrawal_effective_on is null then z.expires_on
                                         else least(z.expires_on, z.withdrawal_effective_on - 1) end) as valid_until
                           from public.professional_consents z
                          group by z.professional_id) k
                     on t.key = 'image_consent' and k.professional_id = x.id
          ) s
         group by s.professional_id
      ) dc on dc.professional_id = p.id
  ) r;

-- {complete, done, total, items, warnings}: 4c.2's four items (matching, account, questionnaire,
-- documents), then contract_signed.
create or replace function public.get_professional_readiness(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'complete', r.ready,
           'done', r.matching_complete::int + r.account_created::int + r.submission_approved::int + r.documents_ok::int
                   + r.contract_signed::int,
           'total', 5,
           'items', pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object(
               'key', 'matching_profile',
               'done', r.matching_complete,
               'missing', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
                 case when not r.has_profession then 'profession' end,
                 case when not r.licences_ok then 'licence' end,
                 case when not r.restricted_motifs_ok then 'regulated_title' end,
                 case when not r.has_language then 'language' end,
                 case when not r.has_clientele then 'clientele' end,
                 case when not r.has_motif then 'motif' end], null))),
             pg_catalog.jsonb_build_object('key', 'account_created', 'done', r.account_created, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'submission_approved', 'done', r.submission_approved, 'missing', '[]'::jsonb),
             pg_catalog.jsonb_build_object('key', 'documents', 'done', r.documents_ok,
                                           'missing', pg_catalog.to_jsonb(r.documents_missing)),
             pg_catalog.jsonb_build_object('key', 'contract_signed', 'done', r.contract_signed, 'missing', '[]'::jsonb)),
           'warnings', pg_catalog.to_jsonb(pg_catalog.array_remove(array[
             case when not r.email_matches_login then 'login_email_mismatch' end], null)))
    from public.professionals_readiness r
   where r.professional_id = p_id
$$;

-- -----------------------------------------------------------------------------
-- History: the contract's requests and signers
-- -----------------------------------------------------------------------------
-- Same signature, grants, checks and paging as *_professionals_onboarding.sql (the tables of
-- private.professional_history_tables(), private rows without values, compensation rows for
-- professionals.compensation only, draft saves of submissions left out, the submission's kind),
-- plus the audit rows of the professional's service-contract requests and of their signers whose
-- changed_fields move `status` (an insert, a send claim, a sync stamp or a failed draft are not
-- events). Their record ids are the request's and the signer's own ids, found once through
-- signature_requests_subject_idx; a signer's row carries its `role` in changed_fields (a plain
-- string beside the {before, after} pairs, as a submission's `kind`).
create or replace function public.list_professional_history(p_id uuid, p_before_id bigint default null, p_limit int default 50)
returns table (
  id bigint, created_at timestamptz, table_name text, record_id text, action text,
  changed_fields jsonb, actor_id uuid, actor_name text, actor_role text, source text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_org uuid := private.current_user_org_id();
  v_before bigint := coalesce(p_before_id, 9223372036854775807);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_prefix text := p_id::text;
  v_tables text[] := private.professional_history_tables();
  v_contract_ids text[];
begin
  if not private.has_permission('professionals.view') then
    raise exception 'Permission refusée : professionals.view' using errcode = '42501';
  end if;
  if not private.has_permission('professionals.compensation') then
    v_tables := array(select t from pg_catalog.unnest(v_tables) t
                       where t <> all (private.professional_compensation_history_tables()));
  end if;
  select coalesce(pg_catalog.array_agg(x.id), '{}') into v_contract_ids
    from (select r.id::text as id
            from public.signature_requests r
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose = 'professionals.service_contract'
          union all
          select s.id::text
            from public.signature_requests r
            join public.signature_request_signers s on s.request_id = r.id
           where r.org_id = v_org and r.subject_type = 'professional' and r.subject_id = p_id
             and r.purpose = 'professionals.service_contract') x;

  return query
    select a.id, a.created_at, a.table_name, a.record_id, a.action,
           case
             -- A signer's row names its role (« par le professionnel », « par la clinique »).
             when a.table_name = 'signature_request_signers' and sr.role is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('role', sr.role)
             when a.table_name = 'professional_submissions' and a.action <> 'insert' and sk.kind is not null
                  and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
               then a.changed_fields || pg_catalog.jsonb_build_object('kind', sk.kind)
             when a.table_name <> 'professional_private' then a.changed_fields
             when a.action = 'read' and pg_catalog.jsonb_typeof(a.changed_fields -> 'fields') = 'array'
               then pg_catalog.jsonb_build_object('fields', (
                      select coalesce(pg_catalog.jsonb_agg(f.value order by f.ord), '[]'::jsonb)
                        from pg_catalog.jsonb_array_elements(a.changed_fields -> 'fields') with ordinality as f(value, ord)
                       where f.value in ('"sin"'::jsonb, '"bank_account"'::jsonb)))
           end,
           a.actor_id, pr.display_name, a.actor_role, a.source
      from public.audit_log a
      left join public.profiles pr on pr.user_id = a.actor_id and pr.org_id = a.org_id
      -- record_id is '<professional_id>:<submission id>' (the primary key's columns).
      left join lateral (select s.kind from public.professional_submissions s
                          where a.table_name = 'professional_submissions'
                            and s.professional_id = p_id and s.org_id = v_org
                            and s.id::text = pg_catalog.substr(a.record_id, 38)) sk on true
      left join lateral (select s.role from public.signature_request_signers s
                          where a.table_name = 'signature_request_signers' and s.org_id = v_org
                            and s.id::text = a.record_id) sr on true
     where a.org_id = v_org
       and a.id < v_before
       and ((left(a.record_id, 36) = v_prefix
             and a.table_name = any (v_tables)
             and not (a.table_name = 'professional_submissions' and a.action = 'update'
                      and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
                      and not exists (select 1 from pg_catalog.jsonb_object_keys(a.changed_fields) k(key)
                                       where k.key not in ('submitted_values', 'secure_link_id'))))
            or (left(a.record_id, 36) = any (v_contract_ids)
                and a.table_name in ('signature_requests', 'signature_request_signers')
                and a.action = 'update'
                and pg_catalog.jsonb_typeof(a.changed_fields) = 'object'
                and a.changed_fields ? 'status'))
     order by a.id desc
     limit v_limit;
end;
$$;
