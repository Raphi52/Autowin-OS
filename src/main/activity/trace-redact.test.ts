import { describe, expect, it } from 'vitest'
import { redactTrace } from './trace-redact'

const red = (v: unknown): string => JSON.stringify(redactTrace(v))

describe('redactTrace — familles de secrets couvertes', () => {
  it('masque un Bearer en texte libre (préfixe conservé)', () => {
    expect(red('Authorization: Bearer sk-abc123DEF456ghi')).toContain('Bearer [REDACTED]')
  })
  it('masque key=value / token: value', () => {
    expect(red('api_key=SECRETVALUE123')).toContain('[REDACTED]')
    expect(red('token: abcDEF123456')).toContain('[REDACTED]')
  })
  it('masque les préfixes connus (sk-, ghp_, xox, AKIA, AIza, JWT, PEM)', () => {
    expect(red('sk-proj-ABCDEFGH12345678')).toContain('[REDACTED]')
    expect(red('ghp_ABCDEFGH12345678')).toContain('[REDACTED]')
    expect(red('AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED]')
    expect(red('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4')).toContain(
      '[REDACTED]'
    )
  })
  it('masque par CLÉ sensible (authorization, refreshToken, password, cookie…)', () => {
    const out = redactTrace({
      authorization: 'Bearer x',
      refreshToken: 'opaque-value',
      password: 'hunter2',
      nested: { apiKey: 'k' },
      list: [{ secret: 's' }]
    }) as Record<string, unknown>
    expect(out.authorization).toBe('[REDACTED]')
    expect(out.refreshToken).toBe('[REDACTED]')
    expect(out.password).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]')
    expect(red(out.list)).toContain('[REDACTED]')
  })
  it('ne touche pas au contenu non sensible', () => {
    expect(redactTrace({ title: 'ticket #1', count: 3 })).toEqual({ title: 'ticket #1', count: 3 })
  })
})

describe('redactTrace — LIMITE connue (résidu de defense-in-depth, PAS une garantie)', () => {
  it('un token OPAQUE (sans préfixe connu ni clé/format key=value) en TEXTE LIBRE N’EST PAS masqué', () => {
    // Documenté : la rédaction couvre les clés sensibles + motifs connus, pas un jeton arbitraire
    // interpolé dans une phrase. Règle d'accompagnement : ne JAMAIS interpoler un secret dans un
    // message d'erreur/log (le vrai garde-fou est en amont, pas ce filtre best-effort).
    const opaque = 'z9Q2mVt7Lp0Rx4Nk'
    expect(red(`échec auth, jeton brut ${opaque} rejeté`)).toContain(opaque)
  })
})
