const base64url = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A real-shaped (unsigned) access token: `header.<base64url(claims)>.sig`, as GoTrue issues them. */
export function fakeAccessToken(sessionId: string, claims: Record<string, unknown> = {}): string {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ session_id: sessionId, ...claims })}.sig`
}
