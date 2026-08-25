import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { observerLeMoteur } from './observer-les-sources'

/**
 * L'OBSERVATION RÉELLE, et le CÂBLAGE — la décision pure est testée à part
 * (`src/shared/moteur-perime.test.ts`).
 *
 * Une fonction que personne n'appelle ne garde rien : ce dépôt a déjà payé ce défaut (six sites de
 * gate dont deux branchés). Les tests de source ci-dessous vérifient donc que le moteur RÉPOND et
 * que l'interface DEMANDE.
 */

const ancien = 1_700_000_000
const recent = 1_700_100_000

function bac(): string {
  const racine = mkdtempSync(join(tmpdir(), 'moteur-'))
  mkdirSync(join(racine, 'src', 'main'), { recursive: true })
  mkdirSync(join(racine, 'src', 'renderer', 'src'), { recursive: true })
  return racine
}

function ecrire(racine: string, relatif: string, secondes: number): void {
  const chemin = join(racine, relatif)
  writeFileSync(chemin, '// contenu', 'utf8')
  utimesSync(chemin, secondes, secondes)
}

describe('l’observation des sources du moteur', () => {
  it('signale une source du moteur écrite après le démarrage', () => {
    const racine = bac()
    ecrire(racine, join('src', 'main', 'index.ts'), recent)

    const etat = observerLeMoteur(racine, ancien * 1000, false)

    expect(etat.perime).toBe(true)
    expect(etat.fichier).toBe('src/main/index.ts')
  })

  it('IGNORE le renderer — lui est rechargé à chaud, le signaler serait FAUX', () => {
    // Le bord qui décide de la crédibilité de l'avertissement : si toucher un composant d'interface
    // criait « moteur périmé », l'avertissement se déclencherait en permanence et cesserait d'être lu.
    const racine = bac()
    ecrire(racine, join('src', 'renderer', 'src', 'App.tsx'), recent)

    expect(observerLeMoteur(racine, ancien * 1000, false).perime).toBe(false)
  })

  it('IGNORE les tests — écrire un test ne périme aucun moteur', () => {
    const racine = bac()
    ecrire(racine, join('src', 'main', 'quelque-chose.test.ts'), recent)

    expect(observerLeMoteur(racine, ancien * 1000, false).perime).toBe(false)
  })

  it('en PACKAGÉ, ne signale jamais rien — il n’y a pas de sources à comparer', () => {
    const racine = bac()
    ecrire(racine, join('src', 'main', 'index.ts'), recent)

    expect(observerLeMoteur(racine, ancien * 1000, true).perime).toBe(false)
  })

  it('un dossier absent ne devient pas un avertissement', () => {
    // S'abstenir plutôt qu'affirmer : l'absence de sources n'est pas une preuve de péremption.
    expect(observerLeMoteur(join(tmpdir(), 'nexiste-pas-du-tout'), ancien * 1000, false).perime).toBe(
      false
    )
  })
})

describe('le câblage jusqu’au pied de page', () => {
  const lire = (relatif: string): string => readFileSync(join(__dirname, '..', relatif), 'utf8')

  it('le moteur expose son état', () => {
    const main = lire(join('main', 'index.ts'))
    expect(main).toContain("ipcMain.handle('os:moteur:etat'")
    expect(main).toMatch(/observerLeMoteur\(app\.getAppPath\(\),\s*demarrageDuMoteurMs/)
  })

  it('l’instant de démarrage est figé UNE FOIS, au chargement — pas relu à chaque appel', () => {
    // `Date.now()` évalué DANS le handler comparerait les sources à l'instant présent : tout
    // paraîtrait à jour, et le garde ne pourrait jamais rien signaler.
    expect(lire(join('main', 'index.ts'))).toContain('const demarrageDuMoteurMs = Date.now()')
  })

  it('le pont l’expose au renderer', () => {
    expect(lire(join('preload', 'index.ts'))).toContain("ipcRenderer.invoke('os:moteur:etat')")
    expect(lire(join('preload', 'index.d.ts'))).toContain('etatDuMoteur')
  })

  it('l’interface le DEMANDE et l’affiche', () => {
    const app = lire(join('renderer', 'src', 'App.tsx'))
    expect(app).toContain('window.api\n      .etatDuMoteur?.()')
    expect(app).toContain('rail-foot--perime')
  })

  it('rien n’est rendu quand l’état est sain', () => {
    // Un pied de page qui afficherait un bloc vide serait du bruit permanent.
    expect(lire(join('renderer', 'src', 'App.tsx'))).toContain('{moteurPerime && (')
  })
})
