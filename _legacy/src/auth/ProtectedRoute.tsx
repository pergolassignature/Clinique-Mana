import { Navigate, useLocation } from '@tanstack/react-router'
import { useAuth } from './AuthContext'
import { LoadingScreen } from './LoadingScreen'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, profile, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <LoadingScreen />
  }

  if (!user || !profile) {
    // Don't set redirect if already on login page to prevent loops
    const redirect = location.pathname !== '/connexion' ? location.pathname : undefined
    return <Navigate to="/connexion" search={{ redirect }} />
  }

  return <>{children}</>
}
