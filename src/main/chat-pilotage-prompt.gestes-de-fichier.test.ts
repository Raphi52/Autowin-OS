import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * LE PROMPT NE DOIT PAS NIER UNE CAPACITE QUE LE CATALOGUE EXPOSE.
 *
 * Defaut MESURE le 2026-09-09, decouvert par un balayage des travaux non publies. `create_file`,
 * `move_file` et `delete_file` ont rejoint le catalogue (`commands.ts`, commit e37ce1f1) apres avoir
 * dormi hors de la base. Mais la consigne « PÉRIMÈTRE D'ÉCRITURE » du chat, elle, n'a pas bouge :
 * elle enumerait « la création d'un fichier » parmi les gestes REFUSES.
 *
 * Consequence exacte : l'agent lisait qu'il ne peut pas creer de fichier, et repondait donc a
 * l'utilisateur qu'il ne peut pas — ou repassait par le contournement `run node -e "..."`, qui
 * echappe justement a toutes les bornes de `file-ops-command.ts`. Une capacite presente mais
 * annoncee impossible est une capacite MORTE, et c'est le defaut meme que ces commandes corrigeaient.
 *
 * C'est le jumeau d'un piege attrape le meme jour sur `verify` : le texte qui accompagne un geste
 * porte des affirmations d'ABSENCE, et une affirmation d'absence devient fausse des qu'on ajoute la
 * capacite. Ce test transforme la vigilance en garde-fou.
 */
describe('perimetre d’ecriture du chat', () => {
  const prompt = buildChatPilotagePrompt([])

  it('NOMME les trois gestes de fichier au lieu de les presenter comme impossibles', () => {
    expect(prompt).toContain('create_file')
    expect(prompt).toContain('move_file')
    expect(prompt).toContain('delete_file')
  })

  it('ne liste plus « la création d’un fichier » parmi les refus sans dire QUI la refuse', () => {
    // La phrase d'origine refusait la creation TOUT COURT. Seul `edit_file` la refuse : c'est une
    // propriete de CETTE commande, pas une limite de l'agent.
    expect(prompt).not.toContain("les racines système, la création d'un fichier (l'extrait")
    expect(prompt).toMatch(/création d[’']un fichier PAR `edit_file`/u)
  })

  it('annonce la portee REELLE de ces gestes : le depot, et un chemin absolu ailleurs', () => {
    /*
     * La version retenue le 2026-09-09 est la LARGE : `localiserCible` accepte un chemin absolu
     * hors workspace (seules les racines systeme sont fermees). Sous-annoncer la portee serait
     * l'erreur symetrique de celle qu'on corrige — une capacite bridee par son texte.
     */
    const bloc = prompt.slice(prompt.indexOf("PÉRIMÈTRE D'ÉCRITURE"))
    expect(bloc).toMatch(/chemin ABSOLU/u)
    expect(bloc.slice(0, 1400)).toMatch(/create_file/u)
  })
})
