/**
 * Fonctions des capsules d'artefact (libellé, poids, adresse affichable, légende des vignettes),
 * partagées par ArtifactPreview.tsx et ArtifactPile.tsx.
 *
 * Module à part et non exports des composants : une fonction exportée depuis un fichier de
 * composant casse le rechargement à chaud (règle `react-refresh/only-export-components`).
 */
import type { ArtifactKind, ChatArtifact } from '../../../shared/artifacts'
import { isChatMediaUrl } from '../../../shared/chat-media'

const LABELS: Record<ArtifactKind, string> = {
  image: 'Image',
  vector: 'Vecteur',
  markdown: 'Markdown',
  text: 'Texte',
  code: 'Code',
  diff: 'Diff',
  'structured-data': 'Données',
  table: 'Tableau',
  diagram: 'Diagramme',
  pdf: 'PDF',
  document: 'Document',
  presentation: 'Présentation',
  spreadsheet: 'Tableur',
  notebook: 'Notebook',
  audio: 'Audio',
  video: 'Vidéo',
  web: 'Web',
  archive: 'Archive',
  model3d: '3D',
  font: 'Police',
  executable: 'Exécutable',
  binary: 'Binaire'
}

/**
 * Le libellé ne doit pas AFFIRMER une génération que rien ne prouve : une image publiée par un
 * outil (capture, lecture de fichier) n'est pas une image produite par le modèle. On nomme donc
 * l'outil quand il existe, et on ne dit « générée » que pour une sortie directe du modèle.
 */
export function kindLabel(artifact: ChatArtifact): string {
  const base = LABELS[artifact.kind]
  if (artifact.kind !== 'image' && artifact.kind !== 'vector') return base
  if (artifact.source.tool) return `${base} · ${artifact.source.tool}`
  return `${base} générée`
}

/**
 * Un nom qui ne fait que REDIRE le libellé de la capsule n'est pas affiché à côté d'elle
 * (conv-195 : « image-Read » en petit à côté de « Image · Read », « image envoyée » à côté de
 * « Image envoyée »). Les nouveaux artefacts lus portent le nom du fichier (claude.ts), mais ceux
 * déjà enregistrés gardent leur nom fabriqué : on compare donc sans casse ni séparateurs.
 */
export function nomRepeteLeLibelle(nom: string, libelle: string): boolean {
  const aplatir = (texte: string): string =>
    texte
      .toLowerCase()
      .replace(/[\s·_-]+/g, ' ')
      .trim()
  return aplatir(nom) === aplatir(libelle)
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export function inlineDataUrl(artifact: ChatArtifact): string | undefined {
  if (artifact.url?.startsWith('data:')) return artifact.url
  // Vidéo/son conservés : adresse lue par plages depuis le disque (`chat-media-protocol.ts`).
  if (isChatMediaUrl(artifact.url)) return artifact.url
  if (artifact.content === undefined || artifact.encoding !== 'base64') return undefined
  return `data:${artifact.mimeType};base64,${artifact.content}`
}

const SEPARATEUR = /[^\p{L}\p{N}]/u

/**
 * Ce qui DISTINGUE chaque nom des autres, pour la légende des vignettes : le préfixe et le suffixe
 * communs sont retirés (« l560-onglet-11.png », « l560-onglet-6.png » → « 11 », « 6 »). La coupe se
 * fait sur un séparateur, jamais au milieu d'un mot ou d'un nombre (« a-10 », « a-11 » ne donnent pas
 * « 0 » et « 1 »). Si un nom n'a plus rien de propre, les noms entiers sont rendus.
 */
export function partiesDistinctes(noms: readonly string[]): string[] {
  if (noms.length < 2) return [...noms]
  const plusCourt = Math.min(...noms.map((nom) => nom.length))
  const premier = noms[0]
  let prefixe = 0
  while (prefixe < plusCourt && noms.every((nom) => nom[prefixe] === premier[prefixe])) prefixe += 1
  // Recule jusqu'au dernier séparateur du préfixe commun, inclus.
  let coupeDebut = 0
  for (let i = prefixe - 1; i >= 0; i -= 1) {
    if (SEPARATEUR.test(premier[i])) {
      coupeDebut = i + 1
      break
    }
  }
  let suffixe = 0
  while (
    suffixe < plusCourt - coupeDebut &&
    noms.every((nom) => nom[nom.length - 1 - suffixe] === premier[premier.length - 1 - suffixe])
  )
    suffixe += 1
  // Avance jusqu'au premier séparateur du suffixe commun, inclus.
  let coupeFin = 0
  const finCommune = premier.slice(premier.length - suffixe)
  for (let i = 0; i < finCommune.length; i += 1) {
    if (SEPARATEUR.test(finCommune[i])) {
      coupeFin = finCommune.length - i
      break
    }
  }
  const parties = noms.map((nom) => nom.slice(coupeDebut, nom.length - coupeFin))
  return parties.some((partie) => partie.length === 0) ? [...noms] : parties
}
