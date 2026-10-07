Confirmation for irreversible actions; the only place a destructive button appears.
```jsx
<AlertDialog open={ask} destructive title="Désactiver ce professionnel ?" description="Il ne recevra plus de nouveaux jumelages." confirmLabel="Désactiver" onConfirm={doIt} onCancel={() => setAsk(false)} />
```
