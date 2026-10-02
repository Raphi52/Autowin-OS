export declare const MARQUE_ECRAN_UTILISATEUR: string
export declare const REGLE_BUREAU_CACHE: string
export declare const RAPPELS_RETIRES: Readonly<Record<string, string>>
export type DecisionLancement =
  | { action: 'laisser' }
  | { action: 'reecrire'; commande: string }
  | { action: 'refuser'; motif: string }
export declare function redirigerLancementGraphique(
  commande: unknown,
  contexte?: { idBureau?: string; lanceur?: string }
): DecisionLancement
export declare function commandeBureauCache(o: {
  exe: string
  args: string
  idBureau: string
  lanceur: string
  travail: string
}): string
export declare function decoderCommande(commande: string): string
export declare function rappelRetire(type: unknown): boolean
export declare function descriptionAvecRegle(description: unknown): string
