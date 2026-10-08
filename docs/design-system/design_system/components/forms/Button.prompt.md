Compact 32px button, 6px radius, no shadow. One `default` (teal) per view; `outline` white for secondary actions; `ghost` for toolbars.
```jsx
<Button><Icon name="plus" size={14} /> Ajouter</Button>
<Button variant="outline">Annuler</Button>
<Button variant="ghost" size="icon-sm" aria-label="Fermer"><Icon name="x" size={14} /></Button>
<Button variant="link">Mot de passe oublié ?</Button>
```
Variants: default · ink · secondary · outline · ghost · destructive · link. Sizes: default (32) · sm (28, 12px) · lg (36, 14px) · icon · icon-sm.
