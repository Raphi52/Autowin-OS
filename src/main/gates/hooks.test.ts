import { describe, expect, it } from 'vitest'
import {
  detectRawSleep,
  detectBlindFixLoop,
  requireProofBeforeGreen,
  requireMotionProofForAnimationDiff,
  requireVisualProofForFrontDiff,
  runHooks
} from './hooks'

// Fixtures construites par concaténation : ce sont des DONNÉES de test du détecteur,
// pas de vrais sleeps — la concat évite que le hook anti-flaky statique se déclenche ici.
const SLEEP = 'Start-' + 'Sleep'
const DELAY = 'Task.' + 'Delay'

describe('hooks déterministes in-app (repro kit)', () => {
  it('anti-flaky : flag un sleep brut ajouté, ignore l’escape sleep-ok', () => {
    const diff = [
      '+++ b/x.ps1',
      `+${SLEEP} -Seconds 5`,
      `+${SLEEP} -Milliseconds 2000`,
      `+await ${DELAY}(3000)`,
      `+${SLEEP} -Milliseconds 200`, // < 1000 -> OK
      `+${SLEEP} -Seconds 30 # sleep-ok: attente reseau bornee`, // escape
      `-${SLEEP} -Seconds 9` // ligne SUPPRIMEE -> pas flaggee
    ].join('\n')
    const v = detectRawSleep(diff)
    expect(v).toHaveLength(3)
    expect(v.every((x) => x.hook === 'anti-flaky')).toBe(true)
  })

  it('fix-gate : block sur édits répétés sans cause, laisse passer avec cause', () => {
    const v = detectBlindFixLoop({ 'a.ts': 3, 'b.ts': 5, 'c.ts': 2 }, { 'b.ts': true })
    expect(v.map((x) => x.detail).join(' ')).toContain('a.ts')
    expect(v.some((x) => x.detail.includes('b.ts'))).toBe(false) // cause présente
    expect(v.some((x) => x.detail.includes('c.ts'))).toBe(false) // sous le seuil
  })

  it('done-without-proof : refuse le green sans preuve, passe avec ≥1 preuve', () => {
    expect(requireProofBeforeGreen(0)).toHaveLength(1)
    expect(requireProofBeforeGreen(2)).toHaveLength(0)
  })

  it('runHooks : agrège et reste vide quand tout est propre', () => {
    expect(runHooks({ producedDiff: '+const x = 1', editsByFile: { 'a.ts': 1 } })).toEqual([])
    expect(runHooks({ requireProof: true, evidenceOkCount: 0 })).toHaveLength(1)
  })
})

/**
 * REGRESSION trouvee par un SCOUT de l'agent Autowin (2026-07-28), verifiee avant correction.
 *
 * `detectRawSleep` filtrait d'abord les lignes ajoutees, PUIS numerotait avec l'index du tableau
 * FILTRE. Des qu'un diff contient du contexte, des suppressions ou un en-tete — c'est-a-dire tout
 * diff unifie reel — le numero rapporte ne designe AUCUNE ligne du diff. Le pointeur de violation
 * envoie donc l'utilisateur au mauvais endroit, ce qui est pire qu'une absence de numero.
 */
describe('detectRawSleep — le numero de ligne doit designer le VRAI diff', () => {
  it('compte les lignes de contexte qui precedent', () => {
    const diff = ['--- a/x.ps1', '+++ b/x.ps1', ' inchangee', '+Start-Sleep 5'].join('\n')
    const [violation] = detectRawSleep(diff)
    expect(violation).toBeDefined()
    // La ligne fautive est la 4e du diff, pas la 1re des lignes ajoutees.
    expect(violation.line).toBe(4)
  })

  it('compte aussi les SUPPRESSIONS', () => {
    const diff = [' contexte', '-ancienne', '+Thread.Sleep(5000)'].join('\n')
    expect(detectRawSleep(diff)[0].line).toBe(3)
  })

  it('reste juste avec plusieurs violations dispersees', () => {
    const diff = [' a', '+Start-Sleep 3', ' b', ' c', '+Task.Delay(9999)'].join('\n')
    expect(detectRawSleep(diff).map((v) => v.line)).toEqual([2, 5])
  })
})

/**
 * KAIZEN (2026-08-21, conv-1360). Defaut de PROCESS observe : le run `accueil-widgets` (remake du
 * fond d'ecran de l'Accueil) est passe le gate `done-without-proof` avec un simple exit-code de
 * test unitaire, puis s'est ferme `degraded` — l'utilisateur a du signaler lui-meme que le rendu
 * n'allait pas. La lecon retenue dans la conversation ("une modif front ne se valide que par une
 * capture reellement lue") n'etait PAS opposable, faute d'exister en CODE deterministe.
 *
 * Ce test est ecrit ROUGE avant la correction.
 */
describe('visual-proof : un diff de RENDU exige une preuve visuelle, pas un exit-code', () => {
  const frontDiff = [
    '--- a/x',
    '+++ b/src/renderer/src/components/home-decor-scene.ts',
    '+const bg = 1'
  ].join('\n')

  it('block quand le diff touche le rendu et qu aucune preuve visuelle n est observee', () => {
    const v = requireVisualProofForFrontDiff(frontDiff, 0)
    expect(v).toHaveLength(1)
    expect(v[0].hook).toBe('visual-proof-missing')
    expect(v[0].detail).toContain('home-decor-scene.ts')
  })

  it('laisse passer des qu une preuve visuelle est observee', () => {
    expect(requireVisualProofForFrontDiff(frontDiff, 1)).toEqual([])
  })

  // ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE (detection trop large) :
  // un diff de test seul, un diff main/, un diff sans fichier front.
  it('n exige rien sur un diff qui ne touche AUCUN fichier de rendu', () => {
    const testOnly = [
      '+++ b/src/renderer/src/components/home-decor-scene.test.ts',
      '+expect(1).toBe(1)'
    ].join('\n')
    const mainOnly = ['+++ b/src/main/gates/hooks.ts', '+const x = 1'].join('\n')
    expect(requireVisualProofForFrontDiff(testOnly, 0)).toEqual([])
    expect(requireVisualProofForFrontDiff(mainOnly, 0)).toEqual([])
  })

  it('runHooks : le hook visuel reste INACTIF par defaut (zero regression sur les runs existants)', () => {
    expect(runHooks({ producedDiff: frontDiff })).toEqual([])
    expect(
      runHooks({ producedDiff: frontDiff, requireVisualProof: true, visualProofOkCount: 0 })
    ).toHaveLength(1)
    expect(
      runHooks({ producedDiff: frontDiff, requireVisualProof: true, visualProofOkCount: 1 })
    ).toEqual([])
  })
})

/**
 * KAIZEN (2026-08-28, conv-1507 + conv-1498). Defaut de PROCESS mesure : le chantier « spinner » a
 * livre une animation declaree correcte sur la foi d'un `tsc` vert et d'une capture PNG FIXE. Une
 * image immobile ne peut pas dire si ce qu'elle montre tourne — c'est l'utilisateur qui a du
 * signaler « c'est cense bouger, la il est static », puis refuter d'un « nn » l'hypothese de cause
 * qui a suivi. Le fil s'est arrete sans verdict.
 *
 * `visual-proof` ne suffisait pas : une capture fixe SATISFAIT ce gate tout en etant aveugle a la
 * chose meme qui etait demandee. Un diff qui touche une ANIMATION exige donc une preuve d'un autre
 * genre — `ui-capture --motion`, qui mesure la fraction de pixels changeant entre frames.
 *
 * Ce test est ecrit ROUGE avant la correction.
 */
describe('motion-proof : un diff d ANIMATION exige une preuve de MOUVEMENT', () => {
  const diffAnimation = [
    '--- a/x',
    '+++ b/src/renderer/src/assets/theme.css',
    '+@keyframes aw-orbit-a { to { transform: rotate(360deg) } }'
  ].join('\n')

  it('block quand le diff introduit une animation sans preuve de mouvement', () => {
    const v = requireMotionProofForAnimationDiff(diffAnimation, 0)
    expect(v).toHaveLength(1)
    expect(v[0].hook).toBe('motion-proof-missing')
    expect(v[0].detail).toContain('theme.css')
    // Le motif doit NOMMER l'instrument : un gate qui bloque sans dire par quoi le lever renvoie
    // le producteur exactement la ou le chantier spinner s'est arrete.
    expect(v[0].detail).toContain('--motion')
  })

  it('reconnait aussi une propriete animation/transition, pas seulement @keyframes', () => {
    const parPropriete = [
      '+++ b/src/renderer/src/components/Spinner.tsx',
      '+  animation: spin 1s linear infinite'
    ].join('\n')
    expect(requireMotionProofForAnimationDiff(parPropriete, 0)).toHaveLength(1)
  })

  it('laisse passer des qu une preuve de mouvement est observee', () => {
    expect(requireMotionProofForAnimationDiff(diffAnimation, 1)).toEqual([])
  })

  // ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST SI LA DETECTION EST TROP LARGE.
  it('n exige rien d un diff de rendu SANS animation — une capture fixe y suffit', () => {
    const sansAnimation = [
      '+++ b/src/renderer/src/components/HomeView.tsx',
      '+const titre = "Accueil"'
    ].join('\n')
    expect(requireMotionProofForAnimationDiff(sansAnimation, 0)).toEqual([])
  })

  it('ignore une animation touchee dans un fichier de TEST', () => {
    const test = [
      '+++ b/src/renderer/src/components/Spinner.test.tsx',
      '+  animation: spin 1s linear infinite'
    ].join('\n')
    expect(requireMotionProofForAnimationDiff(test, 0)).toEqual([])
  })

  it('ignore une ligne SUPPRIMEE — retirer une animation ne demande pas de prouver qu elle bouge', () => {
    const suppression = [
      '+++ b/src/renderer/src/assets/theme.css',
      '-  animation: spin 1s linear infinite'
    ].join('\n')
    expect(requireMotionProofForAnimationDiff(suppression, 0)).toEqual([])
  })

  it('runHooks : le hook mouvement reste INACTIF par defaut (zero regression)', () => {
    expect(runHooks({ producedDiff: diffAnimation })).toEqual([])
    expect(
      runHooks({ producedDiff: diffAnimation, requireMotionProof: true, motionProofOkCount: 0 })
    ).toHaveLength(1)
    expect(
      runHooks({ producedDiff: diffAnimation, requireMotionProof: true, motionProofOkCount: 1 })
    ).toEqual([])
  })
})
