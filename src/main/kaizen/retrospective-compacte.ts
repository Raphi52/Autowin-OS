/**
 * COMPACTER ET PAGINER LE DOSSIER DE `retrospective`.
 *
 * Mesure du 2026-09-18 sur conv-703 : 363 064 caracteres rendus pour 6 messages. Le gros ne dit
 * rien de neuf : chaque tour re-injecte les memes instructions systeme (64 180 caracteres par
 * tour), le meme etat de l'app, et la reponse du modele revient telle quelle dans les messages,
 * la trace causale et le journal des tours. Le tout partait dans le prompt, plafonne a 120 000.
 *
 * Deux gestes, tous deux DITS dans la sortie (jamais une coupe muette) :
 *  1. une chaine deja vue est remplacee par un renvoi « identique au tour N » ; un debut commun
 *     long est remplace par « N premiers caracteres identiques a … » suivi de ce qui differe ;
 *  2. le dossier compacte est rendu par PAGES d'environ 20 000 caracteres, la suite se demande
 *     avec l'argument `page`.
 */

/** Une chaine plus courte ne vaut pas un renvoi : le renvoi coute presque autant. */
const LONGUEUR_MIN_RENVOI = 300
/** Un debut commun plus court que ceci n'est pas une repetition d'injection, c'est du hasard. */
const PREFIXE_MIN_COMMUN = 400
export const TAILLE_PAGE_RETROSPECTIVE = 20_000

interface Vue {
  texte: string
  ref: string
}

function prefixeCommun(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

const LIBELLE = /^([\w-]{1,40}): /
const SUFFIXE_TRONQUE = '…[tronqué]'

function coeur(texte: string): { libelle: string; coeur: string } {
  const m = LIBELLE.exec(texte)
  const libelle = m ? m[0] : ''
  let c = texte.slice(libelle.length)
  if (c.endsWith(SUFFIXE_TRONQUE)) c = c.slice(0, -SUFFIXE_TRONQUE.length)
  return { libelle, coeur: c }
}

/**
 * Remplace, dans un objet JSON, toute longue chaine deja vue plus haut par un renvoi. L'ordre de
 * lecture fait foi : la PREMIERE occurrence reste en clair, les suivantes renvoient vers elle.
 * `tourDe` numerote les tours dans l'ordre d'apparition de leur `turnId`.
 */
export function dedupliquerDossier<T>(dossier: T): T {
  const vues: Vue[] = []
  const tours = new Map<string, number>()
  const numeroTour = (turnId: unknown): number | undefined => {
    if (typeof turnId !== 'string' || !turnId) return undefined
    if (!tours.has(turnId)) tours.set(turnId, tours.size + 1)
    return tours.get(turnId)
  }

  const traiter = (texte: string, chemin: string, tour: number | undefined): string => {
    if (texte.length < LONGUEUR_MIN_RENVOI) return texte
    const ref = tour ? `tour ${tour} (${chemin})` : chemin
    // 1. identique
    const exact = vues.find((v) => v.texte === texte)
    if (exact) return `[identique a ${exact.ref}]`
    // 2. deja contenu dans une chaine vue (reponse recopiee, extrait tronque d'un message)
    const { libelle, coeur: c } = coeur(texte)
    if (c.length >= LONGUEUR_MIN_RENVOI) {
      const hote = vues.find((v) => v.texte.includes(c))
      if (hote) return `${libelle}[identique a ${hote.ref}, ${c.length} car.]`
    }
    // 3. meme debut long (instructions systeme re-injectees a chaque tour), libelle ignore
    let meilleur: Vue | undefined
    let long = 0
    for (const v of vues) {
      const n = prefixeCommun(coeur(v.texte).coeur, c)
      if (n > long) {
        long = n
        meilleur = v
      }
    }
    vues.push({ texte, ref })
    if (meilleur && long >= PREFIXE_MIN_COMMUN) {
      return `${libelle}[${long} premiers car. identiques a ${meilleur.ref}]${c.slice(long)}`
    }
    return texte
  }

  /*
   * Le journal des tours range chaque evenement en JSON SERIALISE : son texte y est echappe et
   * ne ressemblerait jamais a sa copie en clair. On l'ouvre, on compacte dedans, on le referme.
   */
  const traiterChaine = (texte: string, chemin: string, tour: number | undefined): string => {
    if (texte.length >= LONGUEUR_MIN_RENVOI && texte.startsWith('{')) {
      try {
        const objet = JSON.parse(texte) as unknown
        if (objet && typeof objet === 'object') return JSON.stringify(marcher(objet, chemin, tour))
      } catch {
        /* JSON tronque par un plafond amont : on le traite comme du texte */
      }
    }
    return traiter(texte, chemin, tour)
  }

  const marcher = (valeur: unknown, chemin: string, tour: number | undefined): unknown => {
    if (typeof valeur === 'string') return traiterChaine(valeur, chemin, tour)
    if (Array.isArray(valeur)) return valeur.map((v, i) => marcher(v, `${chemin}[${i}]`, tour))
    if (valeur && typeof valeur === 'object') {
      const objet = valeur as Record<string, unknown>
      const t = numeroTour(objet.turnId) ?? tour
      const sortie: Record<string, unknown> = {}
      for (const [cle, v] of Object.entries(objet)) {
        sortie[cle] = marcher(v, chemin ? `${chemin}.${cle}` : cle, t)
      }
      return sortie
    }
    return valeur
  }
  return marcher(dossier, '', undefined) as T
}

export interface PageRetrospective {
  page: number
  pages: number
  caracteresTotal: number
  contenu: string
  note: string
}

/**
 * Coupe le dossier serialise en pages dont la forme ECHAPPEE (celle qui part dans le prompt, via
 * JSON.stringify du resultat) reste sous `taille`. Page 1 par defaut.
 */
export function paginerDossier(
  serialise: string,
  pageDemandee: number,
  taille: number = TAILLE_PAGE_RETROSPECTIVE
): PageRetrospective {
  const bornes: number[] = [0]
  const budget = Math.max(1000, taille - 1500) // marge pour la note et l'enveloppe
  let debut = 0
  while (debut < serialise.length) {
    let fin = Math.min(serialise.length, debut + budget)
    while (fin > debut + 1 && JSON.stringify(serialise.slice(debut, fin)).length > budget) {
      fin = debut + Math.floor((fin - debut) * 0.9)
    }
    bornes.push(fin)
    debut = fin
  }
  const pages = Math.max(1, bornes.length - 1)
  const page = Math.min(pages, Math.max(1, Math.floor(pageDemandee) || 1))
  const contenu = serialise.slice(bornes[page - 1], bornes[page] ?? serialise.length)
  return {
    page,
    pages,
    caracteresTotal: serialise.length,
    contenu,
    note:
      page < pages
        ? `Page ${page}/${pages} du dossier. La suite N'EST PAS dans ce resultat : rappelle ` +
          `retrospective avec page=${page + 1} avant de conclure sur ce qui manque.`
        : `Page ${page}/${pages} : fin du dossier.`
  }
}

/** Debut du resultat d'outil garde en clair : assez pour voir le succes, l'erreur ou la forme. */
export const DEBUT_RESULTAT_OUTIL = 300
const SEPARATEUR_RESULTAT = ' | tool-result: '

/**
 * Mesure du 2026-09-18 sur conv-703 : 30 appels d'outils pesaient 78 387 caracteres dans la
 * trace causale, soit le premier poste du dossier apres compaction. Pour relire un tour, la
 * COMMANDE lancee dit ce qui a ete tente ; du resultat, le debut suffit. On garde donc la commande
 * entiere et les DEBUT_RESULTAT_OUTIL premiers caracteres du resultat, en disant ce qui est coupe.
 */
export function resumerAppelsOutils<T extends { causalEvents?: Array<{ type?: string; payload?: string }> }>(
  dossier: T,
  debut: number = DEBUT_RESULTAT_OUTIL
): T {
  if (!Array.isArray(dossier.causalEvents)) return dossier
  return {
    ...dossier,
    causalEvents: dossier.causalEvents.map((event) => {
      if (event.type !== 'tool-call' || typeof event.payload !== 'string') return event
      const coupe = event.payload.indexOf(SEPARATEUR_RESULTAT)
      if (coupe < 0) return event
      const resultat = event.payload.slice(coupe + SEPARATEUR_RESULTAT.length)
      if (resultat.length <= debut) return event
      return {
        ...event,
        payload:
          event.payload.slice(0, coupe + SEPARATEUR_RESULTAT.length) +
          resultat.slice(0, debut) +
          `…[resultat coupe : ${resultat.length - debut} car. de plus]`
      }
    })
  }
}
