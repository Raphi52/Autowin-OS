import { existsSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'

/**
 * LE RANGEMENT D'UNE CONVERSATION DEDUIT DE SON PREMIER MESSAGE.
 *
 * LE DEFAUT QUE CECI CORRIGE (conv-611, 2026-09-16) : une conversation ouverte alors que le dossier
 * actif etait `D:\BrainRotRoyale`, dont le premier message parlait des bureaux virtuels d'Autowin,
 * est restee rangee au mauvais endroit jusqu'a un deplacement a la main. `depotCiteDansLeMessage`
 * ne rattrape pas ce cas : l'utilisateur NOMME son projet, il n'ecrit pas son chemin.
 *
 * On ne DEVINE pas pour autant : le choix se fait uniquement parmi des dossiers DEJA connus du
 * poste (ceux ou l'utilisateur a deja range une conversation), sur une correspondance de NOM
 * lisible dans le message, et seulement si UN SEUL candidat sort. Aucun modele n'est appele : la
 * decision doit etre rejouable et gratuite. Un doute ne range pas — basculer a tort est pire.
 *
 * N'ecrit QUE `projectPath` : une `categorie` est une taxonomie que l'utilisateur invente, elle ne
 * se devine pas (dissociation des deux champs, store/conversations.ts:1784).
 */

/** Longueur minimale du fragment de nom a retrouver dans le message. En dessous, trop de collisions. */
const MIN_FRAGMENT = 6

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Score d'un dossier face au message : longueur du plus long PREFIXE de son nom present dans le
 * message normalise. « Autowin » dans le message reconnait ainsi `D:\AutoWinOS` (7), alors que
 * `D:\BrainRotRoyale` ne marque rien. 0 = pas de correspondance.
 */
function score(nomDossier: string, messageNormalise: string): number {
  const nom = normaliser(nomDossier)
  for (let taille = nom.length; taille >= MIN_FRAGMENT; taille--) {
    if (messageNormalise.includes(nom.slice(0, taille))) return taille
  }
  return 0
}

function memeDossier(a: string, b: string): boolean {
  const propre = (chemin: string): string =>
    resolve(chemin)
      .replace(/[\\/]+$/, '')
      .toLowerCase()
  return propre(a) === propre(b)
}

/**
 * Rend le dossier a ranger sur la conversation, ou `null` quand rien n'est sur.
 *
 * `dossiersConnus` : les dossiers deja utilises sur ce poste. `dossierActif` : celui du tour — s'il
 * gagne, il n'y a rien a changer. Un ex aequo rend `null` (message ambigu).
 */
export function dossierDeduitDuPremierMessage(
  message: string,
  dossiersConnus: readonly string[],
  dossierActif: string,
  existe: (chemin: string) => boolean = existsSync
): string | null {
  const texte = normaliser(message)
  if (!texte) return null
  let meilleur: { chemin: string; points: number } | null = null
  let exAequo = false
  for (const brut of dossiersConnus) {
    const candidat = brut?.trim()
    if (!candidat || !isAbsolute(candidat)) continue
    const chemin = resolve(candidat)
    if (!existe(chemin)) continue
    const points = score(basename(chemin), texte)
    if (points === 0) continue
    if (!meilleur || points > meilleur.points) {
      meilleur = { chemin, points }
      exAequo = false
    } else if (points === meilleur.points && !memeDossier(chemin, meilleur.chemin)) {
      exAequo = true
    }
  }
  if (!meilleur || exAequo) return null
  if (dossierActif.trim() && memeDossier(meilleur.chemin, dossierActif)) return null
  return meilleur.chemin
}

/** Ce dont la decision a besoin du monde reel. Injectable pour la jouer VRAIMENT dans un test. */
export type DepsRangementPremierMessage = {
  /** La conversation visee, ou `null` si elle n'existe plus. */
  conversation: { projectPath?: string; messages: { role: string; content: unknown }[] } | null
  /** Les dossiers deja utilises sur ce poste. */
  dossiersConnus: readonly string[]
  /** Les categories (libelles de la barre laterale) deja utilisees sur ce poste. */
  categoriesConnues?: readonly string[]
  /** Le dossier dans lequel le tour partirait sans rangement. */
  dossierActif: string
  /** Une categorie posee a la main interdit le rangement automatique. */
  categorie?: string
  ranger: (chemin: string) => void
  annoncer: (message: string) => void
  existe?: (chemin: string) => boolean
  /**
   * L'appel de modele court. Absent (aucun modele cable, tests hors-ligne) -> on retombe sur la
   * correspondance de nom, moins fine mais gratuite.
   */
  demanderAuModele?: EnvoyerAuModele
  /**
   * La fin du tour lance par ce premier message, quand le rangement tourne A COTE de la reponse
   * au lieu de la faire attendre (index.ts, `runPilotChat`). Seul un rangement qui DEPLACE le
   * dossier de travail l'attend : voir `rangerConversationSurLePremierMessage`.
   */
  finDuTour?: Promise<unknown>
  /**
   * Relit l'etat COURANT de la conversation avant d'ecrire. Pendant l'appel au modele, l'utilisateur,
   * l'agent (`classer_conversation`) ou la bascule par chemin cite ont pu la ranger : leur choix prime.
   */
  toujoursNonRangee?: () => boolean
}

/**
 * Applique le rangement au premier message : decide, range, ANNONCE. Rend le dossier applique, ou
 * `null` si rien n'a bouge. Un echec de `ranger`/`annoncer` est avale : un rangement rate ne doit
 * JAMAIS empecher le tour de partir.
 *
 * LA REPONSE N'ATTEND PLUS CE RANGEMENT (2026-09-26, conv-867). L'appel au modele coutait ~5 s
 * AVANT le premier mot de chaque nouvelle conversation, et ce trou faisait afficher un faux
 * « Reponse interrompue avant la fin » (conv-809, conv-862). Il tourne desormais a cote du tour.
 * Consequence assumee : un rangement qui DEPLACE le dossier de travail n'est applique qu'une fois
 * ce premier tour fini — les outils du tour relisent ce dossier a chaque appel (index.ts,
 * `workspace: dossierDuTour`), et un tour a cheval sur deux depots serait pire qu'un tour dans
 * l'ancien. Mesure du 2026-09-26 : 0 rangement de ce type sur 22 (19 categories, 3 meme dossier).
 *
 * fix-ok: le cablage n'etait prouve que par lecture du TEXTE de index.ts (objection majeure du
 * controle) ; la decision + l'effet vivent desormais ici, joues pour de vrai dans le test.
 */
export async function rangerConversationSurLePremierMessage(
  deps: DepsRangementPremierMessage
): Promise<string | null> {
  const { conversation } = deps
  if (!conversation) return null
  if (conversation.projectPath?.trim() || deps.categorie?.trim()) return null
  const messagesUtilisateur = conversation.messages.filter((m) => m.role === 'user')
  if (messagesUtilisateur.length > 1) return null
  const texte = messagesUtilisateur[0]?.content
  if (typeof texte !== 'string' || !texte.trim()) return null
  // Le modele TRANCHE quand il est cable : il juge le sujet, la ou le nom seul rate conv-611 et
  // bascule a tort sur une mention en passant. Sans modele, le lexical reste le filet hors-ligne.
  const deduit = deps.demanderAuModele
    ? await dossierDeduitParModele(
        texte,
        deps.dossiersConnus,
        deps.dossierActif,
        deps.demanderAuModele,
        deps.existe ?? existsSync,
        deps.categoriesConnues ?? []
      )
    : dossierDeduitDuPremierMessage(
        texte,
        deps.dossiersConnus,
        deps.dossierActif,
        deps.existe ?? existsSync
      )
  if (!deduit) return null
  const deplaceLeTravail = isAbsolute(deduit) && !memeDossier(deduit, deps.dossierActif || deduit)
  const differe = deplaceLeTravail && deps.finDuTour !== undefined
  if (differe) await Promise.resolve(deps.finDuTour).catch(() => undefined)
  if (deps.toujoursNonRangee && !deps.toujoursNonRangee()) return null
  try {
    deps.ranger(deduit)
    deps.annoncer(
      !isAbsolute(deduit)
        ? `📂 Ta demande porte sur « ${deduit} » : je range cette conversation dans ce dossier de la ` +
            `liste. Le dossier de travail ne change pas. Si ce n'est pas le bon, change-le dans la liste des conversations.`
        : !deplaceLeTravail
          ? `📂 Cette conversation n'était rangée nulle part : je la range dans ${deduit}, ` +
            `le dossier sur lequel porte ta demande. Le dossier de travail ne change pas. ` +
            `Si ce n'est pas le bon, change-le dans la liste des conversations.`
          : differe
            ? `📂 Ta demande parle de ${deduit}, et cette conversation n'était pas encore rangée : ` +
              `cette première réponse a travaillé dans ${deps.dossierActif}. Je la range dans ${deduit} ` +
              `pour la suite — tes prochains messages y travailleront, avec son AGENTS.md. ` +
              `Si ce n'est pas le bon dossier, change-le dans la liste des conversations.`
            : `📂 Ta demande parle de ${deduit}, et cette conversation n'était pas encore rangée ` +
              `(elle partait dans ${deps.dossierActif}). Je la range là et j'y travaille — c'est son AGENTS.md qui sera lu. ` +
              `Si ce n'est pas le bon dossier, change-le dans la liste des conversations.`
    )
    return deduit
  } catch {
    return null
  }
}

/**
 * CE QUE LA CORRESPONDANCE DE NOM NE SAIT PAS FAIRE (audit du 2026-09-16, conv-612).
 *
 * Le vrai premier message de conv-611 — « /kaizen mes travaux en paralele se parasitent car ils
 * utilise pas mon systeme de bureau virtuel » — n'ecrit NULLE PART « Autowin ». Le score lexical
 * rend donc 0 : le cas fondateur n'etait pas resolu, et le test qui pretendait le couvrir avait
 * reecrit le message. Symetriquement, « rien a voir avec AutoWinOS, parle moi de cuisine » faisait
 * basculer le dossier de travail sur une simple mention en passant.
 *
 * Un nom present ou absent ne dit rien du SUJET. On demande donc au modele — un seul appel court,
 * sur le premier message seulement, avec les MEMES gardes que le routeur de conversations :
 * JSON strict, seuil de confiance, et un choix borne aux dossiers existants. Le lexical reste la
 * voie hors-ligne quand aucun modele n'est cable.
 */
export const RANGEMENT_CONFIANCE_MIN = 0.85

export const RANGEMENT_SYSTEM = `Tu ranges une conversation d’Autowin OS, d’apres son PREMIER message.
Deux rangements existent : un DOSSIER de projet (un chemin, qui devient aussi le dossier de travail) et une CATEGORIE (un simple libelle de la barre laterale, ex. « Autowin OS »).
Reponds uniquement avec un objet JSON : {"rangement":"<valeur exacte copiee d’une des deux listes, ou vide>","confiance":0.0,"motif":""}

Regles :
- "rangement" doit etre COPIE a l’identique depuis la liste « dossiers » ou la liste « categories », ou vide si aucun ne convient ;
- la CATEGORIE PASSE D’ABORD : des qu’un libelle de « categories » correspond au sujet, choisis-le, meme si la demande porte sur du code. Ne choisis un DOSSIER que si AUCUN libelle ne convient ;
- juge le SUJET du message, pas la presence d’un nom : un message qui parle du systeme de bureaux virtuels d’Autowin appartient au dossier d’Autowin meme s’il ne l’ecrit jamais ;
- une simple MENTION en passant, une negation (« rien a voir avec X »), ou un message trop vague ne justifient AUCUN dossier : renvoie vide ;
- confiance >= ${RANGEMENT_CONFIANCE_MIN} seulement quand le rattachement est net ; en dessous, la conversation reste ou elle est.`

/** Le seul contact avec le monde : envoyer un prompt court et rendre le texte brut de la reponse. */
export type EnvoyerAuModele = (systeme: string, message: string) => Promise<string>

/**
 * Rend le dossier choisi par le modele, ou `null`. Un choix hors liste, une confiance trop basse,
 * un JSON illisible ou une panne du modele rendent tous `null` : le doute ne range pas.
 */
export async function dossierDeduitParModele(
  message: string,
  dossiersConnus: readonly string[],
  /**
   * Le dossier du tour. GARDE bien qu'inutilise ici : contrairement a la voie lexicale, la decision
   * du modele ne l'ecarte PAS (voir plus bas), et le retirer casserait les appels existants.
   */
  _dossierActif: string,
  envoyer: EnvoyerAuModele,
  existe: (chemin: string) => boolean = existsSync,
  categoriesConnues: readonly string[] = []
): Promise<string | null> {
  const candidats = [
    ...new Set(
      dossiersConnus
        .map((brut) => brut?.trim())
        .filter((c): c is string => Boolean(c) && isAbsolute(c))
        .map((c) => resolve(c))
        .filter((c) => existe(c))
    )
  ]
  // Les CATEGORIES ne sont pas des chemins : aucune verification d'existence a faire, elles n'ont
  // d'existence que dans la liste des conversations. `rangerDansDossier` route sur la forme de la
  // valeur (store/conversations.ts:1789) — un libelle ecrit `categorie`, un chemin `projectPath`.
  const libelles = [
    ...new Set(
      categoriesConnues
        .map((brut) => brut?.trim())
        .filter((c): c is string => Boolean(c) && !isAbsolute(c))
    )
  ]
  if (candidats.length + libelles.length === 0 || !message.trim()) return null
  let texte: string
  try {
    texte = await envoyer(
      RANGEMENT_SYSTEM,
      JSON.stringify({
        premierMessage: message.slice(0, 2_000),
        dossiers: candidats,
        categories: libelles
      })
    )
  } catch {
    return null
  }
  const bloc = texte?.match(/\{[\s\S]*\}/)
  if (!bloc) return null
  let choisi: string
  let confiance: number
  try {
    const parsed = JSON.parse(bloc[0]) as Record<string, unknown>
    const brut = parsed.rangement ?? parsed.dossier
    choisi = typeof brut === 'string' ? brut.trim() : ''
    confiance = typeof parsed.confiance === 'number' ? parsed.confiance : 0
  } catch {
    return null
  }
  if (!choisi || !Number.isFinite(confiance) || confiance < RANGEMENT_CONFIANCE_MIN) return null
  const libelle = libelles.find((c) => c.toLowerCase() === choisi.toLowerCase())
  if (libelle) return libelle
  const retenu = candidats.find((c) => memeDossier(c, choisi))
  if (!retenu) return null
  // LA CATEGORIE PASSE AVANT LE DOSSIER, et pas seulement dans la consigne du modele : celui-ci a
  // choisi D:\AutoWinOS alors que la categorie « Autowin OS » existait et designait la meme chose
  // (mesure du 2026-09-16, conv-619, motif rendu : « du code du projet, donc du dossier »). Quand
  // le nom du dossier et un libelle existant designent la MEME chose une fois normalises, on prend
  // le libelle : c'est le rangement que l'utilisateur pose lui-meme a la main.
  const equivalent = libelles.find((c) => normaliser(c) === normaliser(basename(retenu)))
  if (equivalent) return equivalent
  // PAS d'exclusion « c'est deja le dossier actif » ici, contrairement a la voie lexicale.
  // Mesure du 2026-09-16 (sonde, conv-618) : le modele rendait bien D:\AutoWinOS a 0,88, et la
  // decision etait jetee parce que ce dossier etait AUSSI le dossier actif — mais seulement par
  // REPLI (`dossierDeTravailDuTour`, index.ts:959), la conversation n'etant rangee nulle part.
  // Ecrire le rangement le rend VISIBLE dans la liste ; le dossier de travail, lui, ne bouge pas.
  return retenu
}
