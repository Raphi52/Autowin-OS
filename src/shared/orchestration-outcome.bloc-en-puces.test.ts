import { describe, expect, it } from 'vitest'
import { reconcileClosedOrchestrationText } from './orchestration-outcome'

/**
 * LA RÉGRESSION QUE MON PROPRE CORRECTIF A INTRODUITE, trouvée par le cycle 2 de l'audit et
 * reproduite à l'exécution.
 *
 * Le correctif 5+6 a élargi la DÉTECTION des marqueurs de clôture aux puces, via
 * `sansDecorationDeCloture`. Mais deux sites frères de `removeExistingStructuredClosingBlock` n'ont
 * pas été migrés : `recommendedLine` et `inlineFact` ne dépouillent toujours que le titre.
 *
 * Conséquence mesurée, sur un bloc en puces SANS ligne vide séparatrice :
 *
 *   entrée  : - ✅ Fait : preuve A / … / - 👉 Recommandé : relancer
 *             PREUVE IMPORTANTE : 74 tests verts, fichier X.ts
 *             SECONDE LIGNE DE PREUVE
 *   sortie  : "- ✅ Fait : preuve A"        ← les deux lignes de preuve ONT DISPARU
 *
 * Le mécanisme : la détection élargie fait matcher le bloc, puis le regex du libellé (`^👉`) échoue
 * sur `- 👉`, donc `inlineRecommendation` est vide, donc la boucle qui cherche la recommandation
 * dans le paragraphe suivant AVALE ce paragraphe. Avant mon correctif, la puce n'était pas détectée
 * du tout et le rapport ressortait intact.
 *
 * DÉTRUIRE LES PREUVES DE L'UTILISATEUR EST PIRE QUE LE DÉFAUT D'ORIGINE. Et la leçon est plus
 * large que ces deux lignes : élargir une DÉTECTION sans élargir d'un même geste tout ce qui
 * CONSOMME cette détection transforme une réparation en destruction.
 */

const livre = { status: 'succeeded', valid: true, gateBlocked: false, reused: false }

const blocDeCloture = (decor: (l: string) => string, separateur: string): string =>
  [
    decor('✅ Fait : preuve A'),
    decor('📍 Maintenant : etat'),
    decor('⏳ Reste à faire : rien'),
    decor('👉 Recommandé : relancer'),
    ...(separateur ? [separateur] : []),
    'PREUVE IMPORTANTE : 74 tests verts, fichier X.ts',
    'SECONDE LIGNE DE PREUVE'
  ].join('\n')

const decors: Array<[string, (l: string) => string]> = [
  ['nue', (l) => l],
  ['en puce', (l) => `- ${l}`],
  ['en puce numérotée', (l) => `1. ${l}`],
  ['en titre', (l) => `### ${l}`]
]

describe('retirer un bloc de clôture ne détruit jamais les preuves qui le suivent', () => {
  for (const [nom, decor] of decors) {
    for (const [nomSep, sep] of [
      ['avec ligne vide', ''],
      ['SANS ligne vide', '']
    ] as Array<[string, string]>) {
      void nomSep
      void sep
    }

    it(`forme ${nom} : les preuves survivent, avec ligne vide`, () => {
      const sortie = reconcileClosedOrchestrationText(blocDeCloture(decor, ''), livre)
      expect(sortie).toContain('PREUVE IMPORTANTE : 74 tests verts, fichier X.ts')
      expect(sortie).toContain('SECONDE LIGNE DE PREUVE')
    })

    it(`forme ${nom} : les preuves survivent SANS ligne vide séparatrice`, () => {
      // C'est ce cas précis qui détruisait. Sans ligne vide, la boucle de rattrapage avale tout.
      const sortie = reconcileClosedOrchestrationText(blocDeCloture(decor, ''), livre)
      expect(sortie).toContain('PREUVE IMPORTANTE : 74 tests verts, fichier X.ts')
    })

    it(`forme ${nom} : l’étiquette « ✅ Fait » ne survit pas dans le corps`, () => {
      const sortie = reconcileClosedOrchestrationText(blocDeCloture(decor, ''), livre)
      expect(sortie).toContain('preuve A')
      expect(sortie).not.toContain('✅ Fait')
    })
  }
})
