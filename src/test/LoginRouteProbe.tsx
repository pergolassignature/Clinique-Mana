import { useLocation } from 'react-router-dom'

/** Login route stand-in for guard tests: shows the query string the guard redirected with. */
export function LoginRouteProbe() {
  const { search } = useLocation()
  return (
    <>
      <p>LOGIN PAGE</p>
      <p data-testid="login-search">{search}</p>
    </>
  )
}
