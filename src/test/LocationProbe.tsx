import { useLocation } from 'react-router-dom'

/** Shows where the router is, so a test can tell that a guarded link navigated (or did not). */
export function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}
