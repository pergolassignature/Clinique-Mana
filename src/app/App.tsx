import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { AccessProvider } from '@/core/access/AccessProvider'
import { RequireAuth } from '@/core/access/guards'
import { LoginPage } from '@/core/auth/pages/LoginPage'
import { ForgotPasswordPage } from '@/core/auth/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/core/auth/pages/ResetPasswordPage'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { Toaster } from '@/shared/ui/sonner'
import { AuthenticatedApp } from './AuthenticatedApp'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2 * 60_000, gcTime: 5 * 60_000, retry: 1 } },
})

export function App() {
  return (
    <ErrorBoundary scope="app">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccessProvider>
            <BrowserRouter future={ROUTER_FUTURE}>
              <Routes>
                <Route path="/connexion" element={<LoginPage />} />
                <Route path="/mot-de-passe-oublie" element={<ForgotPasswordPage />} />
                {/* Not under RequireAuth: RequireAuth sends recovery sessions here. */}
                <Route path="/reinitialiser-mot-de-passe" element={<ResetPasswordPage />} />
                <Route
                  path="/*"
                  element={
                    <RequireAuth>
                      <AuthenticatedApp />
                    </RequireAuth>
                  }
                />
              </Routes>
            </BrowserRouter>
            <Toaster />
          </AccessProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
