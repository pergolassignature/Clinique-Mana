Centered modal (max 512px, 16px radius, shadow-large, blurred charcoal overlay).
```jsx
<Dialog open={open} onClose={close} title="Ajouter un professionnel" description="Une invitation lui sera envoyée par courriel." footer={<><Button variant="outline" onClick={close}>Annuler</Button><Button>Créer et inviter</Button></>}>…fields…</Dialog>
```
Close X is outside the tab order. Use `inline` only for specimen cards.
