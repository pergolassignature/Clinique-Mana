-- =============================================================================
-- Professionnels: the 2026 service contract (« Convention de prestation de services professionnels »)
-- =============================================================================
-- Asked:   Jonathan, 2026-10-14: the final 2026 contract, which also carries the image-rights
--          authorisation (its article 6.2). Decisions P4-554 … P4-557 (docs/plans/2026-10-07-decisions-log.md)
-- Needs:   *_professionals_contracts.sql (the template, its seed, the printed terms)
-- Rules:   docs/standards/database-conventions.md
--
-- Key choices
-- * The template's content (private.professionals_contract_template(), same signature; the seed
--   function reads it, so a NEW clinic gets this text): Jonathan's wording, chapters 1–8, then
--   Annexe A « Conditions financières » and Annexe B « Dossier professionnel », then the signature
--   page (the renderer's rule: it is the last block, so the annexes come before it). The only
--   edits (P4-554): chapter 1's articles numbered 1.1–1.3 (Word's automatic numbers, lost in a
--   text copy), chapter 2's « 2.4 Référencement » → 2.3 (there is no 2.3), the second note under
--   Annexe A's table without its stray « * » (only the cancellations carry one), headings in
--   sentence case, typographic apostrophes, and the « Signé à / Date » lines replaced by the
--   signature page (Documenso writes the date). No banner: the text is final.
-- * Nothing real in the text (P4-554): the clinic party is {{contract.clinic_legal_name}},
--   {{contract.clinic_address}}, {{clinic.signatory_name}}, {{clinic.signatory_title}}; the
--   professional's block is professional.* with a new optional `professional.phone`
--   (« Téléphone », the personal phone, P4-555). « Clinique MANA » stays the contract's defined term, as
--   Jonathan wrote it. Annexe A's table is `{{pricing.annexe_a}}` alone on its line (P4-433), now
--   printed in the contract's format by professionals-contract-send (P4-556); its notes, the
--   « Programme de reconnaissance », « Facturation », « Paiement des honoraires » and
--   « Collaboration professionnelle » stay prose. `professional.membership` and `today` are no
--   longer in the text (the terms still return them for older versions).
-- * The body says it grants the image rights: `"grantsImageRights": true` at its top level (the PDF
--   model's optional flag, ignored by the renderer; the editor and create_template_version copy the
--   body, so the flag follows the text into the clinic's next versions). The next migration
--   (*_professionals_contract_image_rights.sql) reads it (P4-557).
-- * The data fix (private.professionals_contract_2026_text(), run once below, idempotent): in each
--   clinic whose « Contrat de service » has NO published version, the draft that still holds the
--   seeded banner « Texte à faire valider par la direction avant publication » gets the 2026 body
--   and variables (plus any variable its own email subject or message uses); a draft the clinic
--   edited (no banner) or a clinic with a published version is left as it is (a NOTICE says so).
--   Its email subject and message are kept.
-- * Additive: two functions replaced with the same signatures, one function added.
-- =============================================================================

select pg_catalog.set_config('app.audit_source', 'migration:professionals_contract_2026', true);

-- -----------------------------------------------------------------------------
-- The template's content (the 2026 text)
-- -----------------------------------------------------------------------------
-- A PdfDocument (supabase/functions/_shared/pdf/model.ts), its variables, signers and Documenso
-- invitation. One copy, read by the seed, the data fix below and the function's test
-- (professionals-contract-send/template.test.ts reads the newest migration defining it).
create or replace function private.professionals_contract_template()
returns jsonb
language sql
immutable
set search_path = ''
as $tpl$
  select $json${
  "body": {
    "title": "Convention de prestation de services professionnels",
    "grantsImageRights": true,
    "header": {"text": "Convention de prestation de services professionnels", "initialsFor": ["professional"]},
    "footer": {"text": "Convention de prestation de services professionnels"},
    "blocks": [
      {"type": "heading", "level": 1, "text": "Convention de prestation de services professionnels"},
      {"type": "paragraph", "runs": [{"text": "Entre :", "bold": true}]},
      {"type": "paragraph", "runs": [{"text": "{{contract.clinic_legal_name}}", "bold": true}, {"text": ", société constituée en vertu des lois du Québec, ayant son siège social au {{contract.clinic_address}}, représentée aux présentes par {{clinic.signatory_name}}, {{clinic.signatory_title}}, dûment autorisée à agir."}]},
      {"type": "paragraph", "runs": [{"text": "(ci-après appelée la « Clinique MANA »)"}]},
      {"type": "paragraph", "runs": [{"text": "Et", "bold": true}]},
      {"type": "paragraph", "runs": [{"text": "Nom du professionnel : "}, {"text": "{{professional.full_name}}", "bold": true}]},
      {"type": "paragraph", "runs": [{"text": "Profession : {{professional.profession}}"}]},
      {"type": "paragraph", "runs": [{"text": "Adresse : {{professional.address}}"}]},
      {"type": "paragraph", "runs": [{"text": "Téléphone : {{professional.phone}}"}]},
      {"type": "paragraph", "runs": [{"text": "Courriel : {{professional.email}}"}]},
      {"type": "paragraph", "runs": [{"text": "(ci-après appelé le « Professionnel »)"}]},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA et le Professionnel sont ci-après désignés collectivement les « Parties »."}]},
      {"type": "heading", "level": 2, "text": "Préambule"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA est une clinique multidisciplinaire en santé mentale dont la mission est d’offrir des services accessibles, humains et rigoureux, dans un environnement favorisant la collaboration interdisciplinaire et le développement des meilleures pratiques."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel exerce sa profession à titre de travailleur autonome et choisit de collaborer avec la Clinique MANA afin d’évoluer dans un milieu favorisant son développement professionnel, le travail interdisciplinaire ainsi que le soutien administratif, technologique et organisationnel mis à sa disposition par la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "Les Parties souhaitent établir une relation de collaboration fondée sur la confiance, le respect, la transparence et le professionnalisme, dans le respect de l’autonomie professionnelle du Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "La présente convention a pour objet de définir les droits, les responsabilités et les engagements respectifs des Parties."}]},
      {"type": "paragraph", "runs": [{"text": "En conséquence, les Parties conviennent de ce qui suit."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 1 — Objet de la convention"},
      {"type": "heading", "level": 3, "text": "1.1 Objet"},
      {"type": "paragraph", "runs": [{"text": "La présente convention établit les modalités de la collaboration entre la Clinique MANA et le Professionnel dans le cadre de l’exercice de sa pratique professionnelle."}]},
      {"type": "heading", "level": 3, "text": "1.2 Statut du Professionnel"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel exerce sa profession à titre de travailleur autonome. La présente convention ne crée aucun lien d’emploi, de société, de mandat, de coentreprise ou toute autre relation juridique de nature similaire entre les Parties."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel demeure seul responsable de ses actes professionnels, conformément aux lois applicables et aux exigences de son ordre professionnel."}]},
      {"type": "heading", "level": 3, "text": "1.3 Principes de collaboration"},
      {"type": "paragraph", "runs": [{"text": "Les Parties conviennent de collaborer de bonne foi, dans un esprit de respect, de transparence et de professionnalisme."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel conserve son entière autonomie dans l’exercice de son jugement professionnel et s’engage à respecter les politiques, procédures et standards administratifs de la Clinique MANA, dans la mesure où ceux-ci sont compatibles avec ses obligations légales et déontologiques."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 2 — Services offerts par la Clinique MANA"},
      {"type": "heading", "level": 3, "text": "2.1 Services offerts"},
      {"type": "paragraph", "runs": [{"text": "Afin de soutenir le développement de la pratique du Professionnel, la Clinique MANA met à sa disposition les services et les ressources qu’elle juge appropriés, notamment en matière :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "de référencement et d’accueil de la clientèle;"}], [{"text": "d’administration et de soutien à la pratique;"}], [{"text": "de développement professionnel;"}], [{"text": "de rayonnement et de promotion;"}], [{"text": "de technologies et d’outils numériques."}]]},
      {"type": "paragraph", "runs": [{"text": "La nature et l’étendue des services peuvent évoluer afin de répondre aux besoins de la clientèle, aux exigences légales, aux normes professionnelles ou aux orientations de la Clinique."}]},
      {"type": "heading", "level": 3, "text": "2.2 Développement professionnel"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA favorise le développement professionnel de son équipe en offrant des activités de codéveloppement, des rencontres cliniques, des activités de supervision ainsi que toute autre initiative jugée pertinente."}]},
      {"type": "paragraph", "runs": [{"text": "Afin de maintenir un lien de proximité avec son équipe, la Clinique MANA organise annuellement une rencontre individuelle entre sa présidente et chacun des professionnels. Cette rencontre vise à maintenir un partenariat de qualité, à favoriser les échanges et à assurer l’évolution des standards administratifs de la Clinique."}]},
      {"type": "heading", "level": 3, "text": "2.3 Référencement"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA met en œuvre des moyens raisonnables afin d’orienter la clientèle vers les professionnels en fonction des besoins exprimés, des expertises recherchées et des disponibilités offertes."}]},
      {"type": "paragraph", "runs": [{"text": "Toutefois, la Clinique MANA ne garantit au Professionnel aucun volume minimal de références, de rendez-vous, de revenus ou d’heures de travail."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 3 — Gestion de la pratique"},
      {"type": "heading", "level": 3, "text": "3.1 Exercice de la profession"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel exerce sa profession conformément aux lois applicables et aux normes professionnelles qui lui sont applicables."}]},
      {"type": "paragraph", "runs": [{"text": "À ce titre, il :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "maintient son droit d’exercice et son adhésion à son ordre professionnel;"}], [{"text": "maintient en vigueur son assurance responsabilité professionnelle;"}], [{"text": "informe sans délai la Clinique MANA de toute situation susceptible d’affecter son droit d’exercice ou sa pratique professionnelle."}]]},
      {"type": "heading", "level": 3, "text": "3.2 Organisation de la pratique"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel demeure responsable de l’organisation de sa pratique, de son horaire et du suivi de sa clientèle."}]},
      {"type": "paragraph", "runs": [{"text": "Afin de maintenir une collaboration active avec la Clinique MANA, le Professionnel s’engage à maintenir une pratique correspondant généralement à un minimum de trois (3) rencontres par semaine auprès de la clientèle desservie par l’entremise de la Clinique, en tenant compte des périodes de vacances, des absences planifiées ainsi que des fluctuations normales de la clientèle."}]},
      {"type": "paragraph", "runs": [{"text": "Il :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "inscrit, au moins deux (2) semaines à l’avance, les plages horaires qu’il souhaite rendre disponibles pour l’attribution de nouveaux clients lorsqu’il est en mesure d’en accueillir;"}], [{"text": "assure directement avec sa clientèle la planification, la modification et l’annulation de ses rendez-vous;"}], [{"text": "tient des dossiers conformes aux exigences professionnelles qui lui sont applicables;"}], [{"text": "informe la Clinique MANA de toute situation susceptible d’avoir un impact sur le référencement ou la continuité des services."}]]},
      {"type": "heading", "level": 3, "text": "3.3 Collaboration avec la Clinique"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "respecte les documents de référence de la Clinique MANA compatibles avec ses obligations légales et déontologiques;"}], [{"text": "transmet, dans un délai raisonnable, les renseignements et documents nécessaires au bon fonctionnement administratif de la Clinique;"}], [{"text": "collabore avec les autres professionnels lorsque la situation le justifie et que cette collaboration est dans l’intérêt de la clientèle."}]]},
      {"type": "paragraph", "runs": [{"text": "Dans le respect de son autonomie professionnelle, il contribue à la qualité de l’expérience client, à la continuité des services et au bon fonctionnement de la Clinique."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 4 — Rémunération et conditions financières"},
      {"type": "heading", "level": 3, "text": "4.1 Rémunération"},
      {"type": "paragraph", "runs": [{"text": "En contrepartie des services, des ressources et de l’environnement de pratique offerts par la Clinique MANA, le Professionnel verse à la Clinique une rémunération dont les modalités sont prévues à l’Annexe A."}]},
      {"type": "heading", "level": 3, "text": "4.2 Facturation et paiement"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA assure la facturation des services rendus à la clientèle et transmet au Professionnel les informations nécessaires à l’émission de sa facture."}]},
      {"type": "paragraph", "runs": [{"text": "Les modalités relatives à la facturation, aux paiements et aux autres conditions financières sont précisées à l’Annexe A."}]},
      {"type": "heading", "level": 3, "text": "4.3 Collaboration clinique"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA privilégie une approche collaborative favorisant la complémentarité des expertises et la continuité des services."}]},
      {"type": "paragraph", "runs": [{"text": "Les échanges cliniques, les discussions interdisciplinaires et les transferts de dossiers effectués dans le meilleur intérêt de la clientèle constituent une valeur ajoutée offerte par la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "En conséquence, ces activités ne peuvent faire l’objet d’une facturation distincte au client."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 5 — Utilisation des ressources de la Clinique"},
      {"type": "heading", "level": 3, "text": "5.1 Ressources mises à la disposition du Professionnel"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA met à la disposition du Professionnel les ressources administratives, technologiques et documentaires nécessaires à l’exercice de sa pratique."}]},
      {"type": "heading", "level": 3, "text": "5.2 Utilisation des ressources"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à utiliser les ressources mises à sa disposition conformément aux lois applicables, aux exigences de son ordre professionnel ainsi qu’aux politiques, procédures et standards administratifs de la Clinique MANA."}]},
      {"type": "paragraph", "runs": [{"text": "Il prend les mesures raisonnables afin d’assurer la confidentialité des renseignements auxquels il a accès et la sécurité des ressources qui lui sont confiées. Il s’engage également à protéger les identifiants, mots de passe et accès qui lui sont confiés par la Clinique MANA."}]},
      {"type": "heading", "level": 3, "text": "5.3 Intelligence artificielle"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel demeure entièrement responsable des décisions professionnelles qu’il prend dans le cadre de sa pratique."}]},
      {"type": "paragraph", "runs": [{"text": "Lorsqu’il utilise un outil reposant sur l’intelligence artificielle ou toute autre technologie susceptible de traiter des renseignements concernant un client, le Professionnel s’engage à respecter les lois applicables, les exigences déontologiques de son ordre professionnel ainsi que les politiques de la Clinique MANA."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel est responsable de déterminer si l’utilisation d’un tel outil requiert le consentement du client ou toute autre mesure préalable et, le cas échéant, d’obtenir ce consentement avant son utilisation."}]},
      {"type": "paragraph", "runs": [{"text": "L’utilisation de ces outils ne peut se substituer au jugement professionnel du Professionnel ni compromettre la confidentialité, la sécurité ou la protection des renseignements personnels."}]},
      {"type": "heading", "level": 3, "text": "5.4 Évolution des ressources"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA peut, en tout temps, ajouter, modifier ou retirer les ressources mises à la disposition du Professionnel afin de répondre à l’évolution de ses besoins organisationnels, des exigences légales, des normes professionnelles ou des avancées technologiques."}]},
      {"type": "heading", "level": 3, "text": "5.5 Confidentialité"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à préserver la confidentialité de tous les renseignements confidentiels obtenus dans le cadre de sa collaboration avec la Clinique MANA, qu’ils concernent notamment :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "la clientèle;"}], [{"text": "les autres professionnels;"}], [{"text": "les employés;"}], [{"text": "les méthodes de travail;"}], [{"text": "les documents internes;"}], [{"text": "les renseignements financiers;"}], [{"text": "les projets et stratégies de développement."}]]},
      {"type": "paragraph", "runs": [{"text": "Cette obligation subsiste après la fin de la convention."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à respecter les lois applicables en matière de protection des renseignements personnels ainsi que les politiques adoptées par la Clinique MANA."}]},
      {"type": "heading", "level": 2, "text": "Chapitre 6 — Identité, rayonnement et réputation de la Clinique"},
      {"type": "heading", "level": 3, "text": "6.1 Utilisation des éléments de la Clinique"},
      {"type": "paragraph", "runs": [{"text": "Pendant la durée de la présente convention, le Professionnel est autorisé à identifier la Clinique MANA comme son milieu de pratique."}]},
      {"type": "paragraph", "runs": [{"text": "Toute utilisation du nom, du logo, de l’identité visuelle ou de tout autre élément distinctif de la Clinique doit être conforme aux normes et directives établies par celle-ci."}]},
      {"type": "paragraph", "runs": [{"text": "Le nom « Clinique MANA », son logo, son identité visuelle, ses marques distinctives, ainsi que tout document, outil, contenu ou autre matériel développé ou mis à la disposition du Professionnel demeurent la propriété exclusive de la Clinique MANA, sauf entente écrite à l’effet contraire."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à respecter ces droits et à ne pas reproduire, utiliser, diffuser ou transmettre ces éléments autrement que dans le cadre de la présente collaboration ou avec l’autorisation préalable de la Clinique MANA."}]},
      {"type": "paragraph", "runs": [{"text": "À la fin de la collaboration, le Professionnel s’engage à cesser toute utilisation susceptible de laisser croire qu’il est toujours associé à la Clinique MANA."}]},
      {"type": "heading", "level": 3, "text": "6.2 Promotion des services professionnels"},
      {"type": "paragraph", "runs": [{"text": "Pendant la durée de la présente convention, le Professionnel autorise la Clinique MANA à utiliser son nom, son titre professionnel, sa photographie, sa biographie, ses champs d’expertise ainsi que tout autre renseignement professionnel pertinent aux fins de la promotion de ses services et du rayonnement de la Clinique."}]},
      {"type": "paragraph", "runs": [{"text": "Cette autorisation comprend également l’utilisation des photographies, vidéos ou autres contenus réalisés dans le cadre des activités professionnelles de la Clinique MANA."}]},
      {"type": "heading", "level": 3, "text": "6.3 Protection de la réputation"},
      {"type": "paragraph", "runs": [{"text": "Pendant la durée de la présente convention et pour une période de douze (12) mois suivant sa fin, le Professionnel s’engage à ne pas diffuser, publier ou communiquer, de quelque manière que ce soit et sur quelque support ou plateforme que ce soit, notamment les réseaux sociaux et les sites d’avis en ligne, des propos, commentaires ou contenus faux, diffamatoires, dénigrants ou malveillants portant atteinte à la réputation, à l’image ou aux intérêts légitimes de la Clinique MANA, de ses dirigeants ou de ses employés."}]},
      {"type": "paragraph", "runs": [{"text": "En cas de manquement aux obligations prévues au présent article, et après la transmission d’un avis écrit exigeant le retrait du contenu litigieux, le Professionnel s’engage à verser à la Clinique MANA, à titre de clause pénale et de dommages liquidés, une somme de mille dollars (1 000 $) par jour de retard jusqu’au retrait complet du contenu, sous réserve d’un montant maximal de dix mille dollars (10 000 $)."}]},
      {"type": "paragraph", "runs": [{"text": "Le paiement de cette pénalité ne prive pas la Clinique MANA du droit de demander une injonction ou de réclamer toute somme additionnelle correspondant au préjudice démontré, conformément aux règles de droit applicables."}]},
      {"type": "heading", "level": 3, "text": "6.4 Non-sollicitation"},
      {"type": "paragraph", "runs": [{"text": "Solliciter désigne toute démarche ciblée visant à inciter une personne à transférer ses services professionnels, à modifier son milieu de pratique ou à mettre fin à sa relation avec la Clinique MANA. Ne constituent pas de la sollicitation les communications générales destinées au public ou les situations où le client ou le professionnel prend lui-même l’initiative de communiquer avec le Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "Pendant la durée de la présente convention et pour une période de douze (12) mois suivant sa fin, le Professionnel s’engage à ne pas solliciter activement, directement ou indirectement :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "un client ayant reçu des services par l’entremise de la Clinique MANA dans le but de lui offrir des services professionnels à l’extérieur de la Clinique;"}], [{"text": "un professionnel ou un membre du personnel de la Clinique MANA dans le but de l’inciter à mettre fin à sa collaboration avec la Clinique ou à se joindre à une autre organisation."}]]},
      {"type": "paragraph", "runs": [{"text": "La présente disposition n’a pas pour effet d’empêcher :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "un client de choisir librement son professionnel ou son milieu de pratique;"}], [{"text": "le Professionnel d’accepter un client qui communique spontanément avec lui, sans qu’il y ait eu de démarche de sollicitation de sa part;"}], [{"text": "les communications ou activités de nature générale, notamment la publicité ou les publications sur un site Internet, dans les médias ou sur les réseaux sociaux, qui ne visent pas spécifiquement la clientèle ou les professionnels de la Clinique MANA."}]]},
      {"type": "heading", "level": 2, "text": "Chapitre 7 — Fin de la collaboration"},
      {"type": "heading", "level": 3, "text": "7.1 Durée de la convention"},
      {"type": "paragraph", "runs": [{"text": "La présente convention entre en vigueur à la date de sa signature par les Parties et demeure en vigueur jusqu’à ce qu’il y soit mis fin conformément aux dispositions du présent chapitre."}]},
      {"type": "heading", "level": 3, "text": "7.2 Fin de la collaboration"},
      {"type": "paragraph", "runs": [{"text": "Chacune des Parties peut mettre fin à la présente convention en transmettant à l’autre Partie un préavis écrit d’au moins trente (30) jours."}]},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA peut toutefois mettre fin à la présente convention sans préavis en cas de manquement grave du Professionnel, notamment lorsque :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "un cas de perte, suspension ou limitation du droit d’exercice;"}], [{"text": "un défaut de maintenir les assurances professionnelles requises;"}], [{"text": "manquement grave aux obligations prévues à la présente convention;"}], [{"text": "comportement susceptible de compromettre la sécurité de la clientèle ou de porter gravement atteinte aux intérêts de la Clinique MANA."}]]},
      {"type": "heading", "level": 3, "text": "7.3 Obligations à la fin de la collaboration"},
      {"type": "paragraph", "runs": [{"text": "À la fin de la collaboration, le Professionnel s’engage à :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "collaborer avec la Clinique MANA afin de favoriser une transition harmonieuse dans l’intérêt de la clientèle;"}], [{"text": "restituer, sur demande, tout document, matériel, équipement, accès ou autre bien appartenant à la Clinique;"}], [{"text": "cesser toute utilisation du nom, du logo, des plateformes, des outils ou de tout autre élément appartenant à la Clinique MANA;"}], [{"text": "respecter ses obligations légales et déontologiques relativement à la continuité des services et à la gestion de ses dossiers."}]]},
      {"type": "heading", "level": 3, "text": "7.4 Survie des obligations"},
      {"type": "paragraph", "runs": [{"text": "La fin de la présente convention ne met pas fin aux obligations qui, par leur nature, sont destinées à survivre, notamment celles relatives :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "à la confidentialité;"}], [{"text": "à la protection des renseignements personnels;"}], [{"text": "à la propriété intellectuelle;"}], [{"text": "à la protection de la réputation de la Clinique MANA;"}], [{"text": "aux obligations financières non acquittées;"}], [{"text": "à toute autre obligation expressément prévue à cet effet dans la présente convention."}]]},
      {"type": "heading", "level": 2, "text": "Chapitre 8 — Dispositions générales"},
      {"type": "heading", "level": 3, "text": "8.1 Documents de référence"},
      {"type": "paragraph", "runs": [{"text": "Les annexes, politiques, procédures, guides, standards administratifs et autres documents auxquels la présente convention fait référence en font partie intégrante."}]},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA peut les modifier afin de tenir compte de l’évolution des lois, des normes professionnelles, des technologies ou de ses besoins organisationnels. Toute modification est communiquée au Professionnel dans un délai raisonnable avant son entrée en vigueur."}]},
      {"type": "heading", "level": 3, "text": "8.2 Loi applicable"},
      {"type": "paragraph", "runs": [{"text": "La présente convention est régie et interprétée conformément aux lois en vigueur dans la province de Québec."}]},
      {"type": "paragraph", "runs": [{"text": "Tout différend relatif à son interprétation ou à son application est soumis aux tribunaux compétents du district judiciaire du siège de la Clinique MANA, sous réserve des dispositions impératives de la loi."}]},
      {"type": "pageBreak"},
      {"type": "heading", "level": 2, "text": "Annexe A — Conditions financières"},
      {"type": "paragraph", "runs": [{"text": "La présente annexe fait partie intégrante de la Convention de prestation de services professionnels conclue entre la Clinique MANA et le Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "Les modifications ayant un impact sur le partage des honoraires font l’objet d’un avenant signé par les Parties."}]},
      {"type": "heading", "level": 3, "text": "1. Partage des honoraires"},
      {"type": "paragraph", "runs": [{"text": "Sous réserve de toute entente particulière intervenue entre les Parties, les honoraires sont répartis selon les modalités suivantes :"}]},
      {"type": "paragraph", "runs": [{"text": "{{pricing.annexe_a}}"}]},
      {"type": "paragraph", "runs": [{"text": "* Les pourcentages applicables aux frais d’annulation ou d’absence s’appliquent uniquement lorsque les frais ont été acquittés par le client."}]},
      {"type": "paragraph", "runs": [{"text": "Les frais d’ouverture de dossier, lorsqu’applicables, sont perçus par la Clinique MANA conformément à sa politique en vigueur et ne sont pas inclus dans le partage des honoraires."}]},
      {"type": "heading", "level": 3, "text": "2. Programme de reconnaissance"},
      {"type": "paragraph", "runs": [{"text": "Dans le cadre de sa culture de reconnaissance et de valorisation de l’engagement de ses professionnels, la Clinique MANA offre un programme de reconnaissance pouvant prendre la forme d’une bonification financière."}]},
      {"type": "paragraph", "runs": [{"text": "Les critères d’admissibilité, les modalités d’application ainsi que les avantages accordés dans le cadre de ce programme sont déterminées par la Clinique MANA et communiqués au Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA se réserve le droit de faire évoluer son programme de reconnaissance afin de l’adapter à ses orientations, à ses besoins organisationnels ou à l’évolution de ses activités."}]},
      {"type": "heading", "level": 3, "text": "3. Facturation"},
      {"type": "paragraph", "runs": [{"text": "La Clinique MANA transmet mensuellement au Professionnel un relevé des services facturés."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel est responsable de transmettre sa facture conformément aux exigences fiscales applicables."}]},
      {"type": "paragraph", "runs": [{"text": "Tout retard dans la transmission de cette facture peut entraîner le report du paiement au prochain cycle de paiement."}]},
      {"type": "heading", "level": 3, "text": "4. Paiement des honoraires"},
      {"type": "paragraph", "runs": [{"text": "Sous réserve de la réception de la facture du Professionnel, les paiements sont effectués selon le calendrier établi par la Clinique MANA."}]},
      {"type": "paragraph", "runs": [{"text": "Le calendrier des paiements peut être ajusté à l’occasion de jours fériés ou de circonstances exceptionnelles."}]},
      {"type": "heading", "level": 3, "text": "5. Collaboration professionnelle"},
      {"type": "paragraph", "runs": [{"text": "Les discussions cliniques, les échanges interdisciplinaires et les transferts de dossiers effectués dans le meilleur intérêt de la clientèle constituent une valeur ajoutée offerte dans le cadre du modèle de pratique de la Clinique. En conséquence, ces activités ne peuvent faire l’objet d’une facturation distincte auprès du client."}]},
      {"type": "pageBreak"},
      {"type": "heading", "level": 2, "text": "Annexe B — Dossier professionnel"},
      {"type": "paragraph", "runs": [{"text": "La présente annexe fait partie intégrante de la Convention de prestation de services professionnels conclue entre la Clinique MANA et le Professionnel."}]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à transmettre les renseignements et documents requis ainsi qu’à les maintenir à jour pendant toute la durée de la collaboration."}]},
      {"type": "heading", "level": 3, "text": "1. Identification du Professionnel"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel fournit notamment les renseignements suivants :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "titre professionnel;"}], [{"text": "coordonnées;"}], [{"text": "numéro de permis d’exercice"}], [{"text": "numéro d’assurance sociale (NAS);"}], [{"text": "numéro d’entreprise (NEQ), lorsqu’applicable;"}], [{"text": "numéros de TPS et TVQ, lorsqu’applicable."}]]},
      {"type": "heading", "level": 3, "text": "2. Documents professionnels"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel transmet et maintient à jour les documents suivants :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "preuve du droit d’exercice;"}], [{"text": "preuve d’assurance responsabilité professionnelle;"}], [{"text": "preuve de renouvellement, lorsque ces documents expirent pendant la durée de la collaboration."}]]},
      {"type": "heading", "level": 3, "text": "3. Profil professionnel"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel fournit les renseignements nécessaires à la présentation de ses services, notamment :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "photographie professionnelle conforme aux standards de qualité de la Clinique MANA;"}], [{"text": "biographie;"}], [{"text": "champs d’expertise;"}], [{"text": "clientèles desservies;"}], [{"text": "approches privilégiées;"}], [{"text": "langues parlées;"}], [{"text": "autres renseignements pertinents."}]]},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel s’engage à collaborer avec la Clinique MANA afin de maintenir un profil professionnel conforme à son image de marque, notamment en mettant à jour, sur demande raisonnable, sa photographie, sa biographie ou tout autre renseignement utilisé à des fins de présentation ou de promotion."}]},
      {"type": "heading", "level": 3, "text": "4. Renseignements administratifs"},
      {"type": "paragraph", "runs": [{"text": "Le Professionnel fournit les renseignements nécessaires à l’administration de la présente convention, notamment :"}]},
      {"type": "list", "ordered": false, "items": [[{"text": "coordonnées bancaires;"}]]},
      {"type": "heading", "level": 3, "text": "5. Mise à jour annuelle"},
      {"type": "paragraph", "runs": [{"text": "Afin d’assurer l’exactitude des renseignements détenus par la Clinique MANA, le Professionnel s’engage à participer à la mise à jour annuelle de son dossier professionnel et à transmettre, dans les délais demandés, tout renseignement ou document requis."}]},
      {"type": "signaturePage", "signers": [{"role": "professional", "label": "Le Professionnel : {{professional.full_name}}"}, {"role": "clinic", "label": "Pour la Clinique MANA : {{clinic.signatory_name}}"}]}
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
    {"path": "professional.phone", "label": "Téléphone du professionnel", "sample": "418 555-0123", "required": false, "kind": "text"},
    {"path": "professional.profession", "label": "Profession", "sample": "psychologue", "required": true, "kind": "text"},
    {"path": "pricing.annexe_a", "label": "Tableau de l’Annexe A", "sample": "(le tableau du partage des honoraires)", "required": true, "kind": "text"}
  ],
  "signers": [{"role": "professional", "label": "Professionnel", "order": 1, "required": true}, {"role": "clinic", "label": "Signataire de la clinique", "order": 2, "required": false}],
  "email_subject": "Votre contrat de service avec {{clinic.name}}",
  "email_message": "Bonjour {{professional.first_name}},\n\nVoici votre contrat de service avec {{clinic.name}}. Prenez le temps de le lire, paraphez chaque page et signez la dernière page.\n\nPour toute question, communiquez avec la clinique.\n\nMerci!"
}$json$::jsonb
$tpl$;
revoke all on function private.professionals_contract_template() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The printed terms: *_professionals_contracts.sql's, with the professional's phone
-- -----------------------------------------------------------------------------
-- As before (its comment), plus professional.phone: the personal phone written « 418 555-0123 »,
-- or null (an optional variable: printed empty).
create or replace function private.professional_contract_terms(p_org uuid, p_id uuid)
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
      -- « Téléphone » (2026 text, P4-555): the personal phone as the app writes it (514 555-1234).
      'phone', pg_catalog.regexp_replace(v_pro.personal_phone, '^\+1([0-9]{3})([0-9]{3})([0-9]{4})$', '\1 \2-\3'),
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
-- The data fix: a seeded draft gets the 2026 text
-- -----------------------------------------------------------------------------
-- Returns how many drafts it rewrote (header). Idempotent: a rewritten draft no longer holds the
-- banner.
create function private.professionals_contract_2026_text()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_content jsonb := private.professionals_contract_template();
  v_count int := 0;
begin
  for v in
    select x.id, x.org_id, x.version, x.body, x.variables, x.email_subject, x.email_message,
           exists (select 1 from public.document_template_versions p
                    where p.template_id = x.template_id and p.status = 'published') as has_published
      from public.document_template_versions x
      join public.document_templates t on t.id = x.template_id and t.org_id = x.org_id
     where t.key = 'professionals.service_contract' and x.status = 'draft'
     order by x.org_id
  loop
    if v.body = v_content -> 'body' then
      null; -- Already the 2026 text (a clinic created since, or a second run).
    elsif v.body::text !~ 'Texte à faire valider par la direction avant publication' then
      raise notice 'service contract (org %): draft version % edited by the clinic: left as it is', v.org_id, v.version;
    elsif v.has_published then
      raise notice 'service contract (org %): a version is published: draft version % left as it is', v.org_id, v.version;
    else
      update public.document_template_versions x
         set body = v_content -> 'body',
             -- The 2026 variables, then any other one the draft's own email still uses.
             variables = (v_content -> 'variables') || coalesce((
               select pg_catalog.jsonb_agg(o.var order by o.ord)
                 from pg_catalog.jsonb_array_elements(v.variables) with ordinality as o(var, ord)
                where not exists (select 1 from pg_catalog.jsonb_array_elements(v_content -> 'variables') n
                                   where n ->> 'path' = o.var ->> 'path')
                  and pg_catalog.strpos(v.email_subject || ' ' || v.email_message, '{{' || (o.var ->> 'path') || '}}') > 0),
               '[]'::jsonb)
       where x.id = v.id;
      v_count := v_count + 1;
      raise notice 'service contract (org %): draft version % now holds the 2026 text', v.org_id, v.version;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.professionals_contract_2026_text() from public, anon, authenticated, service_role;

select private.professionals_contract_2026_text();

select pg_catalog.set_config('app.audit_source', '', true);
