/**
 * Lance une passe de veille RÉELLE, hors application.
 *
 * Pourquoi hors application : la mise au point d'une passe demande de la rejouer souvent, et redémarrer
 * Electron à chaque essai coûterait des minutes pour rien. La planification (`taskManagerRunNow`) reste
 * le chemin de production ; ce script est le chemin de mise au point.
 *
 *   npx tsx scripts/lancer-veille.ts                     # toutes les sources
 *   npx tsx scripts/lancer-veille.ts --source Codex      # une seule
 *   npx tsx scripts/lancer-veille.ts --stock C:/tmp/x.json
 *
 * Le scout est un appel au CLI Claude avec les outils web, exactement ceux qu'Autowin ouvre désormais à
 * tous ses agents. Aucun autre outil n'est autorisé : un scout n'a rien à écrire ni à exécuter.
 */

import { spawn } from 'node:child_process'
import { resolveClaudeBin } from '../src/main/providers/claude'
import { executerPasse, type LancerScout } from '../src/main/veille/passe'
import { SOURCES_VEILLE } from '../src/main/veille/sources'

const valeur = (nom: string): string | undefined => {
  const i = process.argv.indexOf(nom)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/**
 * Un scout = un appel CLI, outils web SEULS.
 *
 * `--tools`/`--allowedTools` reçoivent la même liste : `--tools` restreint ce qui est CHARGÉ dans le
 * contexte, `--allowedTools` ce qui est AUTORISÉ. Les deux, sinon on paie les définitions d'outils qu'on
 * n'autorise pas — mesure déjà faite dans ce dépôt.
 */
/**
 * Le binaire vient du résolveur de l'APPLICATION, pas du PATH.
 *
 * `execFile` sans shell ne résout pas les shims Windows : mesuré, `spawn claude ENOENT`, alors que le
 * PATH ne porte qu'un `claude.ps1`. En réutilisant `resolveClaudeBin`, le script et l'application
 * lancent exactement la même binaire — inventer un chemin ici aurait produit un script qui teste autre
 * chose que ce que l'app exécute.
 */
const binaire = resolveClaudeBin()

const lancerScout: LancerScout = (source, prompt) =>
  new Promise<string>((resoudre, rejeter) => {
    void source
    /**
     * `spawn` avec stdin FERMÉ, et non `execFile`.
     *
     * Mesuré : avec `execFile`, stdin reste un tuyau jamais fermé et le CLI attend une entrée —
     * « no stdin data received in 3s, proceeding without it ». Il finissait par continuer, mais en
     * ayant perdu du temps et en mêlant son avertissement à la sortie utile.
     *
     * `--tools` ET `--allowedTools` reçoivent la même liste : le premier restreint ce qui est CHARGÉ
     * dans le contexte, le second ce qui est AUTORISÉ. Un scout n'a rien à écrire ni à exécuter.
     */
    const enfant = spawn(
      binaire,
      [
        '-p',
        prompt,
        '--tools',
        'WebFetch,WebSearch',
        // Arguments SÉPARÉS, mesuré en A/B : la forme à virgules fait PENDRE la récupération de page
        // (code 124 au délai maximum), la forme séparée répond en quelques secondes.
        '--allowedTools',
        'WebFetch',
        'WebSearch',
        '--permission-mode',
        'bypassPermissions',
        // Les MÊMES drapeaux d'hygiène que l'application, et ce n'est pas cosmétique : sans
        // `--strict-mcp-config`, le CLI démarre tous les serveurs MCP du poste (windows-mcp, Chrome,
        // Roblox…) avant de répondre. MESURÉ sans eux : le scout dépassait 240 s et se faisait tuer,
        // alors qu'un appel direct sur une petite page répondait en 12 s.
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--disable-slash-commands'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let sortie = ''
    let erreurs = ''
    enfant.stdout.setEncoding('utf8')
    enfant.stdout.on('data', (bout: string) => {
      sortie += bout
    })
    enfant.stderr.setEncoding('utf8')
    enfant.stderr.on('data', (bout: string) => {
      erreurs += bout
    })
    // Budget BORNÉ : une page peut être longue, un scout pendu ne doit pas bloquer la passe.
    const minuteur = setTimeout(() => enfant.kill('SIGKILL'), 240_000)
    minuteur.unref?.()
    enfant.on('error', (erreur) => {
      clearTimeout(minuteur)
      rejeter(erreur)
    })
    enfant.on('close', (code) => {
      clearTimeout(minuteur)
      if (code === 0) resoudre(sortie)
      // Le code de sortie ET stderr : un échec muet serait pris pour une page sans nouveauté.
      //
      // La FIN de stderr, pas le début : au premier essai je gardais les 200 premiers caractères, et
      // stderr commence par un avertissement bénin sur une règle de permissions du poste. Mon propre
      // message de diagnostic cachait donc la cause réelle derrière du bruit connu.
      else {
        const utile = erreurs
          .split(String.fromCharCode(10))
          .map((ligne) => ligne.trim())
          .filter((ligne) => ligne && !/^Permission allow rule|^Warning: no stdin/.test(ligne))
        rejeter(
          new Error(
            `scout sorti en ${code} : ${utile.slice(-3).join(' | ').slice(0, 400) || 'sans message'}`
          )
        )
      }
    })
  })

/** Encapsulé : tsx compile en CJS, où le `await` de premier niveau est refusé. */
async function main(): Promise<void> {
  const filtre = valeur('--source')
  const sources = filtre
    ? SOURCES_VEILLE.filter((s) => s.concurrent.toLowerCase().includes(filtre.toLowerCase()))
    : SOURCES_VEILLE

  if (sources.length === 0) {
    console.error(`Aucune source ne correspond à « ${filtre} ».`)
    console.error(`Sources connues : ${SOURCES_VEILLE.map((s) => s.concurrent).join(', ')}`)
    process.exit(2)
  }

  const debut = Date.now()
  console.log(
    `Passe de veille sur ${sources.length} source(s) : ${sources.map((s) => s.concurrent).join(', ')}`
  )
  // Le binaire est DIT : un script qui teste une autre binaire que l'app ne prouve rien sur l'app.
  console.log(`Binaire scout : ${binaire}`)

  const resultat = await executerPasse({
    lancerScout,
    sources,
    ...(valeur('--stock') ? { chemin: valeur('--stock') } : {})
  })

  const secondes = Math.round((Date.now() - debut) / 1000)
  console.log(`\n— Passe terminée en ${secondes} s —`)
  console.log(`Retenus : ${resultat.retenus}`)
  console.log(`Refusés : ${resultat.refuses.length}`)
  for (const refus of resultat.refuses) {
    console.log(`  refusé (${refus.raison}) : ${refus.brut.titre ?? '(sans titre)'}`)
  }
  console.log(`Sources muettes : ${resultat.echecs.length}`)
  for (const echec of resultat.echecs) {
    console.log(`  ${echec.concurrent} — ${echec.detail}`)
  }
  console.log(`\nStock : ${resultat.stock.candidats.length} candidat(s) au total`)
  for (const candidat of resultat.stock.candidats.slice(-10)) {
    console.log(`  [${candidat.concurrent}] ${candidat.dateSource} · ${candidat.titre}`)
  }

  /**
   * Le code de sortie dit la VÉRITÉ sur la passe, pour qu'un appel automatisé ne prenne pas un silence
   * pour un succès :
   *   0 = au moins une source a été lue sans échec
   *   1 = toutes les sources ont échoué (rien n'a été lu — ce n'est PAS « rien de neuf »)
   */
  process.exit(resultat.echecs.length === sources.length ? 1 : 0)
}

void main()
