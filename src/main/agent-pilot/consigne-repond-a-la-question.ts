import { replier } from '../../shared/mots'
import { normaliserReponsesAsk } from '../chat/ask-options'

/**
 * UNE CONSIGNE ARRIVÉE PENDANT LE TOUR RÉPOND-ELLE À LA QUESTION QUE CE TOUR POSE ?
 *
 * L'utilisateur peut répondre avant que la carte n'apparaisse : il lit les options dans le texte
 * qui défile, ou clique pendant que le tour se termine. Mais il envoie aussi, pendant qu'un tour
 * travaille, des ajustements sans rapport. Mesuré le 20/11 : « dans la vidéo elle doit prononcer
 * … » a été pris pour le choix d'hébergement ; la question n'est jamais apparue et le choix est
 * resté ouvert.
 *
 * Vrai seulement quand la consigne DÉSIGNE une option : son libellé ou son texte d'envoi (le clic),
 * un fragment de libellé tapé, un numéro (« 2 », « la 2 », « option 2 ») ou une forme de choix
 * (« les deux », « aucune », « la première »). Le doute vaut « non » : la carte s'affiche et la
 * consigne est traitée. Une carte de trop coûte un coup d'œil ; une question avalée coûte la décision.
 */
export function consigneRepondALaQuestion(
  consigne: string,
  args: Record<string, unknown>
): boolean {
  const options = normaliserReponsesAsk(args.options).map((o) =>
    [o.libelle, o.envoi].filter((t): t is string => Boolean(t)).map(plier)
  )
  if (options.length === 0) return false
  // Plusieurs consignes arrivées dans le même tour sont jointes par « / » (reponse-du-tour.ts).
  return consigne.split(' / ').some((partie) => designeUneOption(plier(partie), options))
}

const plier = (texte: string): string =>
  replier(texte)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const FORME_DE_CHOIX =
  /^(?:les deux|tous|toutes|tout|aucun|aucune|ni l un ni l autre|(?:la |le |l )?(?:premier|premiere|deuxieme|second|seconde|troisieme|quatrieme|cinquieme|dernier|derniere))$/
const NUMERO =
  /^(?:plutot |je prends |je choisis |on prend )?(?:la |le |l |option |choix |reponse )?(\d{1,2})$/

/** Un fragment tapé désigne une option s'il est assez long pour ne pas être un mot courant. */
const FRAGMENT_MINIMAL = 8

function designeUneOption(consigne: string, options: string[][]): boolean {
  if (!consigne) return false
  if (FORME_DE_CHOIX.test(consigne)) return true
  const numero = NUMERO.exec(consigne)
  if (numero) return Number(numero[1]) >= 1 && Number(numero[1]) <= options.length
  // Comparaison sur des mots entiers : « oui » ne doit pas se trouver dans « ouistiti ».
  const contient = (long: string, court: string): boolean => ` ${long} `.includes(` ${court} `)
  return options.some((textes) =>
    textes.some(
      (texte) =>
        texte === consigne ||
        (texte.length >= 3 && contient(consigne, texte)) ||
        (consigne.length >= FRAGMENT_MINIMAL && contient(texte, consigne))
    )
  )
}
