/**
 * A stand-in for Google's token signer (test-only, and `scripts/fake-gmail.ts`):
 * an RSA key pair of its own, its JWKS as Google publishes it at
 * `/oauth2/v3/certs`, and `sign(claims)` → an RS256 JWT as Pub/Sub sends one.
 * No `index.ts` imports it.
 */

export interface OidcSigner {
  kid: string
  /** The body of `/oauth2/v3/certs`. */
  jwks(): Promise<{ keys: JsonWebKey[] }>
  /** A signed token; `header` overrides (`kid`, `alg`) for the negative tests. */
  sign(
    claims: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<string>
}

const b64url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(
    /=+$/,
    '',
  )
}
const b64urlJson = (value: unknown) =>
  b64url(new TextEncoder().encode(JSON.stringify(value)))

/** A fresh signer; `kid` names its key. */
export async function createOidcSigner(
  kid = 'fake-key-1',
): Promise<OidcSigner> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  return {
    kid,
    async jwks() {
      const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
      return {
        keys: [{
          kty: 'RSA',
          n: jwk.n,
          e: jwk.e,
          alg: 'RS256',
          use: 'sig',
          kid,
        } as JsonWebKey],
      }
    },
    async sign(claims, header = {}) {
      const head = b64urlJson({ alg: 'RS256', typ: 'JWT', kid, ...header })
      const body = b64urlJson(claims)
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          pair.privateKey,
          new TextEncoder().encode(`${head}.${body}`),
        ),
      )
      return `${head}.${body}.${b64url(signature)}`
    },
  }
}

/** The claims Pub/Sub's push token carries, for `audience` and `email`, valid an hour from `nowS`. */
export function pushClaims(
  audience: string,
  email: string,
  nowS: number,
): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: audience,
    azp: '100000000000000000000',
    sub: '100000000000000000000',
    email,
    email_verified: true,
    iat: nowS,
    exp: nowS + 3_600,
  }
}
