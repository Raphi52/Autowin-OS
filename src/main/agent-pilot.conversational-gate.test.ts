import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * Contrat du GATE CONVERSATIONNEL de `chat()`.
 *
 * Mesure du 2026-07-28 sur 1h d'usage reel : 114 spawns CLI pour 26,65 $, dont des appels de juge a
 * 1,5 $ pour 89 tokens de verdict. La cause n'etait pas la mecanique de routage mais le PROMPT :
 * trois consignes poussaient vers `orchestrate` et ecrasaient la seule ligne autorisant une reponse
 * directe. Ces assertions empechent la regression silencieuse de ce reglage (un prompt se reecrit
 * sans qu'aucun test ne tombe).
 *
 * On teste le TEXTE REELLEMENT PRODUIT (et non plus le source du fichier, comme il fallait le faire
 * quand ce prompt etait un litteral inline) : le module rend l'invariant verifiable directement.
 */
const prompt = buildChatPilotagePrompt([
  { name: 'navigate', args: { tab: '' }, description: 'change d onglet' }
])

describe('chat() — gate conversationnel', () => {
  it('fait de la reponse DIRECTE le comportement par defaut', () => {
    expect(prompt).toContain('RÈGLE PREMIÈRE — RÉPONDS TOI-MÊME')
    expect(prompt).toContain('AUCUNE commande')
    expect(prompt).toMatch(/En doute entre répondre et orchestrer\s*:\s*RÉPONDS/)
  })

  it('reserve le pipeline aux MODIFICATIONS et aux verifications outillees', () => {
    expect(prompt).toContain('MODIFIER le workspace')
    expect(prompt).toContain('vérification')
  })

  it('place la regle AVANT la consigne qui pousse vers orchestrate', () => {
    const gate = prompt.indexOf('RÈGLE PREMIÈRE')
    const push = prompt.indexOf('Ne dis jamais que tu ne peux pas')
    expect(gate).toBeGreaterThan(-1)
    expect(push).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(push) // la recence et l'ordre comptent dans un system prompt
  })

  it('neutralise « en doute -> substantiel » pour la DECISION d’orchestrer', () => {
    expect(prompt).toContain('ne vaut que pour du travail DÉJÀ')
  })


  it('ANALYSER n’est pas MODIFIER : un scout se fait avec les outils de lecture', () => {
    // Constate en essai reel : sur « scoute src/main/ », l'agent lançait `orchestrate` (qui a
    // echoue) alors qu'il pouvait lire. La regle d'origine etait juste quand il etait AVEUGLE.
    expect(prompt).toContain("ANALYSER, ce n'est pas MODIFIER")
    expect(prompt).toContain('OUTILS DE LECTURE')
    expect(prompt).toMatch(/Scouter, auditer[\s\S]{0,200}JAMAIS avec/)
  })

  it('oriente la correction ponctuelle vers edit_file + verify, pas vers le pipeline', () => {
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('verify')
  })


  it('NE REVIENT PAS BREDOUILLE : cherche, essaie, nettoie, puis parle', () => {
    // Constate en usage reel (2026-07-29) : 4 `edit_file` rates, verify impossible a mettre au vert,
    // cap atteint -> « je n'y arrive pas » ET un workspace a moitie modifie.
    expect(prompt).toContain('FACE A UN BLOCAGE')
    expect(prompt).toContain('NETTOIE AVANT DE PARLER')
    expect(prompt).toMatch(/echoue deux fois[\s\S]{0,80}Arrete-la/)
    // Un echec doit NOMMER ce qui a ete essaye et ce qui manque.
    expect(prompt).toContain('NOMMANT ce que tu as essaye')
  })

  it('distingue son propre echec du BRUIT ambiant (lint preexistant, etc.)', () => {
    expect(prompt).toContain('SANS RAPPORT avec ton changement')
  })

  it('oriente vers la LECTURE avant l’ecriture (cause n°1 des edit_file rates)', () => {
    expect(prompt).toContain("LIS avant d'ecrire")
  })

  it('borne la « demande ouverte » : conversationnelle -> reponse, code -> orchestrate', () => {
    expect(prompt).toContain('Si elle est CONVERSATIONNELLE')
    expect(prompt).toContain('SANS aucune commande')
    // Resserre apres essai reel : le critere est « faut-il TRAVAILLER dessus », pas « ça parle de code ».
    expect(prompt).toContain("porte sur le CODE et demande d'y TRAVAILLER")
  })

  it('n’exige jamais de renvoyer la question a l’utilisateur (divergence preservee)', () => {
    expect(prompt).toContain('ne renvoie JAMAIS la question')
    expect(prompt).toContain('options concrètes et scorées')
  })

  it('injecte le catalogue de commandes reellement disponible', () => {
    expect(prompt).toContain('- navigate(tab) : change d onglet')
  })
})
