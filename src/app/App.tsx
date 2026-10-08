import { useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { useAuth } from '@/core/auth/auth-context'
import { AccessProvider } from '@/core/access/AccessProvider'
import { Loading, RequireAuth } from '@/core/access/guards'
import { LoginPage } from '@/core/auth/pages/LoginPage'
import { ForgotPasswordPage } from '@/core/auth/pages/ForgotPasswordPage'
import { ResetPasswordPage } from '@/core/auth/pages/ResetPasswordPage'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { Toaster } from '@/shared/ui/sonner'
import { lazyPage, useLazyPageReady, whenIdle } from '@/shared/lib/lazy-page'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'
import { preloadRouteCode } from './route-preload'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2 * 60_000, gcTime: 5 * 60_000, retry: 1 } },
})

/**
 * The signed-in app (shell, command palette, « Mon compte », settings, date libraries) is its own
 * chunk, so the login page does not download or run it. RequireAuth and its recovery redirect
 * stay in the entry: nothing signed-in renders before the access is verified (#11), and sign-out
 * lands on the login page without this chunk (#17).
 */
const AuthenticatedApp = lazyPage(() => import('./AuthenticatedApp'), 'AuthenticatedApp')

/**
 * Shows RequireAuth's loading screen until the signed-in chunk is in. No Suspense: a committed
 * fallback would stay at least 300 ms (React 19), slowing sign-in. A failed load reaches the
 * app's error boundary, whose Retry reloads the page.
 */
function SignedInApp() {
  const ready = useLazyPageReady(AuthenticatedApp)
  return ready ? <AuthenticatedApp /> : <Loading />
}

/**
 * Starts loading signed-in code early, so sign-in and reloads never wait for it:
 * - on the login (or other public) page, the signed-in chunk once the browser is idle;
 * - as soon as a session exists (reload, deep link, sign-in), that chunk and the page the user is
 *   going to, in the same tick as AccessProvider's get_my_access.
 * Code only, the same for every user. Renders nothing: RequireAuth still waits for the verified
 * access before anything signed-in renders (#11).
 */
function PreloadSignedInCode() {
  const { session, isLoading, isRecovery } = useAuth()
  const signedIn = Boolean(session) && !isRecovery
  const signedOut = !isLoading && !session
  useEffect(() => {
    if (!signedIn) return
    void AuthenticatedApp.preload().catch(() => {
      // Ignored here: SignedInApp loads it again and reports a real failure.
    })
    preloadRouteCode()
  }, [signedIn])
  useEffect(() => {
    if (!signedOut) return
    const idle = whenIdle(() => void AuthenticatedApp.preload().catch(() => {}))
    return idle.cancel
  }, [signedOut])
  return null
}

export function App() {
  return (
    <ErrorBoundary scope="app">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AccessProvider>
            <PreloadSignedInCode />
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
                      <SignedInApp />
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
