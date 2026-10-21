import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cheminDevToolsPort, cheminDepot } from './racine-depot.mjs'

/**
 * QUELLE FENÊTRE le banc de gel (scripts/banc-gel.mjs) a le droit de viser, et QUEL journal lire.
 *
 * Défaut corrigé le 2026-10-21 (conv-1036, en écrivant la skill `/gel`) : le banc lisait en dur
 * `.autowin-data/autowin-os/DevToolsActivePort`, donc l'app OUVERTE de l'utilisateur. Il y clique
 * une vue et attend qu'elle gèle : c'est son écran et sa session qu'on figeait. Lancé sous
 * `avec-instance-headless.mjs`, il ignorait le `--port` de l'instance cachée, et lisait la
 * réanimation dans le journal de l'utilisateur au lieu de celui de l'instance.
 *
 * Ordre : `--port` (ce que pose avec-instance-headless) > `AUTOWIN_CDP_PORT` > l'app ouverte,
 * seulement avec `--app-ouverte` (geste assumé, jamais par défaut).
 * Le journal suit le port : `--journal`, sinon celui de l'instance cachée qui tient ce port
 * (`Audit/headless-instances/<id>/instance.json` -> `<userData>/app-data/autowin-os/gels.jsonl`).
 */
export function cibleDuBanc({
  argv = process.argv,
  env = process.env,
  racineInstances = cheminDepot('Audit', 'headless-instances'),
  devToolsPort = cheminDevToolsPort(),
  journalApp = cheminDepot('.autowin-data', 'autowin-os', 'gels.jsonl')
} = {}) {
  const valeur = (nom) => {
    const i = argv.indexOf(nom)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const journalDemande = valeur('--journal')
  const portArgument = Number(valeur('--port'))
  const portEnv = Number(env.AUTOWIN_CDP_PORT)
  if (Number.isInteger(portArgument) && portArgument > 0) {
    return avecJournal(portArgument, 'argument', journalDemande, racineInstances)
  }
  if (Number.isInteger(portEnv) && portEnv > 0) {
    return avecJournal(portEnv, 'environnement', journalDemande, racineInstances)
  }
  if (!argv.includes('--app-ouverte')) {
    return {
      refus:
        "banc-gel : aucune instance visée. Le banc clique une vue et attend qu'elle gèle : sur l'app " +
        "ouverte de l'utilisateur, c'est SA fenêtre qui se fige. Lance-le dans une instance cachée : " +
        'node scripts/avec-instance-headless.mjs --code-dev -- node scripts/banc-gel.mjs <vue> [essais]. ' +
        "Viser l'app ouverte reste possible, en le disant : --app-ouverte."
    }
  }
  if (!existsSync(devToolsPort)) {
    return {
      refus: `banc-gel : --app-ouverte, mais aucun port d'app ouverte (${devToolsPort} absent).`
    }
  }
  const port = Number(readFileSync(devToolsPort, 'utf8').split('\n')[0].trim())
  return { port, origine: 'app-ouverte', journal: journalDemande ?? journalApp }
}

function avecJournal(port, origine, journalDemande, racineInstances) {
  if (journalDemande) return { port, origine, journal: journalDemande }
  return { port, origine, journal: journalDeLInstance(port, racineInstances) }
}

/** Le journal des gels de l'instance cachée qui écoute sur `port`, ou undefined si aucune ne le tient. */
export function journalDeLInstance(port, racineInstances) {
  let dossiers = []
  try {
    dossiers = readdirSync(racineInstances, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return undefined
  }
  for (const d of dossiers) {
    try {
      const brut = readFileSync(join(racineInstances, d.name, 'instance.json'), 'utf8')
      const etat = JSON.parse(brut.charCodeAt(0) === 0xfeff ? brut.slice(1) : brut)
      if (Number(etat.port) === port && etat.userData) {
        return join(etat.userData, 'app-data', 'autowin-os', 'gels.jsonl')
      }
    } catch {
      /* instance sans état lisible : elle ne tient aucun port connu */
    }
  }
  return undefined
}
