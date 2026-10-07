const { SidebarNav, Topbar, Dialog, CommandPalette, Icon } = DS;
function Shell({ role, setRole, page, setPage, title, crumbs, children }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  React.useEffect(() => { const h = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const r = ROLES[role];
  const items = r.nav.map(id => ({ id, ...NAV[id] }));
  const current = r.nav.includes(page) ? page : 'accueil';
  return <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
    <SidebarNav logoSrc="../assets/logo-header.svg" items={items} active={current} onNavigate={setPage} user={r.user} roleLabel={r.label} collapsed={collapsed} onSignOut={() => setPage('login')} />
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Topbar title={title} crumbs={crumbs} onToggleSidebar={() => setCollapsed(c => !c)} onSearch={() => setPalette(true)} notifications={role === 'conseillere' ? 3 : 1} user={r.user} actions={<RoleSwitch role={role} setRole={setRole} />} />
      <main style={{ flex: 1, overflowY: 'auto', padding: 'var(--page-pad)' }}><div style={{ maxWidth: 'var(--content-max)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div></main>
    </div>
    {palette && <Dialog open onClose={() => setPalette(false)} hideClose maxWidth={600} style={{ padding: 0, background: 'transparent', boxShadow: 'none' }}><CommandPalette onSelect={it => { setPalette(false); if (it.page) setPage(it.page); }} groups={[{ label: 'Clients', items: [{ label: 'Marie Tremblay', icon: 'circle-user', hint: 'Cliente', page: 'clients' }, { label: 'Olivier Bernier', icon: 'circle-user', hint: 'Client', page: 'clients' }] }, { label: 'Professionnels', items: PROS.slice(0, 3).map(p => ({ label: p.name, icon: 'users', hint: p.profession, page: 'professionnels' })) }, { label: 'Pages', items: r.nav.map(i => ({ label: NAV[i].label, icon: NAV[i].icon, page: i })) }]} /></Dialog>}
  </div>;
}
function RoleSwitch({ role, setRole }) {
  return <div role="radiogroup" aria-label="Voir comme" style={{ display: 'flex', gap: 1, padding: 2, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', marginRight: 6 }}>{Object.entries(ROLES).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={k === role} onClick={() => setRole(k)} style={{ border: 0, cursor: 'pointer', padding: '3px 8px', borderRadius: 4, font: 'var(--type-caption)', fontWeight: 500, background: k === role ? 'var(--surface-card)' : 'transparent', color: k === role ? 'var(--text-body)' : 'var(--text-muted)', boxShadow: k === role ? '0 0 0 1px var(--border)' : 'none', whiteSpace: 'nowrap' }}>{v.label.split(' ')[0]}</button>)}</div>;
}
/* Inline figure: label over number, separated by hairlines inside one flat panel */
function Figure({ label, value, hint, onClick, tone }) {
  return <button type="button" onClick={onClick} className="kit-fig" style={{ flex: 1, minWidth: 140, background: 'transparent', textAlign: 'left', padding: '12px 16px', cursor: onClick ? 'pointer' : 'default', font: 'inherit', color: 'inherit' }}><p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</p><p className="kit-num" style={{ margin: '2px 0 0', font: 'var(--type-figure)', color: tone === 'warn' ? 'var(--danger)' : 'var(--text-body)' }}>{value}</p>{hint && <p style={{ margin: '2px 0 0', font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{hint}</p>}</button>;
}
function Row({ children, onClick, cols, style, className = '' }) { return <div className={'kit-tr ' + className} onClick={onClick} style={{ gridTemplateColumns: cols, cursor: onClick ? 'pointer' : 'default', ...style }}>{children}</div>; }
function Head({ children, cols }) { return <div className="kit-th" style={{ gridTemplateColumns: cols }}>{children}</div>; }
Object.assign(window, { Shell, Figure, Row, Head });
