/**
 * LE WORKFLOW INTELLIGENT EN SUPER CONVERSATION (conv-1333, 2026-10-30).
 *
 * Mesuré sur les fils depuis le 22/10 : 6 panneaux, 4 lancements, 12 lots prévus et 4 partis ; 2
 * panneaux sur 6 ont reçu une réponse tapée, qui passait à côté de tout ; sur 64 pistes, l'effort
 * était vide 64 fois alors que le texte le disait. Les textes de pistes viennent de ces fils.
 */
import { describe, expect, it } from 'vitest'
import { DEMANDE_MAX, lirePlanDeLots, promptDuLot, creerPlan } from '../../../shared/plan-de-lots'
import { estSelectionDeScout, voieDeLaSelection } from '../../../shared/selection-scout'
import { parseScoutTable } from '../../../shared/scout-table'
import {
  candidatsDepuisScoutTable,
  panneauDuDernierTour,
  planDeLaSaisie,
  planDeLancement,
  selectionAPlanifier,
  selectionTapee,
  voieDeLaPiste,
  type CandidatAffiche
} from './veille-candidats-message'

const TABLEAU = [
  '| # | Score | Type | What | Why | How |',
  '|---|---|---|---|---|---|',
  '| 1 | 78 | 🔧 fix | **Le mode `/draft` se perd.** | `src/main/skills/draft-choix-par-boutons.ts:46` ne regarde que 2 messages. | Remonter au dernier /draft.<br>**Effort :** faible.<br>**Preuve :** `npx vitest run src/main/skills/draft-choix-par-boutons.test.ts` |',
  '| 2 | 70 | 🆕 feature | **Alt+clic sur un élément** | 163 retouches | Réutiliser `src/main/bureau/navigateur-integre.ts:1464`.<br>**Effort :** moyen. |',
  '| 3 | 60 | 🔧 fix | **Grosse reprise** | a | Reprendre `src/main/a.ts:3`.<br>**Effort :** élevé. |'
].join('\n')

const candidats = (): CandidatAffiche[] => candidatsDepuisScoutTable(parseScoutTable(TABLEAU)!)

describe('l’effort et la preuve écrits dans le « Comment » comptent', () => {
  it('l’effort en prose remplit la colonne absente du tableau', () => {
    expect(candidats().map((c) => c.effort)).toEqual(['g', 'y', 'r'])
  })

  it('une correction annoncée « élevé » part au cadrage : la règle ne dort plus', () => {
    const [, , grosse] = candidats()
    expect(voieDeLaPiste(grosse!)).toMatchObject({ voie: 'complete' })
    expect(voieDeLaPiste(grosse!).motif).toContain('effort')
  })

  it('la commande citée dans « Preuve : » devient la preuve de la piste', () => {
    expect(candidats()[0]!.commande).toBe('npx vitest run src/main/skills/draft-choix-par-boutons.test.ts')
  })

  it('jumeau : une commande sans fichier visé ne prouve rien', () => {
    const lignes = parseScoutTable(TABLEAU.replace('src/main/skills/draft-choix-par-boutons.test.ts', ''))
    expect(candidatsDepuisScoutTable(lignes!)[0]!.commande).toBeUndefined()
  })

  it('un chemin avec son dossier localise une correction, un nom d’URL non', () => {
    const base: CandidatAffiche = { titre: 'x', type: 'fix' }
    expect(voieDeLaPiste({ ...base, how: 'Corriger `src/main/a.ts`.' }).voie).toBe('directe')
    expect(voieDeLaPiste({ ...base, how: 'Voir https://exemple.fr/a/b.html' }).voie).toBe(
      'complete'
    )
  })

  it('un chemin n’est pas un signal de risque : `orchestrator.ts:12` reste une adresse', () => {
    const base: CandidatAffiche = { titre: 'x', type: 'fix', url: 'src/main/a.ts:1' }
    expect(voieDeLaPiste({ ...base, how: 'Borner `src/main/orchestration/orchestrator.ts:12`.' }).voie).toBe(
      'directe'
    )
    // Jumeau : le même mot en prose garde le workflow complet.
    expect(voieDeLaPiste({ ...base, how: 'Refondre l’orchestration du dépôt.' }).voie).toBe(
      'complete'
    )
  })
})

describe('selectionAPlanifier — la sélection devient un plan lisible', () => {
  it('un plan à deux lots passe le lecteur strict, voies et fichiers annoncés', () => {
    const plan = selectionAPlanifier(planDeLancement(candidats()))
    const lu = lirePlanDeLots(plan)
    expect(lu.ok && lu.avertissements).toEqual([])
    expect(plan.lots.map((l) => l.titre)).toEqual([
      'Direct — Le mode /draft se perd.',
      'À cadrer — Alt+clic sur un élément (+1)'
    ])
    expect(plan.lots[0]!.fichiers).toEqual([
      'src/main/skills/draft-choix-par-boutons.ts',
      'src/main/skills/draft-choix-par-boutons.test.ts'
    ])
    expect(plan.lots[1]!.fichiers).toContain('src/main/bureau/navigateur-integre.ts')
  })

  it('les pistes aux fichiers communs sont annoncées : le plan les fera passer l’une après l’autre', () => {
    const lot = (titre: string): CandidatAffiche => ({
      titre,
      type: 'new',
      how: 'Toucher `src/main/commun.ts:4`.'
    })
    const quatre = [lot('A'), lot('B'), lot('C'), lot('D')]
    const lu = lirePlanDeLots(selectionAPlanifier(planDeLancement(quatre)))
    expect(lu.ok && lu.avertissements.join(' ')).toContain('ils passeront l’un après l’autre')
  })

  it('une demande géante tient dans la borne du plan sans perdre le « Quoi » ni son en-tête', () => {
    const geant: CandidatAffiche[] = [1, 2, 3].map((n) => ({
      titre: `**Piste ${n}**`,
      what: `**Piste ${n}**`,
      type: 'new',
      why: 'preuve lue '.repeat(300),
      how: 'étape précise '.repeat(300)
    }))
    const plan = selectionAPlanifier([
      ...planDeLancement(geant),
      ...planDeLancement([{ titre: 'Autre', type: 'new' }])
    ])
    const [demande] = plan.lots.map((l) => l.demande)
    expect(demande!.length).toBeLessThanOrEqual(DEMANDE_MAX)
    expect(lirePlanDeLots(plan).ok).toBe(true)
    expect(estSelectionDeScout(demande)).toBe(true)
    for (const n of [1, 2, 3]) expect(demande).toContain(`Quoi : **Piste ${n}**`)
    expect(demande).toContain('coupé : le détail est dans le tableau du scout')
  })

  it('le message reçu par le fil du lot reste reconnu : voie, en-tête, /build en première ligne', () => {
    const plan = selectionAPlanifier(planDeLancement(candidats()))
    const lu = lirePlanDeLots(plan)
    if (!lu.ok) throw new Error(lu.erreur)
    const cree = creerPlan(lu.plan, { id: 'plan-x', chef: 'conv-1', maintenant: 1 })
    const direct = promptDuLot(cree, cree.lots[0]!)
    const complet = promptDuLot(cree, cree.lots[1]!)
    expect(direct.split('\n')[0]).toBe('/build')
    expect(voieDeLaSelection(direct)).toBe('directe')
    expect(voieDeLaSelection(complet)).toBe('complete')
  })
})

describe('selectionTapee — ce que l’utilisateur tape sous le panneau', () => {
  const tableau = candidats()
  const cible = '## Cible\nLigne 2 : la plus utile.'
  const choix = (texte: string, scout?: string): number[] | null => {
    const lu = selectionTapee(texte, tableau, scout)
    return lu ? [...lu].map((rang) => rang + 1).sort((a, b) => a - b) : null
  }

  it('des numéros de lignes, sous toutes leurs formes courantes', () => {
    expect(choix('1 et 3')).toEqual([1, 3])
    expect(choix('la 2')).toEqual([2])
    expect(choix('les lignes 1, 2')).toEqual([1, 2])
    expect(choix('1 et 3 stp')).toEqual([1, 3])
    expect(choix('prends 3')).toEqual([3])
  })

  it('« toutes » prend tout le tableau', () => {
    expect(choix('toutes')).toEqual([1, 2, 3])
  })

  it('conv-1097 : « fais au mieux c trop complexe pour moi » suit la cible du scout', () => {
    expect(choix('fais au mieux c trop complexe pour moi', cible)).toEqual([2])
    expect(choix('go', cible)).toEqual([2])
  })

  it('une délégation sans cible déclarée reste un message : personne n’a choisi', () => {
    expect(choix('fais au mieux')).toBeNull()
  })

  it('un accusé de réception ne lance jamais de plan', () => {
    expect(choix('ok', cible)).toBeNull()
    expect(choix('oui', cible)).toBeNull()
  })

  it('une phrase qui cite un numéro reste une phrase', () => {
    expect(choix('corrige la ligne 2 du fichier')).toBeNull()
    expect(choix('pourquoi la 3 ?')).toBeNull()
    expect(choix('2024')).toBeNull()
  })

  it('un numéro hors du tableau n’est pas un choix de ce tableau', () => {
    expect(choix('1 et 12')).toBeNull()
  })
})

describe('planDeLaSaisie — seulement sous le panneau du DERNIER tour', () => {
  const tour = (surcharge: Record<string, unknown> = {}): Record<string, unknown> => ({
    role: 'assistant',
    done: true,
    parts: [{ kind: 'text', text: TABLEAU }],
    ...surcharge
  })
  const fil = (...fin: Record<string, unknown>[]): { role: string }[] =>
    [{ role: 'user' }, ...fin] as { role: string }[]

  it('« 1 et 2 » sous le panneau fait le plan de ces deux lignes', () => {
    const plan = planDeLaSaisie('1 et 2', fil(tour()))
    expect(plan?.map((lot) => lot.voie)).toEqual(['directe', 'complete'])
  })

  it('le panneau d’un tour plus ancien ne compte pas', () => {
    expect(planDeLaSaisie('1 et 2', fil(tour(), { role: 'user' }, tour({ parts: [] })))).toBeNull()
  })

  it('un tour pas fini, ou refusé par le contrôle final, laisse le message au modèle', () => {
    expect(planDeLaSaisie('1', fil(tour({ done: false })))).toBeNull()
    expect(panneauDuDernierTour(fil(tour({ status: 'failed' })))).toBeNull()
    expect(
      panneauDuDernierTour(
        fil(tour({ parts: [{ kind: 'text', text: `⛔ Workflow ARRÊTÉ\n${TABLEAU}` }] }))
      )
    ).toBeNull()
  })
})
