import { describe, expect, it } from 'vitest'
import {
  createMidPhaseSupervision,
  briefArbitrage,
  createRouteDriftDetector,
  exprimeUnDoute,
  normaliserLigne,
  readRouteVerdict
} from './route-drift'

/** Le flux arrive en morceaux qui coupent au milieu des lignes : tous les tests le simulent. */
function couper(texte: string, taille: number): string[] {
  const morceaux: string[] = []
  for (let i = 0; i < texte.length; i += taille) morceaux.push(texte.slice(i, i + taille))
  return morceaux
}

function jouer(
  texte: string,
  taille = 7
): ReturnType<ReturnType<typeof createRouteDriftDetector>['tripped']> {
  const d = createRouteDriftDetector()
  for (const m of couper(texte, taille)) {
    const trip = d.beat(m)
    if (trip) return trip
  }
  return d.tripped()
}

describe('normaliserLigne', () => {
  it('efface ce qui varie pour que la même erreur se compte comme une', () => {
    const a = normaliserLigne('Error: cannot read C:\\Amitel\\Autowin OS\\src\\a.ts line 41')
    const b = normaliserLigne('Error: cannot read C:\\Amitel\\Autowin OS\\src\\a.ts line 87')
    expect(a).toBe(b)
  })

  it('ne confond pas deux erreurs de FORME différente', () => {
    expect(normaliserLigne('Error: fichier absent')).not.toBe(
      normaliserLigne('Error: permission refusée')
    )
  })
})

describe('erreur répétée', () => {
  it('trippe à la troisième occurrence de la même erreur, chemins et numéros variables', () => {
    const trip = jouer(
      [
        'Error: ECONNREFUSED sur /srv/a/1 ligne 4',
        'je réessaie',
        'Error: ECONNREFUSED sur /srv/b/2 ligne 9',
        'je réessaie encore',
        'Error: ECONNREFUSED sur /srv/c/3 ligne 12',
        ''
      ].join('\n')
    )
    expect(trip?.signal).toBe('erreur-repetee')
    expect(trip?.detail).toContain('3')
    expect(trip?.extrait).toContain('ECONNREFUSED')
  })

  it('NE trippe PAS sur deux occurrences — buter deux fois est du travail normal', () => {
    const trip = jouer(
      ['Error: ECONNREFUSED ligne 4', 'Error: ECONNREFUSED ligne 9', 'wrote src/fix.ts', ''].join(
        '\n'
      )
    )
    expect(trip).toBeUndefined()
  })

  it("NE trippe PAS sur trois erreurs DIFFÉRENTES — c'est un agent qui avance, pas qui boucle", () => {
    const trip = jouer(
      ['Error: fichier absent', 'Error: permission refusée', 'Error: port déjà utilisé', ''].join(
        '\n'
      )
    )
    expect(trip).toBeUndefined()
  })
})

describe('boucle d’outil', () => {
  it("trippe quand le même appel est relancé trois fois à l'identique", () => {
    const trip = jouer(
      [
        '● Bash(npm run build)',
        'sortie…',
        '● Bash(npm run build)',
        'sortie…',
        '● Bash(npm run build)',
        ''
      ].join('\n')
    )
    expect(trip?.signal).toBe('boucle-outil')
  })

  it('NE trippe PAS quand les appels portent des cibles différentes', () => {
    const trip = jouer(['● Read(src/a.ts)', '● Read(src/b.ts)', '● Read(src/c.ts)', ''].join('\n'))
    expect(trip).toBeUndefined()
  })
})

describe('doute déclaré', () => {
  it('trippe dès que l’agent se dit bloqué, en français comme en anglais', () => {
    expect(jouer('je tourne en rond sur ce test\n')?.signal).toBe('doute-declare')
    expect(jouer("i'm stuck on this assertion\n")?.signal).toBe('doute-declare')
  })

  it('NE trippe PAS sur une incertitude ordinaire', () => {
    expect(exprimeUnDoute('je ne suis pas sûr du nom exact de ce fichier')).toBe(false)
    expect(jouer('je ne suis pas sûr du nom exact de ce fichier\n')).toBeUndefined()
  })
})

describe('absence de progrès', () => {
  it('trippe au-delà du volume toléré sans aucun marqueur de progrès', () => {
    const d = createRouteDriftDetector({ volumeSansProgres: 200 })
    let trip = d.beat('blabla '.repeat(10))
    expect(trip).toBeUndefined()
    trip = d.beat('blabla '.repeat(40))
    expect(trip?.signal).toBe('aucun-progres')
  })

  it('un marqueur de progrès remet le compteur à zéro', () => {
    const d = createRouteDriftDetector({ volumeSansProgres: 200 })
    d.beat('blabla '.repeat(20))
    d.beat('wrote src/fix.ts\n')
    expect(d.beat('blabla '.repeat(20))).toBeUndefined()
  })
})

describe('le trip est un événement, pas un état', () => {
  it('ne se republie pas à chaque chunk suivant', () => {
    const d = createRouteDriftDetector({ seuilErreur: 2 })
    d.beat('Error: x\n')
    expect(d.beat('Error: x\n')?.signal).toBe('erreur-repetee')
    expect(d.beat('Error: x\n')).toBeUndefined()
    expect(d.tripped()?.signal).toBe('erreur-repetee')
  })
})

describe('arbitrage', () => {
  it("ne dit jamais à l'arbitre que la route est mauvaise", () => {
    const brief = briefArbitrage(
      {
        signal: 'erreur-repetee',
        detail: 'la même erreur est revenue 3 fois',
        extrait: 'Error: x'
      },
      'build',
      'faire passer la suite'
    )
    expect(brief).toContain('Constat mesuré')
    expect(brief).toContain('ne prouve PAS')
    expect(brief).toContain('ROUTE: continuer')
  })

  it('lit la décision sur une ligne à elle', () => {
    expect(readRouteVerdict('bla\nROUTE: scout')).toEqual({ kind: 'phase', phase: 'scout' })
    expect(readRouteVerdict('ROUTE: continuer')).toEqual({ kind: 'continuer' })
    expect(readRouteVerdict('ROUTE: fin')).toEqual({ kind: 'stop' })
  })

  it("une sortie illisible n'avorte JAMAIS le travail en cours", () => {
    expect(readRouteVerdict('je pense que la route est mauvaise')).toEqual({ kind: 'continuer' })
    expect(readRouteVerdict('')).toEqual({ kind: 'continuer' })
  })

  it('un récit qui mentionne la route au fil du texte ne pilote pas', () => {
    expect(
      readRouteVerdict("j'ai suivi la ROUTE: scout que le graphe prévoyait, et ça a marché")
    ).toEqual({ kind: 'continuer' })
  })
})

describe('supervision mi-phase — elle observe, elle ne coupe pas', () => {
  it('retient le trip et laisse le flux continuer, sans exposer aucun moyen de couper', () => {
    const vus: string[] = []
    const sup = createMidPhaseSupervision({
      forward: (d) => vus.push(d),
      options: { seuilErreur: 2 }
    })
    sup.onDelta('Error: x\n')
    expect(sup.trip()).toBeUndefined()
    sup.onDelta('Error: x\n')
    expect(sup.trip()?.signal).toBe('erreur-repetee')

    // LA GARDE DE LA DOCTRINE : la supervision ne porte AUCUN signal d'avortement. Si quelqu'un en
    // rajoute un, ce test rougit — « plus aucune coupe de run » ne se protège pas par un commentaire.
    expect('signal' in sup).toBe(false)
    expect('avortePourDerive' in sup).toBe(false)

    // Et le flux continue APRÈS le trip : les chunks suivants sont toujours relayés.
    sup.onDelta('encore du travail\n')
    expect(vus).toEqual(['Error: x\n', 'Error: x\n', 'encore du travail\n'])
  })

  it('voit tout le texte du tour, y compris ce qui suit le trip', () => {
    const sup = createMidPhaseSupervision({ options: { seuilErreur: 2 } })
    sup.onDelta('wrote src/a.ts\n')
    sup.onDelta('Error: x\n')
    sup.onDelta('Error: x\n')
    sup.onDelta('wrote src/b.ts\n')
    expect(sup.texte()).toContain('wrote src/a.ts')
    // La preuve que le tour n'a pas été coupé : ce qui vient APRÈS le trip est là aussi.
    expect(sup.texte()).toContain('wrote src/b.ts')
  })

  it('le trip reste lisible après coup — c’est lui qui nourrit le rapport et la décision de route', () => {
    const sup = createMidPhaseSupervision({ options: { seuilErreur: 2 } })
    sup.onDelta('Error: ECONNREFUSED\n')
    sup.onDelta('Error: ECONNREFUSED\n')
    expect(sup.trip()?.detail).toContain('2')
    expect(sup.trip()?.extrait).toContain('ECONNREFUSED')
  })
})

/**
 * DÉFAUTS DU CYCLE 1 DU JUGE — chaque test ci-dessous a été écrit ROUGE puis vert.
 *
 * Tous portent la même leçon : un détecteur qui coupe un agent doit se tromper du côté du SILENCE.
 * Un faux négatif laisse un run s'entêter, ce que l'humain voit ; un faux positif tue un agent qui
 * travaillait, ce que personne ne voit — et cela apprend à débrancher le garde.
 */
describe('D2 — des valeurs différentes ne sont pas la même erreur', () => {
  it('trois assertions de tests DISTINCTS ne trippent pas (elles ne diffèrent QUE par leurs valeurs)', () => {
    const d = createRouteDriftDetector()
    d.beat('AssertionError: expected 3 to equal 4\n')
    d.beat('AssertionError: expected 12 to equal 45\n')
    expect(d.beat('AssertionError: expected 0 to equal 1\n')).toBeUndefined()
  })

  it('mais la MÊME erreur à des LIGNES différentes trippe toujours — la position, elle, est du bruit', () => {
    const d = createRouteDriftDetector()
    d.beat('Error: cannot read config, ligne 41\n')
    d.beat('Error: cannot read config, ligne 87\n')
    expect(d.beat('Error: cannot read config, ligne 112\n')?.signal).toBe('erreur-repetee')
  })

  it('la même erreur à des CHEMINS différents trippe toujours', () => {
    const d = createRouteDriftDetector()
    d.beat('Error: ECONNREFUSED sur /srv/a/x\n')
    d.beat('Error: ECONNREFUSED sur /srv/b/y\n')
    expect(d.beat('Error: ECONNREFUSED sur /srv/c/z\n')?.signal).toBe('erreur-repetee')
  })
})

describe("D3 — du code affiché n'est pas un appel d'outil", () => {
  it('Array(3) / Array(7) / Array(9) dans du code ne trippent pas', () => {
    const d = createRouteDriftDetector()
    d.beat(' return Array(3).fill(0)\n')
    d.beat(' return Array(7).fill(0)\n')
    expect(d.beat(' return Array(9).fill(0)\n')).toBeUndefined()
  })

  it('un vrai appel d’outil, marqué comme tel par le provider, trippe toujours', () => {
    const d = createRouteDriftDetector()
    d.beat('● Bash(npm run build)\n')
    d.beat('● Bash(npm run build)\n')
    expect(d.beat('● Bash(npm run build)\n')?.signal).toBe('boucle-outil')
  })
})

describe('D4 — un progrès annoncé dans une ligne non terminée compte quand même', () => {
  it('un gros chunk sans saut de ligne portant « wrote … » ne trippe PAS aucun-progres', () => {
    const d = createRouteDriftDetector({ volumeSansProgres: 100 })
    expect(d.beat(`wrote the file successfully${' x'.repeat(120)}`)).toBeUndefined()
  })

  it('un gros chunk sans saut de ligne et SANS progrès trippe toujours', () => {
    const d = createRouteDriftDetector({ volumeSansProgres: 100 })
    expect(d.beat('blabla'.repeat(40))?.signal).toBe('aucun-progres')
  })
})
