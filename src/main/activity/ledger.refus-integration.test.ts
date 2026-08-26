import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { corpsDeBloc } from '../../shared/corps-source'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TraceLedger, REFUS_INTEGRATION, evenementRefusIntegration } from './ledger'

/**
 * COMPTER LES REFUS D'INTEGRATION — parce que RIEN ne les compte aujourd'hui.
 *
 * Cadrage du 2026-08-22 (RUN « livraison-des-agents »). Trois instruments ont ete essayes pour
 * repartir les causes de refus (`base-dirty` / `base-in-progress` / `merge-failed`), les trois
 * INVALIDES :
 *   - `runs/**‍/trace.json` ne porte aucun champ `reason` structure (0 occurrence de
 *     `"reason":"base-dirty"`), et ses occurrences du mot sont du CODE SOURCE CITE — declarations
 *     TypeScript et sorties de `grep` avec numeros de ligne, capturees parce qu'un agent avait lu
 *     ces fichiers ;
 *   - les 1995 `RUN.md` n'en gardent aucune trace ;
 *   - le journal de conversations est rotatif et melange prose et evenements.
 *
 * Consequence mesuree : un chantier anterieur (2026-08-18) s'est priorise sur « 216
 * `base-in-progress` contre 86 `base-dirty` dans runs/**‍/trace.json » — le meme artefact pollue —
 * et a verrouille une exclusion par DoD sur cette base.
 *
 * D'ou un evenement STRUCTURE, dans le ledger d'activite qui existe deja. Ce qui le protege de la
 * meme pollution : le ledger n'enregistre que des EVENEMENTS EMIS, jamais du contenu de fichier lu
 * par un agent. Un compte s'y lit par egalite sur un champ, pas par grep sur de la prose.
 */
const ledger = (): { l: TraceLedger; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-refus-'))
  return { l: new TraceLedger(dir), dir }
}
const lignes = (dir: string): Array<Record<string, unknown>> =>
  readdirSync(dir).flatMap((f) =>
    readFileSync(join(dir, f), 'utf8')
      .split(String.fromCharCode(10))
      .filter((x) => x.trim())
      .map((x) => JSON.parse(x))
  )

describe('refus d’intégration — un événement structuré, pas de la prose', () => {
  it('enregistre la CAUSE dans un champ, lisible par égalité', () => {
    const { l, dir } = ledger()
    l.append(evenementRefusIntegration({ cause: 'base-dirty', agentId: 'run-1', files: ['a.ts'] }))

    const [e] = lignes(dir)
    expect(e.name).toBe(REFUS_INTEGRATION)
    expect((e.data as Record<string, unknown>).cause).toBe('base-dirty')
  })

  it('garde les fichiers en cause : « lesquels » est la question actionnable', () => {
    const { l, dir } = ledger()
    l.append(
      evenementRefusIntegration({ cause: 'merge-failed', agentId: 'run-2', files: ['a.ts', 'b.ts'] })
    )

    expect((lignes(dir)[0].data as { files: string[] }).files).toEqual(['a.ts', 'b.ts'])
  })

  it('un refus n’est jamais un succès', () => {
    const { l, dir } = ledger()
    l.append(evenementRefusIntegration({ cause: 'base-in-progress', agentId: 'run-3', files: [] }))

    expect(lignes(dir)[0].ok).toBe(false)
  })

  it('BORNE les fichiers : une liste géante ne doit pas gonfler le ledger', () => {
    const { l, dir } = ledger()
    const beaucoup = Array.from({ length: 200 }, (_, i) => `f${i}.ts`)
    l.append(evenementRefusIntegration({ cause: 'base-dirty', agentId: 'run-4', files: beaucoup }))

    const data = lignes(dir)[0].data as { files: string[]; filesTotal: number }
    expect(data.files.length).toBeLessThanOrEqual(20)
    // Le TOTAL reste exact : borner l'affichage ne doit pas fausser la mesure.
    expect(data.filesTotal).toBe(200)
  })

  it('le comptage par cause se fait SANS grep sur de la prose', () => {
    // C'est l'invariant qui distingue cet instrument de celui qui a echoue.
    const { l, dir } = ledger()
    l.append(evenementRefusIntegration({ cause: 'base-dirty', agentId: 'a', files: [] }))
    l.append(evenementRefusIntegration({ cause: 'base-dirty', agentId: 'b', files: [] }))
    l.append(evenementRefusIntegration({ cause: 'merge-failed', agentId: 'c', files: [] }))
    // Un evenement SANS rapport, dont le detail CITE le mot : il ne doit pas etre compte.
    l.append({ source: 'bus', name: 'edit_file', detail: "reason: 'base-dirty' | 'merge-failed'" })

    const refus = lignes(dir).filter((e) => e.name === REFUS_INTEGRATION)
    const parCause = refus.reduce<Record<string, number>>((acc, e) => {
      const c = (e.data as { cause: string }).cause
      acc[c] = (acc[c] ?? 0) + 1
      return acc
    }, {})
    expect(parCause).toEqual({ 'base-dirty': 2, 'merge-failed': 1 })
  })

  it('porte le NUMERO DE TENTATIVE : sinon on reconfond occurrences et incidents', () => {
    /*
     * Le coordinateur reessaie jusqu'a 6 fois. Sans ce champ, compter les evenements donnerait la
     * CHURN des reessais et non le nombre de runs affectes — l'exacte confusion qui a invalide mes
     * trois mesures du 2026-08-22. Avec lui : incidents = agentId distincts, churn = evenements.
     */
    const { l, dir } = ledger()
    l.append(
      evenementRefusIntegration({ cause: 'base-in-progress', agentId: 'r', files: [], tentative: 3 })
    )

    expect((lignes(dir)[0].data as { tentative: number }).tentative).toBe(3)
  })

  it('sans tentative fournie, le champ vaut 1 — jamais absent', () => {
    // Un champ parfois absent oblige le consommateur a deviner ; il vaut mieux un defaut explicite.
    const { l, dir } = ledger()
    l.append(evenementRefusIntegration({ cause: 'base-dirty', agentId: 'r', files: [] }))

    expect((lignes(dir)[0].data as { tentative: number }).tentative).toBe(1)
  })
})

/**
 * GARDE ANTI-POTEMKINE — la chaîne complète, maillon par maillon.
 *
 * Un compteur exporté que personne n'appelle ne compte rien. Ce dépôt a déjà livré de
 * l'« atteignable mais jamais alimenté », et c'est précisément ce défaut qui a rendu la mesure
 * impossible ici. Test de SOURCE, pis-aller assumé : il vérifie le CÂBLAGE, pas l'effet.
 */
describe('le compteur de refus est branché de bout en bout', () => {
  const lire = (f: string): string => readFileSync(join(__dirname, '..', f), 'utf8')

  it('le coordinateur ÉMET, au point de passage unique des refus', () => {
    const src = lire('store/run-worktree-coordinator.ts')
    // La fenetre etait FIXE (900 premiers caracteres) : un commentaire ajoute plus haut a repousse
    // l'appel a 1034 et ce garde est passe au ROUGE alors que le cablage etait intact. On borne
    // desormais sur la vraie fin de methode — elargir la fenetre n'aurait fait que repousser la
    // prochaine fausse alerte.
    const bloc = corpsDeBloc(src, 'private applyFinalize')
    expect(bloc).toContain('this.onRefusIntegration?.(')
  })

  it('l’OS RELAIE vers un abonné', () => {
    expect(lire('os.ts')).toContain('onRefusIntegration: (refus) =>')
  })

  it('le point d’entrée BRANCHE l’abonné sur le ledger', () => {
    expect(lire('index.ts')).toContain('os.onRefusIntegration((refus) => ledger.append(')
  })
})
