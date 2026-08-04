import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Contrat de SOURCE sur la borne du probe provider (`src/main/index.ts`).
 *
 * Pourquoi un test sur le texte source plutot que sur le comportement : ce message n'est emis
 * qu'apres 20 s d'attente reelle d'un appel provider. Le simuler demanderait d'injecter l'horloge et
 * le registre dans `probeProviderConnection`, une restructuration hors de proportion avec l'enjeu.
 * Ce qui est verifiable a cout nul, en revanche, c'est l'invariant qui compte.
 *
 * L'invariant piegeur : le `catch` en aval classe le resultat en lisant le MESSAGE d'erreur, et
 * cherche `authenticate|oauth|expired|not logged|login`. Si une reecriture future glissait l'un de ces
 * mots dans le message de timeout (« session expired ? », « login timeout »…), un provider qui ne
 * REPOND PAS serait silencieusement classe « session expiree » — donc l'UI proposerait de se
 * reconnecter alors que le service est juste muet. Ce test ferme cette porte.
 */
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

/** Les mots sur lesquels le `catch` de `probeProviderConnection` bascule vers « expire ». */
const MOTS_QUI_RECLASSENT = ['authenticate', 'oauth', 'expired', 'not logged', 'login']

function messageDuTimeout(): string {
  const found = source.match(/reject\(new Error\(`([^`]*apres[^`]*)`\)\)/)
  return found?.[1] ?? ''
}

describe('borne du probe provider — le message doit rester diagnostique', () => {
  it('ne dépense aucun tour modèle automatiquement au démarrage', () => {
    expect(source).not.toContain('startupProviderChecks = runStartupProviderProbes(')
  })

  it('le test explicite du provider passe par ExecutionSupervisor', () => {
    const probe = source.match(/async function probeProviderConnection[\s\S]*?\n}/)?.[0] ?? ''
    expect(probe).toContain('executionSupervisor.run(')
    expect(probe).toContain('maxProviderCalls: 1')
  })

  it('la constante est NOMMEE, plus un nombre nu dans l’appel', () => {
    expect(source).toContain('const PROVIDER_PROBE_TIMEOUT_MS = 20_000')
    // La constante doit etre CONSOMMEE, pas seulement declaree : declaration + message + delai = 3.
    // (Compter plutot que matcher une fenetre autour de `setTimeout` : un commentaire insere entre les
    // deux ferait tomber un tel motif sans qu'aucun invariant reel ne soit casse.)
    expect(source.split('PROVIDER_PROBE_TIMEOUT_MS').length - 1).toBeGreaterThanOrEqual(3)
    // Et la valeur nue ne doit pas revenir en dur dans un setTimeout.
    expect(source).not.toMatch(/setTimeout\([^)]*,\s*20000\s*\)/)
  })

  it('le message NOMME le provider et le delai', () => {
    const message = messageDuTimeout()
    expect(message).not.toBe('')
    expect(message).toContain('${id}')
    expect(message).toContain('${PROVIDER_PROBE_TIMEOUT_MS}')
  })

  it('le message ne contient AUCUN mot qui le ferait passer pour une session expiree', () => {
    const message = messageDuTimeout().toLowerCase()
    expect(message).not.toBe('')
    for (const mot of MOTS_QUI_RECLASSENT) {
      expect(message).not.toContain(mot)
    }
  })

  it('le `catch` classe bien sur ces mots — sinon ce test garderait une porte qui n’existe plus', () => {
    // Si cette regex disparait du source, l'invariant ci-dessus perd son objet : il faut le savoir.
    expect(source).toContain('/authenticate|oauth|expired|not logged|login/.test(message)')
  })
})
