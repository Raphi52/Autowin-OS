import { ConversationStore } from './conversations'

/**
 * UN BANC D'ESSAI OU LA RARETE SE CALIBRE.
 *
 * Trois fois le 2026-08-26, un test de recherche ecrit sur une douzaine de conversations a donne un
 * verdict FAUX -- dans les deux sens. Un correctif mesure bon sur le corpus reel y echouait ; un autre
 * y passait alors qu'il ne servait a rien. La cause est arithmetique et non anecdotique : `rarete`
 * vaut `log(1 / part) / log(messagesVus + 1)`. Sur treize messages, le denominateur vaut 2,6 et
 * l'ecart entre un mot vu une fois et un mot vu douze fois se compresse au point de ne plus rien
 * separer. Sur sept mille, il vaut 8,9 et la fonction discrimine.
 *
 * Ce banc reproduit le PROFIL du corpus reel mesure le meme jour -- 1203 conversations, 7495 messages,
 * cinq messages par conversation en mediane, longueurs aux quartiles 92 / 120 / 564 -- a une echelle
 * suffisante pour que les index se comportent comme en production, et assez petite pour qu'un test
 * reste rapide.
 *
 * CE QU'IL NE FAIT PAS ENCORE, mesure le 2026-08-26 et ecrit ici pour ne pas etre redecouvert : il ne
 * reproduit pas la CONCURRENCE LEXICALE du corpus reel. Son vocabulaire de bruit tient en quinze mots,
 * la ou le reel en compte des milliers. Consequence observee : un mot d'adresse comme « rappelle », qui
 * sur le corpus reel EXISTE et capte le re-classement au detriment du sujet, est ici absent du bruit --
 * le re-classement reste donc neutre et le score decide correctement. Les quatre formulations qui
 * echouaient en reel (48 a 71 sur 120) passent toutes sur ce banc.
 *
 * Autrement dit : ce banc suffit a falsifier ce qui depend de la CALIBRATION de la rarete, pas ce qui
 * depend de la RICHESSE du vocabulaire. Pour ce second usage, il faudrait peupler le bruit de mots
 * semi-rares en concurrence avec le sujet -- et c'est ce qui manque pour tester le bonus de tete.
 *
 * Il est DETERMINISTE : meme graine, meme corpus. Un banc d'essai qui bouge entre deux executions ne
 * falsifie rien.
 */

/** Generateur pseudo-aleatoire deterministe (xorshift32) : pas de `Math.random` dans un test. */
function graine(depart: number): () => number {
  let etat = depart | 0 || 1
  return () => {
    etat ^= etat << 13
    etat ^= etat >>> 17
    etat ^= etat << 5
    return ((etat >>> 0) % 100000) / 100000
  }
}

/** Vocabulaire courant : ces mots peuplent le bruit et doivent devenir NON discriminants. */
const COURANT = [
  'projet',
  'travail',
  'decide',
  'ensemble',
  'avance',
  'reunion',
  'version',
  'client',
  'equipe',
  'semaine',
  'demande',
  'reponse',
  'question',
  'contexte',
  'resultat'
]

export interface BancOptions {
  /** Combien de conversations de bruit. 250 suffit a calibrer la rarete ; 1200 imite le reel. */
  conversations?: number
  /** Graine du generateur : changer la graine change le corpus, pas son profil. */
  seed?: number
}

/**
 * Construit un magasin peuple de bruit realiste. Les conversations utiles sont ajoutees ENSUITE par
 * l'appelant, avec `ajouterConversation`, pour que le test dise clairement ce qu'il met en jeu.
 */
export function bancDEssai(options: BancOptions = {}): ConversationStore {
  const nombre = options.conversations ?? 250
  const alea = graine(options.seed ?? 20260826)
  let horloge = 1_000_000
  const store = new ConversationStore(() => horloge++)

  for (let i = 0; i < nombre; i++) {
    const conversation = store.create({ title: `Bruit ${i}`, provider: 'claude' })
    // Cinq messages en mediane, comme le corpus reel.
    const messages = 3 + Math.floor(alea() * 5)
    for (let m = 0; m < messages; m++) {
      // Longueurs aux quartiles du reel : un quart court, la moitie moyen, un quart long.
      const tirage = alea()
      const cible = tirage < 0.25 ? 92 : tirage < 0.75 ? 120 : 564
      const mots: string[] = []
      while (mots.join(' ').length < cible) {
        mots.push(COURANT[Math.floor(alea() * COURANT.length)])
      }
      store.append(conversation.id, {
        role: m % 2 === 0 ? 'user' : 'assistant',
        content: mots.join(' ')
      })
    }
  }
  return store
}

/** Ajoute une conversation nommee, dont le contenu est ecrit par le test. */
export function ajouterConversation(
  store: ConversationStore,
  titre: string,
  contenus: string[]
): string {
  const conversation = store.create({ title: titre, provider: 'claude' })
  for (const [index, contenu] of contenus.entries()) {
    store.append(conversation.id, {
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: contenu
    })
  }
  return conversation.id
}

/** Un long remplissage neutre, pour placer un terme dans un message de taille realiste. */
export function remplissage(caracteres = 600): string {
  const bloc = 'contexte technique sans rapport particulier avec la demande. '
  return bloc.repeat(Math.ceil(caracteres / bloc.length))
}
