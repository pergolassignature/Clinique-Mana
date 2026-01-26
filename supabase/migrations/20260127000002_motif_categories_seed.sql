-- Seed default motif categories
-- These categories match the existing MOTIF_DISPLAY_GROUPS in src/motifs/constants.ts

insert into public.motif_categories (key, label_fr, description_fr, icon_name, display_order) values
  ('inner_life', 'Vie intérieure', 'Anxiété, dépression, estime de soi et santé mentale', 'Brain', 1),
  ('relationships', 'Relations et famille', 'Relations amoureuses, familiales et interpersonnelles', 'Users', 2),
  ('dependencies', 'Dépendances', 'Dépendances comportementales et substances', 'AlertTriangle', 3),
  ('work', 'Vie professionnelle', 'Carrière, épuisement et difficultés au travail', 'Briefcase', 4),
  ('development', 'Développement', 'Troubles d''apprentissage, TDAH et neurodéveloppement', 'GraduationCap', 5),
  ('identity', 'Identité', 'Genre, orientation sexuelle et identité personnelle', 'Fingerprint', 6),
  ('trauma', 'Trauma', 'Abus, violence et expériences traumatiques', 'Shield', 7),
  ('life_changes', 'Changements de vie', 'Deuil, maladies et transitions de vie', 'Leaf', 8);
