// Mesures avant publication (suite par lots, rapport vitest, base avant édition) : méthodes de AppCommandBus
// sorties de commands.ts telles quelles (conv-1580, lot 6). À part de verification.ts pour qu'aucun module
// ne dépasse ~800 lignes.
// Les membres du bus lus ici sont publics et marqués @internal : ce module fait partie du bus.
import type { AppCommandBus } from './commands'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
  decideRelatedVerify,
  decideVerifyCommand,
  porteeAvantPublication,
  scriptVitestUnique,
  echecsDuRapport,
  lectureBruteDuRapport,
  decouperEnLots,
  fusionnerRapportsVitest,
  BUDGET_CHEMINS_PAR_LANCEMENT
} from './verify-command'
import { refusAvecIssue } from '../chat/issue-de-refus'
import { readTestsCitant } from '../git/git-read-main'
import type { VerificationAvantPublication } from '../runs/run-autoclose'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import { comparerALaBase } from '../git/comparaison-a-la-base'
import { restaurer } from './publication'
import type { MesureVerifiee } from './publication'

/**
 * Rejoue, dans le dépôt RÉEL, les tests des fichiers qu'un tour de chat va publier — appelé par le
 * commit automatique AVANT de pousser (`chat-turn-publication.ts`).
 *
 * Mesuré le 2026-10-01 : `b6d2a3fc` (conv-892) a été poussé sans aucun test et a laissé main rouge
 * 20 h. La portée est celle d'`edit_file`, plus les tests qui CITENT un fichier de code
 * (`porteeAvantPublication`) : c'est ce qui rejoue `chat-ipc-contract.test.ts`, qui LIT `index.ts`.
 *
 * JAMAIS de repli sur la suite complète ici : à chaque fin de tour, elle coûterait plusieurs minutes
 * et bloquerait toute publication sur le moindre rouge préexistant du dépôt. Sans portée, la
 * publication part comme avant et le rapport dit `non-verifie`, avec sa raison.
 */
export async function verifierAvantPublication(
  bus: AppCommandBus,
  repo: string,
  fichiers: readonly string[]
): Promise<VerificationAvantPublication> {
  const portee = await porteeAvantPublication(
    fichiers,
    async (motif) => await readTestsCitant(repo, motif)
  )
  if (!portee) {
    return { statut: 'non-verifie', raison: `aucun test ciblable pour ${fichiers.join(', ')}` }
  }
  const decision = decideRelatedVerify(repo, portee)
  if (!decision.allowed) return { statut: 'non-verifie', raison: decision.reason }
  const binDuDepot = join(repo, 'node_modules', '.bin')
  const versRelatif = (chemin: string): string =>
    (isAbsolute(chemin) ? relative(repo, chemin) : chemin).split(sep).join('/')
  const fichierExiste = (chemin: string): boolean =>
    existsSync(isAbsolute(chemin) ? chemin : join(repo, chemin))
  const mesure = await bus.mesurerParLots(repo, portee, binDuDepot)
  if (!mesure.allowed) {
    return { statut: 'non-verifie', raison: mesure.reason ?? 'vérification indisponible' }
  }
  if (mesure.exitCode === null) {
    return {
      statut: 'echec',
      commande: mesure.command,
      detail: 'tests coupés au plafond de temps',
      testsEnEchec: []
    }
  }
  const rapport = echecsDuRapport(mesure.rapport, fichierExiste)
  if (mesure.ok) {
    // Un exit 0 sans test joué n'est pas un vert : rien n'a été mesuré.
    if (!rapport.concluant || rapport.testsJoues === 0) {
      return {
        statut: 'non-verifie',
        raison: rapport.raison ?? `aucun test joué par ${mesure.command}`
      }
    }
    return { statut: 'vert', commande: mesure.command, testsJoues: rapport.testsJoues }
  }
  /*
   * ROUGE SOUS CHARGE, VERT SEUL — choix de l'utilisateur du 2026-10-01. Mesuré le même jour : dans
   * la portée de `src/main/index.ts` (1 555 tests), `moteur-perime-cablage.test.ts` échouait alors
   * qu'il passe seul, et aurait bloqué toute publication touchant `index.ts`. On rejoue UNE fois les
   * SEULES suites en échec, isolées : toutes vertes → on publie, et le rapport les NOMME ; une seule
   * encore rouge → on bloque en ne nommant que celles qui restent rouges. Ce n'est pas un réessai à
   * l'aveugle : la condition change (isolées), et le résultat est dit dans le panneau.
   */
  const brut = lectureBruteDuRapport(mesure.rapport)
  const suites = [...new Set((brut?.suitesEnEchec ?? []).map(versRelatif))]
  if (suites.length > 0 && decideRelatedVerify(repo, suites).allowed) {
    const seules = await bus.mesurerParLots(repo, suites, binDuDepot)
    if (seules.allowed && seules.exitCode !== null) {
      const rapportSeules = echecsDuRapport(seules.rapport, fichierExiste)
      if (seules.ok && rapportSeules.concluant && rapportSeules.testsJoues > 0) {
        return {
          statut: 'vert',
          commande: mesure.command,
          testsJoues: brut?.testsJoues ?? rapportSeules.testsJoues,
          instablesSousCharge: suites
        }
      }
      const encoreRouges = lectureBruteDuRapport(seules.rapport)?.suitesEnEchec.map(versRelatif)
      if (encoreRouges?.length) {
        /*
         * UN ROUGE DÉJÀ PRÉSENT NE BLOQUE PLUS (conv-246, 2026-10-11, choix de l'utilisateur) : les
         * suites restées rouges sont rejouées sur le dernier commit, puis avec les fichiers du
         * tour, dans une copie propre. Seul un échec NOUVEAU bloque (voir `comparaison-a-la-base.ts`).
         */
        const suites = [...new Set(encoreRouges)]
        const comparaison = await comparerALaBase({
          repo,
          fichiers,
          suites,
          mesurer: async (racine, cible) => {
            const m = await bus.mesurerParLots(racine, cible, binDuDepot)
            return {
              lancee: m.allowed,
              ok: m.ok,
              exitCode: m.exitCode,
              rapport: m.rapport,
              ...(m.reason ? { raison: m.reason } : {})
            }
          }
        })
        if (comparaison.issue === 'aucun-rouge-du-tour') {
          return {
            statut: 'vert',
            commande: mesure.command,
            testsJoues: brut?.testsJoues ?? 0,
            ...(comparaison.dejaRouges.length ? { dejaRouges: comparaison.dejaRouges } : {}),
            ...(comparaison.rougesDAilleurs.length
              ? { rougesDAilleurs: comparaison.rougesDAilleurs }
              : {})
          }
        }
        if (comparaison.issue === 'rouges-du-tour') {
          return {
            statut: 'echec',
            commande: mesure.command,
            detail: comparaison.detail,
            testsEnEchec: comparaison.suites
          }
        }
        return {
          statut: 'echec',
          commande: mesure.command,
          detail:
            `${suites.length} suite(s) rouge(s), même rejouée(s) seule(s) — ` +
            `impossible de dire si le tour en est la cause : ${comparaison.raison}`,
          testsEnEchec: suites
        }
      }
    }
  }
  // Identité d'un échec : `<fichier> > <nom> :: <empreinte>` (voir `RapportDeTests`).
  const testsEnEchec = [
    ...new Set([...rapport.echecs].map((echec) => versRelatif(echec.split(' > ')[0])))
  ]
  return {
    statut: 'echec',
    commande: mesure.command,
    // Un rapport non concluant (suite qui ne charge pas…) bloque AUSSI : rien n'a prouvé le vert.
    detail: rapport.concluant
      ? `${rapport.echecs.size} test(s) en échec`
      : `code de sortie ${mesure.exitCode}${rapport.raison ? ` — ${rapport.raison.slice(0, 200)}` : ''}`,
    testsEnEchec
  }
}

/**
 * La même mesure, en LOTS qui tiennent dans une ligne de `cmd.exe` (8 191 caractères), lancés l'un
 * après l'autre puis fusionnés. Mesuré le 2026-10-01 (conv-770, tour 532299a4) : 194 tests
 * citaient les fichiers du tour, la commande unique faisait 9 121 caractères, `cmd.exe` la
 * refusait, aucun rapport n'était produit et la publication restait bloquée.
 */
export async function mesurerParLots(
  bus: AppCommandBus,
  workspaceRoot: string,
  cible: readonly string[],
  binDir?: string
): Promise<MesureVerifiee> {
  const lots = decouperEnLots(cible, BUDGET_CHEMINS_PAR_LANCEMENT)
  if (lots.length <= 1) return await bus.mesurerAvecRapport(workspaceRoot, cible, binDir)
  const mesures: MesureVerifiee[] = []
  for (const lot of lots) mesures.push(await bus.mesurerAvecRapport(workspaceRoot, lot, binDir))
  const refus = mesures.find((m) => !m.allowed)
  if (refus) return refus
  const rapport = fusionnerRapportsVitest(mesures.map((m) => m.rapport))
  return {
    allowed: true,
    // Un lot coupé au plafond rend la mesure entière coupée : aucun artefact n'est complet.
    ok: mesures.every((m) => m.ok),
    exitCode: mesures.some((m) => m.exitCode === null)
      ? null
      : (mesures.find((m) => m.exitCode !== 0)?.exitCode ?? 0),
    command: `${mesures[0].command} (${lots.length} lancements)`,
    output: mesures.map((m) => m.output).join('\n'),
    parPortee: mesures.every((m) => m.parPortee),
    ...(rapport ? { rapport } : {})
  }
}

/**
 * UNE MESURE QUI PORTE SON ARTEFACT — la sortie pour l'humain, le rapport pour la decision.
 *
 * Deux reporters a la fois (`default` + `json`), verifie hors modele le 2026-08-27 : la sortie
 * lisible survit ET le fichier JSON est ecrit. C'est ce qui permet de garder le message d'echec
 * rendu au modele sans faire dependre la DECISION d'un texte tronque et falsifiable.
 *
 * Le rapport est ecrit HORS du bureau isole : dedans, il deviendrait un fichier a publier.
 *
 * CONTRAINTE HARD INTACTE : le modele ne choisit toujours JAMAIS la commande. `decideRelatedVerify`
 * et `decideVerifyCommand` decident, l'argv est construit ici argument par argument, `shell: false`.
 */
export async function mesurerAvecRapport(
  bus: AppCommandBus,
  workspaceRoot: string,
  cible: readonly string[],
  /** Binaires du dépôt mesuré (voir `spawnVerify`) ; défaut : ceux du dossier du tour. */
  binDir?: string,
  /** Signal d'arrêt du tour : le Stop de l'utilisateur tue la mesure en cours. */
  signal?: AbortSignal
): Promise<MesureVerifiee> {
  /*
   * UN DOSSIER A NOM ALEATOIRE, PAS UN NOM DERIVE DU PID.
   *
   * La v2 ecrivait `autowin-verdict-<pid>-<compteur>.json` dans le dossier temporaire : un chemin
   * DEVINABLE, et un panel a prouve par execution qu'un test peut le reecrire pour fabriquer le
   * verdict. `mkdtempSync` ne FERME pas cette voie — le chemin reste publie sur l'argv du process
   * fils, donc lisible par tout descendant — mais il en releve le cout et supprime deux defauts
   * reels : la collision entre deux instances de bus dans le meme process (pid partage, compteur
   * par instance), et la substitution par un lien pose a l'avance sur un chemin previsible.
   */
  const dossierDeRapport = mkdtempSync(join(tmpdir(), 'autowin-verdict-'))
  const rapportVers = join(dossierDeRapport, 'rapport.json')
  /*
   * PAS DE VITEST, PAS DE RAPPORT — et donc pas de differentiel, donc le comportement d'AVANT.
   * Les drapeaux de rapport sont une notion vitest : les ajouter a un `test:unit` qui lance autre
   * chose fabrique un refus sur un projet sain (cinq tests l'ont prouve le 2026-08-27).
   */
  const drapeauxDeRapport = scriptVitestUnique(workspaceRoot)
    ? ['--reporter=default', '--reporter=json', `--outputFile=${rapportVers}`]
    : []
  let argv: string[]
  let etiquette: string
  let parPortee = false
  const parPorteeDecision = cible.length
    ? decideRelatedVerify(workspaceRoot, cible)
    : { allowed: false as const, reason: 'aucune portée dérivable' }
  if (parPorteeDecision.allowed) {
    argv = [...parPorteeDecision.argv, ...drapeauxDeRapport]
    etiquette = parPorteeDecision.command
    parPortee = true
  } else {
    const globale = decideVerifyCommand(workspaceRoot)
    if (!globale.allowed) {
      return {
        allowed: false,
        reason: globale.reason,
        ok: false,
        exitCode: null,
        command: '',
        output: '',
        parPortee: false
      }
    }
    // `--` fait passer ce qui suit du script npm au runner. La cible n'est jamais interpolee.
    argv = drapeauxDeRapport.length
      ? [...globale.command.split(' '), '--', ...drapeauxDeRapport]
      : globale.command.split(' ')
    etiquette = globale.command
  }
  try {
    const issue = await bus.spawnVerify(
      argv,
      workspaceRoot,
      etiquette,
      undefined,
      signal,
      binDir
    )
    /*
     * PAS DE FICHIER = PAS DE DIFFERENTIEL. C'est exactement le cas du plafond de temps : le
     * process est tue, aucun rapport complet n'est ecrit. La v1 lisait alors la sortie PARTIELLE,
     * y trouvait des echecs deja emis, et publiait. Ici l'absence est un fait lisible.
     */
    /*
     * UNE EXECUTION COUPEE AU PLAFOND NE LIVRE AUCUN ARTEFACT — `exitCode === null` le dit.
     *
     * La v2 se reposait sur « pas de fichier = pas de differentiel », en supposant que seul vitest
     * pouvait creer ce fichier. Un panel a prouve le contraire par execution : un test peut ecrire
     * le rapport PUIS pendre jusqu'au plafond, et le seul fichier present a ce chemin est alors le
     * sien. Un plafond est deterministe et provocable ; on ne lit donc rien dans ce cas, quelle que
     * soit la presence du fichier.
     */
    const coupeAuPlafond = issue.exitCode === null
    const rapport =
      !coupeAuPlafond && existsSync(rapportVers) ? readFileSync(rapportVers, 'utf8') : undefined
    return { ...issue, command: etiquette, parPortee, ...(rapport ? { rapport } : {}) }
  } finally {
    try {
      supprimerArbre(dossierDeRapport)
    } catch {
      /* Un rapport qui traine dans le dossier temporaire ne change aucun verdict. */
    }
  }
}

/**
 * L'ETAT D'AVANT, MESURE — pas suppose.
 *
 * Rejoue la MEME verification sur les octets que le fichier portait AVANT l'edition, pour que le
 * verdict puisse distinguer un rouge IMPUTABLE d'un rouge deja present. Rend `undefined` des que
 * la mesure n'est pas fiable : `verdictDifferentiel` traite alors le cas comme non concluant, donc
 * comme un REFUS. Aucune branche d'ici ne peut ouvrir la publication par defaut.
 *
 * Les octets viennent de `runEditFile`, qui les a lus juste avant d'ecrire — jamais d'un `git show`
 * (qui supposerait un bureau propre, alors qu'ils sont REUTILISES) ni d'une reconstruction par
 * remplacement inverse.
 */
export async function baselineAvantEdition(
  bus: AppCommandBus,
  absolu: string,
  octetsAvant: Buffer,
  rejouer: () => Promise<MesureVerifiee>,
  commandeAttendue: string
): Promise<MesureVerifiee | undefined> {
  let octetsApres: Buffer
  try {
    octetsApres = readFileSync(absolu)
  } catch {
    return undefined
  }
  let mesure: MesureVerifiee | undefined
  try {
    writeFileSync(absolu, octetsAvant)
    const issue = await rejouer()
    // Une commande DIFFERENTE ne mesure pas la meme chose : ce n'est pas une baseline.
    if (issue.allowed && issue.command === commandeAttendue) mesure = issue
  } catch {
    mesure = undefined
  }
  /*
   * LA RESTAURATION NE PEUT PAS ECHOUER EN SILENCE. Un `finally` nu qui jette ecraserait
   * l'exception en cours et laisserait le bureau dans l'etat D'AVANT — donc publierait
   * l'ANNULATION de l'edition. On reessaie une fois, puis on REFUSE en le NOMMANT : un etat
   * incertain n'est jamais publiable.
   */
  if (!restaurer(absolu, octetsApres, bus.ecrireFichier)) {
    throw new Error(
      refusAvecIssue(
        'verification-indisponible',
        'état pré-édition non restauré après la mesure de baseline — rien n’est publié'
      )
    )
  }
  return mesure
}
