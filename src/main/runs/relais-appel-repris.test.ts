import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ligneDEtape } from '../../shared/etapes-du-tour'
import {
  DejaAuFil,
  LignesDuFluxClaude,
  lignesDejaAuFil,
  relayerAppelRepris,
  type LigneDAction
} from './relais-appel-repris'

/**
 * conv-1535 (tour 7fa28264, 2026-11-04) : l'app redémarre 12 s après la 2e action ; le CLI continue
 * seul 20 min et le fil ne reçoit plus aucune ligne d'action ni d'étape. Ces flux reprennent la
 * forme mesurée dans `run-stdout/addf0f1f-….stdout.jsonl` (CLI Claude, `stream-json`).
 */
const init = { type: 'system', subtype: 'init', session_id: 'sess-1535' }
const bruit = {
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'je' } }
}
const appel = (id: string, name: string, input: Record<string, unknown>): object => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] }
})
const retour = (id: string, texte: string, extra: object = {}, enErreur = false): object => ({
  type: 'user',
  message: {
    content: [{ type: 'tool_result', tool_use_id: id, content: texte, is_error: enErreur }]
  },
  ...extra
})
const L = (o: object): string => JSON.stringify(o)

describe('LignesDuFluxClaude — mêmes lignes que le chemin direct', () => {
  it('actions, étapes et tâche de fond ; rien pour le bruit ni pour un outil direct de l’app', () => {
    let horloge = 1_000
    const lecteur = new LignesDuFluxClaude(
      () => [],
      () => horloge
    )
    const lire = (o: object, enDirect = true): string[] =>
      lecteur.recevoir(L(o), enDirect).map((ligne) => ligne.text)

    expect(lire(init)).toEqual([])
    expect(lire(bruit)).toEqual([])
    expect(lire(appel('t1', 'Bash', { command: 'cat src/x.tsx' }))).toEqual([
      'Bash · cat src/x.tsx'
    ])
    horloge += 2_000
    expect(lire(retour('t1', 'contenu'))).toEqual(['Bash terminé - 2 s'])

    expect(
      lire(appel('t2', 'TaskCreate', { subject: 'Taper la phrase lettre par lettre' }))
    ).toEqual([])
    expect(
      lire(retour('t2', 'Task #6 created successfully', { tool_use_result: { task: { id: '6' } } }))
    ).toEqual([ligneDEtape('6', 'pending', 'Taper la phrase lettre par lettre')])
    expect(lire(appel('t3', 'TaskUpdate', { taskId: '6', status: 'in_progress' }))).toEqual([])
    expect(lire(retour('t3', 'Updated task #6 status'))).toEqual([
      ligneDEtape('6', 'in_progress', 'Taper la phrase lettre par lettre')
    ])

    expect(
      lire({
        type: 'system',
        subtype: 'task_started',
        task_id: 'b7o',
        tool_use_id: 't4',
        description: 'Capture des vues'
      })
    ).toEqual(['tache de fond en cours - Capture des vues'])

    expect(lire(appel('t5', 'mcp__autowin__remember', { title: 'x' }))).toEqual([])
    expect(lire(retour('t5', 'ok'))).toEqual([])
  })

  it('rattrapage : ni durée ni battement, l’heure de lecture n’est pas celle de l’action', () => {
    const lecteur = new LignesDuFluxClaude(() => [])
    const lignes = [
      appel('t1', 'Read', { file_path: 'D:/a.ts' }),
      { type: 'tool_progress', tool_name: 'Read', tool_use_id: 't1', elapsed_time_seconds: 40 },
      retour('t1', 'x', {}, true)
    ].flatMap((o) => lecteur.recevoir(L(o), false).map((ligne) => ligne.text))
    expect(lignes.slice(0, 2)).toEqual(['Read · D:/a.ts', 'Read échoué'])
  })

  it('une cible longue est rognée à 120 caractères et voyage entière à côté', () => {
    const commande = `npx vitest run ${'src/tres/long/chemin/'.repeat(10)}`
    const [ligne] = new LignesDuFluxClaude(() => []).recevoir(
      L(appel('t1', 'Bash', { command: commande })),
      true
    )
    expect(ligne.text).toBe(`Bash · ${commande.slice(0, 120)}`)
    expect(ligne.target).toBe(commande)
  })
})

describe('DejaAuFil — ce que l’écran avait reçu avant le redémarrage', () => {
  it('saute le préfixe déjà affiché, battements compris, puis tout est nouveau', () => {
    const deja = new DejaAuFil([
      'Bash · ls',
      'Bash terminé - 1 s',
      'Bash · cat x',
      'Bash en cours - 1 min - cat x',
      'Bash terminé - 0 s'
    ])
    expect(
      [
        'Bash · ls',
        'Bash terminé',
        'Bash · cat x',
        'Bash terminé',
        'Bash · grep y',
        'Bash terminé'
      ].map((ligne) => deja.contient(ligne))
    ).toEqual([true, true, true, true, false, false])
  })

  it('lit les lignes du DERNIER appel dans le journal du tour', () => {
    const lignes = lignesDejaAuFil(
      [
        { kind: 'provider-journal', token: 'ancien' },
        { kind: 'provider-status', text: 'Read · vieux' },
        { kind: 'provider-journal', token: 'tok' },
        { kind: 'delta', text: 'bonjour' },
        { kind: 'provider-status', text: 'Bash · ls', data: { target: 'ls -la' } }
      ],
      'tok'
    )
    expect(lignes).toEqual([{ text: 'Bash · ls', target: 'ls -la' }])
  })
})

describe('relayerAppelRepris — le fil voit le CLI repris', () => {
  let dossier: string | undefined
  afterEach(() => {
    if (dossier) rmSync(dossier, { recursive: true, force: true })
    dossier = undefined
  })

  it('rattrape ce que l’écran a manqué, suit le direct, enregistre AVANT d’envoyer', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relais-repris-'))
    const chemin = join(dossier, 'cli.stdout.jsonl')
    // Écrit AVANT le redémarrage : 2 actions déjà au fil, 1 manquée pendant l'absence de l'app.
    writeFileSync(
      chemin,
      [
        init,
        bruit,
        appel('t1', 'Bash', { command: 'ls' }),
        retour('t1', 'a'),
        appel('t2', 'Bash', { command: 'cat x' }),
        retour('t2', 'b'),
        appel('t3', 'Bash', { command: 'grep y' }),
        retour('t3', 'c')
      ]
        .map(L)
        .join('\n') + '\n'
    )
    const ordre: string[] = []
    const envoyees: LigneDAction[] = []
    let enregistrees: string[] = []
    const relais = relayerAppelRepris({
      provider: 'claude',
      journalPath: chemin,
      dejaAuFil: [
        { text: 'Bash · ls' },
        { text: 'Bash terminé - 1 s' },
        { text: 'Bash · cat x' },
        { text: 'Bash terminé - 0 s' }
      ],
      lireEtapes: () => [],
      enregistrer: (lignes) => {
        ordre.push('enregistrer')
        enregistrees = lignes
      },
      envoyer: (lignes) => {
        ordre.push('envoyer')
        envoyees.push(...lignes)
      },
      pasDEnvoiMs: 30,
      pollMs: 20
    })
    await new Promise((r) => setTimeout(r, 120))
    // Le CLI continue après la reprise : cette action-là est vue EN DIRECT.
    appendFileSync(
      chemin,
      [appel('t4', 'TaskCreate', { subject: 'Vérifier' }), retour('t4', 'Task #1 created')]
        .map(L)
        .join('\n') + '\n'
    )
    await new Promise((r) => setTimeout(r, 120))
    await relais.arreter()

    expect(envoyees.map((ligne) => [ligne.text, ligne.rejouee === true])).toEqual([
      ['Bash · ls', true],
      ['Bash terminé - 1 s', true],
      ['Bash · cat x', true],
      ['Bash terminé - 0 s', true],
      ['Bash · grep y', false],
      ['Bash terminé', false],
      [ligneDEtape('1', 'pending', 'Vérifier'), false]
    ])
    expect(enregistrees).toEqual(envoyees.map((ligne) => ligne.text))
    expect(ordre[0]).toBe('enregistrer')
    expect(
      ordre.filter((geste, rang) => geste === 'envoyer' && ordre[rang - 1] !== 'enregistrer')
    ).toEqual([])
  })

  it('second redémarrage : les lignes déjà enregistrées ne repartent pas', async () => {
    dossier = mkdtempSync(join(tmpdir(), 'relais-repris-'))
    const chemin = join(dossier, 'cli.stdout.jsonl')
    writeFileSync(chemin, [init, appel('t1', 'Bash', { command: 'ls' })].map(L).join('\n') + '\n')
    const envoyees: string[] = []
    const relais = relayerAppelRepris({
      provider: 'claude',
      journalPath: chemin,
      dejaAuFil: [{ text: 'Bash · ls' }],
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

  it('un autre fournisseur garde l’attente seule', async () => {
    const envoyees: string[] = []
    const relais = relayerAppelRepris({
      provider: 'codex',
      journalPath: 'introuvable.jsonl',
      dejaAuFil: [{ text: 'Bash · ls' }],
      lireEtapes: () => [],
      enregistrer: () => undefined,
      envoyer: (lignes) => envoyees.push(...lignes.map((ligne) => ligne.text))
    })
    await relais.arreter()
    expect(envoyees).toEqual([])
  })
})
