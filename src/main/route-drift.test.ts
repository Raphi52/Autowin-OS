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

describe('supervision mi-phase', () => {
  it("avorte l'appel dès le trip, en distinguant la dérive d'une annulation utilisateur", () => {
    const vus: string[] = []
    const sup = createMidPhaseSupervision({
      forward: (d) => vus.push(d),
      options: { seuilErreur: 2 }
    })
    sup.onDelta('Error: x\n')
    expect(sup.signal.aborted).toBe(false)
    sup.onDelta('Error: x\n')
    expect(sup.signal.aborted).toBe(true)
    expect(sup.avortePourDerive()).toBe(true)
    expect(sup.trip()?.signal).toBe('erreur-repetee')
    // Le relais a bien tout vu, y compris le chunk qui a trippé.
    expect(vus).toEqual(['Error: x\n', 'Error: x\n'])
  })

  it('garde le texte déjà produit — avorter ne jette pas le travail', () => {
    const sup = createMidPhaseSupervision({ options: { seuilErreur: 2 } })
    sup.onDelta('wrote src/a.ts\n')
    sup.onDelta('Error: x\n')
    sup.onDelta('Error: x\n')
    expect(sup.texte()).toContain('wrote src/a.ts')
  })

  it("une annulation UTILISATEUR avorte aussi, mais n'est pas une dérive", () => {
    const user = new AbortController()
    const sup = createMidPhaseSupervision({ signal: user.signal })
    user.abort()
    expect(sup.signal.aborted).toBe(true)
    expect(sup.avortePourDerive()).toBe(false)
  })

  it('un signal DÉJÀ avorté est honoré immédiatement', () => {
    const user = new AbortController()
    user.abort()
    const sup = createMidPhaseSupervision({ signal: user.signal })
    expect(sup.signal.aborted).toBe(true)
    expect(sup.avortePourDerive()).toBe(false)
  })
})
