/**
 * RÉSERVATION DES FICHIERS ENTRE FILS (conv-1083, 2026-10-22).
 *
 * Plusieurs fils de chat travaillent dans le MÊME dossier (`D:\AutoWinOS`). Jusqu'ici, seule une
 * règle écrite (constitution, réflexe 14) disait « fichier déjà modifié par un autre = son travail ».
 * Quand deux fils écrivent le même fichier non commité, aucun des deux ne peut plus le publier : la
 * publication du chat refuse un fichier dont elle ne peut pas prouver toutes les lignes
 * (`chat-turn-publication.ts`, motif `touche-par-un-autre-fil`).
 *
 * La règle, comme les équipes d'agents de Claude Code (« chaque coéquipier possède ses fichiers ») :
 * - le premier fil qui édite un fichier le RÉSERVE ; chacune de ses éditions renouvelle le bail ;
 * - un autre fil est refusé, avec le nom du fil propriétaire, tant que le fichier reste modifié et
 *   non commité ET que le propriétaire l'a édité depuis moins que le bail ;
 * - la réservation tombe dès que le fichier est commité (git le dit propre), ou à la fin du bail.
 * - un fichier HORS dépôt git (état inconnu) reste réservé : chaque édition de son propriétaire
 *   renouvelle 30 min, et seule la fin du bail le libère (voulu, testé : rien ne prouve qu'il est
 *   sauvegardé ailleurs).
 *
 * Le bail, 30 min : un tour de chat sans signe de vie est coupé à 20 min (veilleur d'inactivité,
 * `main/chat/run-pilot-chat.ts`) ; un fil qui n'a plus touché le fichier depuis 30 min a fini son tour.
 *
 * Fonction AUTOPORTÉE : le hook PreToolUse des agents la sérialise telle quelle
 * (`garde-git-destructeur.ts`). Aucune référence extérieure, d'où le bail écrit en littéral dans la
 * signature — `BAIL_RESERVATION_MS` le redit pour les appelants, et le banc vérifie qu'ils concordent.
 *
 * OÙ LA RÈGLE S'APPLIQUE (un seul registre, `main/reservation-fichiers-app.ts`) :
 * - Edit, Write, MultiEdit, NotebookEdit des agents CLAUDE : hook lancé avant chaque appel
 *   (`garde-git-destructeur.ts`, fil posé par `claude.ts` dans `reservation.json`) ;
 * - la commande `edit_file` de l'app, pour TOUT modèle IA (`commands.ts`, `runTracedEditFile`) ;
 * - le `git commit` d'un agent Claude (`refusCommitReserve`, ci-dessous, même hook) ;
 * - le `git commit` lancé par la commande `run` de l'app, pour TOUT modèle IA (`commands.ts`,
 *   `refusCommitDeFichierReserve`).
 *
 * LIMITES CONNUES : une écriture par le terminal (`sed -i`, `>`) n'est ni vue ni bloquée ; les
 * outils d'édition PROPRES aux autres modèles IA (hors `edit_file`) ne passent pas par le hook
 * Claude, donc ne réservent ni ne sont refusés ; les chemins sont comparés tels quels, sans résoudre
 * un nom court Windows (forme 8.3, `NOMLON~1`) : une réservation posée sous un nom court ne se recoupe pas
 * avec la racine longue que rend git ; le hook n'existe qu'à partir du prochain lancement de l'app
 * (code du processus principal).
 */

export const BAIL_RESERVATION_MS = 30 * 60_000

export interface IoReservation {
  /** Contenu du registre, ou `undefined` s'il n'existe pas encore. */
  lire: (chemin: string) => string | undefined
  ecrire: (chemin: string, texte: string) => void
  /** `true` = aucun changement non commité ; `false` = modifié ; `undefined` = inconnu (pas de git). */
  estPropre: (chemin: string) => boolean | undefined
}

export function reserverOuRefuser(
  io: IoReservation,
  conf: { fil: string; registre: string },
  chemin: string,
  maintenant: number,
  windows: boolean,
  bailMs = 1_800_000
): string | undefined {
  const normalise = chemin.replace(/\\/g, '/').replace(/\/+$/, '')
  const cle = windows ? normalise.toLowerCase() : normalise
  let registre: Record<string, { fil?: unknown; at?: unknown }> = {}
  try {
    const brut = io.lire(conf.registre)
    const lu: unknown = brut ? JSON.parse(brut) : {}
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) registre = lu as typeof registre
  } catch {
    // Registre illisible (écriture coupée) : il repart vide plutôt que de bloquer toute édition.
  }
  const entree = registre[cle]
  if (
    entree &&
    typeof entree.fil === 'string' &&
    entree.fil !== conf.fil &&
    typeof entree.at === 'number' &&
    maintenant - entree.at < bailMs &&
    io.estPropre(chemin) !== true
  ) {
    const ilYA = Math.max(0, Math.round((maintenant - entree.at) / 60_000))
    const reste = Math.max(1, Math.ceil((entree.at + bailMs - maintenant) / 60_000))
    return (
      `Fichier réservé par ${entree.fil} : ce fil l'a modifié il y a ${ilYA} min et son travail n'est pas encore commité (${chemin}). ` +
      `Deux fils sur le même fichier non commité, c'est une publication bloquée pour les deux. ` +
      `Travaille sur un autre fichier : la réservation tombe dès que ${entree.fil} commite ce fichier, ou dans ${reste} min sans nouvelle édition de sa part. ` +
      `Si ce fichier est indispensable à ta tâche, dis-le à l'utilisateur en nommant ${entree.fil}.`
    )
  }
  const suivant: Record<string, { fil: string; at: number }> = {}
  for (const [k, v] of Object.entries(registre)) {
    if (v && typeof v.fil === 'string' && typeof v.at === 'number' && maintenant - v.at < bailMs)
      suivant[k] = { fil: v.fil, at: v.at }
  }
  suivant[cle] = { fil: conf.fil, at: maintenant }
  try {
    io.ecrire(conf.registre, JSON.stringify(suivant))
  } catch {
    // Registre non écrit : l'édition passe quand même, la réservation manquera une fois.
  }
  return undefined
}

export interface IoCommitReserve {
  lire: (chemin: string) => string | undefined
  /** `true` = aucun changement non commité ; `false` = modifié ; `undefined` = inconnu. */
  estPropre: (chemin: string) => boolean | undefined
  /** `true` = le fichier a des changements déjà dans l'index (partagé entre les fils). */
  estIndexe: (chemin: string) => boolean | undefined
  /** Racine du dépôt git qui contient `dossier`, ou `undefined` hors dépôt. */
  racineDepot: (dossier: string) => string | undefined
}

/**
 * LE `git commit` D'UN AGENT CONSULTE LE REGISTRE (objection du contrôle final, conv-1083).
 *
 * L'index git est partagé par tous les fils du même dossier : un `git commit -am`, un `git add -A`
 * ou un fichier déjà indexé par un autre fil emporte son travail sous un autre nom — les demi-commits
 * qui ont cassé `main` (a8ffac96, 99190044). Le commit est refusé, en nommant le fil propriétaire,
 * quand il EMPORTERAIT un fichier qu'un autre fil tient encore (bail en cours, fichier modifié),
 * dans le MÊME dépôt que celui du commit.
 *
 * « Emporter » = un balayage (`commit -a`/`--all`, `git add -A`/`--all`/`-u`/`.`), le fichier NOMMÉ
 * dans la commande, ou le fichier déjà indexé quand le commit ne nomme pas ses chemins (`-- …`).
 * Un commit `git commit -m … -- <mes chemins>` n'emporte que ces chemins : il passe.
 *
 * Fonction AUTOPORTÉE, sérialisée telle quelle dans le hook (`garde-git-destructeur.ts`).
 * LIMITE : le dépôt visé se lit dans `git -C`, le dernier `cd` avant le commit, sinon le dossier
 * courant de l'agent ; un dépôt visé autrement (variable, sous-shell) n'est pas vu.
 */
export function refusCommitReserve(
  io: IoCommitReserve,
  conf: { fil: string; registre: string },
  commande: string,
  cwd: string,
  maintenant: number,
  windows: boolean,
  bailMs = 1_800_000
): string | undefined {
  // Les textes entre guillemets (messages de commit) ne portent pas d'option : « -a » y est du texte.
  const sansTextes = commande.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
  const OPTION_GIT = '(?:\\s+(?:-C\\s+\\S+|-c\\s+\\S+|--?[A-Za-z][\\w-]*(?:=\\S+)?))*'
  if (
    !new RegExp('(?:^|[\\s;&|(])git' + OPTION_GIT + '\\s+commit(?=\\s|$|[;&|)])').test(sansTextes)
  )
    return undefined
  let registre: Record<string, { fil?: unknown; at?: unknown }> = {}
  try {
    const brut = io.lire(conf.registre)
    const lu: unknown = brut ? JSON.parse(brut) : {}
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) registre = lu as typeof registre
  } catch {
    return undefined
  }
  const tenus = Object.entries(registre).filter(
    ([, v]) =>
      v &&
      typeof v.fil === 'string' &&
      v.fil !== conf.fil &&
      typeof v.at === 'number' &&
      maintenant - v.at < bailMs
  ) as [string, { fil: string; at: number }][]
  if (!tenus.length) return undefined
  const norme = (p: string): string => {
    const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return windows ? n.toLowerCase() : n
  }
  // Dépôt visé : `git -C <p> … commit`, sinon le dernier `cd <p>` avant le commit, sinon le dossier courant.
  const chemin = '(?:"([^"]*)"|\'([^\']*)\'|([^\\s;&|]+))'
  const avecC = new RegExp(
    '(?:^|[\\s;&|(])git(?:\\s+-c\\s+\\S+)*\\s+-C\\s+' + chemin + OPTION_GIT + '\\s+commit\\b'
  ).exec(commande)
  let base = avecC ? (avecC[1] ?? avecC[2] ?? avecC[3]) : undefined
  if (!base) {
    const fin = commande.search(/\bcommit\b/)
    const cd = new RegExp('(?:^|[;&|(]\\s*)cd\\s+' + chemin, 'g')
    let m: RegExpExecArray | null
    while ((m = cd.exec(commande)) && m.index < fin) base = m[1] ?? m[2] ?? m[3]
  }
  const dossier = !base
    ? cwd
    : /^(?:[A-Za-z]:)?[\\/]/.test(base)
      ? base
      : cwd.replace(/[\\/]+$/, '') + '/' + base
  const racineBrute = io.racineDepot(dossier)
  if (!racineBrute) return undefined
  const racine = norme(racineBrute)
  const balaye =
    /\bcommit\b[^;&|]*?\s(?:--all|-[A-Za-z]*a[A-Za-z]*)(?=\s|$|[;&|)])/.test(sansTextes) ||
    /\bgit\s+add\b[^;&|]*?\s(?:-A|--all|-u|--update|\.|:\/|\*)(?=\s|$|[;&|)])/.test(sansTextes)
  const avecChemins = /\bcommit\b[^;&|]*\s--(?=\s|$)/.test(sansTextes)
  const texte = norme(commande)
  const cite = (cible: string): boolean => {
    for (let i = texte.indexOf(cible); i >= 0; i = texte.indexOf(cible, i + 1)) {
      const avant = i === 0 ? ' ' : texte[i - 1]
      const apres = texte[i + cible.length] ?? ' '
      const debutOk = /[\s"'=]/.test(avant) || (avant === '/' && texte.slice(i - 2, i) === './')
      if (debutOk && /[\s"';&|)]/.test(apres)) return true
    }
    return false
  }
  const emportes: { fichier: string; fil: string; ilYA: number }[] = []
  for (const [cle, entree] of tenus) {
    if (!cle.startsWith(racine + '/')) continue
    // Même préfixe ne veut pas dire même dépôt : une copie de travail vit DANS le dossier du dépôt.
    const racineDuFichier = io.racineDepot(cle.slice(0, cle.lastIndexOf('/')))
    if (!racineDuFichier || norme(racineDuFichier) !== racine) continue
    // Un commit ne se refuse que sur un fichier qu'on SAIT modifié : un état inconnu laisse passer.
    if (io.estPropre(cle) !== false) continue
    const relatif = cle.slice(racine.length + 1)
    if (balaye || cite(relatif) || cite(cle) || (!avecChemins && io.estIndexe(cle) === true)) {
      const ilYA = Math.max(0, Math.round((maintenant - entree.at) / 60_000))
      emportes.push({ fichier: relatif, fil: entree.fil, ilYA })
    }
  }
  if (!emportes.length) return undefined
  const fils = [...new Set(emportes.map((e) => e.fil))].join(', ')
  const liste = emportes
    .map((e) => `${e.fichier} (réservé par ${e.fil}, modifié il y a ${e.ilYA} min)`)
    .join(' ; ')
  return (
    `Commit refusé : il emporterait le travail non commité d'un autre fil — ${liste}. ` +
    `L'index git est partagé par tous les fils de ce dossier : commite seulement TES fichiers, nommés ` +
    `(git commit -m "…" -- <tes chemins>), sans -a, git add -A ni git add . ` +
    `Si ce fichier doit vraiment partir dans ton commit, dis-le à l'utilisateur en nommant ${fils}.`
  )
}
