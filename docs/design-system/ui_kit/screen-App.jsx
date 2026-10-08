function App() {
  const [page, setPage] = React.useState(localStorage.getItem('mana-kit-page') || 'login');
  const [role, setRole] = React.useState(localStorage.getItem('mana-kit-role') || 'admin');
  const [selected, setSelected] = React.useState(null);
  React.useEffect(() => { localStorage.setItem('mana-kit-page', page); localStorage.setItem('mana-kit-role', role); }, [page, role]);
  const go = p => { setSelected(null); setPage(p); };
  if (page === 'login') return <Login onLogin={() => setPage('accueil')} />;
  const title = page === 'professionnels' && selected ? selected.name : (NAV[page] || NAV.accueil).label;
  const crumbs = page === 'professionnels' && selected ? ['Professionnels'] : undefined;
  return <Shell role={role} setRole={r => { setRole(r); if (!ROLES[r].nav.includes(page)) go('accueil'); }} page={page} setPage={go} title={title} crumbs={crumbs}>
    {page === 'accueil' && <Accueil role={role} setPage={go} />}
    {page === 'professionnels' && <Professionnels role={role} selected={selected} setSelected={setSelected} />}
    {page === 'demandes' && <Demandes />}
    {page === 'parametres' && <Parametres key={role} role={role} />}
    {['clients', 'rendez-vous', 'facturation'].includes(page) && <DS.EmptyState title={NAV[page].label + ' — module en préparation'} description="Cet écran sera conçu avec le module correspondant. Il reprendra la liste, la fiche et le tiroir des pages Professionnels et Demandes." />}
  </Shell>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
