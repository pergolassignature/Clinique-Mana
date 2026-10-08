Quiet status chip: ink text, hairline border, coloured 6px dot. Colour lives in the dot, not the fill.
```jsx
<Badge variant="success">Actif</Badge>
<Badge variant="secondary">Invité</Badge>
<Badge variant="warning">Expire le 19 oct.</Badge>
<Badge variant="error">Inactif</Badge>
<Badge dot={false}>Psychologue</Badge>
<Badge variant="warning" filled>Urgent</Badge>
```
Professional statuses: active → success, invited → secondary, pending → outline, inactive → error. Use `filled` sparingly (urgent, one per row max).
