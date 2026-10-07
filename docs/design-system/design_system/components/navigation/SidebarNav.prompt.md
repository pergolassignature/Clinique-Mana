Flat grey sidebar, 220px (56 collapsed): logo, 13px links with 16px icons, optional section labels, user row with sign-out at the bottom. Items follow the user's role.
```jsx
<SidebarNav logoSrc="assets/logo-header.svg" active="professionnels" onNavigate={go} user="Christine Sirois" roleLabel="Admin" onSignOut={out}
  items={[{ id: 'accueil', label: 'Accueil', icon: 'house' }, { id: 'demandes', label: 'Demandes', icon: 'inbox', badge: 4 }, { section: 'Dossiers' }, { id: 'clients', label: 'Clients', icon: 'circle-user' }, { id: 'professionnels', label: 'Professionnels', icon: 'users' }]} />
```
Active = white pill with hairline ring, ink text. No coloured bars, no coloured icons.
