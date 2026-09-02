import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import {
  fichiersDuTourDeChat,
  sourceProcessPrincipal
} from '../source-process-principal.test-helpers'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * GARDE D'EXHAUSTIVITÉ DE L'OBSERVATORY — deux invariants, tenus sur le CODE et non sur une
 * intention.
 *
 * L'audit du 2026-08-31 a trouvé les deux mêmes trous, du même genre : l'Observatory annonçait
 * « ce qui part au provider » et « ce que le Brain a fait », et montrait chaque fois une PARTIE en
 * la donnant pour le tout — trois sites d'envoi n'avaient jamais déclaré leur décomposition, trois
 * appels Brain n'écrivaient aucune trace. Aucun test ne pouvait le détecter : ils vérifiaient tous
 * ce qui EST tracé, jamais ce qui ne l'est pas.
 *
 * Ce fichier vérifie donc l'inverse — qu'aucun site n'échappe à l'inventaire. Une garde par
 * lecture de source est grossière, et c'est assumé : elle ne prouve pas qu'une trace est JUSTE,
 * seulement qu'elle n'est pas ABSENTE. C'est exactement le défaut qu'elle doit rendre impossible à
 * réintroduire en silence, et les listes d'exemption ci-dessous obligent toute exception à
 * s'écrire.
 */

const RACINE = join(__dirname, '..')

function lire(chemin: string): string[] {
  return readFileSync(join(RACINE, chemin), 'utf8').split(/\r?\n/)
}

/**
 * Source PRIVÉE DE SES COMMENTAIRES.
 *
 * Vérifié par sabotage le 2026-08-31 : sans ce filtre, remplacer `kind: 'recherche'` par autre
 * chose DANS LE HANDLER laissait ce fichier vert — le commentaire au-dessus du handler cite la même
 * expression, et la garde se contentait de la prose. Un test qu'un commentaire suffit à satisfaire
 * ne mesure rien, et celui-ci existe précisément pour détecter une absence.
 */
function codeSeulement(chemin: string): string {
  return lire(chemin)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * MEME FILTRE, sur la ZONE du process principal et non sur un chemin.
 *
 * Les canaux du Brain ont quitte `index.ts` pour `src/main/ipc/brain.ts` le 2026-09-02 : la garde
 * cherchait la trace de recherche a une adresse qu'elle avait quittee. Un demenagement de code
 * n'est pas une trace absente.
 */
function codeSeulementDuProcessPrincipal(): string {
  return sourceProcessPrincipal()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Fichiers qui DÉCIDENT d'un envoi provider (par opposition à ceux qui ne font que retransporter un
 * `system` déjà composé : adaptateurs, registre, copies d'observabilité).
 */
const FICHIERS_DE_DECISION = ['orchestrator.ts', 'agent-pilot.ts', 'conversation-router.ts']

/** Valeurs qui ne COMPOSENT pas une injection : elles recopient un `system` construit ailleurs. */
const RETRANSPORTS =
  /^\s*system:\s*(opts|route\.opts|resolved|step\.prompt|pilotEvent\.prompt|body)\./

describe("exhaustivité de l'inventaire des injections", () => {
  it('chaque site qui compose un `system` déclare aussi sa décomposition en blocs nommés', () => {
    const manquants: string[] = []
    for (const fichier of FICHIERS_DE_DECISION) {
      const lignes = lire(fichier)
      lignes.forEach((ligne, index) => {
        if (!/^\s*system:\s/.test(ligne)) return
        if (RETRANSPORTS.test(ligne)) return
        // `system: ''` n'injecte rien : il n'y a pas de bloc à nommer.
        if (/^\s*system:\s*(''|"")\s*,?\s*$/.test(ligne)) return
        // La déclaration suit l'envoi de près ; au-delà, elle appartient à un autre littéral.
        const fenetre = lignes.slice(index, index + 14)
        /*
         * FORME DE CODE EXIGÉE, pas simple présence du mot — corrigé le 2026-08-31.
         *
         * Cette assertion cherchait `/systemBlocks[:,\s]/` n'importe où dans la fenêtre, source
         * BRUTE : un commentaire disant « TODO: rebrancher les systemBlocks » la satisfaisait, donc
         * elle validait un site dont le code venait d'être retiré. C'est le défaut EXACT qui avait
         * déjà été trouvé sur les assertions Brain de ce fichier — j'en avais durci une famille et
         * laissé sa jumelle intacte, vingt lignes plus bas.
         *
         * Le remède est ici l'ancrage en DÉBUT de ligne plutôt qu'un filtrage des commentaires :
         * une ligne de commentaire commence par `//` ou `*`, une clé d'objet non. Plus simple qu'un
         * analyseur de commentaires, et sans le trou du commentaire de FIN de ligne que celui-ci
         * laisserait ouvert.
         */
        const declaree = fenetre.some((candidate) => /^\s*systemBlocks\s*[:,]/.test(candidate))
        if (!declaree) {
          manquants.push(`${fichier}:${index + 1} — ${ligne.trim()}`)
        }
      })
    }
    // Un site sans bloc rend son injection ANONYME : l'Observatory la compte alors en « non
    // attribué », ce qui est honnête mais inutilisable.
    expect(manquants).toEqual([])
  })

  it('les deux chemins qui poussent du contexte côté USER le déclarent aussi', () => {
    // Trou trouvé le 2026-08-31 APRÈS la première passe : seule l'orchestration avait été nommée.
    // Le CHAT poussait cinq blocs (état de l'app, Brain, mémoire, rappel, skill) dans le message
    // utilisateur sans aucun nom — et c'est le chemin le plus emprunté des deux.
    expect(codeSeulement('orchestrator.ts')).toMatch(/contextBlocks:/)
    expect(codeSeulement('agent-pilot.ts')).toMatch(/contextBlocks/)
  })

  it("aucun site de persistance d'appel ne JETTE une décomposition déjà calculée", () => {
    /*
     * Le défaut le plus sournois de ce lot : `agent-pilot` calculait `systemBlocks` depuis F6, et
     * `index.ts` ne le recopiait pas en persistant l'appel. La donnée existait, était juste, et
     * mourait à un `appendPromptCall` — les tours de chat, les plus nombreux, arrivaient donc dans
     * l'Observatory sans une seule injection nommée. Un site de persistance qui laisse tomber un
     * champ ne casse rien et ne se voit nulle part : d'où ce test.
     */
    /*
     * ON CHERCHE LES SITES, PAS UN FICHIER. Le tour pilote a quitte `index.ts` pour
     * `src/main/chat/` le 2026-09-02 : la liste codee en dur rendait ce controle rouge alors que le
     * transport etait INTACT. Un site qui n'appelle pas `appendPromptCall` n'a rien a transporter ;
     * ce qui compte est qu'AUCUN de ceux qui l'appellent ne laisse tomber la decomposition. Le
     * plancher a 2 interdit le faux vert d'une liste devenue vide.
     */
    const candidats = [
      'index.ts',
      'activity/orchestration-observability.ts',
      ...fichiersDuTourDeChat().map((chemin) => `chat/${basename(chemin)}`)
    ]
    const sites = candidats.filter((fichier) =>
      codeSeulement(fichier).includes('appendPromptCall(')
    )
    expect(
      sites.length,
      `sites de persistance introuvables parmi ${candidats.join(', ')}`
    ).toBeGreaterThanOrEqual(2)
    for (const fichier of sites) {
      const source = codeSeulement(fichier)
      const debut = source.indexOf('appendPromptCall(')
      const bloc = source.slice(debut, debut + 1_800)
      expect(bloc, `${fichier} : systemBlocks non transporté`).toMatch(/systemBlocks[:,]/)
      expect(bloc, `${fichier} : contextBlocks non transporté`).toMatch(/contextBlocks[:,]/)
    }
  })
})

/**
 * Modules qui manipulent un récupérateur Brain sans en être l'APPELANT métier : ils reçoivent la
 * fonction, la bornent, la transportent. Tracer ici doublerait la trace de l'appelant réel.
 */
const PLOMBERIE_BRAIN = new Set(['brain-retrieval.ts', 'brain-corpus-scope.ts'])

describe('exhaustivité des appels au Brain', () => {
  it('chaque fichier qui appelle le Brain écrit une trace, ou figure dans la plomberie déclarée', () => {
    const fichiers = ['orchestrator.ts', 'commands.ts', 'index.ts', 'brain-corpus-scope.ts']
    const sansTrace: string[] = []
    for (const fichier of fichiers) {
      const source = codeSeulement(fichier)
      const appelle =
        /retrieveBrainContext\(|this\.retrieveBrain\(|brainScope\.retrieve\(|rememberFact\(/.test(
          source
        )
      if (!appelle || PLOMBERIE_BRAIN.has(fichier)) continue
      const trace = /appendBrainTrace\(|onBrainRetrieved\?\.\(/.test(source)
      if (!trace) sansTrace.push(fichier)
    }
    expect(sansTrace).toEqual([])
  })

  it('la commande `remember` trace son ÉCRITURE vers le Brain, pas seulement les lectures', () => {
    // Le spool ne connaissait que la lecture : un dépôt réussi et un dépôt tombé dans un service
    // injoignable étaient également invisibles dans la vue qui prétend montrer l'activité Brain.
    expect(codeSeulement('commands.ts')).toMatch(/kind: 'depot'/)
  })

  it('la recherche lancée depuis la vue Knowledge laisse une trace', () => {
    expect(codeSeulementDuProcessPrincipal()).toMatch(/kind: 'recherche'/)
  })

  it("l'empreinte du dépôt chargée à chaque run laisse une trace", () => {
    // Deuxième appel Brain du run. Il partait déjà sur le réseau ; personne n'en était notifié, si
    // bien que la liste Brain montrait un appel là où le run en faisait deux.
    expect(codeSeulement('orchestrator.ts')).toMatch(/kind: 'empreinte'/)
  })
})
