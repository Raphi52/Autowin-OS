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
 * ENRICHI le meme jour pour repondre a ce manque : le bruit tire desormais deux tiers de ses mots
 * d'une queue longue de 40 000 formes, et seme rarement des mots d'ADRESSE. Profil obtenu sur 250
 * conversations : ~7 000 mots distincts, 48 % d'hapax (55,6 % en reel), et « rappelle » a une
 * frequence documentaire de l'ordre de dix, contre quatre en reel -- il concurrence donc vraiment le
 * sujet, ce qu'un bruit de quinze mots ne permettait pas.
 *
 * ET LE TROISIEME ETAT, ajoute ensuite : un terme ni present ni absent, mais NOYE dans ses propres
 * variantes. Le bruit applique desormais des SUFFIXES aux mots de la queue, si bien que ~1 200 formes
 * y sont rares en token exact et repandues en sous-chaine -- le cas d'« ecriture », deux conversations
 * en token contre 94 en sous-chaine. C'est ce qui manquait pour que le banc FASSE ECHOUER une
 * recherche comme le reel la fait echouer ; un test le verifie explicitement.
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

/**
 * Les mots d'ADRESSE, ceux qui ouvrent une demande sans en porter le sujet.
 *
 * Ils sont ici pour une raison mesuree : dans le corpus reel, « rappelle » a une frequence
 * documentaire de QUATRE -- exactement la tranche des termes qu'on cherche (deux a cinq
 * conversations). C'est pourquoi il rivalise avec eux, et c'est ce qu'un bruit de quinze mots
 * courants ne pouvait pas reproduire. Ils sont donc semes rarement, pour tomber dans cette tranche.
 */
const ADRESSE = ['rappelle', 'retrouve', 'souviens', 'cherche', 'redis']

/**
 * Les SUFFIXES qui fabriquent des variantes d'un meme radical.
 *
 * Sans eux, un terme cherche est soit present soit absent, jamais NOYE. Le corpus reel connait ce
 * troisieme etat et c'est le plus difficile : « ecriture » n'a que deux conversations en token exact
 * mais 94 en sous-chaine -- ecritures, ecriturier, reecriture. Le re-classement compte par
 * sous-chaine ; sans variantes dans le bruit, il ne rencontre jamais ce cas.
 */
const SUFFIXES = ['', '', '', 's', 'e', 'es', 'er', 'ion', 'ure', 'ment', 'able']

/**
 * Un vocabulaire de remplissage a queue longue, comme le corpus reel.
 *
 * Profil mesure le 2026-08-26 sur 1203 conversations : 29 524 mots distincts, dont 55,6 % presents
 * dans UNE seule conversation, 27,5 % dans deux a cinq, 11,1 % dans six a vingt. Un bruit uniforme de
 * quinze mots ne cree aucune concurrence ; c'est cette queue qui la fait.
 */
function vocabulaire(alea: () => number, taille: number): string[] {
  const syllabes = ['ta', 'ro', 'mi', 'ka', 'lu', 'se', 'pi', 'no', 'dra', 'vel', 'sim', 'qua']
  const mots: string[] = []
  for (let i = 0; i < taille; i++) {
    let mot = ''
    const n = 2 + Math.floor(alea() * 3)
    for (let s = 0; s < n; s++) mot += syllabes[Math.floor(alea() * syllabes.length)]
    mots.push(mot)
  }
  return mots
}

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

  // Une queue TRES longue : il faut que la majorite des mots n'apparaisse qu'une fois, comme dans le
  // reel (55,6 % du vocabulaire y est un hapax). Avec 3 000 mots pour ~37 000 tirages, chaque mot
  // ressortait six a vingt fois et la queue n'en etait plus une -- mesure du 2026-08-26.
  const queue = vocabulaire(alea, 40000)
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
        const tirageMot = alea()
        // Un tiers de mots courants, deux tiers tires de la queue longue : c'est elle qui cree la
        // concurrence lexicale, et sans elle un mot d'adresse ne rivalise avec rien.
        if (tirageMot < 0.34) mots.push(COURANT[Math.floor(alea() * COURANT.length)])
        else {
          const radical = queue[Math.floor(alea() * queue.length)]
          mots.push(radical + SUFFIXES[Math.floor(alea() * SUFFIXES.length)])
        }
      }
      // Les mots d'adresse sont semes RAREMENT, pour atterrir dans la tranche de frequence des
      // termes qu'on cherche -- deux a cinq conversations, comme « rappelle » dans le corpus reel.
      if (alea() < 0.02) mots.unshift(ADRESSE[Math.floor(alea() * ADRESSE.length)])
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
