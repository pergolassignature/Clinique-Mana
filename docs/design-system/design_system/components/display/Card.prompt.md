Flat grey panel (8px radius, no border, no shadow) that groups content; `outline` variant for white panels on grey.
```jsx
<Card title="Documents" description="Assurance, permis…" action={<Button variant="outline" size="sm">Ajouter</Button>}>…</Card>
<Card interactive onClick={open} padding={12}>…</Card>
<Card variant="outline">…</Card>
```
Padding 16 (12 compact). Lists inside a panel use white rows (`outline`) or hairline dividers, never nested shadows.
