import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'
import { choisirPortLibre } from './port-libre.mjs'

/*
 * SIX PREUVES DE LECTURE, UNE SEULE INSTANCE — et branchees automatiquement.
 *
 * Ces six sondes n'ecrivent rien : elles ouvrent une vue et verifient ce qui s'affiche (catalogue
 * de modeles, hooks, coquille, bloc Frame d'Agent Studio, rail au-dessus du decor, registre des
 * skills). Chacune coute quelques secondes et n'appelle JAMAIS le modele : leur place est sur le
 * paquet qui vient d'etre construit, pas dans la boucle d'edition.
 *
 * POURQUOI UN LANCEUR COMMUN : prises une par une, elles demandent chacune une application ouverte
 * et un port. Ce prix — demarrer, deviner le port, arreter — est la raison pour laquelle elles ne
 * tournaient JAMAIS. Mesure du 2026-09-06 : jouees pour la premiere fois depuis des semaines, deux
 * d'entre elles etaient rouges, et pour des defauts du HARNAIS, pas du produit.
 *
 * Une instance, six sondes, un arret garanti. Le premier rouge arrete tout : la sonde suivante
 * travaillerait sur une application dont on ne sait plus dans quel etat la precedente l'a laissee.
 */
const racine = racineDepot()
const binaire = join(racine, 'dist', 'win-unpacked', 'autowin-os.exe')
const instance = process.env.AUTOWIN_LECTURE_INSTANCE || 'sondes-lecture'
const portDemande = Number(process.env.AUTOWIN_LECTURE_PORT || 9300)

const SONDES = [
  'cdp-model-catalog.mjs',
  'cdp-hooks.mjs',
  'cdp-shell-proof.mjs',
  'cdp-frame-block-proof.mjs',
  'cdp-rail-visible-proof.mjs',
  'cdp-skills-registry.mjs',
  /*
   * La seule qui ECRIT — et elle passe en dernier, pour cette raison.
   *
   * Elle cree un fil et y joue la fixture GRATUITE [[autowin-fixture-durable-stream]] : un vrai
   * parcours d'orchestration, sans un centime d'appel modele. Son fil vit dans le profil isole,
   * qui est jete avec l'instance.
   */
  'cdp-sonde-cloture-orchestration.mjs',
  /*
   * Elle seme une fixture HTML deliberement HOSTILE (script, meta refresh, image distante, lien
   * externe) et verifie dans le VRAI DOM que le rendu arrive et que le poison est retire. Elle
   * ouvre un serveur canari local le temps de la mesure : rien ne doit le joindre a l'affichage.
   */
  'cdp-chat-html-render.mjs',
  /*
   * Elle seme une galerie de cinq artefacts, amene chaque carte au champ, la deplie, verifie les
   * cinq rendus (vecteur, markdown, diagramme, tableau, 3D) — puis SUPPRIME ses conversations.
   */
  'cdp-artifact-previews.mjs'
]

if (!existsSync(binaire)) {
  console.error(
    `[sondes-lecture] binaire absent : ${binaire}\n` +
      "Construis-le d'abord (npm run build:desktop) — ces preuves portent sur le PAQUET."
  )
  process.exit(2)
}

// Un socket ORPHELIN peut tenir le port demande sans qu'aucun processus vivant ne le detienne : on
// prend le suivant libre plutot que de tomber sur une cause sans rapport avec le produit.
const port = choisirPortLibre(portDemande)
if (port === undefined) {
  console.error(
    `[sondes-lecture] aucun port libre entre ${portDemande} et ${portDemande + 19} — machine saturee.`
  )
  process.exit(3)
}
if (port !== portDemande)
  console.log(`[sondes-lecture] port ${portDemande} occupe — repli sur ${port}`)

/** Interroge la page jusqu'a ce que le rail de navigation existe. Rend la main ou leve. */
async function attendreInterfaceMontee(plafondMs = 30000) {
  const echeance = Date.now() + plafondMs
  while (Date.now() < echeance) {
    try {
      const cibles = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      const page = cibles.find((cible) => cible.type === 'page')
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        const monte = await new Promise((resolve) => {
          socket.addEventListener('open', () => {
            socket.send(
              JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                  expression: `Boolean(document.querySelector('[data-testid="nav-chat"]'))`,
                  returnByValue: true
                }
              })
            )
          })
          socket.addEventListener('message', (evenement) => {
            const message = JSON.parse(evenement.data)
            if (message.id === 1) resolve(message.result?.result?.value === true)
          })
          socket.addEventListener('error', () => resolve(false))
          setTimeout(() => resolve(false), 3000)
        })
        socket.close()
        if (monte) {
          console.log('[sondes-lecture] interface montee — les sondes peuvent partir')
          return
        }
      }
    } catch {
      // La page peut n'etre pas encore la : on reessaie, c'est le principe de l'attente.
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  console.error("[sondes-lecture] l'interface n'est pas montee apres 30 s — arret avant de sonder.")
  lanceur('Stop')
  process.exit(1)
}

const lanceur = (action) =>
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(racine, 'scripts', 'autowin-headless.ps1'),
      '-Action',
      action,
      '-InstanceId',
      instance,
      '-Port',
      String(port)
    ],
    { cwd: racine, encoding: 'utf8' }
  )

lanceur('Stop')
const demarrage = lanceur('Start')
if (demarrage.status !== 0) {
  console.error(
    `[sondes-lecture] instance isolee non demarree :\n${demarrage.stderr || demarrage.stdout}`
  )
  process.exit(1)
}
console.log(`[sondes-lecture] instance « ${instance} » prete sur le port ${port}`)

/*
 * « PORT OUVERT » N'EST PAS « INTERFACE PRETE ».
 *
 * Le lanceur rend `ready` des que le port de pilotage repond — c'est-a-dire des que la fenetre
 * existe, AVANT que React ait monte le rail de navigation. Mesure du 2026-09-06 : la premiere
 * sonde de la file tombait alors sur « Navigation Agent Studio introuvable » et accusait le
 * produit, tandis que la meme sonde passait dix secondes plus tard. Les suivantes, elles, ne
 * voyaient jamais le defaut : la sonde d'avant avait servi d'attente.
 *
 * On attend donc ICI, une fois pour les six, que le rail existe reellement.
 */
await attendreInterfaceMontee()

let echec = null
for (const sonde of SONDES) {
  const debut = Date.now()
  const resultat = spawnSync(process.execPath, [join(racine, 'scripts', sonde)], {
    cwd: racine,
    encoding: 'utf8',
    env: { ...process.env, AUTOWIN_CDP_PORT: String(port) }
  })
  const duree = ((Date.now() - debut) / 1000).toFixed(1)
  if (resultat.status === 0) {
    console.log(`[sondes-lecture] OK   ${sonde} (${duree}s)`)
    continue
  }
  console.error(`[sondes-lecture] ECHEC ${sonde} (${duree}s, sortie ${resultat.status})`)
  console.error(resultat.stderr || resultat.stdout)
  echec = sonde
  break
}

// L'arret a lieu QUOI QU'IL ARRIVE : une sonde rouge qui laisse une application ouverte transforme
// un echec lisible en port occupe au passage suivant.
lanceur('Stop')

if (echec) process.exit(1)
console.log(`[sondes-lecture] vert — ${SONDES.length} preuves verifiees sur le paquet`)
