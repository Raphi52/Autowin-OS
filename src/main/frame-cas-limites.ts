/**
 * UN CADRAGE QUI DECRIT UNE ENTREE SANS EN ENUMERER LES CAS LIMITES NE PASSE PAS A LA SUITE.
 *
 * Meme geste que `scout-cible.ts`, sur un autre defaut mesure : la garde est de FORME (les cas
 * sont-ils enumeres, oui ou non), jamais de qualite — producteur et juge etant le meme modele,
 * seule une verification de forme est falsifiable.
 *
 * CE QUI JUSTIFIE LA GARDE, mesure hors modele. Banc `arena-bench-ax3` (2026-09-07) : 6 agents
 * lances en UNE vague, 3 repliques par bras, meme tache, meme critere comportemental de 30
 * assertions, copies de travail conservees.
 *   - bras `a`, enonce SANS cas limites enumeres : 0 vert sur 3. Defauts REELS, pas lexicaux — les
 *     3 repliques avalent `--jours 7 --jours 0` en silence (code 0), 2 sur 3 jettent une pile Node
 *     sur `--jours 200000000`.
 *   - bras `x`, memes mots + la LISTE des cas limites en prose : 3 verts sur 3 (30/30).
 * Separation parfaite, p = 0,10 (le plancher atteignable a n=3) ; l'ecart de cout inter-bras
 * (x3,12) depasse largement la dispersion intra-bras (+45 % / +20 %). Journal : `arena-duels.jsonl`.
 *
 * DEUX ETAGES, comme pour la cible du scout :
 *  1. CONVENTION — `skills/frame/SKILL.md` etape 4 bis demande la rubrique. Ecrite seule, une regle
 *     n'engage rien : elle est suivie ou non (c'est exactement ce que le bras `a` montre).
 *  2. GARDE DETERMINISTE — ce module, accroche dans le trajet de phase de l'orchestrateur.
 *
 * ET CE QUI LE DISTINGUE DE `scout-cible.ts` : ici le blocage ROUTE. La sortie porte `SUITE: frame`,
 * ligne que `readModelChoice` lit deja et que le marcheur honore — le cadrage repasse par `frame`
 * au lieu d'etre transmis incomplet. Un simple avertissement en tete ne suffisait pas : le bras `a`
 * du banc AVAIT l'enonce complet du defaut et a quand meme laisse passer trois cas limites.
 *
 * LE MEME CONTROLE EN LIGNE DE COMMANDE : `node scripts/frame-cas-limites-check.mjs <RUN.md>`
 * (exit 1 = refus). Les deux implementations sont tenues d'accord par un test de contrat
 * (`frame-cas-limites.contrat.test.ts`) : une divergence de regle est rouge, pas silencieuse.
 *
 * PUR : pas d'horloge, pas de provider, aucune E/S.
 */

/** Minimum de cas enumeres pour que la rubrique soit autre chose qu'un alibi. */
export const CAS_MINIMUM = 3

/** Marque du blocage deja pose — rend l'application idempotente. */
const MARQUE = '⛔ Cadrage incomplet'

/**
 * Signes qu'un besoin decrit une ENTREE utilisateur, donc qu'il y a des cas limites a enumerer.
 * Volontairement large : la garde doit se declencher par defaut, pas seulement sur les CLI.
 */
const MARQUEURS_ENTREE: RegExp[] = [
  /(^|[^\w-])--[a-z][\w-]*/i,
  /\b(argument|parametre|paramètre|option|drapeau|flag|saisie|champ|formulaire|input)\b/i,
  /\b(valeur|entree|entrée)\s+(saisie|fournie|passee|passée|utilisateur)\b/i,
  /\b(requete|requête|payload|query\s?string|variable d'environnement)\b/i
]

const TITRE_RUBRIQUE = /^\s{0,3}(#{2,6}\s*)?cas\s+limites?\b.*$/i
/** Dispense EXPLICITE et motivee — un simple silence n'en est pas une. */
const DISPENSE = /^\s*cas\s+limites?\s*:\s*(sans objet|aucun)\b.*[-—:]\s*\S+/i

/** La section `## Besoin`, ou le texte entier si le livrable n'est pas structure. */
function sectionBesoin(texte: string): string {
  const lignes = (texte ?? '').split('\n')
  const debut = lignes.findIndex((l) => /^##\s+Besoin\b/i.test(l))
  if (debut === -1) return texte ?? ''
  let fin = lignes.length
  for (let i = debut + 1; i < lignes.length; i++) {
    if (/^##\s+/.test(lignes[i]!)) {
      fin = i
      break
    }
  }
  return lignes.slice(debut, fin).join('\n')
}

/** Les cas limites reellement enumeres sous la rubrique, dans l'ordre du texte. */
export function casLimitesEnumeres(texte: string): string[] {
  const lignes = sectionBesoin(texte).split('\n')
  const debut = lignes.findIndex((l) => TITRE_RUBRIQUE.test(l))
  if (debut === -1) return []
  const cas: string[] = []
  for (let i = debut + 1; i < lignes.length; i++) {
    const l = lignes[i]!
    if (/^\s{0,3}#{2,6}\s/.test(l)) break
    if (/^\s*([-*]|\d+[.)])\s+\S/.test(l)) cas.push(l.trim())
  }
  return cas
}

/** Le besoin decrit-il une entree utilisateur ? */
function decritUneEntree(texte: string): boolean {
  const besoin = sectionBesoin(texte)
  return MARQUEURS_ENTREE.some((re) => re.test(besoin))
}

/**
 * Ce que la phase suivante doit lire en TETE quand les cas limites manquent — ou `undefined`
 * quand le cadrage est complet, dispense, ou sans entree utilisateur.
 */
export function enteteCasLimitesManquants(texte: string): string | undefined {
  const brut = texte ?? ''
  if (brut.includes(MARQUE)) return undefined
  const besoin = sectionBesoin(brut)
  if (besoin.split('\n').some((l) => DISPENSE.test(l))) return undefined
  const cas = casLimitesEnumeres(brut)
  if (cas.length >= CAS_MINIMUM) return undefined
  const rubriquePresente = besoin.split('\n').some((l) => TITRE_RUBRIQUE.test(l))
  if (!rubriquePresente && !decritUneEntree(brut)) return undefined
  const constat = rubriquePresente
    ? `la rubrique « Cas limites » existe mais n'enumere que ${cas.length} cas`
    : "le besoin decrit une entree utilisateur et n'enumere AUCUN cas limite"
  return (
    `${MARQUE} — ${constat} ; il en faut au moins ${CAS_MINIMUM}.\n` +
    "Ce cadrage n'est PAS transmis en l'etat. Mesure hors modele (banc arena-bench-ax3, 3 repliques) : " +
    'un enonce sans cas limites donne 0 correctif conforme sur 3, le meme enonce avec la liste en donne 3 sur 3.\n' +
    "Reprends le cadrage : ajoute sous `## Besoin` une rubrique `### Cas limites d'entree` listant au " +
    'moins trois cas AVEC le comportement attendu (absente · vide · mal typee · hors bornes ' +
    '(zero, negatif, enorme) · repetee · nominale). Aucune entree a border ? Ecris-le en clair : ' +
    '`Cas limites : sans objet — <raison>`.\n' +
    'SUITE: frame'
  )
}

/**
 * La sortie de `frame` telle qu'elle doit etre ENREGISTREE et portee a la suite.
 * Inchangee quand les cas limites sont la. Sinon le refus est mis en TETE : le seul endroit qui
 * survit a la projection de `phase-carry.ts` ET a la troncature.
 */
export function sortieFrameAvecCasLimites(texte: string): string {
  const entete = enteteCasLimitesManquants(texte)
  return entete ? `${entete}\n\n${texte ?? ''}` : texte
}
