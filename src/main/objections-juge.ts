import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

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

/**
 * LE CONTRAT DES OBJECTIONS, ÉCRIT UNE SEULE FOIS, À CÔTÉ DE LA RÈGLE QUI LE LIT.
 *
 * fix-ok: run-85d8e7f57af2-1 (conv-892, 2026-10-01) — trois VALIDE (84, 86, 88) ont chacun relancé
 * une réparation. Cause : le contrat était recopié à quatre endroits (phase-briefs.ts, trois prompts
 * d'orchestrator.ts), qui définissait MINEUR comme une « réserve non bloquante », alors que depuis conv-844 (2026-09-24)
 * `objectionsDuJuge` bloque sur tout MINEUR (seul OK passe) : aucune copie n'avait suivi. Les juges y
 * rangeaient des réserves qu'aucune réparation ne lève (publication faite par l'app APRÈS le VALIDE,
 * mesure qui attend 10 runs après la fusion). Le texte et la règle vivent donc ici, ensemble.
 * Les puces OK restent affichées : panneau des juges (`lireContratEtendu`) et RUN.md (`judgeText`).
 */
export const CONTRAT_OBJECTIONS = `OBJECTIONS:
- MAJEUR: <écart qui empêche de livrer : preuve manquante, où vérifier> | MINEUR: <défaut que le producteur peut encore corriger dans CE run — il BLOQUE la clôture et relance une réparation> | OK: <constat vérifié> | OK: hors run — <réserve qu'aucune réparation ne peut lever (publication faite par l'app après ton VALIDE, mesure qui attend des runs futurs, geste ou accord de l'utilisateur) et qui la lèvera>
Facultatif, en fin d'une puce MAJEUR ou MINEUR : « | TEST: <fichier de test> | <commande> » — le test qui échoue aujourd'hui et que la réparation doit faire passer sans le modifier.
Un défaut corrigeable dans ce run n'est jamais OK. Une puce OK ne bloque pas et reste affichée à l'utilisateur.
Aucune objection → une seule puce « - aucune ». N'écris le mot DEFAUT que sur la première ligne (le lecteur machine le prendrait pour un rejet).`

const ENTETE_OBJECTIONS = /^\s*objections?\s*:/i
/** Une section suivante du contrat du juge (SCORE:, VERDICT:, …) ferme la liste. */
const AUTRE_SECTION = /^\s*[A-ZÉÈÀ_ ]{3,}\s*:/
const PUCE = /^\s*(?:[-*•]|\d+[.)])\s+/
/** Gravité déclarée par le juge : seules MAJEUR (ou l'absence d'étiquette) bloquent. */
/** Une puce explicitement etiquetee MAJEUR par le juge. */
const PUCE_MAJEUR = /^\s*(?:[-*•]|\d+[.)])\s+\**\s*MAJEUR\s*\**\s*:/im
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
  /*
   * DANS UN VERDICT QUI PORTE DEJA UNE PUCE `MAJEUR:`, UNE PUCE NUE N'EST PAS UN DEFAUT MAJEUR.
   *
   * fix-ok: conv-540 tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f - verdict AGREGE d'un panel :
   * `verdictPanelValide` etiquette MAJEUR les seules puces du membre qui vote DEFAUT, et laisse
   * NUES celles des membres APPROBATEURS. La regle "non etiquete = majeur" retenait alors TOUT :
   * le controle de 09:53:28.450 a recopie en "Promis mais pas fait" des verifications REUSSIES
   * ("les 11 commits existent bien... 240 sur 240, code de sortie 0", "les 7 tests passent
   * maintenant"), noyant le vrai motif. Des qu'un MAJEUR est present, le juge a etiquete ce qui
   * bloque : les puces nues sont des constats.
   */
  const aUnMajeur = PUCE_MAJEUR.test(text ?? '')
  const lignes = (text ?? '').split(/\r?\n/)
  const objections: string[] = []
  let dansLaSection = false
  /*
   * fix-ok: run-0940cc5e0fcd-1 (conv-857, 2026-09-26) reparation 13 — le juge rend VALIDE 86 ; sa puce
   * « OK: Chaque correction annoncee existe dans le code : » porte 9 sous-puces indentees, sans etiquette
   * propre, donc retenues comme objections : le controle final en a recite 8 en « Promis mais pas fait »
   * et masque les 4 MINEUR. Mesure : objections.mineur.test.ts rouge (2/5) avant, vert apres.
   * Une sous-puce (plus indentee que la puce precedente) herite donc de l'etiquette de sa parente.
   */
  let parente: { retrait: number; etiquette: string | null } | null = null
  for (const ligne of lignes) {
    if (ENTETE_OBJECTIONS.test(ligne)) {
      dansLaSection = true
      parente = null
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
    const retrait = (/^\s*/.exec(ligne)?.[0] ?? '').replace(/\t/g, '    ').length
    const sousPuce = !etiquette && parente !== null && retrait > parente.retrait
    const gravite = etiquette ? etiquette[1] : sousPuce && parente ? parente.etiquette : null
    if (!sousPuce) parente = { retrait, etiquette: etiquette ? etiquette[1] : null }
    // Etiquette bornee au VALIDE : sur un refus, MINEUR/OK ne masquent pas les raisons (reparation 4).
    // fix-ok: conv-844 (2026-09-24) — run kaizen-…-mufvgag5 clos « succeeded » sur un VALIDE 82 dont
    // une puce MINEUR etait un vrai trou (drapeau `orientation` jamais transmis par run-pilot-chat.ts).
    // Decision utilisateur : tout defaut du juge, meme MINEUR, bloque la cloture verte. Seul OK passe.
    if (gravite && !toutesGravites && /^ok$/i.test(gravite)) continue
    if (!gravite && !toutesGravites && aUnMajeur) continue
    objections.push(etiquette ? contenu.slice(etiquette[0].length).trim() : contenu)
  }
  return objections
}

const SUFFIXE_TEST = /\|?\s*\bTEST:\s*([^|]+?)\s*\|\s*(.+?)\s*$/

/**
 * Les tests exécutables joints par le juge (`| TEST: <fichier> | <commande>`) à ses objections
 * BLOQUANTES seulement : le `TEST:` d'une puce OK ne relance rien. Piste 2 /build (conv-44) :
 * la réparation repartait d'une prose ; elle reçoit désormais l'échec à faire passer.
 */
export function testsDuJuge(text: string): { fichier: string; commande: string }[] {
  const tests: { fichier: string; commande: string }[] = []
  for (const objection of objectionsDuJuge(text)) {
    const m = SUFFIXE_TEST.exec(objection)
    if (m) tests.push({ fichier: m[1].trim(), commande: m[2].trim() })
  }
  return tests
}

/** La consigne de réparation tirée de `testsDuJuge` ; chaîne vide sans test (comportement inchangé). */
export function consigneTestsDuJuge(text: string): string {
  const tests = testsDuJuge(text)
  if (tests.length === 0) return ''
  return ` Tests du juge à faire passer SANS modifier le fichier de test : ${tests
    .map((t) => `\`${t.commande}\` (fichier ${t.fichier})`)
    .join(' ; ')}.`
}

/** Début du motif de refus « test du juge retouché » — reconnu par `arretDeLaReparation` (stopgate). */
export const PREFIXE_TEST_MODIFIE = 'Réparation refusée : le fichier de test désigné par le juge a été modifié'

/** Clé stable d'un fichier `TEST:` : relatif ou absolu, `\` ou `/`, même clé (piège conv-539). */
function cleDuTest(fichier: string, racine: string): string {
  const abs = isAbsolute(fichier) ? fichier : resolve(racine, fichier)
  return abs.replace(/\\/g, '/').replace(/^([a-z]):/, (_, l: string) => `${l.toUpperCase()}:`)
}

/**
 * Empreinte (sha256) de chaque fichier `TEST:` désigné par le juge ; `null` si le fichier n'existe pas.
 * Piste 2 /build (conv-44) : la consigne « SANS modifier le fichier de test » n'était qu'une phrase.
 */
// fix-ok: la consigne « SANS modifier le fichier de test » (consigneTestsDuJuge) n'était qu'une phrase de prompt ; aucun code ne la faisait respecter (grep testsDuJuge = 1 seul site). Empreinte sha256 avant/après la réparation.
export function empreintesTestsDuJuge(text: string, racine: string): Record<string, string | null> {
  return empreintesDesFichiers(testsDuJuge(text).map(({ fichier }) => cleDuTest(fichier, racine)))
}

/** Empreinte sha256 de chaque chemin ABSOLU donné (clés de `empreintesTestsDuJuge`) ; `null` si absent. */
export function empreintesDesFichiers(cles: string[]): Record<string, string | null> {
  const empreintes: Record<string, string | null> = {}
  for (const cle of cles) {
    try {
      empreintes[cle] = createHash('sha256').update(readFileSync(cle)).digest('hex')
    } catch {
      empreintes[cle] = null
    }
  }
  return empreintes
}

/**
 * Motifs de refus : un fichier `TEST:` qui EXISTAIT avant la réparation et a changé après.
 * Un fichier absent avant n'est pas protégé : le créer peut être le travail demandé.
 */
export function motifsTestModifie(
  avant: Record<string, string | null>,
  apres: Record<string, string | null>
): string[] {
  const motifs: string[] = []
  for (const [cle, empreinte] of Object.entries(avant)) {
    if (empreinte === null) continue
    if (cle in apres && apres[cle] === empreinte) continue
    motifs.push(`${PREFIXE_TEST_MODIFIE} (${cle}) — il fallait le faire passer sans le toucher.`)
  }
  return motifs
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
/*
 * fix-ok: conv-539 tour 6ba33167-9b16-4dbb-8a5f-fd40207ed80e — les puces d'un membre APPROBATEUR
 * restaient nues, et la regle « non etiquete = MAJEUR » les retenait comme defauts : le controle
 * final recopiait en « Promis mais pas fait » des CONSTATS de verification reussie (reparation 2 :
 * « Les deux corrections existent et tiennent… 6 verts, code 0 »). Le vote du membre est connu ici :
 * un approbateur n'a declare aucun defaut, ses puces sont donc MINEUR, celles du dissident MAJEUR.
 */
function etiqueterSelonLeVote(puce: string, ok: boolean): string {
  if (PUCE_ETIQUETEE.test(`- ${puce}`)) return puce
  // conv-844 : MINEUR bloque desormais ; une puce NUE d'un approbateur est un constat -> OK.
  return ok ? `OK: ${puce}` : `MAJEUR: ${puce}`
}

export function verdictPanelValide(membresDuPanel: MembreDuPanel[]): string {
  const puces: string[] = []
  for (const membre of membresDuPanel ?? []) {
    const texte = typeof membre === 'string' ? membre : membre.text
    const ok = typeof membre === 'string' ? true : membre.ok
    for (const brute of objectionsBrutesDuJuge(texte)) {
      const puce = etiqueterSelonLeVote(brute, ok)
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

