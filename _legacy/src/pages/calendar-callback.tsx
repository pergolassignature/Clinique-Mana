import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Loader2, CheckCircle, XCircle } from 'lucide-react'

type CallbackStatus = 'processing' | 'success' | 'error'

export function CalendarCallbackPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { code?: string; state?: string; error?: string }
  const [status, setStatus] = useState<CallbackStatus>('processing')
  const [errorMessage, setErrorMessage] = useState<string>('')

  useEffect(() => {
    async function handleCallback() {
      // Check for OAuth error from Google
      if (search.error) {
        setStatus('error')
        setErrorMessage(search.error === 'access_denied'
          ? 'Accès refusé. Vous avez annulé la connexion.'
          : `Erreur OAuth: ${search.error}`)
        return
      }

      const { code, state } = search

      if (!code || !state) {
        setStatus('error')
        setErrorMessage('Paramètres manquants dans la réponse OAuth.')
        return
      }

      // Validate state against sessionStorage
      const storedState = sessionStorage.getItem('gcal_oauth_state')
      const storedProfessionalId = sessionStorage.getItem('gcal_oauth_professional_id')

      if (!storedState || state !== storedState) {
        setStatus('error')
        setErrorMessage('État OAuth invalide. Veuillez réessayer.')
        return
      }

      // Clean up sessionStorage
      sessionStorage.removeItem('gcal_oauth_state')
      sessionStorage.removeItem('gcal_oauth_professional_id')

      try {
        // Call the callback Edge Function directly (uses service role internally, validates via state)
        const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-callback`
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
        const response = await fetch(functionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({ code, state }),
        })

        const data = await response.json()

        if (!response.ok) {
          console.error('Callback error:', data)
          setStatus('error')
          setErrorMessage(data?.error || 'Erreur lors de la connexion du calendrier.')
          return
        }

        if (!data?.success) {
          setStatus('error')
          setErrorMessage(data?.error || 'Erreur inconnue.')
          return
        }

        setStatus('success')

        // Redirect to professional calendar tab after short delay
        setTimeout(() => {
          if (storedProfessionalId) {
            navigate({ to: '/professionnels/$id', params: { id: storedProfessionalId } })
          } else {
            navigate({ to: '/professionnels' })
          }
        }, 1500)
      } catch (err) {
        console.error('Callback error:', err)
        setStatus('error')
        setErrorMessage('Une erreur inattendue est survenue.')
      }
    }

    handleCallback()
  }, [search, navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="mx-auto max-w-md rounded-2xl border border-border bg-white p-8 text-center shadow-lg">
        {status === 'processing' && (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-sage-500" />
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Connexion en cours...
            </h1>
            <p className="mt-2 text-foreground-secondary">
              Veuillez patienter pendant que nous configurons votre calendrier.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Calendrier connecté !
            </h1>
            <p className="mt-2 text-foreground-secondary">
              Redirection vers votre profil...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Erreur de connexion
            </h1>
            <p className="mt-2 text-foreground-secondary">
              {errorMessage}
            </p>
            <button
              onClick={() => navigate({ to: '/professionnels' })}
              className="mt-6 rounded-lg bg-sage-600 px-4 py-2 text-sm font-medium text-white hover:bg-sage-700"
            >
              Retour aux professionnels
            </button>
          </>
        )}
      </div>
    </div>
  )
}
