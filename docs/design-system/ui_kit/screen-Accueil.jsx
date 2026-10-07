function Accueil({ role, setPage }) {
  const { Card, Badge, Avatar, Button, Icon } = DS;
  const r = ROLES[role];
  const first = r.user.split(' ')[0];
  const showDemandes = r.nav.includes('demandes'); const showFact = r.nav.includes('facturation');
  return <>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}><h2 style={{ margin: 0, font: 'var(--type-page-title)', letterSpacing: 'var(--tracking-tight)' }}>Bonjour {first}</h2><span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Mercredi 7 octobre 2026</span></div>
    <Card padding={0} style={{ flexDirection: 'row', overflow: 'hidden' }}>
      {showDemandes && <Figure label="Demandes à rappeler" value="4" hint="2 dépassent 24 h" tone="warn" onClick={() => setPage('demandes')} />}
      <Figure label="Rendez-vous aujourd'hui" value="12" hint="4 ce matin · 100 % en ligne" onClick={() => setPage('rendez-vous')} />
      <Figure label="Documents qui expirent" value="2" hint="dans les 30 prochains jours" onClick={() => setPage('professionnels')} />
      {showFact ? <Figure label="Factures impayées" value="3 180 $" hint="7 factures · 2 IVAC" onClick={() => setPage('facturation')} /> : <Figure label="Professionnels actifs" value="48" hint="sur 52" onClick={() => setPage('professionnels')} />}
    </Card>
    <div style={{ display: 'grid', gridTemplateColumns: showDemandes ? 'repeat(auto-fit, minmax(320px,1fr))' : '1fr', gap: 20 }}>
      {showDemandes && <section><div className="kit-sec"><h3>À rappeler</h3><Button variant="ghost" size="sm" onClick={() => setPage('demandes')}>Toutes les demandes <Icon name="arrow-right" size={12} /></Button></div>
        <Card padding={0}>{DEMANDES.filter(d => d.status === 'À rappeler').concat(DEMANDES[2]).map((d, i) => <Row key={d.id} cols="24px 1fr auto auto" onClick={() => setPage('demandes')} style={{ borderTop: i ? '1px solid var(--border)' : 0 }}><Avatar name={d.client} size="sm" tone="neutral" /><div style={{ minWidth: 0 }}><p style={{ margin: 0, font: 'var(--type-label)' }}>{d.client}</p><p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.motifs.join(' · ')} · {d.source}</p></div>{d.urgency === 'haute' ? <Badge variant="error" filled>Urgent</Badge> : <span />}<span className="kit-num kit-muted" style={{ font: 'var(--type-caption)' }}>{d.age}</span></Row>)}</Card></section>}
      <section><div className="kit-sec"><h3>Aujourd'hui</h3><Button variant="ghost" size="sm" onClick={() => setPage('rendez-vous')}>Agenda <Icon name="arrow-right" size={12} /></Button></div>
        <Card padding={0}>{RDV.map((a, i) => <Row key={a.time} cols="44px 1fr auto" style={{ borderTop: i ? '1px solid var(--border)' : 0 }}><span className="kit-num" style={{ font: 'var(--type-label)' }}>{a.time}</span><div style={{ minWidth: 0 }}><p style={{ margin: 0, font: 'var(--type-label)' }}>{a.client}</p><p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{a.pro} · {a.type}</p></div><span className="kit-row" style={{ gap: 4, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}><Icon name={a.mode === 'Vidéo' ? 'video' : 'phone'} size={12} />{a.mode}</span></Row>)}</Card></section>
    </div>
    <section><div className="kit-sec"><h3>À surveiller</h3></div>
      <Card padding={0}><Row cols="16px 1fr auto" onClick={() => setPage('professionnels')}><Icon name="triangle-alert" size={14} style={{ color: 'var(--warning)' }} /><span><b style={{ fontWeight: 500 }}>Sophie Lavoie</b> · assurance responsabilité expire le 19 oct. — désactivation automatique sans renouvellement</span><Button variant="outline" size="sm">Voir la fiche</Button></Row><Row cols="16px 1fr auto" onClick={() => setPage('professionnels')} style={{ borderTop: '1px solid var(--border)' }}><Icon name="clock" size={14} style={{ color: 'var(--neutral-dot)' }} /><span><b style={{ fontWeight: 500 }}>Marc-Antoine Roy</b> · invitation sans réponse depuis 6 jours</span><Button variant="outline" size="sm">Relancer</Button></Row></Card></section>
  </>;
}
window.Accueil = Accueil;
