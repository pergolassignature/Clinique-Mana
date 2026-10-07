// src/contracts/constants/contract-text-fr.ts
// Texte légal du contrat de service en français

export const CLINIC_INFO = {
  name: 'CLINIQUE MANA INC',
  legalForm: 'corporation légalement constituée en vertu de la Loi sur les sociétés par actions (Québec)',
  address: '300 – 797 Boul. Lebourgneuf, Qc, G2J 0B5',
  representative: 'Madame Christine Sirois',
  representativeTitle: 'sa présidente dûment autorisée',
}

export const CONTRACT_HEADER = {
  title: 'Convention de prestation de service',
  between: 'ENTRE :',
  and: 'ET',
  nameLabel: 'Nom :',
  addressLabel: 'Adresse :',
  phoneLabel: 'Téléphone :',
  professionalDesignation: '(ci-après désigné(e) comme le « Professionnel »)',
  clinicDesignation: '(ci-après désignée comme « Clinique MANA »)',
}

export const ATTENDU_CLAUSE = (professionLabel: string) =>
  `ATTENDU QUE le Professionnel déclare et représente exercer une profession liée au domaine de la santé, soit ${professionLabel} et déclare être membre en règle de son ordre professionnel;`

export const CONSEQUENCE_HEADER = 'EN CONSÉQUENCE DE QUOI, LES PARTIES CONVIENNENT DE CE QUI SUIT :'

// =============================================================================
// CLAUSES DU CONTRAT
// =============================================================================

export interface ContractClause {
  number: string
  title: string
  content: string[]
}

export const CONTRACT_CLAUSES: ContractClause[] = [
  {
    number: '1',
    title: 'PRÉAMBULE',
    content: [
      `1.1. Les parties à la présente convention déclarent avoir pris connaissance des attendus et déclarations qui précèdent, reconnaissent la véracité de ces attendus et déclarations et acceptent que ces attendus et déclarations fassent partie intégrante de la présente convention.`,
    ],
  },
  {
    number: '2',
    title: 'LOCATION DE SERVICE',
    content: [
      `2.1. Clinique MANA référencera ses clients au Professionnel en fonction des besoins du client, de l'expertise offerte par le Professionnel et de ses disponibilités;`,
      `2.2. Clinique MANA fournira les services généraux d'administration durant les heures normales d'affaires;`,
      `2.3. Clinique MANA fournira les services de gestion de la prise de rendez-vous clients et de la liste d'attente clients ainsi que de la facturation des services professionnels et frais liés et la perception des paiements auprès de la clientèle du Professionnel;`,
      `2.4. Le Professionnel consent à ce que les services mentionnés en 2.1, 2.2 et 2.3 ci-dessus soient accomplis exclusivement par Clinique MANA et s'engage à utiliser tout formulaire de services ou autre fournis par Clinique MANA. Toutefois, lorsque le choix du Professionnel est d'exercer ses activités le soir ou les fins de semaine, ce dernier reconnait et convient que Clinique MANA n'aura pas de ressource sur place et ne fournira pas tout service afférent;`,
    ],
  },
  {
    number: '3',
    title: 'PAIEMENT DES SERVICES',
    content: [
      `3.1. Pendant la durée complète de ce contrat, le Professionnel accepte de payer pour les services ci-avant décrits, avant toute taxe applicable, s'il y a lieu, un montant équivalent à une proportion des honoraires facturés pour tout acte professionnel de ce dernier, ayant fait l'objet d'une facturation, le pourcentage applicable tel que déterminé au tableau ci-dessous;`,
      `TABLE_PAYMENT_TERMS`,
      `3.3. La portion retenue des honoraires applicables, viendra réduire les paiements d'honoraires au Professionnel à chacun des paiements faits au Professionnel. Chaque premier du mois, la Clinique transmet un résumé des interventions du mois précédent afin que le Professionnel puisse produire sa facture; tout retard dans l'envoi de celle-ci entraînera un report du paiement au jeudi suivant sa réception.`,
      `3.4. Les honoraires établis par Clinique MANA sont mentionnés à l'Annexe A.`,
      `3.5. Une bonification des honoraires de 0,50$/50 minutes et de 0,25$/30 minutes pour chaque tranche de 50 rendez-vous réalisés jusqu'à concurrence de 25% est applicable.`,
      `3.5.1. Si le client ou le professionnel met fin à la démarche après le premier rendez-vous, cette rencontre ne sera pas comptabilisée.`,
      `3.5.2. Les annulations tardives ou absences non motivées ne sont pas touchées par les bonifications, la compensation de 30% est applicable.`,
    ],
  },
  {
    number: '4',
    title: 'RESPONSABILITÉS DU PROFESSIONNEL(LE)',
    content: [
      `4.1. Le Professionnel s'engage à proposer un minimum de trois (3) plages horaires par semaine pour les clients de MANA.`,
      `4.2. Le Professionnel s'engage à inscrire ses disponibilités dans Go Rendez-vous au moins 2 semaines au préalable. Advenant une modification de ses disponibilités, le Professionnel doit assurer un suivi avec ses clients impactés par ce changement et doit aviser Clinique MANA.`,
      `4.3. Le Professionnel s'engage à indiquer dans le système de Go Rendez-vous dans « note sur le client » le statut du suivi, soit : en cours, en pause ou arrêt du suivi.`,
      `4.4. Lors d'une situation d'annulation tardive (moins de 24h) ou d'absence non motivée, c'est le Professionnel qui prend la décision d'appliquer les frais stipulés dans le formulaire de consentement ou non. Clinique MANA assurera le suivi auprès du client. Le risque financier est partagé entre le Professionnel et Clinique MANA. Les frais seront payés au Professionnel seulement si le client paye les frais.`,
      `4.5. Le Professionnel s'engage à vérifier dans Go Rendez-vous si le formulaire de consentement MANA a été accepté pour chaque client. Si le client n'a pas accepté le formulaire, le Professionnel assure le suivi pour que le formulaire soit bien accepté.`,
      `4.6. Le Professionnel s'engage à fournir une photo professionnelle`,
      `4.6.1. Dans un souci d'assurer une image cohérente, professionnelle et représentative de la Clinique MANA, chaque professionnel s'engage à fournir une photographie conforme aux standards établis par la Clinique.`,
    ],
  },
  {
    number: '5',
    title: 'DURÉE DE LA CONVENTION',
    content: [
      `5.1. La présente convention débutera le jour de sa signature et demeurera en vigueur pour une période de douze (12) mois;`,
      `5.2. Le Professionnel et Clinique MANA ne pourra résilier cette convention avant son terme sauf s'il a fait le choix d'un préavis écrit d'au moins trente (30) jours, adressé et remis à l'autre partie;`,
      `5.3. Les parties gardent une ouverture à discuter et convenir ensemble des ajustements à la présente entente pouvant s'avérer requis.`,
      `5.4. À défaut par le professionnel d'envoyer l'avis écrit, la convention sera réputée renouvelée selon les termes et conditions alors en vigueur.`,
    ],
  },
  {
    number: '6',
    title: 'INCESSIBILITÉ DES DROITS',
    content: [
      `6.1. Aucun droit et/ou privilège octroyé par la présente convention au Professionnel ne peut être cédé à un tiers;`,
    ],
  },
  {
    number: '7',
    title: 'EXERCICE PROFESSIONNEL ET DÉPENSES',
    content: [
      `7.1. Il est entendu que le Professionnel assume toute responsabilité professionnelle et tous les frais liés à l'exercice de sa profession et à la conduite et au développement de ses affaires y compris tous frais liés à l'assurance responsabilité et à la formation professionnelle;`,
      `7.2. Le Professionnel fournit concurremment à la présente, la preuve de son adhésion à l'ordre professionnel, une preuve de l'assurance responsabilité et s'engage à divulguer sans délai tout changement de statut ou événement pouvant affecter sa pratique;`,
      `7.3. Le Professionnel pourra utiliser le nom de Clinique MANA. De plus, le Professionnel permet que son nom soit mentionné comme faisant partie de l'équipe MANA;`,
    ],
  },
  {
    number: '8',
    title: 'AUCUNE ASSOCIATION / NON-RESPONSABILITÉ',
    content: [
      `8.1. Sauf pour les actes spécifiques mentionnés à la présente entente, aucune disposition de la présente ne doit être interprétée, comme créant entre les parties, une relation de mandant à mandataire, d'agence, d'association ou créant une société ou entreprise conjointe entre elles et il est expressément convenu que le Professionnel est un contractant indépendant et qu'il n'est, d'aucune façon, autorisé à faire et signer aucun contrat, aucune convention, ni à fournir ou donner aucune garantie ou représentation pour le compte de Clinique MANA ni à créer aucune dette ou obligation, expresse ou implicite, pour le compte de Clinique MANA ou à sa charge;`,
      `8.2. Clinique MANA n'encourra aucune responsabilité, de quelque nature que ce soit, relativement au traitement fiscal de toute somme payée au Professionnel, notamment en ce qui a trait à toute taxe ou impôt, y compris ceux qui auraient pu faire l'objet d'une retenue à la source par Clinique MANA, le Professionnel s'engageant par les présentes à tenir Clinique MANA indemne et à couvert de tout impôt, pénalité ou intérêt que Clinique MANA pourrait être amenée à payer à cet égard et de tout frais ou responsabilité (incluant frais raisonnables et les honoraires judiciaires et extrajudiciaires d'avocats) que Clinique MANA pourrait subir ou encourir en raison de toute demande des autorités fiscales;`,
      `8.3. Le Professionnel déclare être totalement et entièrement autonome et indépendant de Clinique MANA et s'engage à s'acquitter de tous les droits et cotisations qui seraient dus aux ministères du Revenu provincial et fédéral ou à d'autres ministères ou autorités publiques;`,
    ],
  },
  {
    number: '9',
    title: 'ENGAGEMENT DE CONFIDENTIALITÉ',
    content: [
      `9.1. Le Professionnel s'engage à maintenir confidentielle toute propriété intellectuelle ainsi que toute information afférente à Clinique MANA et ce, concernant toute information dont il aura eu, directement ou indirectement, accès dans le cadre de la présente convention. Sans limiter la généralité de ce qui précède, les parties considèrent et reconnaissent comme confidentielles les informations suivantes : tout formulaire conçu par Clinique MANA, tout secret commercial (procédé, formule, méthode de commercialisation, etc), tout programme d'ordinateur sous toutes ses formes, tout code d'accès à un programme informatique ainsi que tout contrat, soumission, liste de prix et liste de clients;`,
      `9.2. Subséquemment à la terminaison de la présente convention, le Professionnel s'engage à maintenir et respecter son obligation de confidentialité;`,
    ],
  },
  {
    number: '10',
    title: 'NON-CONCURRENCE / NON-SOLLICITATION',
    content: [
      `10.1. Pendant la durée de la présente convention et de tout renouvellement, s'il y a lieu, et pour une période d'un an après cette période, le Professionnel ne devra en aucune façon :`,
      `10.1.1. Détourner ou tenter de détourner directement ou indirectement et de quelque façon que ce soit, toute affaire ou tout client de Clinique MANA vers tout autre établissement concurrent, par offre directe ou indirecte ou autrement;`,
      `10.1.2. Employer ou chercher à employer toute personne qui à ce moment est employée par Clinique MANA ou amener autrement, directement ou indirectement, telle personne à quitter son emploi;`,
    ],
  },
  {
    number: '11',
    title: 'NOM, MARQUE DE COMMERCE ET RÉPUTATION',
    content: [
      `11.1. Le Professionnel reconnait de plus que le nom Clinique MANA et toute marque de commerce liée est la propriété de Clinique MANA, et qu'il n'a aucun droit de quelque nature que ce soit sur cette marque de commerce et ne peut l'utiliser de quelque façon et sous quelque forme que ce soit mise à part de mentionner comme faisant partie de l'équipe MANA;`,
      `11.2. Le Professionnel ne devra en aucune façon publier sur le web et/ou les réseaux sociaux des avis pouvant nuire à la réputation de Clinique MANA, le Professionnel devra verser un montant de 1 000$ par jour à Clinique MANA en guise de dédommagement.`,
    ],
  },
  {
    number: '12',
    title: 'AVIS',
    content: [
      `12.1. Tous les avis et autres communications en vertu des présentes, devront être donnés par écrit et seront présumés avoir été préalablement donnés s'ils sont remis en main propre ou postés par courrier recommandé ou sous pli affranchi et adressés à l'adresse apparaissant à la première page ou à toute autre adresse faisant suite à un avis de changement expédié par une partie à l'autre;`,
    ],
  },
  {
    number: '13',
    title: 'TERMINAISON',
    content: [
      `13.1. En plus des causes de terminaison mentionnées à la présente convention, Clinique MANA pourra mettre fin à la présente convention après avoir donné un préavis écrit de trente (30) jours au Professionnel, advenant l'un ou l'autre des événements suivants;`,
      `13.1.1. Le Professionnel fait défaut d'être en règle avec son ordre professionnel;`,
      `13.1.2. Le Professionnel fait défaut ou refuse d'accomplir une quelconque obligation lui incombant en vertu des présentes, suivi de son omission d'y remédier dans les dix (10) jours de la réception d'un avis de défaut;`,
      `13.1.3. Si Clinique MANA cesse de faire affaires;`,
      `13.1.4. Si l'une des parties aux présentes, est mise en faillite, entame des procédures de protection vis-à-vis ses créanciers, de liquidation ou de dissolution, volontairement ou par ordonnance de quelque tribunal ayant juridiction sur ses affaires;`,
      `13.2. La terminaison de cette convention par entente ou par défaut aura les effets et comportera les conséquences suivantes :`,
      `13.2.1. Tous les droits accordés au Professionnel seront éteints y compris, de faire usage du nom Clinique MANA ainsi que tous autres noms connexes ainsi que tout autres droits reliés aux droits consentis;`,
      `13.2.2. Le Professionnel devra éviter d'agir de façon à laisser croire à des tiers qu'il est lié à Clinique MANA;`,
      `13.2.3. À compter de la date de résiliation, le Professionnel doit remettre sans délai à Clinique MANA tous documents fournis antérieurement au Professionnel par la Clinique MANA et ce sous quelque forme que ce soit et qui se trouvent en possession du Professionnel, dans les Locaux ou ailleurs;`,
      `13.2.4. À compter de la terminaison de la présente convention, aucune partie ne sera responsable envers l'autre partie pour tout dommage, perte, incluant, mais sans limiter la généralité de ce qui précède, aux pertes de profit causées par la terminaison de la présente convention;`,
      `13.2.5. Le professionnel s'engage à conserver une copie de ses dossiers pour une durée de 5 ans.`,
    ],
  },
  {
    number: '14',
    title: 'GÉNÉRALITÉS',
    content: [
      `14.1. Chaque disposition des présentes formes un tout distinct, de sorte que nonobstant toute décision d'un tribunal à l'effet que l'une des dispositions des présentes est déclarée nulle, sans effet, illégale, invalide ou réputée non-écrite ou non exécutoire envers toute personne ou pour toute circonstance, cette disposition sera réputée être indépendante, disjointe et divisible du reste de la convention et son invalidité, sa non-exécution ou son illégalité ne devra pas affecter ou invalider le reste de la convention, qui demeurera exécutoire entre les parties;`,
      `14.2. Cette convention lie par ailleurs les parties aux présentes ainsi que leurs héritiers, administrateurs, représentants légaux et successeurs;`,
      `14.3. La présente convention est régie et doit être interprétée selon les lois applicables dans la province de Québec. Tout litige découlant des présentes devra obligatoirement être intenté devant le tribunal ayant compétence dans le district judiciaire de Québec;`,
      `14.4. La présente convention remplace ou annule, s'il y a lieu, toute autre convention, entente, lettre d'entente, communication verbale ou écrite, ou autre document ayant trait aux présentes et qui aurait précédé sa date d'entrée en vigueur;`,
    ],
  },
]

// =============================================================================
// SIGNATURE SECTION
// =============================================================================

export const SIGNATURE_SECTION = {
  header: 'EN FOI DE QUOI, LES PARTIES ONT SIGNÉ À :',
  dateLabel: 'DATE :',
  professionalLabel: 'Professionnel',
  clinicLabel: 'Christine Sirois, Clinique MANA inc.',
}

// =============================================================================
// ANNEXE A
// =============================================================================

export const ANNEXE_A_HEADER = {
  title: 'Annexe A',
  subtitle: 'HONORAIRES ET AUTRES FRAIS',
}

export const ANNEXE_A_TABLE_HEADERS = {
  serviceType: 'Type de services',
  duration60Couple: 'Rencontre 60 min couple',
  duration50: 'Rencontre 50 min.',
  duration30: 'Rencontre 30 min',
  evaluationInitiale: 'Évaluation initiale',
}

export const AUTRES_FRAIS_HEADERS = {
  description: 'Autres frais',
  fraisFix: 'Frais fixe',
  fraisVariable: 'Frais variable',
}

// Default autres frais entries
export const DEFAULT_AUTRES_FRAIS = [
  {
    description: 'Déplacement',
    fraisFixe: '-',
    fraisVariable: '$ 0,70 / km',
  },
  {
    description: 'Temps de déplacement',
    fraisFixe: '-',
    fraisVariable: '40$/heure',
  },
  {
    description: 'Échange avec intervenant externe',
    fraisFixe: '-',
    fraisVariable: '100% honoraires',
  },
  {
    description: 'Rédaction de rapport',
    fraisFixe: '-',
    fraisVariable: '100% honoraires',
  },
]

// =============================================================================
// PAYMENT TERMS TABLE (Section 3.2)
// =============================================================================

export const PAYMENT_TERMS_TABLE = [
  { service: 'Ateliers et Conférences', percent: '25 %' },
  { service: 'Consultation en ligne ou en personne au bureau du professionnel', percent: '30 %' },
  { service: 'Annulation tardive ou absence non motivée', percent: '30 %' },
  { service: 'Autres frais', percent: '15 %' },
]

// =============================================================================
// PAGE FOOTER
// =============================================================================

export const PAGE_FOOTER = {
  initialsLabel: 'Initiales_________',
}
