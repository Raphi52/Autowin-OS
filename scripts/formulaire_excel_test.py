"""Tests de scripts/formulaire_excel.py (conv-1968) : le questionnaire JSON du PDF devient un classeur de
compilation, une ligne par personne interrogée, une colonne par question."""
import json
import os
import sys
import tempfile
import unittest

from openpyxl import load_workbook

sys.path.insert(0, os.path.dirname(__file__))
from formulaire_excel import colonnes, construire, main  # noqa: E402

SPEC = {
    'titre': 'Entretien test',
    'identification': {'champs': ['Date', 'Nom', 'Prénom', 'Poste', 'Service']},
    'sections': [
        {'questions': [
            {'texte': 'Qu’aimez-vous dans l’outil ?', 'lignes': 3},
            {'texte': 'Cinq tâches', 'liste': 5, 'colonnes': [['Tâche', 0.7], ['Fréquence', 0.3]]},
        ]},
        {'titre': 'Suite', 'questions': [
            {'texte': 'IA', 'parties': [{'libelle': 'Aide', 'lignes': 2}, {'libelle': 'Jamais', 'lignes': 2}]},
            {'texte': 'Suite', 'choix': [{'libelle': 'Rappel', 'options': ['Oui', 'Non']}], 'champ': 'Contact'},
        ]},
    ],
}
ATTENDU = ['Date', 'Nom', 'Prénom', 'Poste', 'Service',
           '1. Qu’aimez-vous dans l’outil ?', '2. Cinq tâches',
           '3. IA — Aide', '3. IA — Jamais', '4. Rappel', '4. Contact']


class FormulaireExcel(unittest.TestCase):
    def test_une_colonne_par_question_numerotee_comme_le_pdf(self):
        self.assertEqual([c['entete'] for c in colonnes(SPEC)], ATTENDU)

    def test_le_classeur_a_l_en_tete_le_tableau_et_les_listes_oui_non(self):
        feuille = construire(SPEC, lignes=10).active
        self.assertEqual([cellule.value for cellule in feuille[1]], ATTENDU)
        self.assertEqual(feuille.tables['Reponses'].ref, 'A1:K11')
        self.assertEqual(feuille.freeze_panes, 'E2')
        listes = feuille.data_validations.dataValidation
        self.assertEqual([(v.formula1, str(v.sqref)) for v in listes], [('"Oui,Non"', 'J2:J11')])
        self.assertEqual(feuille['A2'].number_format, 'DD/MM/YYYY')

    def test_deux_colonnes_au_meme_nom_sont_refusees(self):
        spec = {'titre': 'X', 'identification': {'champs': ['Nom', 'Nom']}}
        with self.assertRaisesRegex(ValueError, 'double'):
            construire(spec)

    def test_la_ligne_de_commande_ecrit_un_classeur_relisible(self):
        with tempfile.TemporaryDirectory() as dossier:
            source = os.path.join(dossier, 'spec.json')
            sortie = os.path.join(dossier, 'sortie.xlsx')
            with open(source, 'w', encoding='utf-8', newline='') as fh:
                json.dump(SPEC, fh, ensure_ascii=False)
            self.assertEqual(main(['formulaire_excel.py', source, sortie, '--lignes', '5']), 0)
            feuille = load_workbook(sortie).active
            self.assertEqual(feuille.title, 'Réponses')
            self.assertEqual(feuille.max_column, len(ATTENDU))
            self.assertEqual(feuille.tables['Reponses'].ref, 'A1:K6')


if __name__ == '__main__':
    unittest.main()
