import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from '../consignes/chat-pilotage-prompt'
import { CONSTITUTION } from '../consignes/constitution'
import { invokedSkillId, skillNommeeSansBarre } from '../skills/skill-pipeline'

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
    expect(prompt).toMatch(/scouter, auditer[\s\S]{0,200}JAMAIS avec `orchestrate`/u)
  })

  it('oriente la correction ponctuelle vers edit_file + verify, pas vers le pipeline', () => {
    expect(prompt).toContain('edit_file')
    expect(prompt).toContain('verify')
  })


  it('NE REVIENT PAS BREDOUILLE : cherche, essaie, nettoie, puis parle', () => {
    // Constate en usage reel (2026-07-29) : 4 `edit_file` rates, verify impossible a mettre au vert,
    // cap atteint -> « je n'y arrive pas » ET un workspace a moitie modifie.
    expect(prompt).toContain('FACE A UN BLOCAGE')
    // « Nettoie avant de parler » vit dans Autonomie (constitution, servie avec ce prompt) ; le
    // titre du bloc garde le mot comme renvoi.
    expect(prompt).toContain('NETTOIE, PUIS SEULEMENT PARLE')
    expect(prompt).not.toContain('NETTOIE AVANT DE PARLER')
    expect(CONSTITUTION).toMatch(/après avoir annulé tes modifications inutiles/u)
    // « La meme approche qui echoue deux fois, arrete-la » vit dans la CONSTITUTION (reflexe 7),
    // injectee dans le meme prompt systeme ; le doublon du pilotage est parti le 2026-10-28.
    expect(prompt).toContain("CHANGE D'APPROCHE (réflexe 7)")
    expect(CONSTITUTION).toMatch(/change d'approche, ne répète pas la même/u)
    // Un echec doit NOMMER ce qui a ete essaye et ce qui manque : la phrase du pilotage redisait
    // Autonomie (« un blocage nommé »), ce detail y vit desormais, une seule fois.
    expect(CONSTITUTION).toMatch(/blocage nommé \(essais, résultats, ce qui manque\)/u)
    expect(prompt).toContain('PUIS SEULEMENT PARLE (réflexe 8)')
  })

  it('distingue son propre echec du BRUIT ambiant (lint preexistant, etc.)', () => {
    // La phrase vit dans Autonomie (2) de la constitution, une seule fois.
    expect(CONSTITUTION).toMatch(/Un rouge sans rapport avec ton changement se dit comme tel/u)
    expect(prompt).not.toContain('SANS RAPPORT avec ton changement')
  })

  it('oriente vers la LECTURE avant l’ecriture (cause n°1 des edit_file rates)', () => {
    expect(prompt).toContain("LIS avant d'ecrire")
  })

  it('borne la « demande ouverte » : conversationnelle -> reponse, code -> orchestrate', () => {
    // Fondue dans la RÈGLE PREMIÈRE le 2026-10-28 : la demande ouverte se tranche par le
    // MEME critere que le reste — quelque chose doit-il CHANGER ? Non : options dans la reponse, sans
    // commande. Oui (un chantier) : `orchestrate`, pipeline scout/frame.
    expect(prompt).toMatch(
      /Non → tu réponds DIRECTEMENT, AUCUNE commande[\s\S]*demande OUVERTE[\s\S]*options concrètes et scorées[\s\S]*Oui →/u
    )
    expect(prompt).toContain('mener un chantier (pipeline scout/frame si la demande est ouverte)')
  })

  it('ne lance pas build quand aucun livrable ni cible ne sont nommes', () => {
    // Entrée discriminante : « fais un truc parfait ». La règle « DEMANDE SANS OBJET → `ask` » a
    // quitté la consigne (revue 2026-11-06) : elle contredisait la RÈGLE PREMIÈRE. Une demande
    // ouverte se diverge dans la réponse, et le doute tranche pour répondre, pas pour orchestrer.
    expect(prompt).not.toContain('DEMANDE SANS OBJET')
    expect(prompt).toMatch(/En doute entre répondre et orchestrer : RÉPONDS/u)
    expect(prompt).toContain("ne se renvoie JAMAIS à l'utilisateur")
  })

  it('n’exige jamais de renvoyer la question a l’utilisateur (divergence preservee)', () => {
    expect(prompt).toContain("ne se renvoie JAMAIS à l'utilisateur")
    expect(prompt).toContain('DERNIER recours')
    expect(prompt).toContain('options concrètes et scorées')
  })

  it('injecte le catalogue de commandes reellement disponible', () => {
    expect(prompt).toContain('- navigate(tab) : change d onglet')
  })
})

/**
 * SKILL NOMMEE EN CLAIR / DEMANDE DE TEXTE.
 *
 * Mesure du 2026-09-07 : « donne moi un bon prompt pour lancer de l'arena » a declenche
 * un run, puis « kaizen ... » a ete lu comme un commentaire et non comme l'invocation de la skill.
 * Cause : `skillsDisponibles` etait pousse dans l'etat sans qu'aucune ligne du prompt dise quoi en
 * faire, et rien ne distinguait un livrable TEXTE d'une demande d'action.
 */
describe('chat() — skill nommée et demande de texte', () => {
  // « SKILL NOMMÉE = SKILL INVOQUÉE » a quitté la consigne (revue 2026-11-06) : le code charge
  // lui-même le corps d'une skill nommée en tête, avec ou sans barre oblique.
  it('traite un nom de skill en tête de message comme une INVOCATION — tenu par le code', () => {
    expect(skillNommeeSansBarre('kaizen pourquoi le tri casse')).toBe('kaizen')
    expect(invokedSkillId('/arena compare les deux tris')).toBe('arena')
    expect(prompt).not.toContain('SKILL NOMMÉE = SKILL INVOQUÉE')
  })

  it('exclut le pipeline quand le livrable demandé est du TEXTE', () => {
    expect(prompt).toMatch(/DEMANDE DE TEXTE[^.]*se rédige dans ta réponse, ZÉRO commande/u)
    expect(prompt).toContain('même si ce texte parle de lancer un run')
  })
})
