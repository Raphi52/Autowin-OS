/**
 * DIRE qu'un travail fini n'a jamais été publié.
 *
 * Mesuré le 2026-08-23 : trois travaux terminés, testés et prouvés ont été perdus de vue le même
 * jour — un fond d'écran d'accueil, un correctif d'historique, un export Markdown. Chacun dormait
 * sur une branche `autowin/recovery/<id>` que personne n'a fusionnée, pendant que l'utilisateur
 * écrivait « T'as toujours pas fais le fond d'ecran de l'accueuil ». Le travail existait ; rien ne
 * le lui disait, et un run bloqué à la publication s'affiche en ROUGE — donc comme un échec.
 *
 * Ce message ne répare rien et n'accuse personne : il dit qu'il y a quelque chose à aller chercher,
 * et où. Un avertissement sans adresse n'est pas une information, c'est une inquiétude.
 */
export interface EntreeTravail {
  agentId: string
  travailNonPublie?: boolean
  fichiersNonPublies?: string[]
  dateNonPublie?: string
}

/**
 * Le nom SOUS lequel l'humain reconnait un travail. Le sujet du commit de secours repete l'UUID de
 * la copie -- verifie sur les 14 branches le 2026-08-23 -- donc il n'aide pas. Le fichier touche,
 * lui, se reconnait au premier coup d'oeil. A defaut, on retombe sur la branche : moins parlant,
 * mais toujours une adresse ou aller voir.
 */
function nommer(entree: EntreeTravail): string {
  const fichiers = entree.fichiersNonPublies ?? []
  const date = entree.dateNonPublie ? ` (${entree.dateNonPublie})` : ''
  if (!fichiers.length) return `autowin/recovery/${entree.agentId}`
  const premier = fichiers[0].split('/').pop() ?? fichiers[0]
  const reste = fichiers.length > 1 ? ` +${fichiers.length - 1}` : ''
  return `${premier}${reste}${date}`
}

/** Au-delà, le bandeau devient un mur que plus personne ne lit. */
const BRANCHES_CITEES = 3

export function messageTravailNonPublie(entrees: readonly EntreeTravail[]): string | null {
  const enAttente = entrees.filter((entree) => entree.travailNonPublie === true)
  if (!enAttente.length) return null

  /*
   * DEDOUBLONNER les exemples, pas le compte. Vu a l'ecran le 2026-08-23 : « brain-trace-spool.test.ts,
   * brain-trace-spool.test.ts, brain-trace-spool.ts » -- trois places, une seule information. Les
   * reprises d'un meme travail produisent plusieurs branches ; les montrer toutes gache le peu de
   * place disponible. Le TOTAL, lui, reste celui des branches reelles : c'est ce qu'il y a a aller
   * chercher, et le minorer serait mentir dans l'autre sens.
   */
  const vus = new Set<string>()
  const branches: string[] = []
  for (const entree of enAttente) {
    const nom = nommer(entree)
    if (vus.has(nom)) continue
    vus.add(nom)
    branches.push(nom)
    if (branches.length === BRANCHES_CITEES) break
  }
  const reste = enAttente.length - branches.length
  const quantite = enAttente.length === 1 ? '1 travail terminé' : `${enAttente.length} travaux terminés`

  return (
    `${quantite} n’${enAttente.length === 1 ? 'a' : 'ont'} jamais été publié${enAttente.length === 1 ? '' : 's'} : ` +
    branches.join(', ') +
    (reste > 0 ? ` et ${reste} autres` : '') +
    '.'
  )
}
