"""Fabrique le script Google Apps Script qui crée un Google Form depuis un questionnaire JSON (conv-1968) :
le même JSON que scripts/formulaire_pdf.py (PDF) et scripts/formulaire_excel.py (classeur de compilation).

Google Forms n'importe aucun fichier. On colle donc ce script dans un projet Apps Script
(https://script.google.com/home, « Nouveau projet »), on exécute `creerFormulaire`, le compte accepte l'accès
à Google Forms, et le journal d'exécution donne le lien à envoyer et le lien de modification.

Usage : python -I scripts/formulaire_google.py questionnaire.json sortie.gs
Sortie : une ligne JSON {sortie, questions, caracteres}.

Correspondance avec le PDF (même numérotation) :
  - identification -> réponses courtes (« Date » -> champ date) ;
  - question libre ou "liste" -> paragraphe (la liste devient « une par ligne » dans l'aide) ;
  - "parties" / "choix" -> un titre portant la question, puis un paragraphe par partie, un choix unique par
    choix et une réponse courte pour "champ".
Clé facultative "google" : {"titre": ..., "description": ..., "champsExclus": ["Date"]} remplace le titre et
le sous-titre du PDF, et retire des champs d'identification inutiles en ligne (Google horodate déjà chaque
réponse).
"""
import json
import os
import sys

MODELE = """// Crée le Google Form du questionnaire ci-dessous : exécuter creerFormulaire, puis lire le journal.
// Généré par formulaire_google.py : modifier le questionnaire JSON et régénérer plutôt que retoucher ici.
var QUESTIONNAIRE = __QUESTIONNAIRE__;

function creerFormulaire() {
  var q = QUESTIONNAIRE, google = q.google || {};
  var exclus = (google.champsExclus || []).map(function (c) { return c.trim().toLowerCase(); });
  var form = FormApp.create(google.titre || q.titre);
  form.setDescription(google.description || q.sousTitre || '');
  var identite = q.identification || {};
  if (identite.titre) form.addSectionHeaderItem().setTitle(identite.titre);
  (identite.champs || []).forEach(function (champ) {
    var nom = champ.trim().toLowerCase();
    if (exclus.indexOf(nom) >= 0) return;
    if (nom === 'date') form.addDateItem().setTitle(champ);
    else form.addTextItem().setTitle(champ);
  });
  var numero = 0;
  (q.sections || []).forEach(function (section) {
    if (section.titre) form.addSectionHeaderItem().setTitle(section.titre).setHelpText(section.note || '');
    (section.questions || []).forEach(function (question) {
      numero += 1;
      var titre = numero + '. ' + question.texte;
      var aide = question.aide || '';
      if (question.parties || question.choix) {
        form.addSectionHeaderItem().setTitle(titre).setHelpText(aide);
        (question.parties || []).forEach(function (partie) {
          form.addParagraphTextItem().setTitle(partie.libelle || titre);
        });
        (question.choix || []).forEach(function (choix) {
          form.addMultipleChoiceItem().setTitle(choix.libelle).setChoiceValues(choix.options);
        });
        if (question.champ) form.addTextItem().setTitle(question.champ);
        return;
      }
      if (question.liste) {
        var colonnes = (question.colonnes || []).map(function (c) { return c[0]; }).filter(Boolean);
        aide = [aide, 'Une par ligne, ' + question.liste + ' au plus' +
          (colonnes.length ? ' : ' + colonnes.join(', ') : '') + '.'].filter(Boolean).join(' ');
      }
      form.addParagraphTextItem().setTitle(titre).setHelpText(aide);
    });
  });
  Logger.log('Lien à envoyer : ' + form.getPublishedUrl());
  Logger.log('Lien pour modifier : ' + form.getEditUrl());
  return { envoyer: form.getPublishedUrl(), modifier: form.getEditUrl() };
}
"""


def generer(spec):
    # JSON compact : le script se colle d'un bloc dans l'éditeur, autant qu'il reste court.
    return MODELE.replace('__QUESTIONNAIRE__', json.dumps(spec, ensure_ascii=False, separators=(',', ':')))


def main(argv):
    if len(argv) != 3:
        print('Usage : python -I scripts/formulaire_google.py questionnaire.json sortie.gs', file=sys.stderr)
        return 2
    with open(argv[1], encoding='utf-8') as fh:
        spec = json.load(fh)
    code = generer(spec)
    with open(argv[2], 'w', encoding='utf-8', newline='') as fh:
        fh.write(code)
    questions = sum(len(section.get('questions', [])) for section in spec.get('sections', []))
    print(json.dumps({'sortie': os.path.abspath(argv[2]), 'questions': questions, 'caracteres': len(code)},
                     ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
