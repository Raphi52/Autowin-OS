import { describe, expect, it } from 'vitest'
import {
  MAX_FICHIERS_CITES,
  avertissementCollisionProbable
} from './avertissement-collision-probable'

/**
 * L'avertissement doit informer sans crier, et se taire quand il n'y a rien a dire.
 *
 * Le cas vecu (conv-1450) : la collision apprise APRES le travail, avec la facture. Ce que ces tests
 * verrouillent, c'est autant ce que le message DIT que ce qu'il ne dit PAS — il ne promet pas un
 * blocage (l'intersection est incalculable au lancement) et il ne parle pas sur un arbre propre.
 */
describe('avertissementCollisionProbable', () => {
  it('se TAIT quand il n y a rien a signaler', () => {
    expect(avertissementCollisionProbable(undefined)).toBe('')
    expect(avertissementCollisionProbable([])).toBe('')
    // Des entrees vides ne sont pas des fichiers : un bandeau vide serait du decor.
    expect(avertissementCollisionProbable(['', '   '])).toBe('')
  })

  it('nomme les fichiers et dit « SI », jamais « ca va bloquer »', () => {
    const texte = avertissementCollisionProbable(['src/main/agent-pilot.ts', 'notes.md'])

    expect(texte).toContain('src/main/agent-pilot.ts')
    expect(texte).toContain('notes.md')
    expect(texte).toContain('2 changements non committés')
    // La nuance qui fait tout : conditionnel, parce que les fichiers du run sont inconnus a ce stade.
    expect(texte).toContain('SI')
    expect(texte).not.toMatch(/va bloquer|sera bloqu|echec|échec/i)
    // Et il dit ce qui part quand meme : ce n'est pas un refus.
    expect(texte).toContain('part quand même')
    // Plus le geste qui l'evite, sinon l'avertissement laisse l'utilisateur sans prise.
    expect(texte).toMatch(/committer|ranger/)
  })

  it('resume au-dela de quelques noms plutot que de dresser un mur', () => {
    const beaucoup = Array.from({ length: 12 }, (_, i) => `fichier-${i}.ts`)

    const texte = avertissementCollisionProbable(beaucoup)

    expect(texte).toContain('fichier-0.ts')
    expect(texte).toContain(`et ${12 - MAX_FICHIERS_CITES} autre(s)`)
    // Le dernier n'est pas cite : c'est le principe du resume.
    expect(texte).not.toContain('fichier-11.ts')
    // Le TOTAL reste exact, meme quand la liste est ecourtee — sinon on sous-declare le risque.
    expect(texte).toContain('12 changements')
  })

  it('un total fourni PRIME sur la longueur de la liste (liste deja tronquee en amont)', () => {
    // `excludedDirtyFiles` arrive parfois deja tronque, avec son compte reel a part. Compter les
    // elements recus sous-declarerait alors le nombre de changements en cause.
    const texte = avertissementCollisionProbable(['a.ts', 'b.ts'], { total: 40, tronquee: true })

    expect(texte).toContain('40 changements')
    expect(texte).toContain('et 38 autre(s)')
  })

  it('un seul fichier reste au SINGULIER', () => {
    const texte = avertissementCollisionProbable(['seul.ts'])
    expect(texte).toContain('1 changement non committé :')
    expect(texte).not.toContain('changements')
  })
})
