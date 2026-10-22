import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../fs-supprimer'
import { lireResultatsReelsParWorkflow } from './resultats-reels-workflows'

/**
 * LES RÉSULTATS RÉELS DE CHAQUE WORKFLOW, LUS DANS `causal-trace/` (piste 1, conv-1070).
 *
 * La vue Workflows n'affichait que les bancs d'essai (`arena-duels.jsonl`). Or chaque run écrit
 * déjà sa `quote` (le workflow qui le pilote) et sa clôture (statut, durée, coût) dans la trace.
 *
 * L'entrée qui ferait échouer ce test si le lecteur était faux : un run `red` arrêté par la limite
 * de session (ou par Stop) — il doit tomber en « interrompues », jamais en « échecs », sinon les
 * coupures d'abonnement font passer un bon workflow pour un mauvais.
 */
const racine = mkdtempSync(join(tmpdir(), 'aos-resultats-reels-'))
afterAll(() => supprimerArbre(racine))

function quote(runId: string, workflow?: string, ts = '2026-10-20T10:00:00.000Z'): string {
  return JSON.stringify({
    schema: 'autowin.trace/v1',
    timestamp: ts,
    run: {
      stage: 'quote',
      runId,
      quote: {
        quoteId: `q-${runId}`,
        ...(workflow ? { workflow: { name: workflow, source: 'manuel' } } : {})
      }
    }
  })
}

function cloture(
  runId: string,
  status: string,
  extra: Record<string, unknown> = {},
  ts = '2026-10-20T10:05:00.000Z'
): string {
  return JSON.stringify({
    schema: 'autowin.trace/v1',
    timestamp: ts,
    run: {
      stage: 'closure',
      runId,
      closure: { status, totalDurationMs: 60_000, totalCostUsd: 1, ...extra }
    }
  })
}

describe('lireResultatsReelsParWorkflow', () => {
  it('compte abouties, échecs, interrompues et non closes par workflow', async () => {
    const dossier = join(racine, 'cas-1')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dossier)
    writeFileSync(
      join(dossier, 'conv-1.jsonl'),
      [
        // clôture d'OUVERTURE puis devis puis clôture terminale : seule la terminale compte
        cloture('run-a', 'open', { totalDurationMs: 0, totalCostUsd: 0 }),
        quote('run-a', 'Correctif'),
        cloture('run-a', 'green', { totalDurationMs: 120_000, totalCostUsd: 2 }),
        quote('run-b', 'Correctif'),
        cloture('run-b', 'red', { totalDurationMs: 240_000, totalCostUsd: 4 }),
        // NOUVEAU CHAMP : la clôture nomme l'interruption
        quote('run-c', 'Correctif'),
        cloture('run-c', 'red', {
          interruption: 'quota',
          totalDurationMs: 9_000_000,
          totalCostUsd: 50
        }),
        // TRACE ANCIENNE, sans le champ : la raison dit la limite de session
        quote('run-d', 'Correctif'),
        cloture('run-d', 'red', {
          gateReasons: [
            "Claude a interrompu l'appel : You've hit your session limit · resets 1pm (Europe/Paris)"
          ]
        }),
        // TRACE ANCIENNE coupée par le bouton Stop
        quote('run-e', 'Correctif'),
        cloture('run-e', 'red', {
          gateReasons: [
            "Error: verdict — appel du rôle judge INTERROMPU avant sa fin : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop du chat)"
          ]
        }),
        // un run démarré, jamais clos
        quote('run-f', 'Correctif'),
        'ligne illisible {',
        ''
      ].join('\n')
    )
    writeFileSync(
      join(dossier, 'conv-2.jsonl'),
      [
        quote('run-g', 'Feature'),
        cloture('run-g', 'degraded-closed'),
        // un run SANS workflow : regroupé à part, jamais attribué à un workflow
        quote('run-h'),
        cloture('run-h', 'green')
      ].join('\n')
    )

    const r = await lireResultatsReelsParWorkflow(dossier)
    expect(r.Correctif).toMatchObject({
      runs: 6,
      abouties: 1,
      echecs: 1,
      interrompues: 3,
      nonCloses: 1,
      // médianes sur les runs ALLÉS AU BOUT seulement (abouti ou échec) : les 9 000 s du run coupé
      // par le quota n'y entrent pas
      dureeMedianeMs: 180_000,
      coutMedianUsd: 3
    })
    expect(r.Feature).toMatchObject({ runs: 1, abouties: 1, echecs: 0, interrompues: 0 })
    expect(Object.keys(r).sort()).toEqual(['Correctif', 'Feature'])
  })

  it('un refus du juge qui CITE une limite de session reste un échec', async () => {
    const dossier = join(racine, 'cas-2')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dossier)
    writeFileSync(
      join(dossier, 'conv-3.jsonl'),
      [
        quote('run-i', 'Correctif'),
        cloture('run-i', 'red', {
          gateReasons: [
            "Promis mais pas fait : « Objection du juge : le message « You've hit your session limit » n'est pas reconnu »"
          ]
        })
      ].join('\n')
    )
    const r = await lireResultatsReelsParWorkflow(dossier)
    expect(r.Correctif).toMatchObject({ echecs: 1, interrompues: 0 })
  })

  it('dossier absent : aucun résultat, aucune exception', async () => {
    await expect(lireResultatsReelsParWorkflow(join(racine, 'absent'))).resolves.toEqual({})
  })
})
