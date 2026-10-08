Grouped side menu for Paramètres (Clinique · Plateforme · Modules · Mon compte).
```jsx
<SettingsNav active="modules" onNavigate={go} groups={[{ label: 'Clinique', items: [{ id: 'identite', label: 'Identité légale', icon: 'building-2' }] }, { label: 'Plateforme', items: [{ id: 'modules', label: 'Modules', icon: 'blocks' }] }]} />
```
`readOnly` shows a lock (adjointe sees Paramètres in lecture seule).
