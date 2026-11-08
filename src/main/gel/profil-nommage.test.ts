import { describe, expect, it } from 'vitest'
import { CODE_DU_NOMMAGE, REGLAGES_PAR_DEFAUT } from './profil-pendant-gel'

/*
 * La règle de nommage vit en JavaScript pur (elle tourne dans le worker, sans module de
 * l'application) : on la charge telle quelle, comme le fait le worker.
 */
type Nommage = {
  reinitialiser(): void
  ajouter(frames: string[]): void
  nom(): string | undefined
}
const creerNommageDuGel = new Function(`${CODE_DU_NOMMAGE}\nreturn creerNommageDuGel`)() as (
  motif: string
) => Nommage

const MOTIF = REGLAGES_PAR_DEFAUT.motifNotreCode
// Un relevé = les frames de la pile, la plus HAUTE d'abord, au format « fonction chemin:ligne:col ».
const NODE = 'normalizeString node:path:10:2'
const CLE = 'cle$1 D:\\AutoWinOS\\app\\out\\main\\index.js:900:12'
const DU_CHEMIN = 'duChemin D:\\AutoWinOS\\app\\out\\main\\index.js:400:3'

describe('nommage du gel — même règle que le classement, écrite pour le worker', () => {
  it('nomme la fonction la plus profonde présente dans la majorité des relevés', () => {
    const nommage = creerNommageDuGel(MOTIF)
    for (let i = 0; i < 3; i++) nommage.ajouter([NODE, CLE, DU_CHEMIN])
    expect(nommage.nom()).toBe('cle$1')
  })

  it('une fonction ANONYME garde sa position dans le bundle — « (anonyme) » seul ne désigne rien', () => {
    const nommage = creerNommageDuGel(MOTIF)
    const anonyme = '(anonyme) D:\\AutoWinOS\\app\\out\\main\\index.js:900:12'
    for (let i = 0; i < 3; i++) nommage.ajouter([NODE, anonyme, DU_CHEMIN])
    expect(nommage.nom()).toBe('(anonyme) main/index.js:900:12')
  })

  it('ignore les frames de Node : un relevé sans code à nous ne nomme rien', () => {
    const nommage = creerNommageDuGel(MOTIF)
    nommage.ajouter([NODE, 'readFileSync node:fs:1:1'])
    expect(nommage.nom()).toBeUndefined()
  })

  it('ne nomme rien sans aucun relevé, et repart de zéro après reinitialiser()', () => {
    const nommage = creerNommageDuGel(MOTIF)
    expect(nommage.nom()).toBeUndefined()
    nommage.ajouter([CLE])
    expect(nommage.nom()).toBe('cle$1')
    nommage.reinitialiser()
    expect(nommage.nom()).toBeUndefined()
  })
})
