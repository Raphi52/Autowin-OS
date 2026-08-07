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
      if (f.endsWith('.md')) trouvees.push({ projet: projet.name, fichier: join(dossier, f), nom: f })
    }
  }
  return trouvees
}

const runs = texteDesRuns(RUNS).split(new RegExp(ANTISLASH + 's+', 'g')).join(' ')
const notes = notesMoissonnees()
const manquements = []

for (const note of notes) {
  const texte = readFileSync(note.fichier, 'utf8')
  const parts = texte.split('---')
  const entete = parts[1] ?? ''
  const corps = parts.slice(2).join('---')

  // 1. Une source, non vide. Sans elle la note n'est plus traçable.
  const source = entete.match(new RegExp('sources: ' + ANTISLASH + '[(.*)' + ANTISLASH + ']'))
  if (!source || !source[1].trim()) {
    manquements.push(note.nom + ' : AUCUNE SOURCE')
    continue
  }

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
    manquements.push(note.nom + ' : ' + inventees.length + ' ligne(s) INTROUVABLE(S) dans les RUN.md')
  }

  // 3. Corps borné : au-delà, la note redevient un dépotoir.
  if (corps.length > PLAFOND_CARACTERES) {
    manquements.push(note.nom + ' : corps de ' + corps.length + ' caractères (plafond ' + PLAFOND_CARACTERES + ')')
  }
}

// 4. Couverture par projet, affichée y compris les zéros — un compteur honnête à zéro informe.
const parProjet = new Map()
for (const note of notes) parProjet.set(note.projet, (parProjet.get(note.projet) ?? 0) + 1)
console.log('notes moissonnées contrôlées : ' + notes.length)
for (const [projet, n] of [...parProjet.entries()].sort()) console.log('  ' + projet + ' : ' + n)

if (manquements.length > 0) {
  console.log('MANQUEMENTS :')
  for (const m of manquements) console.log('  - ' + m)
  process.exit(1)
}
console.log('CONTRÔLE VERT : aucune invention, chaque note sourcée, chaque corps borné.')
process.exit(0)
