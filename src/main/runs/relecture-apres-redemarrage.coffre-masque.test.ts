import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Après un redémarrage, deux chemins relisent sur le disque ce qu'un agent a écrit pendant
 * l'absence de l'app, sans passer par la pompe du routeur qui masque tout le reste :
 * - le relais d'un appel de chat repris (`relais-appel-repris.ts`) relit `run-stdout/` et en tire
 *   les lignes du bloc Actions ;
 * - le rattachement d'un run (`index.ts`) relit le journal de l'agent et en fait le message
 *   « Reprise du fil » (`journal-replay.ts`).
 * Une commande `curl -H "Authorization: Bearer <clé>"` y arrivait en clair, au fil comme au journal.
 */
const { VALEUR } = vi.hoisted(() => ({ VALEUR: 'sk-coffre-0123456789abcdef' }))
vi.mock('../app/coffre-cles', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../app/coffre-cles')>()
  const { mkdtempSync: dossierTemporaire } = await import('node:fs')
  const { tmpdir: temporaire } = await import('node:os')
  const { join: joindre } = await import('node:path')
  const dossier = dossierTemporaire(joindre(temporaire(), 'coffre-relecture-'))
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
  return { ...vrai, masquerValeurs: (texte: string) => coffre.masquerValeurs(texte) }
})

import { relayerAppelRepris, type LigneDAction } from './relais-appel-repris'
import { fusionnerRepriseDuFil, recapMessage, summarizeJournal } from './journal-replay'

const MASQUE = '[secret:MISTRAL_API_KEY]'
const COMMANDE = `curl -s https://api.mistral.ai/v1/models -H "Authorization: Bearer ${VALEUR}"`
// Une commande longue : sa cible entière part aussi dans `target`, au-delà des 120 caractères du libellé.
const LONGUE = `${COMMANDE} ${'-H "Accept: application/json" '.repeat(4)}`

const L = (o: object): string => JSON.stringify(o)
const appel = (id: string, command: string): string =>
  L({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] }
  })
const echec = (id: string, texte: string): string =>
  L({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: texte, is_error: true }] }
  })

let dossier: string | undefined
afterEach(() => {
  if (dossier) rmSync(dossier, { recursive: true, force: true })
  dossier = undefined
})

describe('relais d’un appel de chat repris — les valeurs du coffre sortent masquées', () => {
  it('lignes relues, cible entière, erreur et lignes d’avant le redémarrage', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relais-coffre-'))
    const chemin = join(dossier, 'appel.stdout.jsonl')
    writeFileSync(
      chemin,
      [
        L({ type: 'system', subtype: 'init', session_id: 'sess-coffre' }),
        appel('t1', LONGUE),
        echec('t1', `401 Unauthorized: clé ${VALEUR} refusée`),
        ''
      ].join('\n')
    )
    let enregistrees: string[] = []
    const envoyees: LigneDAction[] = []
    const relais = relayerAppelRepris({
      provider: 'claude',
      journalPath: chemin,
      // Écrite avant le redémarrage par un relais qui ne masquait pas encore.
      dejaAuFil: [{ text: `Bash · echo ${VALEUR}` }, { text: 'Bash terminé' }],
      lireEtapes: () => [],
      enregistrer: (lignes) => (enregistrees = lignes),
      envoyer: (lignes) => envoyees.push(...lignes),
      pasDEnvoiMs: 10,
      pollMs: 10
    })
    await new Promise((r) => setTimeout(r, 80))
    await relais.arreter()

    const vu = JSON.stringify({ enregistrees, envoyees })
    expect(envoyees.length).toBeGreaterThan(2)
    expect(vu).not.toContain(VALEUR)
    expect(vu).toContain(MASQUE)
    expect(envoyees.some((ligne) => ligne.target?.includes(MASQUE))).toBe(true)
  })

  it('une ligne déjà au fil, masquée par le chemin direct, ne repart pas une seconde fois en clair', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relais-coffre-'))
    const chemin = join(dossier, 'appel.stdout.jsonl')
    writeFileSync(chemin, [appel('t1', COMMANDE), ''].join('\n'))
    const envoyees: string[] = []
    const relais = relayerAppelRepris({
      provider: 'claude',
      journalPath: chemin,
      dejaAuFil: [{ text: `Bash · ${COMMANDE.replace(VALEUR, MASQUE)}` }],
      dejaEnregistrees: 1,
      lireEtapes: () => [],
      enregistrer: () => undefined,
      envoyer: (lignes) => envoyees.push(...lignes.map((ligne) => ligne.text)),
      pasDEnvoiMs: 10,
      pollMs: 10
    })
    await new Promise((r) => setTimeout(r, 60))
    await relais.arreter()
    expect(envoyees).toEqual([])
  })

  it('une valeur coupée par le libellé rogné à 120 caractères ne laisse pas son début en clair', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relais-coffre-'))
    const chemin = join(dossier, 'appel.stdout.jsonl')
    // La valeur commence au 102e caractère de la commande : le libellé la couperait en deux.
    writeFileSync(chemin, [appel('t1', `${'x'.repeat(100)} ${VALEUR}`), ''].join('\n'))
    const envoyees: LigneDAction[] = []
    const relais = relayerAppelRepris({
      provider: 'claude',
      journalPath: chemin,
      dejaAuFil: [],
      lireEtapes: () => [],
      enregistrer: () => undefined,
      envoyer: (lignes) => envoyees.push(...lignes),
      pasDEnvoiMs: 10,
      pollMs: 10
    })
    await new Promise((r) => setTimeout(r, 60))
    await relais.arreter()
    expect(envoyees).toHaveLength(1)
    expect(JSON.stringify(envoyees)).not.toContain(VALEUR.slice(0, 12))
  })
})

describe('message « Reprise du fil » d’un run rattaché — les valeurs du coffre sortent masquées', () => {
  const journal = [
    L({
      type: 'assistant',
      message: { content: [{ type: 'text', text: `La clé ${VALEUR} répond bien.` }] }
    }),
    appel('t1', COMMANDE)
  ]

  it('premier redémarrage : texte et actions relus', () => {
    const message = recapMessage(summarizeJournal(journal), false)
    expect(message).toBeDefined()
    const fil = fusionnerRepriseDuFil(undefined, message!, '10:00')
    expect(fil).not.toContain(VALEUR)
    expect(fil).toContain(MASQUE)
  })

  it('redémarrage suivant : le message déjà au fil est masqué lui aussi', () => {
    const precedent = recapMessage(summarizeJournal(journal), true)!
    const nouveau = recapMessage(summarizeJournal([appel('t2', `echo ${VALEUR}`)]), false)!
    const fil = fusionnerRepriseDuFil(precedent, nouveau, '10:05')
    expect(fil).not.toContain(VALEUR)
    expect(fil.split(MASQUE).length - 1).toBe(3)
  })
})
