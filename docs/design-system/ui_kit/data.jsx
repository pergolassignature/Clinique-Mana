const DS = window.CliniqueMANADesignSystem_d475f9;
const ROLES = {
  admin: { label: 'Admin', user: 'Christine Sirois', nav: ['accueil','demandes','clients','professionnels','rendez-vous','facturation','parametres'] },
  conseillere: { label: 'Conseillère', user: 'Alicia Gagnon', nav: ['accueil','demandes','clients','professionnels','rendez-vous'] },
  adjointe: { label: 'Adjointe administrative', user: 'Rachel Bédard', nav: ['accueil','clients','professionnels','rendez-vous','facturation','parametres'] },
};
const NAV = { accueil: { label: 'Accueil', icon: 'house' }, demandes: { label: 'Demandes', icon: 'inbox', badge: 4 }, clients: { label: 'Clients', icon: 'circle-user' }, professionnels: { label: 'Professionnels', icon: 'users' }, 'rendez-vous': { label: 'Rendez-vous', icon: 'calendar-days' }, facturation: { label: 'Facturation', icon: 'receipt' }, parametres: { label: 'Paramètres', icon: 'settings' } };
const PROS = [
  { id: 1, name: 'Justin Mantha', email: 'j.mantha@exemple.com', profession: 'Psychologue', order: 'OPQ', licence: '12345-67', status: 'active', specialties: 10, docs: 3, expiry: '1 mars 2027', rate: 160 },
  { id: 2, name: 'Sophie Lavoie', email: 'sophie.lavoie@exemple.com', profession: 'Psychothérapeute', order: 'OPQ', licence: '8821-11', status: 'active', specialties: 8, docs: 3, expiry: '19 oct. 2026', rate: 144, expiring: true },
  { id: 3, name: 'Marc-Antoine Roy', email: 'ma.roy@exemple.com', profession: 'Travailleur social', order: 'OTSTCFQ', licence: 'ROYM-4410', status: 'invited', specialties: 0, docs: 1, pendingInvite: true, rate: 130 },
  { id: 4, name: 'Nadia Bouchard', email: 'nadia.b@exemple.com', profession: 'Sexologue', order: 'OPSQ', licence: '2290', status: 'active', specialties: 6, docs: 3, expiry: '12 juin 2027', rate: 150 },
  { id: 5, name: 'Émilie Fortin', email: 'emilie.fortin@exemple.com', profession: 'Nutritionniste', order: 'ODNQ', licence: '7741', status: 'pending', specialties: 3, docs: 2, rate: 120 },
  { id: 6, name: 'Pierre-Luc Dubé', email: 'pl.dube@exemple.com', profession: 'Psychoéducateur', order: 'OPPQ', licence: '5531', status: 'inactive', specialties: 5, docs: 3, expiry: '2 sept. 2026', rate: 130 },
];
const STATUS = { active: ['success', 'Actif'], invited: ['secondary', 'Invité'], pending: ['outline', 'En attente'], inactive: ['error', 'Inactif'] };
const DEMANDES = [
  { id: 'D-1042', client: 'Marie Tremblay', motifs: ['Anxiété', 'Stress au travail'], source: 'Google', age: '2 h', urgency: 'normal', status: 'À rappeler', phone: '418 555-0142', pref: 'Soirs, semaine', payer: 'PAE Desjardins' },
  { id: 'D-1041', client: 'Olivier Bernier', motifs: ['Couple'], source: 'Recommandation', age: '5 h', urgency: 'normal', status: 'À rappeler', phone: '581 555-0199', pref: 'Fins de semaine' },
  { id: 'D-1039', client: 'Camille Giroux', motifs: ['Deuil'], source: 'Employeur / PAE', age: '1 j', urgency: 'haute', status: 'Appel découverte fait', phone: '418 555-0177', pref: 'Jours', payer: 'IVAC' },
  { id: 'D-1037', client: 'Samuel Lachance', motifs: ['Orientation', 'Adolescent'], source: 'École ou organisme', age: '2 j', urgency: 'normal', status: 'Jumelage proposé', phone: '418 555-0120', pref: 'Après 16 h' },
];
const RDV = [
  { time: '09:00', client: 'Marie Tremblay', pro: 'Justin Mantha', type: 'Individuel · 50 min', mode: 'Vidéo' },
  { time: '10:30', client: 'Olivier et Jade Bernier', pro: 'Nadia Bouchard', type: 'Couple · 60 min', mode: 'Vidéo' },
  { time: '13:00', client: 'Camille Giroux', pro: 'Sophie Lavoie', type: 'Individuel · 50 min', mode: 'Téléphone' },
  { time: '15:30', client: 'Samuel Lachance', pro: 'Justin Mantha', type: 'Individuel · 50 min', mode: 'Vidéo' },
];
const SETTINGS_GROUPS = [
  { label: 'Clinique', items: [{ id: 'identite', label: 'Identité légale', icon: 'building-2' }, { id: 'fiscalite', label: 'Fiscalité', icon: 'percent' }, { id: 'signataire', label: 'Signataire', icon: 'pen-line' }, { id: 'banque', label: 'Coordonnées bancaires', icon: 'landmark' }, { id: 'region', label: 'Région', icon: 'globe' }, { id: 'confidentialite', label: 'Confidentialité (Loi 25)', icon: 'shield-check' }] },
  { label: 'Plateforme', items: [{ id: 'utilisateurs', label: 'Utilisateurs et accès', icon: 'users' }, { id: 'modules', label: 'Modules', icon: 'blocks' }, { id: 'courriels', label: 'Courriels', icon: 'mail' }, { id: 'signature', label: 'Signature électronique', icon: 'signature' }, { id: 'integrations', label: 'Intégrations', icon: 'plug' }, { id: 'taches', label: 'Tâches planifiées', icon: 'clock' }, { id: 'audit', label: "Journal d'audit", icon: 'scroll-text' }] },
  { label: 'Modules', items: [{ id: 'm-pros', label: 'Professionnels', icon: 'users' }, { id: 'm-services', label: 'Services et tarifs', icon: 'tag' }, { id: 'm-fact', label: 'Facturation', icon: 'receipt' }, { id: 'm-payeurs', label: 'Payeurs externes', icon: 'hand-coins' }, { id: 'm-rdv', label: 'Rendez-vous', icon: 'calendar-days' }] },
  { label: 'Mon compte', items: [{ id: 'compte', label: 'Mon compte', icon: 'circle-user' }] },
];
const MODULES = [
  { key: 'professionals', name: 'Professionnels', enabled: true, depends: [] },
  { key: 'services', name: 'Services et tarifs', enabled: true, depends: ['Professionnels'] },
  { key: 'clients', name: 'Clients', enabled: true, depends: [] },
  { key: 'requests', name: 'Demandes et jumelage', enabled: true, depends: ['Clients', 'Professionnels'] },
  { key: 'appointments', name: 'Rendez-vous', enabled: false, depends: ['Clients', 'Professionnels'] },
  { key: 'billing', name: 'Facturation', enabled: false, depends: ['Rendez-vous', 'Services et tarifs'] },
];
Object.assign(window, { DS, ROLES, NAV, PROS, STATUS, DEMANDES, RDV, SETTINGS_GROUPS, MODULES });
