function Parametres({ role }) {
  const { Card, Button, Icon, SettingsNav, Switch, Input, Label, Select, FullPageMessage, Alert } = DS;
  const readOnly = role === 'adjointe';
  const groups = readOnly ? SETTINGS_GROUPS.filter(g => g.label !== 'Plateforme').map(g => ({ ...g, items: g.items.filter(i => !['banque'].includes(i.id)).map(i => ({ ...i, readOnly: g.label !== 'Mon compte' })) })) : SETTINGS_GROUPS;
  const [sec, setSec] = React.useState(readOnly ? 'identite' : 'modules');
  const [mods, setMods] = React.useState(MODULES);
  const toggle = k => setMods(m => m.map(x => x.key === k ? { ...x, enabled: !x.enabled } : x));
  const active = groups.flatMap(g => g.items).find(i => i.id === sec) || groups[0].items[0];
  const Title = ({ t, d }) => <div style={{ marginBottom: 16 }}><h3 style={{ margin: 0, font: 'var(--type-section-title)' }}>{t}</h3>{d && <p style={{ margin: '2px 0 0', font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{d}</p>}</div>;
  return <>
    <h2 style={{ margin: 0, font: 'var(--type-page-title)', letterSpacing: 'var(--tracking-tight)' }}>Paramètres</h2>
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <SettingsNav groups={groups} active={active.id} onNavigate={setSec} />
      <section style={{ flex: 1, minWidth: 0, maxWidth: 'var(--form-max)' }}>
        {active.id === 'modules' && <><Title t="Modules" d="Activez un module lorsqu'il est prêt. Un module désactivé disparaît du menu et de l'application." />
          <Card padding={0}>{mods.map((m, i) => <div key={m.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderTop: i ? '1px solid var(--border)' : 0 }}><div><p style={{ margin: 0, font: 'var(--type-label)' }}>{m.name}</p>{m.depends.length > 0 && <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Requiert : {m.depends.join(', ')}</p>}</div><Switch checked={m.enabled} onChange={() => toggle(m.key)} aria-label={m.name} /></div>)}</Card></>}
        {active.id === 'identite' && <><Title t="Identité légale" d="Apparaît sur les reçus, les factures et les contrats." />{readOnly && <Alert style={{ marginBottom: 12 }} icon="lock" title="Lecture seule">Seule l'administration peut modifier ces informations.</Alert>}
          <Card><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="kit-col" style={{ gridColumn: '1 / -1' }}><Label>Raison sociale</Label><Input defaultValue="Clinique MANA inc." disabled={readOnly} /></div><div className="kit-col"><Label>NEQ</Label><Input defaultValue="1172 345 678" disabled={readOnly} /></div><div className="kit-col"><Label>Téléphone</Label><Input defaultValue="418 907-9754" disabled={readOnly} /></div><div className="kit-col" style={{ gridColumn: '1 / -1' }}><Label>Adresse du siège social</Label><Input defaultValue="300-797 boul. Lebourgneuf, Québec (QC) G2J 0B5" disabled={readOnly} /></div><div className="kit-col"><Label>Courriel</Label><Input defaultValue="info@cliniquemana.com" disabled={readOnly} /></div><div className="kit-col"><Label>Fuseau horaire</Label><Select defaultValue="America/Toronto" options={['America/Toronto', 'America/Vancouver']} disabled={readOnly} /></div></div>{!readOnly && <div className="kit-row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 6 }}><Button variant="outline">Annuler</Button><Button>Enregistrer</Button></div>}</Card></>}
        {active.id === 'compte' && <><Title t="Mon compte" /><Card><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><div className="kit-col"><Label>Nom</Label><Input defaultValue={ROLES[role].user} /></div><div className="kit-col"><Label>Courriel</Label><Input defaultValue="prenom@cliniquemana.com" /></div></div><div className="kit-row" style={{ marginTop: 16, gap: 6, flexWrap: 'wrap' }}><Button variant="outline" size="sm"><Icon name="key-round" size={14} /> Changer le mot de passe</Button><Button variant="outline" size="sm"><Icon name="log-out" size={14} /> Déconnecter tous les appareils</Button></div></Card></>}
        {!['modules', 'identite', 'compte'].includes(active.id) && <FullPageMessage compact title={active.label} body="Cette section arrive dans une prochaine phase." />}
      </section>
    </div>
  </>;
}
window.Parametres = Parametres;
