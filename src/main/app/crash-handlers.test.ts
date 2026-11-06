import { describe, it, expect, vi } from 'vitest'
import { formatCrashLine, makeCrashHandlers, redactSecrets } from './crash-handlers'

// Un vrai coffre (chiffrement factice, fichier temporaire) tient la clé : c'est son masquage réel
// (`[secret:NOM]`) que crash.log et la lecture du terminal doivent appliquer.
const { VALEUR_DU_COFFRE } = vi.hoisted(() => ({ VALEUR_DU_COFFRE: 'sk-coffre-0123456789abcdef' }))
vi.mock('./coffre-cles', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('./coffre-cles')>()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dossier = mkdtempSync(join(tmpdir(), 'coffre-crash-'))
  const coffre = vrai.creerCoffre({
    chemin: () => join(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(t, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_DU_COFFRE)
  return { ...vrai, masquerValeurs: (texte: string) => coffre.masquerValeurs(texte) }
})

const NOW = () => '2026-07-22T00:00:00.000Z'

describe('formatCrashLine', () => {
  it('inclut horodatage, kind, message et stack pour une Error', () => {
    const line = formatCrashLine('uncaughtException', new Error('boom'), NOW)
    expect(line).toContain('[2026-07-22T00:00:00.000Z]')
    expect(line).toContain('uncaughtException: boom')
    expect(line).toMatch(/Error: boom/) // stack
  })
  it('sérialise une valeur rejetée non-Error', () => {
    expect(formatCrashLine('unhandledRejection', { code: 42 }, NOW)).toContain('{"code":42}')
    expect(formatCrashLine('unhandledRejection', 'str', NOW)).toContain('unhandledRejection: str')
  })
})

describe('makeCrashHandlers (le process SURVIT)', () => {
  it('loggue au lieu de relancer : le handler ne throw JAMAIS', () => {
    const logged: string[] = []
    const h = makeCrashHandlers({ logDir: 'C:\\nope', sink: (l) => logged.push(l), now: NOW })
    // Simule une exception non-catchée + une rejection non gérée.
    expect(() => h.onUncaughtException(new Error('crash1'))).not.toThrow()
    expect(() => h.onUnhandledRejection('rejet2')).not.toThrow()
    expect(logged).toHaveLength(2)
    expect(logged[0]).toContain('uncaughtException: crash1')
    expect(logged[1]).toContain('unhandledRejection: rejet2')
  })

  it('invoque onFatal après le log (récupération best-effort) sans propager si elle jette', () => {
    let called = 0
    const h = makeCrashHandlers({
      logDir: 'C:\\nope',
      sink: () => {},
      now: NOW,
      onFatal: () => {
        called++
        throw new Error('onFatal cassé')
      }
    })
    expect(() => h.onUncaughtException(new Error('x'))).not.toThrow()
    expect(called).toBe(1)
  })

  it('inviolable sur une valeur CIRCULAIRE (JSON.stringify throw) — le handler ne propage pas', () => {
    // Régression Corrector #1 : formatCrashLine était hors du try → une rejection circulaire crashait.
    const logged: string[] = []
    const h = makeCrashHandlers({ logDir: 'C:\\nope', sink: (l) => logged.push(l), now: NOW })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => h.onUnhandledRejection(circular)).not.toThrow()
    expect(logged[0]).toContain('[Circular]')
  })

  it('redacte les secrets courants avant écriture (crash.log)', () => {
    expect(redactSecrets('Authorization: Bearer sk-abc123XYZ')).not.toContain('sk-abc123XYZ')
    expect(redactSecrets('token=supersecret')).not.toContain('supersecret')
    expect(redactSecrets('https://user:p@ss@host')).toContain('***')
    const line = formatCrashLine('uncaughtException', new Error('leak Bearer sk-zzz'), NOW)
    expect(line).not.toContain('sk-zzz')
  })

  it('masque aussi les valeurs du coffre, même sans motif reconnaissable (crash.log, terminal)', () => {
    const texte = `erreur 401 avec la clé ${VALEUR_DU_COFFRE} sur api.mistral.ai`
    expect(redactSecrets(texte)).toBe(
      'erreur 401 avec la clé [secret:MISTRAL_API_KEY] sur api.mistral.ai'
    )
    const line = formatCrashLine('unhandledRejection', new Error(`refus ${VALEUR_DU_COFFRE}`), NOW)
    expect(line).not.toContain(VALEUR_DU_COFFRE)
    expect(line).toContain('[secret:MISTRAL_API_KEY]')
    // Jumeau : un texte sans valeur du coffre ressort tel quel.
    expect(redactSecrets('sk-coffre-autre-chose sur api.mistral.ai')).toBe(
      'sk-coffre-autre-chose sur api.mistral.ai'
    )
  })

  it('inviolable : même un sink qui throw ne fait PAS propager (le process survit)', () => {
    const h = makeCrashHandlers({
      logDir: 'C:\\nope',
      sink: () => {
        throw new Error('sink cassé')
      },
      now: NOW
    })
    // Contrat dur : le handler global ne doit JAMAIS relancer, sinon il tuerait le process protégé.
    expect(() => h.onUncaughtException(new Error('x'))).not.toThrow()
    expect(() => h.onUnhandledRejection('y')).not.toThrow()
  })
})
