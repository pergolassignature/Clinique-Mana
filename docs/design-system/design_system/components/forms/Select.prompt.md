Native select styled like Input, with a chevron on the right.
```jsx
<Select options={['Tous les statuts', 'Actif', 'Invité', 'Inactif']} defaultValue="Tous les statuts" />
<Select placeholder="Choisir une profession" options={[{ value: 'psy', label: 'Psychologue' }]} value={v} onChange={e => setV(e.target.value)} />
```
Placeholder state renders muted text.
