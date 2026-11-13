import { describe, expect, it } from 'vitest'
import {
  constatsDesMurs,
  ligneQuiProduit,
  morceauxDuMessage,
  mursRecurrents,
  type RegistreDesMurs
} from './murs-recurrents'
import type { FichierAudite } from './audit-interne'

/*
 * Les signatures viennent du VRAI registre du poste (`murs-rencontres.json`, relevé du 2026-11-13),
 * recopiées telles que `signatureDEchec` les écrit : minuscules, nombres en `<n>`, coupées par
 * les deux bouts au-delà de 80 caractères.
 */
const INTROUVABLE = 'conversation_read::conversation introuvable: conv-<n>'
const RELIRE =
  'verify::{"allowed":true,"ok":false,"exitcode":<n…: agis sur la cause au lieu de relire."}'
const BUREAU =
  'bureau_cache_agir::{"ok":false,"id":"chat-conv-<n>","detail…e fenetre en (<n>,<n>) dans ce bureau."}'
const TYPAGE =
  'verify::{"allowed":true,"ok":false,"exitcode":<n… does not exist on type \'commandspec\'."}'
const TYPE_CITE =
  'verify::{"allowed":true,"ok":false,"exitcode":<n…uvrirlot: (rang: number) => void; }>\'."}'

/** `fils` fils récents (4 par défaut) qui ont tous buté sur chacune des `signatures`. */
function registre(signatures: string | string[], fils = 4): RegistreDesMurs {
  return Object.fromEntries(
    Array.from({ length: fils }, (_, i) => [`conv-${100 + i}`, [signatures].flat()])
  )
}

const fichier = (chemin: string, ...lignes: string[]): FichierAudite => ({
  chemin,
  contenu: lignes.join('\n')
})

const CODE: FichierAudite[] = [
  fichier(
    'src/main/commands/conversations.ts',
    '// conversation introuvable: on le dit sans planter',
    "  if (!c) throw new Error(`conversation introuvable: ${s('id')}`)"
  ),
  fichier(
    'src/main/commands/rejeu.ts',
    "  'Rien n’a pu ' +",
    "  'fait changer entre-temps : agis sur la cause au lieu de relire.'"
  ),
  fichier(
    'src/main/commands/outils-bureau.ts',
    "  if (!travail) return refus('Refusé : passe `travail`, ce que tu fais dans ce bureau.')"
  ),
  fichier(
    'src/renderer/textes.ts',
    "  'Auto mode: {fichier} still does not exist after {heures} h.'"
  ),
  fichier('src/renderer/SuperConvMosaique.tsx', '  onOuvrirLot: (rang: number) => void'),
  fichier(
    'src/main/commands/conversations.test.ts',
    "  expect(() => lire()).toThrow('conversation introuvable: conv-9')"
  )
]

describe('mursRecurrents — les murs que plusieurs fils ont rencontrés', () => {
  it('compte chaque fil une fois, lit l’ancien format et le format daté, et garde ceux du seuil', () => {
    const date = '2026-11-13T10:00:00.000Z'
    const murs: RegistreDesMurs = {
      'conv-1': [INTROUVABLE, INTROUVABLE],
      'conv-2': [{ signature: INTROUVABLE, derniereFois: date }],
      'conv-3': [INTROUVABLE, RELIRE],
      'conv-4': [{ signature: INTROUVABLE, derniereFois: date }, RELIRE],
      'conv-5': [RELIRE, 12, { pas: 'une entrée' }],
      'conv-6': 'pas une liste'
    }
    expect(mursRecurrents(murs)).toEqual([{ signature: INTROUVABLE, fils: 4 }])
    expect(mursRecurrents(murs, { seuil: 3 })).toEqual([
      { signature: INTROUVABLE, fils: 4 },
      { signature: RELIRE, fils: 3 }
    ])
  })

  it('ne relit que les fils les plus récents, rangés par leur numéro', () => {
    const murs: RegistreDesMurs = {
      'conv-9': [RELIRE],
      'conv-10': [RELIRE],
      'conv-100': [INTROUVABLE],
      'conv-101': [INTROUVABLE]
    }
    expect(mursRecurrents(murs, { seuil: 2, fils: 2 })).toEqual([
      { signature: INTROUVABLE, fils: 2 }
    ])
  })
})

describe('morceauxDuMessage — le texte littéral, sans ce que la normalisation a remplacé', () => {
  it('coupe aux nombres, aux chemins, au JSON et à la coupure, la tête d’abord', () => {
    const [tete, ...reste] = morceauxDuMessage(BUREAU.slice(BUREAU.indexOf('::') + 2))
    expect(tete![0]).toBe('e fenetre en (')
    expect(reste.map((suites) => suites[0])).toEqual([') dans ce bureau.'])
  })

  it('garde les suites de deux mots et plus, assez longues pour ne pas être partout', () => {
    const [tete] = morceauxDuMessage('conversation introuvable: conv-<n>')
    // « conv- » seul (un mot) et « introuvable: » seul ne sont pas des suites : trop communs.
    expect(tete).toEqual([
      'conversation introuvable: conv-',
      'conversation introuvable:',
      'introuvable: conv-'
    ])
    expect(morceauxDuMessage('{"allowed":true,"ok":false}')).toEqual([])
  })
})

describe('ligneQuiProduit — la ligne du dépôt qui écrit le message', () => {
  it('trouve la chaîne qui produit le message, pas le commentaire ni le test qui le citent', () => {
    expect(ligneQuiProduit(INTROUVABLE, CODE)).toMatchObject({
      chemin: 'src/main/commands/conversations.ts',
      ligne: 2,
      tete: 'conversation introuvable: conv'
    })
  })

  it('retrouve la fin d’un message coupé, posée par l’outil après un résultat JSON', () => {
    expect(ligneQuiProduit(RELIRE, CODE)).toMatchObject({
      chemin: 'src/main/commands/rejeu.ts',
      ligne: 2
    })
  })

  it.each([
    ['ne partage que la fin du message (script PowerShell non lu)', BUREAU],
    ['ne partage qu’un bout de phrase anglaise (erreur de typage)', TYPAGE],
    ['cite un type, hors de toute chaîne (erreur de typage)', TYPE_CITE]
  ])('aucun ancrage quand la seule ligne proche %s', (_cas, signature) => {
    expect(ligneQuiProduit(signature, CODE)).toBeUndefined()
  })

  it('à recouvrement égal, src/ passe devant scripts/', () => {
    const doublon = [
      fichier('scripts/outil.mjs', "throw new Error('conversation introuvable: ' + id)"),
      fichier('src/main/a.ts', "throw new Error('conversation introuvable: ' + id)")
    ]
    expect(ligneQuiProduit(INTROUVABLE, doublon)?.chemin).toBe('src/main/a.ts')
  })
})

describe('constatsDesMurs — des candidats de la veille ancrés dans le code', () => {
  it('rend le mur ancré, la ligne recopiée en citation, et laisse les murs sans ancrage', () => {
    // Douze fils ont buté sur les deux murs ; seul celui que le code produit devient un constat.
    const constats = constatsDesMurs(registre([INTROUVABLE, BUREAU], 12), CODE)
    expect(constats).toEqual([
      {
        classe: 'mur-recurrent',
        titre:
          'L’outil « conversation_read » bute au même endroit dans plusieurs fils : « conversation introuvable: conv »'.replace(
            '’',
            "'"
          ),
        ancrage: 'src/main/commands/conversations.ts:2',
        citation: "if (!c) throw new Error(`conversation introuvable: ${s('id')}`)",
        consequence: expect.stringContaining('12 des 100 derniers fils qui ont buté sur un outil'),
        effort: 'petit',
        valeur: 'forte'
      }
    ])
  })

  it('le titre ne bouge pas avec le nombre de fils : la veille déduplique sur lui', () => {
    const quatre = constatsDesMurs(registre(INTROUVABLE, 4), CODE)[0]!
    const neuf = constatsDesMurs(registre(INTROUVABLE, 9), CODE)[0]!
    expect(neuf.titre).toBe(quatre.titre)
    expect(quatre.valeur).toBe('moyenne')
  })
})
