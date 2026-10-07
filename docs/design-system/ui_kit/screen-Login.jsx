function Login({ onLogin }) {
  const { AuthCard, Button, Input, Label } = DS;
  const [sent, setSent] = React.useState(false);
  return <AuthCard logoSrc="../assets/logo-header.svg" title="Connexion" subtitle="Connectez-vous pour accéder à votre espace." status={sent ? 'Si un compte existe pour ce courriel, un lien de connexion vient d\'être envoyé.' : null}>
    <form onSubmit={e => { e.preventDefault(); onLogin(); }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="kit-col"><Label htmlFor="email">Courriel</Label><Input id="email" type="email" autoComplete="username" defaultValue="christine@cliniquemana.com" /></div>
      <div className="kit-col"><Label htmlFor="password">Mot de passe</Label><Input id="password" type="password" autoComplete="current-password" defaultValue="••••••••••••" /></div>
      <Button type="submit" fullWidth>Se connecter</Button>
      <div className="kit-row" style={{ gap: 12, font: 'var(--type-caption)', color: 'var(--text-muted)' }} aria-hidden="true"><span style={{ flex: 1, height: 1, background: 'var(--border)' }} />ou<span style={{ flex: 1, height: 1, background: 'var(--border)' }} /></div>
      <Button type="button" variant="outline" fullWidth style={{ whiteSpace: 'normal' }} onClick={() => setSent(true)}>Recevoir un lien de connexion par courriel</Button>
      <p style={{ margin: 0, textAlign: 'center' }}><Button variant="link" type="button">Mot de passe oublié ?</Button></p>
    </form>
  </AuthCard>;
}
window.Login = Login;
