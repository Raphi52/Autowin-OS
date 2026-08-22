import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { porteeDuVert } from './verify-command'

/**
 * UN VERT D'ARBRE SALE N'ATTESTE PAS L'ETAT COMMITE.
 *
 * Defaut mesure le 2026-08-22 (conv-1371). Un agent a lance la suite via `verify`, obtenu
 * « exit 0, 713 fichiers / 7754 tests », et conclu « Base unitaire prouvee verte, PRETE POUR LA
 * FUSION » — puis recommande la fusion. Or la suite avait tourne dans l'arbre de travail PARTAGE,
 * qui portait alors 14 fichiers non commites d'autres sessions. Mesure independante le meme jour :
 * `origin/main` avait 3 tests ROUGES pendant que le meme arbre rendait vert, dont un rendu vert par
 * une SUPPRESSION non commitee — un test supprime ne passe pas, il se tait.
 *
 * `verify` ne peut pas empecher l'agent de conclure ; il peut refuser de lui laisser croire que sa
 * portee est plus large qu'elle ne l'est. Meme regle que `edit_file`, qui NOMME deja sa portee
 * (« un vert dont on ignore l'etendue se lit plus large qu'il n'est ») — on la reprend, on n'en
 * invente pas une deuxieme.
 */
describe('verify — le vert nomme sa portée', () => {
  it('arbre propre : rien à dire, le vert porte sur l’état commité', () => {
    expect(porteeDuVert([])).toBeUndefined()
  })

  it('arbre sale : dit que le vert n’atteste PAS l’état commité', () => {
    const note = porteeDuVert(['src/a.ts', 'src/b.ts'])
    expect(note).toBeDefined()
    expect(note).toMatch(/n['’]atteste pas/i)
    expect(note).toMatch(/commit/i)
  })

  it('NOMME les fichiers au lieu de les compter', () => {
    // Même règle que le gate : « 2 fichiers » n'est pas actionnable, il faut savoir lesquels.
    const note = porteeDuVert(['src/a.ts', 'src/b.ts']) ?? ''
    expect(note).toContain('src/a.ts')
    expect(note).toContain('src/b.ts')
  })

  it('au-delà de cinq fichiers, nomme les cinq premiers et compte le reste', () => {
    // Ne pas inonder le contexte du tour : la note doit rester lisible.
    const note = porteeDuVert(['a', 'b', 'c', 'd', 'e', 'f', 'g']) ?? ''
    expect(note).toContain('a')
    expect(note).toContain('e')
    expect(note).not.toContain('"f"')
    expect(note).toMatch(/2 autre/)
  })

  it('avertit qu’une SUPPRESSION non commitée fait taire un test', () => {
    // C'est le piege exact qui a masque un rouge : sans cette phrase, la note serait incomplete.
    expect(porteeDuVert(['src/x.test.ts'])).toMatch(/supprim/i)
  })
})

/**
 * GARDE ANTI-POTEMKINE — une fonction exportée que personne n'appelle est du théâtre.
 *
 * Ce dépôt a déjà vécu le défaut « exposé mais jamais alimenté » : atteignable en IPC, jamais
 * appelé. Test de SOURCE, pis-aller assumé (instancier le bus demanderait tout l'OS) : il vérifie
 * le CÂBLAGE, pas l'effet. La mesure sur l'app reste l'autorité.
 */
describe('la note de portée est réellement branchée sur `verify`', () => {
  const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')

  it('`runVerifyAt` appelle porteeDuVert', () => {
    const bloc = source.slice(source.indexOf('private async runVerifyAt'))
    expect(bloc.slice(0, 1600)).toContain('porteeDuVert(')
  })

  it('la liste des fichiers vient du lecteur git EXISTANT, pas d’un doublon', () => {
    expect(source).toContain("import { readGitState } from './git-read-main'")
  })
})
