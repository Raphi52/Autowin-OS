## Variant: Mission Control

### Design stance
Un canvas horizontal de frames qui rend immédiatement visible le pipeline complet et accepte agents, personas et skills composées.

### Key choices
- Layout : bibliothèque → pipeline de frames → inspecteur.
- Interaction : drag-and-drop vers chaque étape, dépliage de la skill Judge, simulation sans exécution.
- Hiérarchie : une frame par étape, plusieurs cartes/personas par frame.

### Trade-offs
- Fort : composition et lecture chronologique.
- Faible : comparaison d'un même persona à travers toutes les étapes.

### Best for
Construire et réordonner visuellement un workflow autonome.
