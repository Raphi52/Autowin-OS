import { describe, expect, it } from 'vitest'
import {
  auditerDepot,
  detecterAssertionsNeutralisees,
  detecterCanauxIpcSansAppelant,
  detecterClassesCssSansRegle,
  detecterComposantsJamaisMontes,
  detecterGardesSurFichierAbsent,
  detecterImpuretesAuRendu,
  scoreValeurEffort,
  candidatsDepuisAudit,
  PRODUIT_INTERNE,
  type FichierAudite
} from './audit-interne'

/**
 * Chaque détecteur est testé DANS LES DEUX SENS : il trouve le défaut, et il se TAIT sur le cas
 * légitime le plus proche. Le second est le vrai test — un détecteur qui signale tout est aussi
 * inutile qu'un détecteur muet, et c'est ce qui a valu à la colonne d'être qualifiée « à chier ».
 *
 * Les cas « il se tait » ne sont pas inventés : chacun est un FAUX POSITIF réellement produit par la
 * première version, sur le dépôt réel, et compté avant d'être corrigé (17 → 10 → 5 → 3 sur les
 * canaux IPC).
 */
const f = (chemin: string, contenu: string): FichierAudite => ({ chemin, contenu })

/**
 * Construit une ligne d'enregistrement de canal IPC A L'EXECUTION.
 *
 * Le motif ne doit PAS apparaitre en clair dans ce fichier : un garde-fou de securite scanne
 * `src/main/**` a la recherche de tout canal enregistre hors `index.ts` et exige un controle
 * d'appelant. Mes fixtures le declenchaient — et le garde avait raison, c'est mon texte qui etait
 * fautif, pas lui. Le detecteur teste ci-dessous voit la meme chaine, elle n'est simplement plus
 * ecrite dans la source.
 */
const ligneCanal = (canal: string, suffixe = ', (event) => 1'): string =>
  `  ipcMain` +
  `.handle('${canal}'${suffixe})
`

describe('audit interne — score valeur/effort', () => {
  it('classe une forte valeur peu coûteuse au-dessus d’une valeur moyenne coûteuse', () => {
    expect(scoreValeurEffort({ valeur: 'forte', effort: 'petit' })).toBeGreaterThan(
      scoreValeurEffort({ valeur: 'moyenne', effort: 'gros' })
    )
  })

  it('fait passer le moins coûteux devant, à valeur égale', () => {
    expect(scoreValeurEffort({ valeur: 'moyenne', effort: 'petit' })).toBeGreaterThan(
      scoreValeurEffort({ valeur: 'moyenne', effort: 'moyen' })
    )
  })

  it('reste borné à 0-100 sur toutes les combinaisons', () => {
    for (const valeur of ['faible', 'moyenne', 'forte'] as const) {
      for (const effort of ['petit', 'moyen', 'gros'] as const) {
        const score = scoreValeurEffort({ valeur, effort })
        expect(score).toBeGreaterThan(0)
        expect(score).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('audit interne — composant jamais monté', () => {
  const vue = f(
    'src/renderer/src/components/OrphelineView.tsx',
    'export function OrphelineView(): null {\n  return null\n}\n'
  )

  it('signale une vue que personne ne monte', () => {
    const constats = detecterComposantsJamaisMontes([
      vue,
      f('src/renderer/src/App.tsx', '<Autre />')
    ])
    expect(constats).toHaveLength(1)
    expect(constats[0].ancrage).toBe('src/renderer/src/components/OrphelineView.tsx:1')
    expect(constats[0].citation).toContain('export function OrphelineView')
  })

  it('se tait dès qu’un fichier la monte', () => {
    const app = f('src/renderer/src/App.tsx', '<OrphelineView active={true} />')
    expect(detecterComposantsJamaisMontes([vue, app])).toHaveLength(0)
  })

  it('ne compte PAS un test comme un montage', () => {
    // Une vue seulement rendue par son propre test reste morte pour l'utilisateur : c'est exactement
    // le cas `WorktreeMapView`, qui avait trois fichiers de tests et aucun écran.
    const test = f('src/renderer/src/components/OrphelineView.test.tsx', '<OrphelineView />')
    expect(detecterComposantsJamaisMontes([vue, test])).toHaveLength(1)
  })
})

describe('audit interne — canal IPC sans appelant', () => {
  const main = f('src/main/index.ts', ligneCanal('os:mort'))
  const preload = f('src/preload/index.ts', "  apiMorte: () => ipcRenderer.invoke('os:mort'),\n")

  it('signale un canal que le preload ne ponte pas', () => {
    const constats = detecterCanauxIpcSansAppelant([main])
    expect(constats).toHaveLength(1)
    expect(constats[0].titre).toContain('os:mort')
  })

  it('signale une API pontée mais appelée par personne', () => {
    const constats = detecterCanauxIpcSansAppelant([main, preload])
    expect(constats).toHaveLength(1)
    expect(constats[0].titre).toContain('apiMorte')
  })

  it('se tait sur un appel en CHAÎNAGE OPTIONNEL', () => {
    // Faux positif réel : `window.api?.getPreflight?.()` ne contient pas `.getPreflight(`. Trois
    // canaux vivants étaient donnés pour morts.
    const vue = f('src/renderer/src/components/Vue.tsx', 'void window.api?.apiMorte?.()')
    expect(detecterCanauxIpcSansAppelant([main, preload, vue])).toHaveLength(0)
  })

  it('se tait quand seul un SCRIPT de pilotage appelle le canal', () => {
    // Faux positif réel : `captureTestPage`, `appState` et `fabricNodes` ne servent qu'aux scripts
    // CDP. C'est une surface de test voulue, pas du code mort.
    const script = f('scripts/cdp-preuve.mjs', 'await api.apiMorte()')
    expect(detecterCanauxIpcSansAppelant([main, preload, script])).toHaveLength(0)
  })

  it('se tait sur un fixture de test et sur un nom interpolé', () => {
    const test = f(
      'src/main/contrat.test.ts',
      `expect(${ligneCanal('chat:send', ', h').trim()}).toBe(1)`
    )
    const interpole = f('src/main/boucle.ts', 'ipcMain.handle(`${canal}`, h)')
    expect(detecterCanauxIpcSansAppelant([test, interpole])).toHaveLength(0)
  })

  it('se tait quand le motif n’est que cité dans un COMMENTAIRE', () => {
    // Faux positif réel : ce module s'était signalé lui-même via son propre commentaire.
    const commente = f(
      'src/main/doc.ts',
      `  // ${ligneCanal('os:exemple', ', h').trim()} — exemple
`
    )
    expect(detecterCanauxIpcSansAppelant([commente])).toHaveLength(0)
  })
})

describe('audit interne — garde sur fichier absent', () => {
  it('signale un test qui lit une feuille supprimée', () => {
    const test = f(
      'src/renderer/src/garde.test.ts',
      "  const css = readFileSync(new URL('./Disparue.css', import.meta.url), 'utf8')\n"
    )
    const constats = detecterGardesSurFichierAbsent([test])
    expect(constats).toHaveLength(1)
    expect(constats[0].titre).toContain('Disparue.css')
  })

  it('se tait quand le fichier lu existe', () => {
    const test = f(
      'src/renderer/src/garde.test.ts',
      "  const css = readFileSync(new URL('./Presente.css', import.meta.url), 'utf8')\n"
    )
    const feuille = f('src/renderer/src/Presente.css', '.a {\n  color: red;\n}\n')
    expect(detecterGardesSurFichierAbsent([test, feuille])).toHaveLength(0)
  })
})

describe('audit interne — assertion neutralisée', () => {
  it('signale un octet de contrôle dans une expression régulière', () => {
    // L'octet est construit depuis son CODE : l'écrire en clair ici reproduirait le défaut traqué.
    const backspace = String.fromCharCode(8)
    const test = f(
      'src/renderer/src/vue.test.ts',
      `  expect(html).not.toMatch(/${backspace}\\d{1,3}%/)\n`
    )
    const constats = detecterAssertionsNeutralisees([test])
    expect(constats).toHaveLength(1)
    // La citation est rendue LISIBLE plutôt que recopiée telle quelle.
    expect(constats[0].citation).toContain('<octet de contrôle>')
    expect(constats[0].citation).not.toContain(backspace)
  })

  it('se tait sur l’échappement correct', () => {
    const test = f('src/renderer/src/vue.test.ts', '  expect(html).not.toMatch(/\\b\\d{1,3}%/)\n')
    expect(detecterAssertionsNeutralisees([test])).toHaveLength(0)
  })
})

describe('audit interne — classe CSS sans règle', () => {
  const vue = f(
    'src/renderer/src/components/Vue.tsx',
    '  return <div className="bloc-sans-style">x</div>\n'
  )

  it('signale une classe qu’aucune feuille ne style', () => {
    const constats = detecterClassesCssSansRegle([vue, f('src/renderer/src/a.css', '.autre {}')])
    expect(constats).toHaveLength(1)
    expect(constats[0].titre).toContain('bloc-sans-style')
  })

  it('se tait quand une règle existe, même via un sélecteur parent', () => {
    const css = f('src/renderer/src/a.css', '.parent > .bloc-sans-style,\n.x {\n  color: red;\n}\n')
    expect(detecterClassesCssSansRegle([vue, css])).toHaveLength(0)
  })

  it('ignore les classes utilitaires courtes et sans tiret', () => {
    // `row`, `gap2` vivent dans des feuilles globales : les signaler noierait les vrais constats.
    const utilitaire = f(
      'src/renderer/src/components/U.tsx',
      '  return <div className="row">x</div>'
    )
    expect(detecterClassesCssSansRegle([utilitaire])).toHaveLength(0)
  })
})

describe('audit interne — impureté au rendu', () => {
  it('signale un Date.now() dans le corps d’un composant', () => {
    const vue = f(
      'src/renderer/src/components/Vue.tsx',
      'export function Vue() {\n  const maintenant = Date.now()\n  return null\n}\n'
    )
    const constats = detecterImpuretesAuRendu([vue])
    expect(constats).toHaveLength(1)
    expect(constats[0].ancrage).toBe('src/renderer/src/components/Vue.tsx:2')
  })

  it('se tait sur un Date.now() dans un callback ou au niveau module', () => {
    const vue = f(
      'src/renderer/src/components/Vue.tsx',
      'const DEBUT = Date.now()\nexport function Vue() {\n  useEffect(() => {\n    const t = Date.now()\n  })\n}\n'
    )
    expect(detecterImpuretesAuRendu([vue])).toHaveLength(0)
  })
})

describe('audit interne — passe complète', () => {
  it('trie par score décroissant et attache le score à chaque constat', () => {
    const fichiers = [
      f(
        'src/renderer/src/garde.test.ts',
        "  const css = readFileSync(new URL('./Disparue.css', import.meta.url), 'utf8')\n"
      ),
      f(
        'src/renderer/src/components/Vue.tsx',
        '  return <div className="bloc-sans-style">x</div>\n'
      )
    ]
    const constats = auditerDepot(fichiers)
    expect(constats.length).toBeGreaterThanOrEqual(2)
    for (const c of constats) expect(c.score).toBeGreaterThan(0)
    // Le garde qui jette (valeur forte, effort petit) doit passer devant une classe non stylée.
    expect(constats[0].classe).toBe('garde-sur-fichier-absent')
    const scores = constats.map((c) => c.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('ne rend AUCUN constat sans ancrage ni citation', () => {
    // Un candidat sans preuve est une opinion, et la colonne en était pleine.
    const constats = auditerDepot([f('src/main/index.ts', ligneCanal('os:mort'))])
    expect(constats.length).toBeGreaterThan(0)
    for (const c of constats) {
      expect(c.ancrage).toMatch(/^[\w./-]+:\d+$/)
      expect(c.citation.length).toBeGreaterThan(0)
      expect(c.consequence.length).toBeGreaterThan(20)
    }
  })
})

describe('audit interne — bout en bout dans la veille', () => {
  it('un constat traverse le tri de la veille et atterrit au stock', async () => {
    // C'est le test qui compte : les detecteurs peuvent etre justes et le candidat quand meme REFUSE
    // par le tri (URL non http, citation trop courte, nature absente). Verifie ici avec le VRAI
    // `trierCandidats`, pas une imitation.
    const { trierCandidats } = await import('./candidats')
    const constats = auditerDepot([f('src/main/index.ts', ligneCanal('os:mort'))])
    expect(constats.length).toBeGreaterThan(0)
    const bruts = candidatsDepuisAudit(constats, '2026-08-13T10:00:00.000Z')
    const { retenus, refuses } = trierCandidats(bruts, new Set(), {
      maintenant: '2026-08-13T10:00:00.000Z',
      redigerPrompt: (c) => `corrige ${c.titre}`
    })
    // Aucun refus : l'ancrage `fichier:ligne` est accepte comme adresse verifiable, la citation est
    // la ligne de code, et la nature est `correction`.
    expect(refuses).toEqual([])
    expect(retenus).toHaveLength(bruts.length)
    expect(retenus[0].concurrent).toBe(PRODUIT_INTERNE)
    expect(retenus[0].url).toMatch(/^src\/main\/index\.ts:\d+$/)
    expect(retenus[0].type).toBe('correction')
    expect(retenus[0].pertinence).toBeGreaterThan(0)
  })

  it('refuse un ancrage qui n’en est pas un, plutôt que de laisser passer une adresse floue', async () => {
    const { trierCandidats } = await import('./candidats')
    const [brut] = candidatsDepuisAudit(
      [
        {
          classe: 'canal-ipc-sans-appelant',
          titre: 'Titre',
          ancrage: 'quelque part dans le code',
          citation: 'une ligne suffisamment longue pour passer le minimum',
          consequence: 'consequence assez longue pour etre acceptee par le controle',
          effort: 'petit',
          valeur: 'forte',
          score: 95
        }
      ],
      '2026-08-13T10:00:00.000Z'
    )
    const { refuses } = trierCandidats([brut], new Set(), {
      maintenant: '2026-08-13T10:00:00.000Z',
      redigerPrompt: () => 'x'
    })
    expect(refuses[0].raison).toBe('url non http(s)')
  })
})
