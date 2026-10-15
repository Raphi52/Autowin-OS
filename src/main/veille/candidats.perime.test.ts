import { describe, expect, it } from 'vitest'
import { classerPerimes, type CandidatVeille, type LireSource } from './candidats'

/**
 * Un candidat de CORRECTION ancré dans le code ne se sert plus quand sa ligne citée a disparu.
 *
 * Cas réel (conv-947, 2026-10-14) : « La mise à jour propose d'abord rebaser » citait
 * `return diverged ? ['rebase', 'merge'] : ['fast-forward']` dans src/shared/update-contract.ts. Le
 * défaut a été corrigé trois heures après sa détection (191ab51d, 2026-09-22), mais le ticket est
 * resté dans le stock avec sa citation figée et a été servi trois semaines plus tard comme défaut à
 * corriger. Les deux extraits ci-dessous sont recopiés de ce fichier avant/après le correctif.
 */

const AVANT_CORRECTIF = `export function strategiesFor(branch: string | undefined, diverged = false): UpdateStrategy[] {
  if (branch !== 'main') return ['merge', 'rebase', 'switch-main']
  return diverged ? ['rebase', 'merge'] : ['fast-forward']
}`

const APRES_CORRECTIF = `export function strategiesFor(
  branch: string | undefined,
  diverged = false,
  arbreSale = false
): UpdateStrategy[] {
  const choix: UpdateStrategy[] =
    branch !== 'main'
      ? ['merge', 'rebase', 'switch-main']
      : diverged
        ? ['rebase', 'merge']
        : ['fast-forward']
  return arbreSale ? choix.filter((s) => s !== 'rebase') : choix
}`

const correction = (partiel: Partial<CandidatVeille> = {}): CandidatVeille => ({
  id: 'autowin os|src/shared/update-contract.ts|la mise à jour propose dabord rebaser',
  concurrent: 'Autowin OS',
  titre: "La mise à jour propose d'abord « rebaser »",
  url: 'src/shared/update-contract.ts:52',
  dateSource: '2026-09-16',
  citation: "return diverged ? ['rebase', 'merge'] : ['fast-forward']",
  type: 'correction',
  prompt: 'Corrige ce defaut',
  vuLe: '2026-09-22T11:40:03.153Z',
  statut: 'nouveau',
  ...partiel
})

const depot =
  (fichiers: Record<string, string>): LireSource =>
  (chemin) =>
    fichiers[chemin]

describe('classerPerimes — la ligne citée est-elle encore dans le fichier ?', () => {
  it('ligne DISPARUE (défaut corrigé depuis) → périmé', () => {
    const [c] = classerPerimes(
      [correction()],
      depot({ 'src/shared/update-contract.ts': APRES_CORRECTIF })
    )
    expect(c.statut).toBe('perime')
  })

  it('ligne TOUJOURS là → le candidat est servi tel quel', () => {
    const [c] = classerPerimes(
      [correction()],
      depot({ 'src/shared/update-contract.ts': AVANT_CORRECTIF })
    )
    expect(c.statut).toBe('nouveau')
  })

  it('une ré-indentation ou des fins de ligne Windows ne rendent pas périmé', () => {
    const reformate = AVANT_CORRECTIF.replace(/\n/g, '\r\n').replace(
      'return diverged ?',
      'return  diverged\t?'
    )
    const [c] = classerPerimes(
      [correction()],
      depot({ 'src/shared/update-contract.ts': reformate })
    )
    expect(c.statut).toBe('nouveau')
  })

  it('fichier SUPPRIMÉ → périmé : la ligne n’est plus dans le fichier', () => {
    const [c] = classerPerimes([correction()], depot({}))
    expect(c.statut).toBe('perime')
  })

  it('fichier ILLISIBLE → état inconnu : on ne déclasse PAS', () => {
    const lire: LireSource = () => {
      throw new Error('EACCES')
    }
    const [c] = classerPerimes([correction({ statut: 'ecarte' })], lire)
    expect(c.statut).toBe('ecarte')
  })

  it('le statut humain est remplacé quel qu’il soit : un écarté périmé se lit « périmé »', () => {
    const [c] = classerPerimes(
      [correction({ statut: 'ecarte' })],
      depot({ 'src/shared/update-contract.ts': APRES_CORRECTIF })
    )
    expect(c.statut).toBe('perime')
  })

  it('un AJOUT ancré dans le code n’est pas touché (seules les corrections sont visées)', () => {
    const [c] = classerPerimes([correction({ type: 'ajout' })], depot({}))
    expect(c.statut).toBe('nouveau')
  })

  it('un candidat WEB n’est pas touché : sa source n’est pas un fichier du dépôt', () => {
    const lus: string[] = []
    const [c] = classerPerimes(
      [correction({ url: 'https://github.com/x/y/releases', concurrent: 'Codex' })],
      (chemin) => {
        lus.push(chemin)
        return undefined
      }
    )
    expect(c.statut).toBe('nouveau')
    expect(lus).toEqual([])
  })

  it('la citation rendue lisible « <octet de contrôle> » se retrouve dans le fichier qui porte l’octet', () => {
    const octet = String.fromCharCode(27)
    const fichier = `    expect(sortie).not.toMatch(/${octet}\\[31m/)\n`
    const [c] = classerPerimes(
      [
        correction({
          url: 'src/main/x.test.ts:1',
          citation: 'expect(sortie).not.toMatch(/<octet de contrôle>\\[31m/)'
        })
      ],
      depot({ 'src/main/x.test.ts': fichier })
    )
    expect(c.statut).toBe('nouveau')
  })

  it('ne relit chaque fichier qu’UNE fois, même pour plusieurs candidats', () => {
    let lectures = 0
    classerPerimes(
      [correction(), correction({ id: 'b', citation: 'return arbreSale ? choix' })],
      () => {
        lectures++
        return APRES_CORRECTIF
      }
    )
    expect(lectures).toBe(1)
  })

  it('n’altère pas le tableau reçu', () => {
    const entree = [correction()]
    classerPerimes(entree, depot({}))
    expect(entree[0].statut).toBe('nouveau')
  })
})
