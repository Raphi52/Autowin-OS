// CONTRÔLE des notes moissonnées : aucune invention, une source par note, un corps borné.
//
// Pourquoi un script et non un test du dépôt : ces notes vivent sur le partage d'équipe
// (\\ged2\rig\Projets IA\Amitel Brain). Un test unitaire qui lirait ce partage serait instable ici et
// échouerait chez un collègue hors VPN. Le contrôle est donc explicite et rejouable à la demande.
//
// Usage : node scripts/verifier-notes-moissonnees.mjs "<racine du brain>"
// Sort non-zero au premier manquement : c'est un contrôle, pas un rapport.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const ANTISLASH = String.fromCharCode(92)
const BRAIN = process.argv[2]
const RUNS = join(process.env.USERPROFILE ?? '', '.claude', 'runs')
/** Plafond du corps d'une note. L'étagement corps/pointeurs avait coupé 66 % des tokens : une note
 *  qui déborde redevient un dépotoir, et la récupération se dégrade. */
const PLAFOND_CARACTERES = 4000
/**
 * Signatures que les moissonneurs écrivent dans le bloc de traçabilité des notes qu'ils produisent.
 * Ce sont elles qui délimitent le périmètre du contrôle — pas une date, qui vieillirait mal.
 *
 * Il y en a DEUX parce que les deux lots ont été écrits par deux passes de formulations différentes.
 * N'en garder qu'une réduisait silencieusement le contrôle à 62 notes sur 92 : les 30 du premier lot
 * passaient à travers. C'est un compteur honnête — « lues » distinct de « réellement contrôlées » —
 * qui l'a rendu visible ; le total seul l'aurait caché.
 */
const SIGNATURES = ['moissonnée le', 'tracée dans son `RUN.md`']

if (!BRAIN || !existsSync(BRAIN)) {
  console.log('racine du brain introuvable : ' + BRAIN)
  process.exit(2)
}

/** Tout le texte des RUN.md de la machine, concaténé : la matière dont les notes sont issues. */
function texteDesRuns(dir, depth = 0) {
  if (depth > 3) return ''
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return ''
  }
  let texte = ''
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) texte += texteDesRuns(full, depth + 1)
    else if (e.name === 'RUN.md') texte += readFileSync(full, 'utf8') + NL
  }
  return texte
}

function notesMoissonnees() {
  const trouvees = []
  const projets = join(BRAIN, 'projects')
  for (const projet of readdirSync(projets, { withFileTypes: true })) {
    if (!projet.isDirectory()) continue
    const dossier = join(projets, projet.name, 'obsidian', 'decisions')
    if (!existsSync(dossier)) continue
    for (const f of readdirSync(dossier)) {
      if (f.endsWith('.md'))
        trouvees.push({ projet: projet.name, fichier: join(dossier, f), nom: f })
    }
  }
  // Les décisions qui n'appartiennent à AUCUN dépôt vivent dans `knowledge/decisions/`, groupées par
  // `scope`. Elles sont moissonnées de la même façon, donc elles méritent le même contrôle : sans ça
  // le contrôle certifierait une moitié du travail en ignorant l'autre.
  const horsDepot = join(BRAIN, 'knowledge', 'decisions')
  if (existsSync(horsDepot)) {
    for (const f of readdirSync(horsDepot)) {
      if (!f.endsWith('.md')) continue
      const fichier = join(horsDepot, f)
      const scope = readFileSync(fichier, 'utf8').match(new RegExp('^scope: (.+)$', 'm'))
      trouvees.push({
        projet: 'knowledge/' + (scope ? scope[1].trim() : 'sans-scope'),
        fichier,
        nom: f
      })
    }
  }
  return trouvees
}

const runs = texteDesRuns(RUNS)
  .split(new RegExp(ANTISLASH + 's+', 'g'))
  .join(' ')
const notes = notesMoissonnees()
const manquements = []
/** Notes que ce contrôle ne garde PAS, mais qu'il refuse de taire : signalées, non comptées en échec. */
const horsPerimetre = []
let controlees = 0

for (const note of notes) {
  const texte = readFileSync(note.fichier, 'utf8')
  const parts = texte.split('---')
  const entete = parts[1] ?? ''
  const corps = parts.slice(2).join('---')

  // 1. Une source, non vide. Sans elle la note n'est plus traçable.
  //    DEUX formes coexistent dans ce Brain, et toutes deux sont légitimes : `sources: [...]` (liste)
  //    dans les notes de projet, `source: "..."` (chaîne) dans `knowledge/`. Ma première version ne
  //    connaissait que la liste et déclarait « AUCUNE SOURCE » sur 58 notes correctement sourcées —
  //    ainsi que sur une note préexistante. Le contrôle avait tort, pas les notes.
  const enListe = entete.match(new RegExp('sources: ' + ANTISLASH + '[(.*)' + ANTISLASH + ']'))
  const enChaine = entete.match(new RegExp('^source: *(.+)$', 'm'))
  const source = (enListe && enListe[1]) || (enChaine && enChaine[1]) || ''
  const sourceVide = !source.replace(new RegExp('["' + ANTISLASH + ANTISLASH + 's]', 'g'), '')

  // Ce contrôle garde les notes que LE MOISSONNEUR a produites, reconnaissables à la signature qu'il
  // écrit dans leur bloc de traçabilité. Les autres notes du Brain viennent de fichiers, de lectures
  // de code, d'autres agents, ou de sessions dont le `RUN.md` n'est pas sur cette machine : leur
  // exiger un corps retrouvable ici serait un faux échec, et j'aurais fini par désarmer le contrôle
  // entier pour faire taire un bruit qui n'était pas un défaut.
  //
  // Un discriminant plus large — « la source contient `session:` » — ne suffisait PAS : deux notes
  // préexistantes portent une source de session légitime dont le run n'existe pas ici.
  if (!SIGNATURES.some((sig) => corps.includes(sig))) {
    if (sourceVide) horsPerimetre.push(note.nom + ' (aucune source — note préexistante)')
    continue
  }
  if (sourceVide) {
    manquements.push(note.nom + ' : AUCUNE SOURCE')
    continue
  }
  controlees += 1

  // 2. Le corps de la décision doit se RETROUVER dans un RUN.md. C'est le contrôle anti-invention :
  //    une phrase que la machine n'a jamais tracée n'a pas sa place ici.
  const avantTracabilite = corps.split('## Traçabilité')[0]
  const lignes = avantTracabilite
    .split(NL)
    .map((l) => l.trim())
    .filter((l) => l.length > 45 && !l.startsWith('#'))
  const inventees = lignes.filter(
    (l) => !runs.includes(l.split(new RegExp(ANTISLASH + 's+', 'g')).join(' '))
  )
  if (inventees.length > 0) {
    manquements.push(
      note.nom + ' : ' + inventees.length + ' ligne(s) INTROUVABLE(S) dans les RUN.md'
    )
  }

  // 3. Corps borné : au-delà, la note redevient un dépotoir.
  if (corps.length > PLAFOND_CARACTERES) {
    manquements.push(
      note.nom + ' : corps de ' + corps.length + ' caractères (plafond ' + PLAFOND_CARACTERES + ')'
    )
  }
}

// 4. Couverture par projet, affichée y compris les zéros — un compteur honnête à zéro informe.
const parProjet = new Map()
for (const note of notes) parProjet.set(note.projet, (parProjet.get(note.projet) ?? 0) + 1)
console.log('notes lues : ' + notes.length + ' | RÉELLEMENT contrôlées : ' + controlees)
for (const [projet, n] of [...parProjet.entries()].sort()) console.log('  ' + projet + ' : ' + n)

if (horsPerimetre.length > 0) {
  console.log('hors périmètre de ce contrôle, mais à savoir (' + horsPerimetre.length + ') :')
  for (const h of horsPerimetre) console.log('  · ' + h)
}

if (manquements.length > 0) {
  console.log('MANQUEMENTS :')
  for (const m of manquements) console.log('  - ' + m)
  process.exit(1)
}
console.log('CONTRÔLE VERT : aucune invention, chaque note sourcée, chaque corps borné.')
process.exit(0)
