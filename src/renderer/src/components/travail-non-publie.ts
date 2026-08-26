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

/** Au-delà, le prompt devient un mur : l'agent ira lire la liste complète lui-même. */
const TRAVAUX_CITES_DANS_LE_PROMPT = 12

/**
 * LE PROMPT que le bouton « Traiter » dépose dans une conversation neuve.
 *
 * POURQUOI il remplace l'ouverture d'une liste. L'utilisateur a cliqué « Traiter », lu la liste, et
 * demandé : « et après je fais quoi avec ça ? » — la question qui condamne l'ancien geste. La liste
 * montrait quatorze lignes et deux boutons par ligne sans dire ce qui était faisable. Un panneau qui
 * informe sans permettre d'agir ne fait que déplacer le problème sur l'utilisateur.
 *
 * Le prompt, lui, DÉLÈGUE : il donne l'inventaire, l'adresse de chaque travail, et l'état réel de la
 * question — y compris le fait qu'un simple réessai peut ne PAS suffire. Mesuré le 2026-08-24 : les
 * quatorze travaux de cette liste étaient tous refusés pour ascendance rompue, donc « Réintégrer »
 * échouait sur les quatorze, en silence. Le prompt demande donc un DIAGNOSTIC avant toute
 * republication, au lieu de promettre que ça va marcher.
 *
 * Il n'est PAS envoyé : l'utilisateur le lit et décide. Même règle que la vue Tickets, pour la même
 * raison — préparer un prompt qu'il ne voit pas serait inutile.
 */
export function promptTravauxNonPublies(entrees: readonly EntreeTravail[]): string | null {
  const enAttente = entrees.filter((entree) => entree.travailNonPublie === true)
  if (!enAttente.length) return null

  const lignes = enAttente.slice(0, TRAVAUX_CITES_DANS_LE_PROMPT).map((entree) => {
    const fichiers = entree.fichiersNonPublies ?? []
    const quoi = fichiers.length ? fichiers.join(', ') : '(fichiers inconnus)'
    const date = entree.dateNonPublie ? ` — ${entree.dateNonPublie}` : ''
    return `- autowin/recovery/${entree.agentId}${date} : ${quoi}`
  })
  const reste = enAttente.length - lignes.length

  return [
    `${enAttente.length} travaux terminés n’ont jamais été publiés. Chacun vit sur une branche de`,
    'secours : rien n’est perdu, mais rien n’arrive dans main non plus.',
    '',
    ...lignes,
    ...(reste > 0 ? [`- … et ${reste} autres.`] : []),
    '',
    'CE QU’IL FAUT FAIRE, dans cet ordre — et ne saute pas le premier point :',
    '',
    '1. DIAGNOSTIQUE avant de republier. Un réessai peut échouer PAR CONSTRUCTION : si la copie ne',
    '   descend pas du SHA de départ enregistré, aucune reprise ne passera jamais. Vérifie-le avec',
    '   git merge-base --is-ancestor <baseSha> <HEAD de la branche de secours> avant de promettre',
    '   quoi que ce soit.',
    '2. Republie ceux qui SONT publiables.',
    '3. Pour les autres, dis-moi POURQUOI et ce que tu proposes — fusion manuelle depuis la branche,',
    '   abandon assumé, ou autre. Ne supprime AUCUNE branche autowin/recovery/* : c’est le seul',
    '   endroit où ce travail existe encore.',
    '4. Rends un compte-rendu court : publiés, impubliables avec la raison, et ce qui reste.'
  ].join('\n')
}

/**
 * Un travail d'agent qui n'a pas rejoint la base. Vit ICI et non dans le composant : le type et son
 * libelle sont de la logique, pas du rendu.
 */
export interface TravailNonPublie {
  agentId: string
  date: string
  fichiers: string[]
}

/**
 * Le nom qu'un humain reconnait : ses fichiers. L'identifiant de copie ne dit rien a personne.
 *
 * Deplacee du composant : un fichier de composants qui exporte AUTRE CHOSE qu'un composant casse le
 * rechargement a chaud (`react-refresh`), et son test l'importait -- l'export etait donc necessaire,
 * seule sa place ne l'etait pas.
 */
export function libelleTravail(travail: TravailNonPublie): string {
  if (!travail.fichiers.length) return travail.agentId
  const premier = travail.fichiers[0]
  const reste = travail.fichiers.length > 1 ? ` +${travail.fichiers.length - 1} fichiers` : ''
  return `${premier}${reste}`
}
