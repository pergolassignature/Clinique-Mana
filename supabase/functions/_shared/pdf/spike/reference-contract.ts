/**
 * Reference contract for the renderer spike and bench (plan Task 3.29): six
 * Letter pages = four pages of clauses, Annexe A (12 × 4 table), signature
 * page. FR-CA text with accents, « », ’, œ and `$` amounts (NBSP separators,
 * as `Intl` formats them in fr-CA).
 */
import type { Block, PdfDocument, Run } from './model.ts'

const p = (...runs: (string | Run)[]): Block => ({
  type: 'paragraph',
  runs: runs.map((r) => typeof r === 'string' ? { text: r } : r),
})
const b = (text: string): Run => ({ text, bold: true })
const h2 = (text: string): Block => ({ type: 'heading', level: 2, text })
const ol = (...items: string[]): Block => ({
  type: 'list',
  ordered: true,
  items: items.map((text) => [{ text }]),
})

const clauses: Block[] = [
  h2('1. Objet du contrat'),
  p(
    'Le présent contrat établit les conditions selon lesquelles le ',
    b('Professionnel'),
    ' offre ses services aux clients que la ',
    b('Clinique'),
    ' lui oriente. La Clinique reçoit les demandes, procède à l’accueil et propose un jumelage; le Professionnel demeure seul responsable de ses interventions, de leur contenu et de leur suivi, conformément aux normes de son ordre professionnel.',
  ),
  p(
    'Les services sont offerts à distance, par visioconférence ou par téléphone, à partir d’un lieu qui assure la confidentialité des échanges. Toute rencontre en personne doit faire l’objet d’une entente écrite préalable entre les parties.',
  ),
  h2('2. Statut de travailleur autonome'),
  p(
    'Le Professionnel agit à titre de travailleur autonome. Rien dans le présent contrat ne crée de lien d’emploi, de société ou de mandat entre les parties. Le Professionnel détermine ses méthodes de travail, son horaire de disponibilité et ses outils, sous réserve des engagements prévus à la clause 5.',
  ),
  p(
    'Le Professionnel est responsable de ses déclarations fiscales, de ses cotisations et de la perception des taxes applicables, le cas échéant. Il fournit à la Clinique, sur demande, son numéro d’inscription aux fichiers de la TPS et de la TVQ.',
  ),
  h2('3. Durée'),
  p(
    'Le contrat entre en vigueur à la date de la dernière signature et se poursuit pour une durée indéterminée. Il peut être résilié selon les modalités de la clause 11. Les obligations de confidentialité survivent à la fin du contrat, sans limite de durée.',
  ),
  h2('4. Engagements de la Clinique'),
  p('La Clinique s’engage à :'),
  ol(
    'recevoir les demandes des clients, recueillir les renseignements nécessaires au jumelage et les transmettre au Professionnel par un moyen sécurisé;',
    'proposer au Professionnel des jumelages compatibles avec ses champs d’intervention, sa clientèle et ses disponibilités déclarées;',
    'assurer la facturation aux clients et le versement des honoraires selon la clause 6;',
    'maintenir une plateforme de gestion conforme à la Loi sur la protection des renseignements personnels dans le secteur privé (« Loi 25 »);',
    'informer le Professionnel, dans un délai raisonnable, de toute plainte qui le concerne.',
  ),
  h2('5. Engagements du Professionnel'),
  p('Le Professionnel s’engage à :'),
  ol(
    'détenir en tout temps un permis d’exercice valide et en informer la Clinique sans délai en cas de suspension, de limitation ou de radiation;',
    'maintenir une assurance responsabilité professionnelle couvrant les services rendus, et en fournir la preuve chaque année avant le 31 mars;',
    'communiquer avec le client jumelé dans les deux jours ouvrables suivant le jumelage;',
    'tenir ses dossiers conformément aux règlements de son ordre, hors de la plateforme de la Clinique;',
    'aviser la Clinique au moins trente jours à l’avance de toute absence prolongée.',
  ),
  p(
    'Le Professionnel reconnaît que les motifs de consultation recueillis à l’accueil sont des repères d’orientation et non des diagnostics. Il demeure seul juge de la pertinence de ses interventions.',
  ),
  h2('6. Honoraires et versements'),
  p(
    'Les honoraires applicables sont ceux de l’Annexe A. La Clinique perçoit les sommes payées par les clients et verse au Professionnel sa part, déduction faite des frais d’administration prévus à l’Annexe A, au plus tard le quinzième jour du mois suivant la prestation.',
  ),
  p(
    'Un rendez-vous annulé moins de 24 heures à l’avance est facturé selon la politique d’annulation en vigueur; la part du Professionnel lui est versée dans les mêmes conditions qu’une séance tenue. Les montants sont exprimés en dollars canadiens, ',
    b('taxes en sus'),
    ' lorsqu’elles s’appliquent.',
  ),
  h2('7. Confidentialité et renseignements personnels'),
  p(
    'Chaque partie protège les renseignements personnels auxquels elle a accès et ne les utilise qu’aux fins du présent contrat. Le Professionnel n’enregistre aucun renseignement clinique dans la plateforme de la Clinique; les notes évolutives sont tenues dans son propre système, sous sa responsabilité.',
  ),
  p(
    'Tout incident de confidentialité est signalé à la responsable de la protection des renseignements personnels de la Clinique dans les 24 heures suivant sa découverte, afin que les mesures prévues par la Loi 25 soient mises en œuvre. Les parties collaborent à l’évaluation du préjudice et aux avis requis.',
  ),
  h2('8. Assurance et responsabilité'),
  p(
    'Le Professionnel est responsable des fautes commises dans l’exercice de sa profession et tient la Clinique indemne de toute réclamation qui en découle. La Clinique est responsable de la gestion de la plateforme, de l’accueil et de la facturation.',
  ),
  p(
    'L’attestation d’assurance est déposée dans l’espace du Professionnel. À défaut d’une attestation valide au 31 mars, la Clinique suspend les nouveaux jumelages jusqu’à sa réception, sans autre avis.',
  ),
  h2('9. Non-sollicitation'),
  p(
    'Pendant la durée du contrat et les douze mois qui suivent sa fin, le Professionnel ne sollicite pas, directement ou indirectement, les clients qui lui ont été orientés par la Clinique afin de les servir hors de celle-ci. Cette clause n’empêche pas un client de choisir librement son professionnel.',
  ),
  h2('10. Propriété intellectuelle'),
  p(
    'Le Professionnel conserve la propriété de ses outils, questionnaires et contenus. La Clinique conserve la propriété de sa marque, de sa plateforme et de ses gabarits. Aucune licence n’est accordée au-delà de ce qui est nécessaire à l’exécution du contrat.',
  ),
  h2('11. Résiliation'),
  p(
    'Chaque partie peut résilier le contrat en tout temps au moyen d’un préavis écrit de trente jours. Le préavis n’est pas requis en cas de manquement grave, notamment la perte du permis d’exercice, un manquement à la confidentialité ou une conduite incompatible avec le code de déontologie applicable.',
  ),
  p(
    'À la résiliation, le Professionnel termine ou transfère les suivis en cours de façon ordonnée, dans l’intérêt des clients, et la Clinique verse les honoraires dus pour les services rendus jusqu’à la date de fin.',
  ),
  h2('12. Communications'),
  p(
    'Les avis prévus au contrat sont transmis par courriel aux adresses inscrites dans la plateforme. Un avis est réputé reçu le jour ouvrable suivant son envoi. Chaque partie informe l’autre de tout changement d’adresse.',
  ),
  h2('13. Disponibilités et calendrier'),
  p(
    'Le Professionnel tient à jour ses plages de disponibilité dans la plateforme au moins deux semaines à l’avance. La Clinique ne propose un jumelage que sur les plages déclarées; un rendez-vous confirmé ne peut être déplacé qu’avec l’accord du client.',
  ),
  p(
    'Les rappels de rendez-vous sont envoyés par la Clinique. Le Professionnel informe la Clinique de toute séance annulée de son fait, afin que le client soit avisé et qu’une nouvelle plage lui soit offerte sans frais.',
  ),
  h2('14. Qualité des services et plaintes'),
  p(
    'La Clinique recueille les commentaires des clients sur l’accueil et le jumelage. Une plainte qui porte sur l’exercice de la profession est transmise au Professionnel et, s’il y a lieu, le client est informé de son droit de s’adresser à l’ordre professionnel concerné.',
  ),
  ol(
    'La Clinique accuse réception de la plainte dans les deux jours ouvrables.',
    'Le Professionnel transmet sa version des faits dans les dix jours ouvrables.',
    'Les parties conviennent, s’il y a lieu, des mesures à prendre envers le client, dans le respect du secret professionnel.',
  ),
  h2('15. Formation continue et supervision'),
  p(
    'Le Professionnel maintient ses compétences selon les exigences de formation continue de son ordre. Il peut, à sa discrétion, participer aux activités de codéveloppement offertes par la Clinique; ces activités ne constituent pas une supervision clinique et ne modifient pas son statut de travailleur autonome.',
  ),
  p(
    'Les attestations de formation que le Professionnel choisit de déposer dans son espace servent uniquement à mettre à jour ses champs d’intervention dans la fiche présentée aux conseillères.',
  ),
  h2('16. Dispositions générales'),
  p(
    'Le contrat est régi par les lois du Québec. Il constitue l’entente complète entre les parties et remplace toute entente antérieure portant sur le même objet. Une modification n’est valide que si elle est constatée par écrit et signée par les deux parties.',
  ),
  p(
    'Si une disposition est jugée invalide, les autres demeurent en vigueur. Le fait pour une partie de ne pas exercer un droit ne constitue pas une renonciation à ce droit. Les parties ont exigé que le contrat soit rédigé en français.',
  ),
  p(
    'Les signatures électroniques apposées au moyen de la plateforme de signature de la Clinique ont la même valeur que des signatures manuscrites, conformément à la Loi concernant le cadre juridique des technologies de l’information. Chaque partie reçoit une copie signée du contrat et de son certificat de signature.',
  ),
]

const money = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
})
const services: [string, string, number, number][] = [
  ['Consultation individuelle (50 min)', '50 min', 130, 24],
  ['Consultation individuelle (80 min)', '80 min', 195, 36],
  ['Consultation de couple (80 min)', '80 min', 210, 39],
  ['Médiation familiale (séance)', '90 min', 225, 42],
  ['Évaluation d’orientation', '120 min', 1250, 230],
  ['Rencontre parent-enfant', '60 min', 145, 27],
  ['Suivi téléphonique bref', '25 min', 65, 12],
  ['Rapport écrit', '—', 180, 33],
  ['Lettre d’attestation', '—', 45, 8.5],
  ['Annulation tardive (< 24 h)', '—', 65, 12],
  ['Groupe « Mieux-être » (par personne)', '120 min', 75, 14],
  ['Préparation de dossier IVAC', '—', 95, 17.5],
]

/** The reference contract (6 pages; initials for both signers on every page). */
export const referenceContract: PdfDocument = {
  title: 'Contrat de services professionnels',
  header: {
    text: 'Clinique MANA · Contrat de services professionnels',
    initialsFor: ['professional', 'clinic'],
  },
  footer: { text: 'Version 2026-1 · Confidentiel' },
  blocks: [
    { type: 'heading', level: 1, text: 'Contrat de services professionnels' },
    p(
      'Entre ',
      b('Clinique MANA inc.'),
      ', 1234, rue Saint-Denis, Montréal (Québec) H2X 3K2, représentée par Christine Côté, directrice (la « Clinique »), et ',
      b('Geneviève Lévesque-Bérubé'),
      ', psychothérapeute, permis nº 12345-67 (le « Professionnel »).',
    ),
    ...clauses,
    { type: 'pageBreak' },
    {
      type: 'heading',
      level: 1,
      text: 'Annexe A — Honoraires et frais d’administration',
    },
    p(
      'Les honoraires ci-dessous sont facturés aux clients par la Clinique. Les frais d’administration sont retenus sur chaque prestation; le solde est versé au Professionnel selon la clause 6.',
    ),
    {
      type: 'table',
      columns: [
        { label: 'Service', width: 46 },
        { label: 'Durée', width: 14 },
        { label: 'Honoraires', width: 20 },
        { label: 'Frais de la Clinique', width: 20 },
      ],
      rows: services.map(([name, length, fee, cut]) => [
        name,
        length,
        money.format(fee),
        money.format(cut),
      ]),
    },
    p(
      'Les montants sont en dollars canadiens et s’entendent avant les taxes applicables (TPS 5 %, TVQ 9,975 %), lorsque le service y est assujetti. Ils peuvent être révisés une fois par année civile, sur préavis écrit de soixante jours.',
    ),
    {
      type: 'signaturePage',
      signers: [
        {
          role: 'professional',
          label: 'Le Professionnel — Geneviève Lévesque-Bérubé',
        },
        {
          role: 'clinic',
          label: 'Pour la Clinique — Christine Côté, directrice',
        },
      ],
    },
  ],
}
