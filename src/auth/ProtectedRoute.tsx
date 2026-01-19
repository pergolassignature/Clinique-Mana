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
    return <Navigate to="/connexion" search={{ redirect: location.pathname }} />
  }

  return <>{children}</>
}
