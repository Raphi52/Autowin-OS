import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Le journal `run-stdout/<jeton>.stdout.jsonl` est écrit par le processus de l'agent lui-même : le
 * relais y redirige la sortie du CLI pour qu'elle survive à l'app. Une commande qui affichait une
 * valeur du coffre la laissait donc en clair sur le disque, alors que le fil la recevait masquée.
 * Ce test joue le vrai suivi du journal (`tailJsonLines`) avec un vrai coffre qui contient une
 * fausse clé.
 */
const { VALEUR } = vi.hoisted(() => ({ VALEUR: 'sk-coffre-disque-0123456789abcdef' }))
vi.mock('../app/coffre-cles', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../app/coffre-cles')>()
  const { mkdtempSync: dossierTemporaire } = await import('node:fs')
  const { tmpdir: temporaire } = await import('node:os')
  const { join: joindre } = await import('node:path')
  const dossier = dossierTemporaire(joindre(temporaire(), 'coffre-run-stdout-'))
  const coffre = vrai.creerCoffre({
    chemin: () => joindre(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(t, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  coffre.ajouterCle('MISTRAL_API_KEY', VALEUR)
  return {
    ...vrai,
    masquerValeurs: (texte: string) => coffre.masquerValeurs(texte),
    valeursPourAgent: (exclusions: readonly string[]) => coffre.valeursPourAgent(exclusions)
  }
})

import { tailJsonLines } from './stdout-journal'

const L = (o: object): string => JSON.stringify(o)
const sortieOutil = (texte: string): string =>
  L({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: texte }] }
  })

let dossier: string | undefined
afterEach(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true })
  dossier = undefined
})

const attendre = async (condition: () => boolean, delaiMs = 3_000): Promise<boolean> => {
  const fin = Date.now() + delaiMs
  while (Date.now() < fin) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return condition()
}

describe('run-stdout — une valeur du coffre ne reste pas en clair sur le disque', () => {
  it('le journal suivi est masqué en place : même taille, lignes JSON intactes', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'run-stdout-coffre-'))
    const chemin = join(dossier, 'jeton.stdout.jsonl')
    const lignes = [
      L({ type: 'system', subtype: 'init', session_id: 'sess-disque' }),
      sortieOutil(`Authorization: Bearer ${VALEUR}`),
      sortieOutil(`deux fois : ${VALEUR} et ${VALEUR}`),
      L({ type: 'result', subtype: 'success', result: 'fini' })
    ]
    writeFileSync(chemin, `${lignes.join('\n')}\n`)
    const tailleAvant = statSync(chemin).size

    const lues: string[] = []
    await tailJsonLines(chemin, (l) => lues.push(l), { pollMs: 20, isComplete: () => true })

    const apres = readFileSync(chemin, 'utf8')
    expect(apres).not.toContain(VALEUR)
    expect(apres).toContain('[secret:MISTRAL_API_KEY]')
    // Même taille : une reprise par position (après un redémarrage) retombe sur les mêmes lignes.
    expect(statSync(chemin).size).toBe(tailleAvant)
    const relues = apres.trim().split('\n')
    expect(relues).toHaveLength(lignes.length)
    for (const ligne of relues) expect(() => JSON.parse(ligne)).not.toThrow()
    expect(lues).toHaveLength(lignes.length)
  })

  it('pendant l’appel : la ligne ajoutée par le CLI est masquée sans attendre la fin', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'run-stdout-coffre-vif-'))
    const chemin = join(dossier, 'jeton.stdout.jsonl')
    writeFileSync(chemin, `${L({ type: 'system', subtype: 'init', session_id: 's' })}\n`)
    let fini = false
    const suivi = tailJsonLines(chemin, () => undefined, { pollMs: 20, isComplete: () => fini })

    appendFileSync(chemin, `${sortieOutil(`clé ${VALEUR} affichée`)}\n`)
    const masqueeEnCours = await attendre(() => !readFileSync(chemin, 'utf8').includes(VALEUR))
    // Le CLI continue d'écrire après le masquage : ses lignes suivantes ne sont pas abîmées.
    appendFileSync(chemin, `${L({ type: 'result', subtype: 'success', result: 'ok' })}\n`)
    fini = true
    await suivi

    expect(masqueeEnCours).toBe(true)
    const relues = readFileSync(chemin, 'utf8').trim().split('\n')
    expect(relues).toHaveLength(3)
    expect(JSON.parse(relues[2]!).result).toBe('ok')
  })

  it('la sortie d’erreur du CLI, rangée à côté du journal, est masquée à la fin de l’appel', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'run-stdout-coffre-err-'))
    const chemin = join(dossier, 'jeton.stdout.jsonl')
    writeFileSync(chemin, `${L({ type: 'result', subtype: 'success', result: 'ok' })}\n`)
    // Les deux noms du dépôt : relais Windows de Claude, et lancement survivable de Codex.
    const erreurRelais = `${chemin}.stderr.log`
    const erreurSurvivable = join(dossier, 'jeton.stderr.log')
    writeFileSync(erreurRelais, `curl: (22) 401 pour ${VALEUR}\n`)
    writeFileSync(erreurSurvivable, `echec ${VALEUR}\n`)

    await tailJsonLines(chemin, () => undefined, { pollMs: 20, isComplete: () => true })

    expect(readFileSync(erreurRelais, 'utf8')).not.toContain(VALEUR)
    expect(readFileSync(erreurSurvivable, 'utf8')).not.toContain(VALEUR)
    expect(readFileSync(erreurRelais, 'utf8')).toContain('[secret:MISTRAL_API_KEY]')
  })
})
