/**
 * Le JUGE des sondes, mis à l'épreuve — parce qu'un juge trop indulgent produit des faux verts.
 *
 * Cas fondateur, réel : le 2026-08-15 une sonde a rendu « OK » sur « Je ne peux pas encore donner un
 * nombre exact… », alors que la tâche avait échoué. Chaque cas ci-dessous est un piège dans lequel ce
 * juge est déjà tombé, ou pourrait tomber.
 *
 * Exécution : node scripts/cdp-verdict.test.mjs
 */
import { juger, estUnRefus, texteUtile } from './cdp-verdict.mjs'

let echecs = 0
const verifie = (nom, condition) => {
  if (condition) console.log(`OK   — ${nom}`)
  else {
    console.error(`ÉCHEC — ${nom}`)
    echecs += 1
  }
}

// 1. Le cas fondateur : un refus poli, statut `completed`, du beau texte. Doit être un ÉCHEC.
const refusReel =
  "Je ne peux pas encore donner un nombre exact : la sonde disponible n’a pas retourné l’inventaire complet des fichiers."
verifie('un refus déclaré est un ÉCHEC malgré `completed`', !juger({ contenu: refusReel, statut: 'completed' }).ok)
verifie('le motif nomme le refus', juger({ contenu: refusReel, statut: 'completed' }).motif.includes('REFUS'))

// 2. Le tour muet : rien que des étiquettes d'action. C'est le défaut à 20,2 % du magasin.
const muet = '[a exécuté find_in_files]\n[a exécuté read_file]\n[a exécuté read_file]'
verifie('un tour muet est un ÉCHEC', !juger({ contenu: muet, statut: 'completed' }).ok)
verifie('les étiquettes seules ne laissent aucun texte utile', texteUtile(muet) === '')

// 3. La barrière que ni le style ni le statut ne franchissent : la réponse doit être EXACTE.
verifie(
  'une réponse fausse est un ÉCHEC, même bien écrite',
  !juger({ contenu: 'Il y a 42 fichiers de test.', statut: 'completed', attendu: 220 }).ok
)
verifie(
  'une réponse exacte est un SUCCÈS',
  juger({ contenu: 'Il y en a exactement 220.', statut: 'completed', attendu: 220 }).ok
)

// 4. Une réponse utile SANS vérité terrain reste acceptée : toutes les tâches ne sont pas chiffrables.
verifie(
  'sans attendu, une vraie phrase passe',
  juger({ contenu: 'prêt.', statut: 'completed' }).ok
)

// 5. Un statut anormal ne se rattrape pas par un joli texte.
verifie(
  'un statut non `completed` est un ÉCHEC',
  !juger({ contenu: 'voilà le résultat', statut: 'failed' }).ok
)

// 6. Le détecteur de refus ne doit pas mordre sur une réponse NORMALE qui contient une négation.
verifie(
  'une phrase négative ordinaire n’est PAS prise pour un refus',
  !estUnRefus('Le dossier ne contient aucun sous-dossier, et le compte est de 220.')
)

console.log(`\n${echecs === 0 ? 'TOUS VERTS' : `${echecs} ÉCHEC(S)`}`)
process.exit(echecs === 0 ? 0 : 1)
