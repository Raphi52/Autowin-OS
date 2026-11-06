/**
 * UN BUREAU PAR TÂCHE, PAS UN PAR TENTATIVE.
 *
 * DÉFAUT MESURÉ le 2026-08-25 : `withIsolatedMutation` mint un identifiant de bureau par
 * `randomUUID()` à CHAQUE appel. Un tour qui a échoué dix fois sur la même édition a donc laissé
 * DIX bureaux, tous porteurs du même JSX non compilable, ~50 Mo pièce. La source des résidus n'est
 * pas l'échec : c'est qu'un échec fabrique un objet neuf au lieu de reprendre le sien.
 *
 * LA RÈGLE, tranchée par l'utilisateur le 2026-08-25 : réinitialiser le bureau à chaque tentative,
 * SAUF s'il contient du travail qu'aucune tentative précédente sur cette cible n'explique.
 *
 * Pourquoi ce « sauf » n'est pas une précaution décorative — les deux branches naïves sont
 * mauvaises, et c'est ce qui rendait la décision indécidable sans arbitrage :
 *   - hériter du contenu : la tentative suivante repart du code cassé de la précédente. Sur le cas
 *     réel, l'agent aurait hérité de son propre JSX déséquilibré à chaque essai ;
 *   - réinitialiser toujours : on détruit le contenu de la tentative précédente, ce qui viole la
 *     contrainte « aucune suppression de travail non trié ».
 *
 * Le « sauf » tranche entre les deux avec un critère VÉRIFIABLE : le bureau ne contient-il que des
 * fichiers que cette tâche était censée toucher ? Si oui, c'est le brouillon de l'essai précédent,
 * il peut repartir de zéro. Si non, il porte autre chose — on n'y touche pas, et la tentative va
 * ailleurs.
 */

/** Ce qu'il faut faire d'un bureau retrouvé au moment d'une nouvelle tentative. */
export type DecisionBureau = 'reinitialiser' | 'preserver'

/**
 * Identifiant STABLE d'un bureau, dérivé de la tâche et non du hasard.
 *
 * Deux tentatives de la même commande, sur la même cible, dans la même conversation, retombent sur
 * le même bureau. C'est tout le levier : sans cette stabilité, aucune réutilisation n'est possible
 * et le stock croît d'un objet par échec.
 *
 * La cible est normalisée (séparateurs et casse) parce que le même fichier arrive écrit de deux
 * façons selon l'appelant, et que deux écritures d'un même chemin fabriqueraient deux bureaux —
 * exactement le défaut qu'on corrige.
 */
/**
 * Longueur maximale d'une cle de bureau.
 *
 * CE N'EST PAS UNE COQUETTERIE : la cle nomme un DOSSIER (`<racine>/agent__<cle>`), donc elle
 * consomme le budget de chemin de Windows. Mesure le 2026-08-26 sur le depot reel — la cle
 * `command-edit-conv-1412-src-renderer-src-components-updatebanner-tsx` portait le bureau a 147
 * caracteres AVANT le fichier edite ; en ajoutant le fichier (~44) puis le cache que la verification
 * ecrit dans `node_modules/.vite/vitest/<hash>/results.json` (~65), on atteignait ~256 pour une
 * limite de 260. Les publications echouaient alors en `merge-failed : Filename too long`, REFUSANT
 * des editions saines, et le travail partait dans une `refs/autowin/rescue/…` que rien n'affiche.
 */
export const LONGUEUR_MAX_CLE_BUREAU = 64

/** Ce qui reste d'un texte une fois reduit aux caracteres surs pour un nom de dossier. */
function jetons(texte: string): string {
  return texte.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Empreinte courte et STABLE d'un chemin — stable entre deux executions, sinon la reutilisation
 * d'un bureau par tache (tout le levier anti-residus du 25/08) s'effondrerait.
 *
 * FNV-1a plutot qu'un hash cryptographique : ce module est pur et sans dependance, et on ne cherche
 * ici ni resistance aux collisions adverses ni secret — seulement a separer des chemins de projet.
 */
function empreinteStable(texte: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(7, '0').slice(0, 8)
}

export function cleDeBureau(
  commande: string,
  conversationId: string | undefined,
  cible: string | undefined
): string | undefined {
  const chemin = (cible ?? '').trim()
  // Sans cible, aucune identite de tache : l'appelant doit garder son identifiant aleatoire plutot
  // que de faire collisionner des taches distinctes sur un meme bureau.
  if (!chemin) return undefined
  // Separateur Windows -> POSIX. `String.fromCharCode(92)` evite un antislash echappe, illisible ici.
  const normalise = chemin.split(String.fromCharCode(92)).join('/').toLowerCase()
  /*
   * LA SIGNATURE DISTINGUE, LE LIBELLE RENSEIGNE — et il faut les deux.
   *
   * L'empreinte gardait les 60 DERNIERS caracteres du chemin. Deux defauts en un : elle n'etait
   * bornee que par ce nombre (une conversation a identifiant long debordait quand meme), et surtout
   * deux fichiers DIFFERENTS dont les queues de chemin coincident recevaient la MEME cle, donc le
   * MEME bureau. Verifie sur des chemins reels : `…/renderer/…/widgets/accueil/panneau-de-
   * configuration.tsx` et `…/main/…/widgets/accueil/panneau-de-configuration.tsx` etaient confondus.
   * Deux taches sans rapport ecrivant au meme endroit, c'est du travail ecrase.
   *
   * La signature porte le chemin ENTIER, donc elle separe ce que la queue confondait. Le libelle,
   * lui, ne sert qu'a l'oeil humain qui inspecte le dossier : un bureau que personne ne sait
   * rattacher a sa tache est un residu de plus.
   */
  const signature = empreinteStable(normalise)
  const fichier = jetons(normalise.slice(normalise.lastIndexOf('/') + 1)).slice(0, 24)
  // Tronquee par la QUEUE : c'est le numero qui distingue deux conversations, pas leur prefixe.
  const conversation = jetons((conversationId ?? 'sans-conversation').toLowerCase()).slice(-12)
  return `command-${commande}-${conversation}-${fichier}-${signature}`
}

/**
 * Le bureau retrouvé peut-il repartir de zéro, ou porte-t-il du travail à préserver ?
 *
 * `preserver` est le défaut prudent : tout ce qui n'est pas EXPLICITEMENT le brouillon de cette
 * tâche est laissé intact. Un bureau vide, lui, se réinitialise sans discussion — il n'y a rien à
 * perdre, et le préserver reviendrait à faire grossir le stock pour rien.
 */
export function decisionDeReutilisation(
  fichiersDuBureau: readonly string[],
  ciblesDeLaTache: readonly string[],
  /**
   * La liste des fichiers est-elle une CONSTATATION, ou l'echo d'une lecture qui a echoue ?
   *
   * Chemin destructeur trouve au cycle 2 de l'audit du 2026-08-26 : `apercuTravauxNonPublies`
   * enveloppe son `git diff` dans un catch muet qui laisse `fichiers = []`. Un index verrouille par
   * une session concurrente suffisait donc a faire lire « bureau vide » ici, donc `reinitialiser`,
   * donc `discardHeldAsync` — un bureau porteur de travail JETE sur une panne passagere, et le
   * commentaire de l'appelant precise « sans qu'aucun humain ne voie rien ».
   *
   * « Aucun fichier » et « on n'a pas pu lire » ne sont pas la meme chose. Le premier autorise a
   * reinitialiser, le second impose de preserver.
   */
  etat: { lectureEchouee?: boolean } = {}
): DecisionBureau {
  if (etat.lectureEchouee) return 'preserver'
  if (fichiersDuBureau.length === 0) return 'reinitialiser'
  const attendus = new Set(ciblesDeLaTache.map((c) => c.replace(/\\/g, '/').toLowerCase()))
  if (attendus.size === 0) return 'preserver'
  const tousAttendus = fichiersDuBureau.every((fichier) =>
    attendus.has(fichier.replace(/\\/g, '/').toLowerCase())
  )
  return tousAttendus ? 'reinitialiser' : 'preserver'
}
