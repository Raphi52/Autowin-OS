import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createConvRun,
  reuseOrCreateConvRun,
  closeConvRun,
  ligneJournalDErreur,
  deleteConvRun,
  listConvRuns,
  saveConvRunTrace,
  loadConvRunTrace
} from './conv-runs'
import type { OrchestrationStep } from '../orchestrator'

const root = mkdtempSync(join(tmpdir(), 'aos-convruns-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('conv-runs — RUN.md par conversation (format autowin)', () => {
  it('createConvRun écrit un RUN open parseable, rattaché à la conversation', async () => {
    const p = createConvRun('conv-9', 'Vérifier les écarts de facturation', root, () => 1000)
    const md = readFileSync(p, 'utf8')
    expect(md).toMatch(/^status: open/m)
    expect(md).toMatch(/^session: conv-9/m)
    expect(md).toContain('Vérifier les écarts de facturation')
    const runs = await listConvRuns('conv-9', [], root)
    expect(runs).toHaveLength(1)
    expect(runs[0].summary.status).toBe('open')
    // Plus de case-VERDICT fantôme (« le juge valide … ») ; les cases présentes sont DÉRIVÉES des
    // obligations falsifiables du prompt (root-execution-contract) : ici mutation + tests.
    expect(runs[0].summary.dodTotal).toBe(2)
    expect(md).toContain('- [ ] Mutation demandee produite avec une preuve executable')
    // L'interdit lui-même, énoncé de façon falsifiable : aucune case ne doit REPORTER LE VERDICT.
    // Compter les cases ne l'attrape pas — la pseudo-DoD retirée en faisait exactement une.
    expect(md).not.toMatch(/- \[[ x]\].*(?:juge valide|gate autorise)/i)
    // Une demande de lecture seule, elle, garde une DoD vide.
    const lecture = createConvRun('conv-9-ro', 'Explique les écarts de facturation', root, () => 1100)
    expect(readFileSync(lecture, 'utf8')).not.toContain('- [ ]')
  })

  it('closeConvRun preserve les quatre statuts, sans plus cocher de pseudo-DoD', async () => {
    const g = createConvRun('conv-9', 'tâche verte', root, () => 2000)
    closeConvRun(g, 'green', 'Juge: validé.')
    const green = (await listConvRuns('conv-9', [], root)).find((r) => r.path === g)!
    expect(green.summary.status).toBe('green')
    // Le cochage n'est jamais un pseudo-critère de verdict : une case dérivée ne se coche qu'avec
    // une PREUVE d'exécution transmise à la clôture — ici aucune, donc rien n'est coché. C'est
    // l'assertion discriminante : ce cochage-là est exactement ce que l'ancien code faisait sur un vert.
    expect(green.summary.dodTotal).toBe(1)
    expect(green.summary.dodChecked).toBe(0)

    const r = createConvRun('conv-9', 'tâche rouge', root, () => 3000)
    closeConvRun(r, 'red', 'Gate BLOQUÉ: défaut.')
    const red = (await listConvRuns('conv-9', [], root)).find((x) => x.path === r)!
    expect(red.summary.status).toBe('red')
    expect(readFileSync(r, 'utf8')).toContain('Gate BLOQUÉ')

    const d = createConvRun('conv-9', 'tâche dégradée', root, () => 3500)
    closeConvRun(d, 'degraded-closed', 'Clôture dégradée assumée.')
    const degraded = (await listConvRuns('conv-9', [], root)).find((x) => x.path === d)!
    expect(degraded.summary.status).toBe('degraded-closed')
    expect(degraded.summary.dodChecked).toBe(0)

    const o = createConvRun('conv-9', 'tâche encore ouverte', root, () => 3750)
    closeConvRun(o, 'open', 'Ne doit pas clore le RUN.')
    const open = (await listConvRuns('conv-9', [], root)).find((x) => x.path === o)!
    expect(open.summary.status).toBe('open')
    expect(open.summary.dodChecked).toBe(0)
  })

  it('pas de collision quand la même tâche est relancée (suffixe horodaté)', () => {
    const a = createConvRun('conv-9', 'même tâche', root, () => 4000)
    const b = createConvRun('conv-9', 'même tâche', root, () => 5000)
    expect(a).not.toBe(b)
  })

  it('réutilise un RUN ouvert identique au lieu de créer un doublon', async () => {
    const first = createConvRun('conv-reuse', 'continuer le même workflow', root, () => 8000)
    const reused = await reuseOrCreateConvRun(
      'conv-reuse',
      'continuer le même workflow',
      root,
      () => 9000
    )
    expect(reused).toEqual({ path: first, reused: true })
  })

  it('réutilise un RUN ouvert quand la redemande ne diffère que par la forme', async () => {
    const first = createConvRun('conv-reask', 'Continuer le même workflow', root, () => 8100)
    const reused = await reuseOrCreateConvRun(
      'conv-reask',
      '  continuer le meme workflow !  ',
      root,
      () => 9100
    )
    expect(reused).toEqual({ path: first, reused: true })
  })

  it('saveConvRunTrace/loadConvRunTrace : le fil des sous-agents est persisté et relu', () => {
    const p = createConvRun('conv-T', 'tâche avec trace', root, () => 7000)
    const steps: OrchestrationStep[] = [
      { step: 'exec', provider: 'claude', role: 'subagent', text: 'sortie du sous-agent' },
      { step: 'judge', provider: 'codex', role: 'judge', text: 'VALIDE', detail: 'validé' },
      { step: 'gate', detail: 'clôture autorisée' }
    ]
    saveConvRunTrace(p, steps)
    const back = loadConvRunTrace(p)
    expect(back).not.toBeNull()
    expect(back!).toHaveLength(3)
    expect(back![0]).toMatchObject({ step: 'exec', text: 'sortie du sous-agent' })
    expect(back![1].detail).toBe('validé')
    // run sans trace → null
    const noTrace = createConvRun('conv-T', 'sans trace', root, () => 7500)
    expect(loadConvRunTrace(noTrace)).toBeNull()
  })

  it('scope strict par conversation + fusion des runs attachés', async () => {
    createConvRun('conv-A', 'tâche de A', root, () => 6000)
    // un RUN.md « Claude Code » externe attaché à B
    const extDir = join(root, '..', 'ext-session', 'sujet-externe-workspace')
    mkdirSync(extDir, { recursive: true })
    const ext = join(extDir, 'RUN.md')
    writeFileSync(ext, 'status: green\n\n## Besoin\nexterne\n', 'utf8')

    const a = await listConvRuns('conv-A', [], root)
    expect(a.every((r) => r.session === 'conv-A')).toBe(true)
    const b = await listConvRuns('conv-B', [ext], root)
    expect(b).toHaveLength(1)
    expect(b[0].session).toBe('attaché')
    expect(b[0].summary.status).toBe('green')
    // chemin attaché disparu → ignoré sans crash
    expect(await listConvRuns('conv-B', [join(root, 'nexiste', 'RUN.md')], root)).toHaveLength(0)
  })

  it('supprime uniquement le workspace natif visé, trace comprise', async () => {
    const target = createConvRun('conv-delete', 'à supprimer', root, () => 10_000)
    const sibling = createConvRun('conv-delete', 'à garder', root, () => 11_000)
    saveConvRunTrace(target, [{ step: 'exec', text: 'trace à retirer' }])

    await expect(deleteConvRun('conv-delete', target, [], root)).resolves.toEqual({
      kind: 'deleted'
    })

    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(dirname(target), 'trace.json'))).toBe(false)
    expect(existsSync(sibling)).toBe(true)
  })

  it('refuse un chemin arbitraire ou le run natif d’une autre conversation', async () => {
    const other = createConvRun('conv-other', 'run étranger', root, () => 12_000)
    const arbitrary = join(root, '..', 'ne-pas-effacer.txt')
    writeFileSync(arbitrary, 'important', 'utf8')

    await expect(deleteConvRun('conv-delete', other, [], root)).rejects.toThrow(/autorisé/i)
    await expect(deleteConvRun('conv-delete', arbitrary, [], root)).rejects.toThrow(/autorisé/i)
    expect(existsSync(other)).toBe(true)
    expect(readFileSync(arbitrary, 'utf8')).toBe('important')
  })

  it('détache un RUN externe sans supprimer son fichier', async () => {
    const externalDir = join(root, '..', 'external-delete-workspace')
    mkdirSync(externalDir, { recursive: true })
    const external = join(externalDir, 'RUN.md')
    writeFileSync(external, 'status: green\n\n## Besoin\nexterne\n', 'utf8')

    await expect(deleteConvRun('conv-delete', external, [external], root)).resolves.toEqual({
      kind: 'detached',
      attachedPath: external
    })
    expect(existsSync(external)).toBe(true)
  })

  it('un RUN natif explicitement attaché est détaché sans supprimer son workspace', async () => {
    const nativeAttached = createConvRun('conv-delete', 'natif attaché', root, () => 13_000)
    saveConvRunTrace(nativeAttached, [{ step: 'exec', text: 'trace à conserver' }])

    await expect(
      deleteConvRun('conv-delete', nativeAttached, [nativeAttached], root)
    ).resolves.toEqual({
      kind: 'detached',
      attachedPath: nativeAttached
    })
    expect(existsSync(nativeAttached)).toBe(true)
    expect(existsSync(join(dirname(nativeAttached), 'trace.json'))).toBe(true)
  })

  it('retourne le chemin attaché canonique quand la requête change seulement de casse', async () => {
    const externalDir = join(root, '..', 'external-case-workspace')
    mkdirSync(externalDir, { recursive: true })
    const external = join(externalDir, 'RUN.md')
    writeFileSync(external, 'status: green\n\n## Besoin\nexterne\n', 'utf8')

    await expect(
      deleteConvRun('conv-delete', external.toLocaleUpperCase('en-US'), [external], root)
    ).resolves.toEqual({
      kind: 'detached',
      attachedPath: external
    })
  })
})

/**
 * LA TRACE DURABLE NE DOIT PAS DETRUIRE LA RAISON DE L'ECHEC.
 *
 * Mesure du 2026-08-31, run conv-9 : le message reel porte la raison sur sa DEUXIEME ligne, et
 * `String(e).slice(0, 120)` coupait a « claude CLI interromp » — avant la raison, avant
 * `last-event=`, avant l'indice de reparation. La diffusion LIVE, deux lignes plus bas dans le meme
 * code, envoyait le message ENTIER : seule la trace relue apres coup etait aveugle. C'est ce qui a
 * force une seconde enquete pour expliquer un simple clic sur Stop. Recidive d'un incident deja
 * nomme dans le code (conv-1369).
 */
describe('ligneJournalDErreur — la raison survit, le format tient', () => {
  const erreurReelle = new Error(
    [
      "Fan-out scout (rôle subagent) : aucun modèle n'a produit de sortie",
      "• claude (opus) : [abort] claude CLI interrompu : arret demande par l'utilisateur (Stop de l'orchestration)",
      'last-event=none',
      'stderr=none',
      "→ Rien à réparer côté provider : l'appel a été coupé."
    ].join('\n')
  )

  it('conserve la RAISON, qui vit apres le premier retour a la ligne', () => {
    expect(ligneJournalDErreur(erreurReelle)).toContain("arret demande par l'utilisateur")
  })

  it('rend UNE seule ligne — le Journal est un format une-entree-par-ligne', () => {
    expect(ligneJournalDErreur(erreurReelle)).not.toContain('\n')
  })

  it('reste borne : un message geant ne noie pas le Journal', () => {
    expect(ligneJournalDErreur(new Error('x'.repeat(5000))).length).toBeLessThanOrEqual(600)
  })
})
