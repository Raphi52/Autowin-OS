import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * LE GABARIT DES VUES : UN seul cadre de page, peint UNE fois.
 *
 * Demande utilisateur (conv-160, 2026-10-10) : « les containers de toutes les vues devraient etre
 * basees sur le meme template pour pas diverger ». Constat mesure ce jour-la, captures des huit vues
 * a l'appui : Task Manager, Worktrees, Tickets, Tests et Observatory posent leur contenu dans
 * `.view-page` ; Memory, Agent Studio (Modeles, Routage) et Settings (Skills, Behaviour) RECOPIAIENT
 * ce cadre sur la racine de leur contenu (grand rayon de page, reflet du haut, fond de page, flou).
 * Resultat : une page dans la page — « un container noir dans un autre container or » — et cinq
 * copies qui derivaient chacune dans son coin, theme par theme.
 *
 * Le gabarit, tel que Task Manager (vue de reference) le pratique :
 *   - `.view-page` est le SEUL cadre : rayon de page, fond de page, reflet, retrait ;
 *   - la racine du contenu d'une vue ne peint RIEN : elle remplit le cadre ;
 *   - les blocs du contenu sont des PANNEAUX (rayon de panneau ou de carte), jamais une page.
 * Ce fichier refuse qu'une vue reparte avec son propre cadre, dans N'IMPORTE quelle feuille —
 * un theme qui repeint la racine en noir recree le defaut aussi surement que la vue elle-meme.
 */

const ICI = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = join(ICI, '..')

/** La racine du contenu de chaque sous-vue posee dans le cadre d'une vue a onglets. */
const RACINES_DE_CONTENU: Record<string, string> = {
  GraphView: 'graph-observatory',
  AgentsTopologyView: 'agents-topology',
  RouterView: 'router-view',
  WorkflowProfilesView: 'workflow-profiles',
  CapabilitiesView: 'capability-cockpit',
  BehaviourView: 'behaviour-view',
  InterfaceView: 'interface-view'
}
/** Les en-tetes poses A MEME le cadre (comme `ViewTopBar`) : une bande peinte y refait un cadre. */
const ENTETES_SUR_LE_CADRE = ['graph-toolbar', 'topology-toolbar']

/** Vues dont le contenu est une sous-vue rendue dans `.domain-content`. */
const VUES_A_SOUS_VUES = ['AgentStudioView.tsx', 'SettingsView.tsx', 'KnowledgeView.tsx']

function feuilles(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...feuilles(chemin))
    else if (entree.name.endsWith('.css')) out.push(chemin)
  }
  return out
}

/** Dernier selecteur compose (apres le dernier combinateur de premier niveau). */
function dernierCompose(selecteur: string): string {
  let profondeur = 0
  let debut = 0
  for (let i = 0; i < selecteur.length; i++) {
    const c = selecteur[i]
    if (c === '(' || c === '[') profondeur++
    else if (c === ')' || c === ']') profondeur--
    else if (profondeur === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) debut = i + 1
  }
  return selecteur.slice(debut).trim()
}

const NEUTRE = /^(transparent|none|0|0px|unset|initial|inherit)$/i

/** Une declaration qui PEINT une surface (fond, ombre, flou, bord visible). */
function peint(prop: string, valeur: string): boolean {
  const v = valeur.replace(/!important/i, '').trim()
  if (/^background(-color|-image)?$/.test(prop)) return !NEUTRE.test(v)
  if (prop === 'box-shadow' || prop === 'backdrop-filter') return !NEUTRE.test(v)
  if (prop === 'border' || prop === 'border-width') return !/^(0|0px|none)(\s|$)/.test(v)
  return false
}

type Violation = string

function violations(classes: string[]): Violation[] {
  const motifs = classes.map((c) => new RegExp(`\\.${c}(--[\\w-]+)?(?![\\w-])`))
  const trouve: Violation[] = []
  for (const fichier of feuilles(RENDERER)) {
    const racine = postcss.parse(readFileSync(fichier, 'utf8'))
    racine.walkRules((regle) => {
      for (const selecteur of regle.selectors) {
        const compose = dernierCompose(selecteur)
        // Un pseudo-element (::before/::after) est un autre objet que la racine elle-meme.
        if (compose.includes('::')) continue
        if (!motifs.some((m) => m.test(compose))) continue
        regle.walkDecls((d) => {
          if (d.parent !== regle) return
          if (peint(d.prop, d.value)) {
            trouve.push(`${fichier.slice(RENDERER.length + 1)} « ${selecteur} » ${d.prop}: ${d.value}`)
          }
        })
      }
    })
  }
  return trouve
}

describe('Gabarit des vues : un seul cadre de page', () => {
  it('chaque sous-vue rendue dans un cadre de page est declaree au gabarit', () => {
    // Une nouvelle sous-vue non declaree echapperait au contrat ci-dessous : elle doit y entrer.
    for (const vue of VUES_A_SOUS_VUES) {
      const tsx = readFileSync(join(ICI, vue), 'utf8')
      for (const [, composant] of tsx.matchAll(/<([A-Z]\w*View)\b/g)) {
        if (composant === 'ViewTopBar') continue
        expect(Object.keys(RACINES_DE_CONTENU), `${vue} rend ${composant}`).toContain(composant)
      }
    }
  })

  it('la racine du contenu d une vue ne repeint pas le cadre de page, dans aucune feuille', () => {
    expect(violations(Object.values(RACINES_DE_CONTENU))).toEqual([])
  })

  it('les en-tetes poses sur le cadre restent nus, dans aucune feuille', () => {
    expect(violations(ENTETES_SUR_LE_CADRE)).toEqual([])
  })

  it('le rayon et le fond DE PAGE ne servent qu aux cadres de page', () => {
    // `.view-page` pour les vues ; Chat, l'Accueil et l'assistant de premier lancement sont des
    // pages a part entiere sans `.view-page`.
    const cadres = /\.(view-page|chat-layout|home-view|frw-card)(?![\w-])/
    const trouve: Violation[] = []
    for (const fichier of feuilles(RENDERER)) {
      postcss.parse(readFileSync(fichier, 'utf8')).walkDecls((d) => {
        if (!/var\(--(container-radius-page|surface-page)\b/.test(d.value)) return
        const regle = d.parent
        if (!regle || regle.type !== 'rule') return
        const selecteurs = (regle as postcss.Rule).selectors
        if (selecteurs.every((s) => cadres.test(dernierCompose(s)))) return
        trouve.push(`${fichier.slice(RENDERER.length + 1)} « ${selecteurs.join(', ')} » ${d.prop}`)
      })
    }
    expect(trouve).toEqual([])
  })

  it('Memory pose le cadre de page commun, sans variante a elle', () => {
    expect(readFileSync(join(ICI, 'KnowledgeView.tsx'), 'utf8')).toContain(
      'className="view-page domain-shell"'
    )
  })
})

/**
 * LE RETRAIT HORIZONTAL DU CONTENU, une seule valeur (conv-160, 2026-10-10 : « Aligne le retrait
 * horizontal du contenu de toutes les vues sur une seule valeur du gabarit »).
 *
 * Mesure au rendu (`ui-capture.mjs --retraits`, distance bord du cadre -> bloc peint le plus a
 * gauche) avant correction : 18 px dans Task Manager, Observatory, Memory, Modeles et cinq onglets
 * de Settings ; 22 dans Tickets, 30 dans Workflows, 36 dans Routage, 38 dans Skills et Behaviour.
 * Chaque ecart venait d'un conteneur du contenu qui AJOUTAIT son retrait lateral par-dessus celui
 * du cadre. Le gabarit : le cadre pose `--view-retrait`, rien a l'interieur n'en rajoute ; le TEXTE
 * des en-tetes va plus loin, de `--view-head-retrait`, et seulement par ce jeton.
 */

/** Composantes [haut, droite, bas, gauche] d'un raccourci padding/margin (parentheses respectees). */
function composantes(valeur: string): string[] {
  const parts: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of valeur.replace(/!important/i, '').trim()) {
    if (c === '(') profondeur++
    if (c === ')') profondeur--
    if (profondeur === 0 && /\s/.test(c)) {
      if (courant) parts.push(courant)
      courant = ''
    } else courant += c
  }
  if (courant) parts.push(courant)
  const [h, d = h, b = h, g = d] = parts
  return [h, d, b, g]
}

/** Les valeurs LATERALES (gauche, droite) qu'une declaration pose, ou [] si elle n'en pose pas. */
function lateraux(prop: string, valeur: string): string[] {
  if (prop === 'padding' || prop === 'margin') {
    const [, d, , g] = composantes(valeur)
    return [g, d]
  }
  if (prop === 'padding-inline' || prop === 'margin-inline') {
    const [g, d = g] = composantes(valeur)
    return [g, d]
  }
  if (/^(padding|margin)-(left|right|inline-start|inline-end)$/.test(prop)) return [valeur.trim()]
  return []
}

/** Toute declaration laterale posee sur une des classes, dans toutes les feuilles. */
function declarationsLaterales(classes: string[]): { ou: string; valeurs: string[] }[] {
  // L'element CIBLE est la fin du selecteur : `.domain-content .x` vise `.x`, pas l'enveloppe. On
  // tolere en queue un modificateur (`--galaxy`) et des pseudo-classes ou attributs (`:only-child`).
  const motifs = classes.map(
    (c) => new RegExp(`(^|[^\\w-])${c}(--[\\w-]+)?(?![\\w-])([.:\\[][^\\s>+~]*)?$`)
  )
  const trouve: { ou: string; valeurs: string[] }[] = []
  for (const fichier of feuilles(RENDERER)) {
    postcss.parse(readFileSync(fichier, 'utf8')).walkRules((regle) => {
      const cibles = regle.selectors.filter(
        (s) => !dernierCompose(s).includes('::') && motifs.some((m) => m.test(s.trim()))
      )
      if (cibles.length === 0) return
      regle.walkDecls((d) => {
        if (d.parent !== regle) return
        const valeurs = lateraux(d.prop, d.value)
        if (valeurs.length === 0) return
        trouve.push({
          ou: `${fichier.slice(RENDERER.length + 1)} « ${cibles.join(', ')} » ${d.prop}: ${d.value}`,
          valeurs
        })
      })
    })
  }
  return trouve
}

/**
 * Les conteneurs PLEINE LARGEUR du contenu : la racine de chaque vue (le meme element que
 * `.view-page` — un padding pose ici ecraserait celui du cadre), l'enveloppe des vues a onglets, la
 * racine de chaque sous-vue, et les enveloppes de corps qui ajoutaient leur propre retrait.
 * `interface-view` n'y est pas : c'est un PANNEAU (`.surface-panel`), son retrait est interieur.
 */
const CONTENEURS_DU_CONTENU = [
  '\\.task-manager-view',
  '\\.tickets-view',
  '\\.tests-view',
  '\\.worktree-tab',
  '\\.observatory-view',
  '\\.domain-shell',
  '\\.domain-content',
  ...Object.values(RACINES_DE_CONTENU)
    .filter((c) => c !== 'interface-view')
    .map((c) => `\\.${c}`),
  '\\.cockpit-scroll',
  '\\.tickets-toolbar',
  '\\.tickets-actions'
]

/** Les BLOCS du contenu (panneau borde, message) : leur padding est INTERIEUR, seule une marge
 *  laterale les decale du retrait commun. */
const BLOCS_DU_CONTENU = [
  '\\.behaviour-inspection',
  '\\.behaviour-error',
  '\\.workflow-profiles-head'
]

/** Les en-tetes dont le TEXTE suit le retrait des titres de page. */
const ENTETES_DE_TEXTE = [
  '\\.view-topbar',
  '\\.graph-toolbar',
  '\\.tickets-head',
  '\\.observatory-head',
  '\\.cockpit-header',
  '\\.topology-toolbar',
  '\\.behaviour-view\\s*>\\s*header',
  '\\.router-view\\s*>\\s*\\.module-header'
]

describe('Gabarit des vues : un seul retrait horizontal du contenu', () => {
  it('le cadre pose le retrait du contenu par SON jeton, declare une seule fois', () => {
    const cadre = readFileSync(join(ICI, 'ViewPage.css'), 'utf8')
    const regleCadre = regle(cadre, '.view-page')
    expect(regleCadre).toMatch(/--view-retrait:\s*\d+px\s*;/)
    expect(regleCadre).toMatch(/--view-head-pad:\s*\S+\s+var\(--view-head-retrait\)\s+\S+\s*;/)
    expect(regleCadre).toMatch(/\n\s*padding:\s*\S+\s+var\(--view-retrait\)\s*;/)
    // Une seule source : un theme qui redefinirait le jeton recreerait une valeur par vue.
    const ailleurs = feuilles(RENDERER).filter(
      (f) => !f.endsWith('ViewPage.css') && /--view-retrait\s*:/.test(readFileSync(f, 'utf8'))
    )
    expect(ailleurs).toEqual([])
  })

  it('aucun conteneur du contenu n ajoute de retrait lateral, dans aucune feuille', () => {
    const fautifs = declarationsLaterales(CONTENEURS_DU_CONTENU)
      .filter(({ valeurs }) => valeurs.some((v) => !/^(0|0px|auto)$/.test(v)))
      .map(({ ou }) => ou)
    expect(fautifs).toEqual([])
  })

  it('aucun bloc du contenu ne se decale par une marge laterale, dans aucune feuille', () => {
    const fautifs = declarationsLaterales(BLOCS_DU_CONTENU)
      .filter(({ ou }) => / margin(-[a-z-]+)?: /.test(ou))
      .filter(({ valeurs }) => valeurs.some((v) => !/^(0|0px|auto)$/.test(v)))
      .map(({ ou }) => ou)
    expect(fautifs).toEqual([])
  })

  it('le texte des en-tetes ne prend son retrait lateral QUE des jetons du gabarit', () => {
    const fautifs = declarationsLaterales(ENTETES_DE_TEXTE)
      .filter(({ valeurs }) =>
        valeurs.some((v) => !/^var\(--view-head-(retrait|pad)\b/.test(v) && !/^(0|0px)$/.test(v))
      )
      .map(({ ou }) => ou)
    expect(fautifs).toEqual([])
  })
})

function regle(css: string, selecteur: string): string {
  for (const bloc of css.split('}')) {
    const coupe = bloc.lastIndexOf('{')
    if (coupe < 0) continue
    if (bloc.slice(0, coupe).replace(/\/\*[\s\S]*?\*\//g, '').trim() === selecteur) {
      return bloc.slice(coupe + 1)
    }
  }
  return ''
}
