import { describe, expect, it } from 'vitest'
import { messageTravailNonPublie } from './travail-non-publie'

/**
 * Mesuré le 2026-08-23 : trois travaux finis, testés et prouvés ont été perdus de vue le même jour —
 * un fond d'écran d'accueil, un correctif d'historique, un export Markdown. Chacun dormait sur une
 * branche que personne n'a fusionnée, PENDANT que l'utilisateur écrivait « T'as toujours pas fais le
 * fond d'ecran de l'accueuil ». Le travail existait ; rien ne le lui disait.
 *
 * Ce bandeau ne répare rien et n'accuse rien : il dit qu'il y a quelque chose à aller chercher.
 */
describe('dire qu’un travail fini n’a jamais été publié', () => {
  it('se tait quand tout est publié — un bandeau permanent cesse d’être lu', () => {
    expect(messageTravailNonPublie([])).toBeNull()
    expect(messageTravailNonPublie([{ agentId: 'a', travailNonPublie: false }])).toBeNull()
    expect(messageTravailNonPublie([{ agentId: 'a' }])).toBeNull()
  })

  it('annonce un travail non publié au singulier', () => {
    const m = messageTravailNonPublie([{ agentId: 'run-1', travailNonPublie: true }])
    expect(m).toContain('1 travail')
    expect(m).toContain('terminé')
    expect(m).not.toContain('travaux')
  })

  it('compte les travaux non publiés, et eux seuls', () => {
    const m = messageTravailNonPublie([
      { agentId: 'run-1', travailNonPublie: true },
      { agentId: 'run-2', travailNonPublie: true },
      { agentId: 'run-3' },
      { agentId: 'run-4', travailNonPublie: false }
    ])
    expect(m).toContain('2 travaux')
  })

  it('nomme où le retrouver — un avertissement sans adresse est une inquiétude, pas une information', () => {
    const m = messageTravailNonPublie([{ agentId: 'run-abc', travailNonPublie: true }])
    expect(m).toContain('autowin/recovery/run-abc')
  })

  it('ne cite que les premières branches quand il y en a beaucoup, et le dit', () => {
    const beaucoup = Array.from({ length: 14 }, (_, i) => ({
      agentId: `run-${i}`,
      travailNonPublie: true
    }))
    const m = messageTravailNonPublie(beaucoup) ?? ''
    expect(m).toContain('14 travaux')
    // Quatorze chemins dans un bandeau, personne ne les lit : on en montre trois et on annonce le reste.
    expect((m.match(/autowin\/recovery\//g) ?? []).length).toBe(3)
    expect(m).toContain('11 autres')
  })
})

describe('nommer un travail par ce qu’il touche, pas par son identifiant', () => {
  it('affiche le fichier plutôt que l’UUID — « app-shell.css » se reconnaît, pas un GUID', () => {
    const m = messageTravailNonPublie([
      {
        agentId: 'command-edit-04789dcc-e999-401d-8c6e-6e5a5dbf9cd2',
        travailNonPublie: true,
        fichiersNonPublies: ['src/renderer/src/assets/app-shell.css'],
        dateNonPublie: '2026-08-21'
      }
    ])
    expect(m).toContain('app-shell.css')
    expect(m).toContain('2026-08-21')
    expect(m).not.toContain('04789dcc')
  })

  it('dit combien d’autres fichiers accompagnent le premier', () => {
    const m = messageTravailNonPublie([
      { agentId: 'r', travailNonPublie: true, fichiersNonPublies: ['a/b.ts', 'c.ts', 'd.ts'] }
    ])
    expect(m).toContain('b.ts +2')
  })

  it('retombe sur la branche quand les fichiers sont inconnus — une adresse vaut mieux que rien', () => {
    const m = messageTravailNonPublie([{ agentId: 'run-9', travailNonPublie: true }])
    expect(m).toContain('autowin/recovery/run-9')
  })
})

describe('ne pas gâcher les trois places avec la même information', () => {
  it('dédoublonne les reprises d’un même travail, sans minorer le total', () => {
    // Vu à l'écran : trois branches pour un seul fichier, donc trois fois la même ligne.
    const m =
      messageTravailNonPublie([
        { agentId: 'a', travailNonPublie: true, fichiersNonPublies: ['x/spool.ts'] },
        { agentId: 'b', travailNonPublie: true, fichiersNonPublies: ['x/spool.ts'] },
        { agentId: 'c', travailNonPublie: true, fichiersNonPublies: ['x/spool.ts'] },
        { agentId: 'd', travailNonPublie: true, fichiersNonPublies: ['y/autre.css'] }
      ]) ?? ''
    expect((m.match(/spool\.ts/g) ?? []).length).toBe(1)
    expect(m).toContain('autre.css')
    // Le total reste celui des branches RÉELLES : c'est ce qu'il y a à aller chercher.
    expect(m).toContain('4 travaux')
  })
})
