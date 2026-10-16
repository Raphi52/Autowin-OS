/**
 * L'ENTREE DES ELEMENTS QUAND ON CHANGE DE VUE — la « Cascade » choisie par l'utilisateur
 * (conv-987, 2026-10-16, direction 1 du draft « animations d'entree ») : chaque bloc de la vue monte
 * de 8 px en apparaissant, de haut en bas, un tous les 40 ms. Avant, la page entiere se fondait d'un
 * coup (conv-981) et les elements n'avaient aucune entree propre.
 *
 * POURQUOI DU CODE ET PAS UN SELECTEUR CSS : les dix vues n'ont pas la meme profondeur. Mesure du
 * 16/10 (instance cachee) — Task Manager : en-tete, bandeau, puis deux colonnes un niveau plus bas ;
 * Knowledge : deux emballages a enfant unique avant la barre et la scene ; Chat : deux colonnes dont
 * les lignes vivent trois niveaux sous la racine. Un `> * > *` fixe animait un seul bloc geant dans
 * certaines vues et des miettes dans d'autres. On descend donc dans les GRANDS conteneurs et les
 * en-tetes, et chaque bloc trouve prend son rang dans l'ordre de lecture (haut, puis gauche).
 *
 * Le marquage est un ATTRIBUT (pas une classe) : React reecrit `className` d'un element quand sa
 * prop change, il ne touche pas un attribut qu'il ne gere pas. Il est RETIRE a la fin de l'entree de
 * chaque bloc : une animation de `translate` qui reste remplie garderait l'element compose a part, et
 * un contenu monte plus tard (donnees arrivees apres coup) ne doit pas rejouer l'entree.
 */
export const ATTRIBUT_ENTREE = 'data-entree-cascade'
/** Ecart entre deux blocs consecutifs (maquette : 40 ms). */
export const PAS_MS = 40
/** Duree de l'entree d'un bloc (maquette : 260 ms) — app-shell.css la porte, le test les lie. */
export const DUREE_MS = 260
/**
 * Rang le plus tardif : au-dela, les blocs entrent ensemble. Une liste de 30 conversations ne doit
 * pas faire attendre 1,2 s le dernier bloc ; 7 x 40 + 260 = 540 ms au pire, comme la maquette.
 */
export const RANG_MAX = 7

/** Un enfant plus haut que cette part de la vue est un conteneur de mise en page : on y descend. */
const PART_CONTENEUR = 0.4
/**
 * ... SAUF s'il se PEINT (fond, bord, ombre) : c'est alors une carte, qui entre d'un seul bloc avec
 * son contenu. Y descendre laissait son cadre en place pendant que son contenu montait — l'effet
 * « squelette » (direction 6), pas la cascade choisie ; mesure du 16/10 sur l'Accueil : les poignees
 * d'angle d'une tuile entraient comme des blocs a part. Seule une COLONNE entiere (Chat : liste des
 * conversations, fil) reste un conteneur malgre son fond : sinon la vue n'aurait que deux blocs.
 */
const PART_COLONNE = 0.7
/** Plus petit qu'un carre de 16 px (poignee, separateur, glyphe) : on le laisse en place. */
const TAILLE_MIN = 16
const PROFONDEUR_MAX = 4
/** Deux blocs dont le haut differe de moins que ceci sont sur la meme ligne : gauche d'abord. */
const MEME_LIGNE_PX = 6

type Boite = { top: number; left: number; bottom: number; width: number; height: number }

function boite(e: Element): Boite {
  const r = e.getBoundingClientRect()
  return { top: r.top, left: r.left, bottom: r.bottom, width: r.width, height: r.height }
}

const TRANSPARENT = /^(?:|transparent|rgba\(\s*0,\s*0,\s*0,\s*0\s*\))$/

/** L'element dessine-t-il un cadre a lui (fond, image de fond, ombre ou bord) ? */
function peint(e: Element): boolean {
  const s = e.ownerDocument.defaultView?.getComputedStyle(e)
  if (!s) return false
  const bord = (['Top', 'Right', 'Bottom', 'Left'] as const).some(
    (cote) =>
      parseFloat(s[`border${cote}Width`]) > 0 &&
      s[`border${cote}Style`] !== 'none' &&
      !TRANSPARENT.test(s[`border${cote}Color`])
  )
  return (
    !TRANSPARENT.test(s.backgroundColor) ||
    (!!s.backgroundImage && s.backgroundImage !== 'none') ||
    (!!s.boxShadow && s.boxShadow !== 'none') ||
    bord
  )
}

/** Les blocs de la vue `racine`, en ordre de lecture. Vue sans mise en page = aucun bloc. */
export function blocsDeCascade(racine: Element): Element[] {
  const vue = boite(racine)
  if (vue.width < 2 || vue.height < 2) return []
  const visibles = (parent: Element): Array<{ e: Element; b: Boite }> =>
    Array.from(parent.children)
      .map((e) => ({ e, b: boite(e) }))
      .filter(
        ({ b }) =>
          b.width >= TAILLE_MIN &&
          b.height >= TAILLE_MIN &&
          b.bottom > vue.top &&
          b.top < vue.top + vue.height
      )

  const trouves: Array<{ e: Element; b: Boite }> = []
  const visiter = (parent: Element, profondeur: number): number => {
    let n = 0
    for (const enfant of visibles(parent)) {
      const sous = profondeur < PROFONDEUR_MAX ? visibles(enfant.e) : []
      const emballage =
        sous.length === 1 &&
        sous[0].b.width * sous[0].b.height >= 0.9 * enfant.b.width * enfant.b.height
      const conteneur =
        sous.length > 0 &&
        (emballage ||
          enfant.e.tagName === 'HEADER' ||
          enfant.b.height >= PART_CONTENEUR * vue.height) &&
        (enfant.b.height >= PART_COLONNE * vue.height || !peint(enfant.e))
      if (conteneur && visiter(enfant.e, profondeur + 1) > 0) {
        n += 1
        continue
      }
      trouves.push(enfant)
      n += 1
    }
    return n
  }
  visiter(racine, 0)

  return trouves
    .sort((a, b) =>
      Math.abs(a.b.top - b.b.top) <= MEME_LIGNE_PX ? a.b.left - b.b.left : a.b.top - b.b.top
    )
    .map(({ e }) => e)
}

/** Le nom des keyframes dans app-shell.css : seule leur fin libere un bloc. */
export const NOM_ANIMATION = 'entree-cascade'
/**
 * Filet de securite si aucune fin d'animation n'arrive (bloc demonte en cours de route). LONG a
 * dessein : la fin NORMALE est l'evenement `animationend`, jamais une minuterie. Une minuterie calee
 * sur 540 ms partait au montage de la vue, alors que l'animation ne demarre qu'a la premiere image —
 * apres le montage, parfois lourd (graphe 3D de Knowledge) : elle coupait l'entree en plein vol.
 */
export const SECOURS_MS = 5000

type Entree = {
  racine: Element
  restants: Set<Element>
  surFin: (evenement: Event) => void
  minuterie: ReturnType<typeof setTimeout>
}
let enCours: Entree | null = null

function liberer(bloc: Element): void {
  bloc.removeAttribute(ATTRIBUT_ENTREE)
  ;(bloc as HTMLElement).style?.removeProperty('--entree-rang')
}

function effacer(): void {
  if (!enCours) return
  const { racine, restants, surFin, minuterie } = enCours
  enCours = null
  clearTimeout(minuterie)
  racine.removeEventListener('animationend', surFin)
  racine.removeEventListener('animationcancel', surFin)
  restants.forEach(liberer)
}

/**
 * Joue la cascade sur la vue qui vient d'apparaitre. Appelee APRES que la vue est dans le DOM et
 * affichee (les rectangles en dependent), avant la peinture : aucun bloc ne se montre une image
 * a sa place finale puis disparait. Une nouvelle entree efface la precedente (clics rapides).
 */
export function jouerEntreeCascade(racine: Element): void {
  effacer()
  const blocs = blocsDeCascade(racine)
  if (!blocs.length) return
  blocs.forEach((bloc, rang) => {
    ;(bloc as HTMLElement).style?.setProperty('--entree-rang', String(Math.min(rang, RANG_MAX)))
    bloc.setAttribute(ATTRIBUT_ENTREE, '')
  })
  const restants = new Set(blocs)
  // Les fins d'animation REMONTENT jusqu'a la racine ; celles des animations propres d'un
  // descendant (spinner, pulsation) portent un autre nom et sont ignorees.
  const surFin = (evenement: Event): void => {
    const bloc = evenement.target as Element
    if ((evenement as AnimationEvent).animationName !== NOM_ANIMATION || !restants.has(bloc)) return
    restants.delete(bloc)
    liberer(bloc)
    if (!restants.size) effacer()
  }
  racine.addEventListener('animationend', surFin)
  racine.addEventListener('animationcancel', surFin)
  enCours = { racine, restants, surFin, minuterie: setTimeout(effacer, SECOURS_MS) }
}
