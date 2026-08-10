// CAMPAGNE D'ARCHITECTURE : quelle façon de ranger le Brain fait qu'un modèle trouve du premier coup ?
//
// Émet plusieurs SURFACES DE NAVIGATION concurrentes sur les mêmes fiches, plus une banque de
// questions dont la vérité-terrain est VÉRIFIÉE ici même. Un sous-agent par surface et par tirage
// répond « où j'irais en premier » ; le score est ensuite calculé contre cette vérité-terrain.
//
// Usage : node scripts/architectures-candidates.mjs "<racine du brain>" "<dossier de sortie>"
//
// CE QUE LA PREMIÈRE CAMPAGNE A APPRIS (2026-08-07, 3 surfaces, 7 questions, n=1) :
//   · la liste plate est la PIRE sur les deux axes — 1/7 de justesse pour 83 276 tokens, contre 4/7
//     pour 63 322. Montrer les 628 titres noie au lieu d'aider.
//   · les catégories cognitives ne coûtent RIEN de plus qu'un arbre de dossiers (0,2 % d'écart).
//   · mais n=1 ne départage pas 4/7 de 2/7. D'où cette campagne : plus de questions, plus
//     d'architectures, et des TIRAGES RÉPÉTÉS.
//
// Règle tenue : une question n'entre dans la banque que si un motif prouve qu'une fiche y répond.
// Une question sans réponse est RAPPORTÉE, jamais comptée comme un échec de navigation — sinon on
// mesurerait un trou de contenu en croyant mesurer une architecture.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const BRAIN = process.argv[2]
const SORTIE = process.argv[3]
if (!BRAIN || !existsSync(BRAIN) || !SORTIE) {
  console.log('usage : node scripts/architectures-candidates.mjs "<brain>" "<sortie>"')
  process.exit(2)
}
if (!existsSync(SORTIE)) mkdirSync(SORTIE, { recursive: true })

const RACINE_CONDUITE = new Set(['claude.md', 'agents.md', 'readme.md', 'home.md', 'index.md'])
const IGNORE = ['.git', 'tooling', '_generated', 'graphify-out']

function toutesLesFiches(dir, base = '') {
  let out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.includes(e.name)) continue
    const rel = base === '' ? e.name : base + '/' + e.name
    if (e.isDirectory()) out = out.concat(toutesLesFiches(join(dir, e.name), rel))
    else if (e.name.endsWith('.md')) {
      const txt = readFileSync(join(dir, e.name), 'utf8')
      const tete = txt.slice(0, 1200)
      const tg = tete.match(new RegExp('^tags: *\\[(.*?)\\]', 'm'))
      const tags = new Set(
        tg ? tg[1].split(',').map((t) => t.trim().replace(/["']/g, '').toLowerCase()) : []
      )
      const h1 = tete.match(new RegExp('^# +(.+)$', 'm'))
      out.push({
        rel,
        txt,
        tags,
        seg: rel.toLowerCase().split('/'),
        titre: (h1 ? h1[1] : e.name.replace(/\.md$/, '')).trim()
      })
    }
  }
  return out
}

const a = (f, ...t) => t.some((x) => f.tags.has(x))

/* ─────────────── les axes de classement, chacun une hypothèse d'architecture ─────────────── */

/** B — par NATURE cognitive : ce qu'on sait faire, ce dont on se souvient, le terrain, le savoir. */
function parNature(f) {
  if (a(f, 'environnement', 'environment')) return 'Environnement et contraintes'
  if (f.seg[0] === 'integrations') return 'Environnement et contraintes'
  if (a(f, 'kit', 'process', 'preference')) return 'Comportement'
  if (f.seg[0] === 'governance') return 'Comportement'
  if (f.seg[1] === 'preferences') return 'Comportement'
  if (f.seg.length === 1 && RACINE_CONDUITE.has(f.seg[0])) return 'Comportement'
  if (a(f, 'decision-tracee', 'lesson')) return 'Mémoires'
  if (f.seg.includes('decisions') || f.seg.includes('lessons')) return 'Mémoires'
  if (a(f, 'code-map', 'area', 'relation', 'graphify')) return 'Code'
  if (f.seg[0] === 'projects' && !f.seg.includes('decisions')) return 'Code'
  if (f.seg.includes('rigapplication-documentation')) return 'Documentation'
  if (f.seg[0] === 'knowledge' || f.seg[0] === 'projects') return 'Savoir'
  if (f.seg[0] === 'inbox') return 'À trier'
  return 'Non classé'
}

/**
 * D — par INTENTION : non pas « de quelle nature est cette fiche » mais « qu'est-ce que je cherche à
 * faire ». Hypothèse concurrente de la nature : on n'interroge pas une base de connaissances pour
 * classer, on l'interroge pour AGIR ou pour COMPRENDRE.
 */
function parIntention(f) {
  if (a(f, 'environnement', 'environment')) return 'Ça a cassé — pourquoi, et ce que le terrain exige'
  if (f.seg[0] === 'integrations') return 'Ça a cassé — pourquoi, et ce que le terrain exige'
  if (a(f, 'kit', 'process', 'preference') || f.seg[0] === 'governance') return 'Comment on travaille ici'
  if (f.seg.length === 1 && RACINE_CONDUITE.has(f.seg[0])) return 'Comment on travaille ici'
  if (f.seg.includes('runbooks') || f.seg.includes('guides') || f.seg.includes('_templates'))
    return 'Je veux FAIRE quelque chose — pas à pas'
  if (a(f, 'decision-tracee') || f.seg.includes('decisions')) return 'On a déjà décidé — quoi, et pourquoi'
  if (a(f, 'lesson') || f.seg.includes('lessons')) return 'Ça a cassé — pourquoi, et ce que le terrain exige'
  if (a(f, 'code-map', 'area', 'relation', 'graphify')) return 'Où vit ce code'
  if (f.seg[0] === 'projects') return 'Où vit ce code'
  if (f.seg[0] === 'inbox') return 'Pas encore trié'
  return 'Je veux COMPRENDRE comment ça marche'
}

/** E — par SUJET : l'axe produit, celui auquel on pense spontanément. */
function parSujet(f) {
  const p = f.rel.toLowerCase()
  if (p.includes('autowin')) return 'Autowin OS'
  if (p.includes('portail') || p.includes('fiche_nouveau')) return 'Portail Amitel'
  if (p.includes('rig-tv') || p.includes('rigtv') || p.includes('testviewer')) return 'RIG-TV'
  if (a(f, 'kit', 'process') || f.seg[0] === 'governance') return 'Le kit et la façon de travailler'
  if (p.includes('brain') || f.seg[1] === '_maps') return 'Le Brain lui-même'
  if (p.includes('rig') || a(f, 'rig')) return 'RIG'
  if (f.seg[0] === 'inbox') return 'Pas encore trié'
  return 'Transverse'
}

/** F — hybride : le SUJET d'abord, l'INTENTION ensuite. Deux niveaux au lieu d'un. */
const parHybride = (f) => parSujet(f) + ' › ' + parIntention(f)

/* ─────────────────────────────── la banque de questions ─────────────────────────────── */

const QUESTIONS = [
  ['Sur quel serveur vit la base COMMUN_RIG ?', 'SQL-PROD.PROD'],
  ['Pourquoi un rebuild complet de RIG annonce exit 0 alors qu’il a échoué ?', 'faux exit=0'],
  ['Où copier une DLL EDI métier pour qu’elle soit réellement chargée ?', 'sous-dossier VERSIONN'],
  ['Quels câblages pour qu’un nouveau processus RIG apparaisse dans la console ?', 'HABILIT_ROLE_USER_PROCESSUS'],
  ['Pourquoi une transaction sur plusieurs connexions échoue-t-elle en silence ?', 'NetworkDtcAccess'],
  ['Comment ajouter un indicateur « N à traiter » sur l’écran d’accueil ?', 'DESCRIPTION_ALERTE'],
  ['Comment lire le partage réseau GED2 depuis Python ?', 'forward-slash|forward slash'],
  ['Quelles sont les conventions de nommage du code RIG ?', 'conventions de codage|convention de nommage'],
  ['Par quelles tables passe un flux EDI entrant ?', 'FLUX_ENTRANT'],
  ['Comment lancer Autowin OS en mode headless pour l’autovérification ?', 'headless'],
  ['Que fait le générateur de cartes Obsidian aux éditions humaines ?', 'préserve les éditions|preserve les editions'],
  ['Pourquoi Graphify ne produit-il pas de graphe sémantique du VB6 ?', 'VB6'],
  ['Comment un collaborateur démarre-t-il avec le Brain ?', 'onboarding|Onboarding'],
  ['Qui promeut une fiche de l’inbox vers knowledge ?', 'curation|brain_curate'],
  ['Quel est le contrat du RAG multi-harnais ?', 'multi-harnais'],
  ['Comment reconstruire RIG fidèlement à ses sources ?', 'fidélité|fidelite'],
  ['Où vivent les graphes de code, et lequel fait référence ?', 'snapshot canonique|gitignore'],
  ['Quelle est l’architecture du Brain Amitel ?', 'cerveau collaboratif|Obsidian . graphify|architecture'],
]

/* ───────────────────────────────── construction ───────────────────────────────── */

const fiches = toutesLesFiches(BRAIN)
const AXES = [
  ['A-dossiers', null],
  ['B-nature', parNature],
  ['C-plate', 'plate'],
  ['D-intention', parIntention],
  ['E-sujet', parSujet],
  ['F-hybride', parHybride]
]

const tailles = {}
for (const [nom, fn] of AXES) {
  let txt
  if (fn === null) {
    const m = new Map()
    for (const f of fiches) {
      const d = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '(racine)'
      m.set(d, (m.get(d) ?? 0) + 1)
    }
    txt =
      'Arborescence des dossiers du vault (dossier — nombre de fiches) :' +
      NL +
      [...m.entries()].sort().map(([d, n]) => `  ${d}/  (${n})`).join(NL)
  } else if (fn === 'plate') {
    txt =
      'Toutes les fiches du vault (chemin — titre) :' +
      NL +
      fiches.slice().sort((x, y) => x.rel.localeCompare(y.rel)).map((f) => `  ${f.rel} — ${f.titre}`).join(NL)
  } else {
    const m = new Map()
    for (const f of fiches) {
      const g = fn(f)
      if (!m.has(g)) m.set(g, new Map())
      const seg = f.rel.split('/')
      const sous = seg.length > 1 ? seg.slice(0, 2).join('/') : '(racine)'
      m.get(g).set(sous, (m.get(g).get(sous) ?? 0) + 1)
    }
    txt = 'Le Brain rangé ainsi (groupe — nombre de fiches) :' + NL
    for (const [g, sousM] of [...m.entries()].sort()) {
      const tot = [...sousM.values()].reduce((x, y) => x + y, 0)
      txt += NL + `${g} (${tot})` + NL + [...sousM.entries()].sort().map(([s, n]) => `    ${s}  (${n})`).join(NL) + NL
    }
  }
  writeFileSync(join(SORTIE, nom + '.txt'), txt, 'utf8')
  tailles[nom] = txt.length
  console.log(`  ${nom.padEnd(13)} ${String(txt.length).padStart(7)} car.`)
}

// Vérité-terrain : pour chaque question, les conteneurs qui contiennent VRAIMENT une réponse.
const verite = {}
const sansReponse = []
QUESTIONS.forEach(([q, motif], i) => {
  const re = new RegExp(motif, 'i')
  const rep = fiches.filter((f) => re.test(f.txt))
  if (rep.length === 0) {
    sansReponse.push(q)
    return
  }
  verite[i + 1] = {
    question: q,
    dossiers: [...new Set(rep.map((f) => (f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) + '/' : '(racine)')))].sort(),
    'B-nature': [...new Set(rep.map(parNature))].sort(),
    'D-intention': [...new Set(rep.map(parIntention))].sort(),
    'E-sujet': [...new Set(rep.map(parSujet))].sort(),
    'F-hybride': [...new Set(rep.map(parHybride))].sort(),
    fiches: rep.map((f) => f.rel).sort()
  }
})
writeFileSync(join(SORTIE, 'verite.json'), JSON.stringify({ verite, sansReponse, tailles }, null, 1), 'utf8')
writeFileSync(
  join(SORTIE, 'questions.txt'),
  Object.entries(verite).map(([n, v]) => `${n}. ${v.question}`).join(NL),
  'utf8'
)
console.log(NL + `questions retenues : ${Object.keys(verite).length} / ${QUESTIONS.length}`)
if (sansReponse.length > 0) {
  console.log('ÉCARTÉES faute de réponse dans le vault (trou de CONTENU, pas de navigation) :')
  for (const q of sansReponse) console.log('  · ' + q)
}
