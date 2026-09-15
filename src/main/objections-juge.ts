/**
 * LES OBJECTIONS DU JUGE NE SE PERDENT PAS DANS UN VERT.
 *
 * Le brief du juge (`phase-briefs.ts`) impose une section `OBJECTIONS:` APRÈS le verdict, et
 * « - aucune » quand il n'y en a pas. Jusqu'ici, seule la première ligne (`VALIDE` / `DEFAUT:`)
 * était lue : un juge qui validait EN LISTANT des écarts concrets fermait le run en vert, et ces
 * écarts n'étaient jamais corrigés — l'utilisateur récupérait un livrable dont les défauts étaient
 * écrits noir sur blanc dans la trace.
 *
 * Ce lecteur extrait ces objections pour que la boucle de réparation B5 (déjà en place) s'en
 * saisisse comme de n'importe quel refus : corriger, puis rejuger.
 *
 * fix-ok: conv-539 tour 24e29815-0cbd-4310-8cda-93207e237015 — juge « VALIDE SCORE 68 » avec objections
 * jamais remises a la reparation ; puis « Aucune capture... » jete comme liste vide (e8da1596, a1243dbe).
 */
const ENTETE_OBJECTIONS = /^\s*objections?\s*:/i
/** Une section suivante du contrat du juge (SCORE:, VERDICT:, …) ferme la liste. */
const AUTRE_SECTION = /^\s*[A-ZÉÈÀ_ ]{3,}\s*:/
const PUCE = /^\s*(?:[-*•]|\d+[.)])\s+/
/** Gravité déclarée par le juge : seules MAJEUR (ou l'absence d'étiquette) bloquent. */
const ETIQUETTE = /^\**\s*(MAJEUR|MINEUR|OK)\s*\**\s*:\s*\**\s*/i
/** « aucune », « aucun », « rien à signaler », « n/a », « néant » — la forme contractuelle du vide. */
// Ligne ENTIÈRE seulement : « Aucune capture du mode sombre » est une objection (conv-539).
const VIDE =
  /^(aucune?(\s+(objections?|ecarts?|defauts?|reserves?))?|rien(\s+a\s+signaler)?|neant|n\/?a|non|ras)\s*[.!]?$/

function normaliser(ligne: string): string {
  return ligne
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Les objections CONCRÈTES d'un texte de verdict, section `OBJECTIONS:` seulement.
 * Rend `[]` quand il n'y a pas de section, qu'elle est vide, ou qu'elle dit « aucune ».
 */
export function objectionsDuJuge(text: string, toutesGravites = false): string[] {
  const lignes = (text ?? '').split(/\r?\n/)
  const objections: string[] = []
  let dansLaSection = false
  for (const ligne of lignes) {
    if (ENTETE_OBJECTIONS.test(ligne)) {
      dansLaSection = true
      // Forme en ligne : « OBJECTIONS: aucune » ou « OBJECTIONS: X ».
      const reste = ligne.replace(ENTETE_OBJECTIONS, '').trim()
      if (reste && !VIDE.test(normaliser(reste))) objections.push(reste)
      continue
    }
    if (!dansLaSection) continue
    if (!ligne.trim()) continue
    if (!PUCE.test(ligne) && AUTRE_SECTION.test(ligne)) {
      dansLaSection = false
      continue
    }
    if (!PUCE.test(ligne)) continue
    const contenu = ligne.replace(PUCE, '').trim()
    if (!contenu) continue
    if (VIDE.test(normaliser(contenu))) continue
    // fix-ok: conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (reparation 3) — un VALIDE 74 dont les puces
    // etaient des constats (« 54 sur 54 passent ») ou des reserves mineures devenait « Promis mais pas fait ».
    // Saisie ts 1789462078031 : le tour finit quand il n'y a plus de defaut MAJEUR. Non etiquete = majeur.
    const etiquette = ETIQUETTE.exec(contenu)
    // Etiquette bornee au VALIDE : sur un refus, MINEUR/OK ne masquent pas les raisons (reparation 4).
    if (etiquette && !toutesGravites && !/^majeur/i.test(etiquette[1])) continue
    objections.push(etiquette ? contenu.slice(etiquette[0].length).trim() : contenu)
  }
  return objections
}

/**
 * Un verdict d'approbation QUI PORTE des objections n'est pas une clôture : il devient un refus
 * lisible, avec ses objections en raisons, pour que la réparation reparte dessus.
 */
/**
 * La DoD que le contrôle final reçoit d'un verdict : UNE case par objection, libellée.
 *
 * Mesuré conv-539, tour 24e29815-0cbd-4310-8cda-93207e237015 : le juge rendait « VALIDE / SCORE 70 /
 * OBJECTIONS: … » (donc rouge), mais le contrôle recevait une case muette. Ses motifs restaient
 * « Échec déjà déclaré ; Promis mais pas fait : 1 point(s) » : le build de réparation (08:45:37) a
 * lu ces motifs comme « mes propres réserves » et n'a rien changé, puis l'arrêt « même refus 2 fois »
 * a coupé alors que les objections, elles, avaient changé (score 70 → 68). Nommer chaque objection
 * les met dans le refus : la réparation les voit, et un refus n'est « figé » que si elles le sont.
 */
export function dodDuVerdict(
  ok: boolean,
  text: string
): Array<{ checked: boolean; hasContent: true; label?: string }> {
  if (ok) return [{ checked: true, hasContent: true }]
  const majeures = objectionsDuJuge(text)
  // Refus sans puce MAJEUR : les MINEUR/OK deviennent les raisons, jamais une case muette (reparation 4).
  // Fallback MINEUR/OK reserve au juge qui REFUSE : sur un VALIDE rouge pour une autre raison (preuve),
  // ses reserves mineures masquaient la vraie cause (tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, reparation 8).
  const jugeRefuse = /\bDEFAUT\s*:/i.test(text ?? '')
  const objections = (majeures.length ? majeures : jugeRefuse ? objectionsDuJuge(text, true) : []).slice(0, 8)
  if (objections.length === 0) return [{ checked: false, hasContent: true }]
  /*
   * Un juge qui a VALIDE n'a rien promis : ses puces sont des reserves, parfois meme des constats
   * de verification REUSSIE. Les recopier une a une dans « Promis mais pas fait » accuse le travail
   * de defauts que le juge n'a pas retenus, et noie le VRAI motif (ici : echec amont).
   *
   * fix-ok: conv-540 tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f — les 4 appels du juge (ts 09:44:57.329,
   * 09:48:05.122, 09:51:14.024, 09:53:28.437) rendent VALIDE 72-74, et le controle de 09:53:28.450
   * affiche 6 « Objection du juge » en promesses non tenues, dont « les 11 commits existent bien…
   * 240 sur 240, code de sortie 0 » et « les 7 tests passent maintenant ». Le blocage reste (une case
   * non cochee), mais il est dit pour ce qu'il est : des reserves sur un verdict approbateur.
   */
  if (!jugeRefuse && /\bVALIDE\b/i.test(text ?? '') && verdictAvecObjectionsPortees(text) === text) {
    const listees = objections.slice(0, 3).join(' | ')
    return [
      {
        checked: false,
        hasContent: true as const,
        label: `Reserves du juge sur un verdict VALIDE (le blocage vient d'un autre motif) : ${
          listees.length > 300 ? `${listees.slice(0, 300)}…` : listees
        }`
      }
    ]
  }
  return objections.map((o) => ({
    checked: false,
    hasContent: true as const,
    label: `Objection du juge : ${o.length > 300 ? `${o.slice(0, 300)}…` : o}`
  }))
}

/**
 * Le juge a-t-il étiqueté AU MOINS UNE de ses puces (MAJEUR/MINEUR/OK) ?
 *
 * fix-ok: conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb (réparations 17 à 19) — le juge rend
 * « VALIDE / SCORE 72 » avec des puces NON étiquetées, dont de purs constats (« 284 tests, tous
 * verts »). Règle « non étiqueté = MAJEUR » : son propre VALIDE était retourné en DEFAUT, donc un
 * juge qui ignore le format ne pouvait JAMAIS clore, et le refus « Promis mais pas fait » recitait
 * ses constats à chaque passage. Le brief le lui demande depuis d8e8986a et il ne s'y plie pas
 * toujours : la consigne en prose ne suffit pas, il faut une règle déterministe.
 *
 * Elle reste étroite : dès que le juge étiquette UNE puce, il sait étiqueter, et une puce nue
 * reste MAJEUR. Une puce MAJEUR ou un `DEFAUT:` bloquent toujours.
 */
const PUCE_ETIQUETEE = /^\s*(?:[-*•]|\d+[.)])\s+\**\s*(?:MAJEUR|MINEUR|OK)\s*\**\s*:/im

function aucunePuceEtiquetee(text: string): boolean {
  return objectionsDuJuge(text, true).length > 0 && !PUCE_ETIQUETEE.test(text ?? '')
}

export function verdictAvecObjectionsPortees(text: string): string {
  const objections = objectionsDuJuge(text)
  if (objections.length === 0) return text
  if (/\bDEFAUT\s*:/i.test(text)) return text
  // Saisie ts 1789462078031 : le tour finit quand les juges n'ont plus de défaut MAJEUR.
  if (/\bVALIDE\b/i.test(text) && aucunePuceEtiquetee(text)) return text
  return `DEFAUT: objections du juge non levées (${objections.length})\n${text}`
}

/**
 * LE VERDICT AGRÉGÉ D'UN PANEL QUI PASSE NE JETTE PLUS LES OBJECTIONS DE SES MEMBRES.
 *
 * fix-ok: conv-539 tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e — quatre passages de juge
 * (promptCalls ts 09:47:42.375, 09:50:30.425, 09:55:17.497, 09:58:16.977) rendent des objections
 * concrètes ; le chemin panel d'`orchestrator.ts` réduisait un quorum atteint au seul mot
 * « VALIDE ». Les objections des membres n'arrivaient donc NI à la réparation NI à l'utilisateur :
 * saisie ts 1789466353210 — « tu t'es arrêté alors que 3/4 des juges ont des objections ».
 *
 * Les puces sont recopiées TELLES QUELLES, étiquette comprise : une MAJEUR rouvre le verdict via
 * `verdictAvecObjectionsPortees`, des puces non étiquetées restent un VALIDE (pas de boucle sans fin).
 */
export type MembreDuPanel = string | { text: string; ok: boolean }

/**
 * UN MEMBRE QUI VOTE `DEFAUT:` RESTE UN DEFAUT, MEME MINORITAIRE.
 *
 * fix-ok: conv-539 tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e — sur les 4 appels juge, celui de
 * promptCalls ts 09:55:17.497 rend « DEFAUT: le tour n'est pas fini en reussite / SCORE: 66 », les
 * 3 autres « VALIDE ». Le quorum passait et les puces du dissident etaient recopiees NUES : non
 * etiquetees = verdict clos (regle de PUCE_ETIQUETEE). Le tour se terminait donc sur un DEFAUT
 * explicite ignore — saisie ts 1789466353210, « tu t'es arrete alors que 3/4 des juges ont des
 * objections ». On etiquette MAJEUR les puces des seuls membres ayant vote DEFAUT : la reparation
 * repart, et un panel sans dissident garde le comportement precedent (pas de boucle sans fin).
 */
function etiqueterSiDissident(puce: string, ok: boolean): string {
  if (ok) return puce
  return PUCE_ETIQUETEE.test(`- ${puce}`) ? puce : `MAJEUR: ${puce}`
}

export function verdictPanelValide(membresDuPanel: MembreDuPanel[]): string {
  const puces: string[] = []
  for (const membre of membresDuPanel ?? []) {
    const texte = typeof membre === 'string' ? membre : membre.text
    const ok = typeof membre === 'string' ? true : membre.ok
    for (const brute of objectionsBrutesDuJuge(texte)) {
      const puce = etiqueterSiDissident(brute, ok)
      if (!puces.includes(puce)) puces.push(puce)
    }
  }
  if (puces.length === 0) return 'VALIDE'
  return `VALIDE\n\nOBJECTIONS:\n${puces.map((p) => `- ${p}`).join('\n')}`
}

/** Les puces de la section OBJECTIONS, étiquette de gravité CONSERVÉE. */
function objectionsBrutesDuJuge(text: string): string[] {
  const lignes = (text ?? '').split(/\r?\n/)
  const puces: string[] = []
  let dansLaSection = false
  for (const ligne of lignes) {
    if (ENTETE_OBJECTIONS.test(ligne)) {
      dansLaSection = true
      const reste = ligne.replace(ENTETE_OBJECTIONS, '').trim()
      if (reste && !VIDE.test(normaliser(reste))) puces.push(reste)
      continue
    }
    if (!dansLaSection) continue
    if (!ligne.trim()) continue
    if (!PUCE.test(ligne) && AUTRE_SECTION.test(ligne)) {
      dansLaSection = false
      continue
    }
    if (!PUCE.test(ligne)) continue
    const contenu = ligne.replace(PUCE, '').trim()
    if (!contenu || VIDE.test(normaliser(contenu))) continue
    puces.push(contenu)
  }
  return puces
}
