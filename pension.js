// =====================================================================
//  RETRAITE PUBLIQUE — estimation simplifiée pour un salarié du privé.
//  Base (Assurance retraite) + complémentaire (Agirc-Arrco), en euros
//  d'aujourd'hui. Hypothèses : une année travaillée = 4 trimestres, les
//  salaires passés suivent le profil de carrière, pas de période de
//  chômage, de maladie ou d'enfants (trimestres en plus non comptés).
//  Ne remplace pas le relevé officiel (info-retraite.fr).
// =====================================================================
import { facteurSalaire, carriereDe, hausseReelle, normaliserFoyer } from "./moteur.js";
import { decomposerSalaire, foyerFiscal, apresImpot } from "./fiscal.js";

// Âge légal et trimestres requis selon l'année de naissance (réforme 2023,
// suspendue par la loi de financement de la Sécurité sociale pour 2026)
export function reglesGeneration(plan, annee) {
  const R = plan.retraitePublique ?? {};
  const table = [
    [1960, 62, 167], [1961, 62.25, 168], [1962, 62.5, 169], [1963, 62.75, 170], [1964, 62.75, 170],
    [1965, 63, 171], [1966, 63.25, 172], [1967, 63.5, 172], [1968, 63.75, 172],
  ];
  if (annee <= 1960) return { ageLegal: 62, trimestres: 167 };
  const t = table.find(([a]) => a === annee);
  if (t) return { ageLegal: t[1], trimestres: t[2] };
  return { ageLegal: R.ageLegal ?? 64, trimestres: R.trimestresRequis ?? 172 };
}
export const ageEnTexte = (a) => {
  const ans = Math.floor(a), mois = Math.round((a - ans) * 12);
  return mois ? `${ans} ans et ${mois} mois` : `${ans} ans`;
};

// Salaires nets mensuels de toute la carrière, en euros d'aujourd'hui
function salairesCarriere(plan, profilSaisi, ageDebut, ageArret) {
  const infl = (plan.hypotheses?.inflation ?? 0) / 100;
  const p = normaliserFoyer(plan, { ...profilSaisi, foyer: { actif: false } });
  // Le salaire saisi est « net après impôt » : les droits à la retraite se calculent sur le brut
  const sSaisi = Number(p.salaireNetMensuel) || 0;
  const s0 = decomposerSalaire(sSaisi, foyerFiscal(profilSaisi)).netAvant;
  const age = Math.round(p.age ?? 30);
  const c = carriereDe(plan, p);
  const out = [];
  for (let a = Math.round(ageDebut); a < Math.round(ageArret); a++) {
    let s;
    if (a >= age) s = (s0 * facteurSalaire(plan, p, a - age)) / Math.pow(1 + infl, a - age);
    else { s = s0; for (let k = a; k < age; k++) s /= 1 + hausseReelle(c, k) / 100; }  // années passées : on remonte la carrière
    out.push({ age: a, net: s });
  }
  return out;
}

export function estimerPension(plan, profilSaisi, { ageDebut, trimestresDeja = null, ageArret, ageDemande, trimestresEnfants = 0 }) {
  const R = plan.retraitePublique ?? {};
  const age = Math.round(profilSaisi.age ?? 30);
  const naissance = new Date().getFullYear() - age;
  const regles = reglesGeneration(plan, naissance);
  const debut = Math.max(14, Math.min(Number(ageDebut) || R.ageDebutCarriere || 22, ageArret));
  const annees = salairesCarriere(plan, profilSaisi, debut, ageArret);
  // Trimestres : relevé saisi pour le passé, sinon 4 par année travaillée
  const passes = trimestresDeja != null && trimestresDeja !== "" ? Math.max(0, Number(trimestresDeja)) : Math.max(0, 4 * (Math.min(age, ageArret) - debut));
  const futurs = Math.max(0, 4 * (ageArret - Math.max(age, debut)));
  // Trimestres pour enfants (majoration de durée d'assurance : jusqu'à 8 par enfant, souvent pour la mère)
  const trimEnfants = Math.max(0, Math.round(Number(trimestresEnfants) || 0));
  const trimestres = Math.round(passes + futurs + trimEnfants);
  // Trimestres travaillés après l'âge légal (seuls ceux-là ouvrent droit à la surcote)
  const trimApresLegal = Math.max(0, Math.round((ageArret - regles.ageLegal) * 4));
  const enfants = Math.max(0, Math.round(Number(profilSaisi.enfants) || 0));
  const PASS = R.pass ?? 48060, brut = (net) => (net * 12) / ((R.netSurBrutSalaire ?? 78) / 100);
  // Base : 25 meilleures années, plafonnées au PASS
  const plafonnes = annees.map((x) => Math.min(brut(x.net), PASS)).sort((a, b) => b - a);
  const meilleures = plafonnes.slice(0, 25);
  const sam = meilleures.length ? meilleures.reduce((t, x) => t + x, 0) / meilleures.length : 0;
  // Complémentaire : points achetés chaque année
  const points = annees.reduce((t, x) => {
    const b = brut(x.net);
    return t + (Math.min(b, PASS) * (R.agircTauxT1 ?? 6.2) / 100 + Math.max(0, Math.min(b, 8 * PASS) - PASS) * (R.agircTauxT2 ?? 17) / 100) / (R.agircPrixAchat ?? 20.1877);
  }, 0);
  const calcul = (A) => {
    const a = Math.max(A, regles.ageLegal);
    const manque = Math.max(0, regles.trimestres - trimestres);
    const manqueAge = Math.max(0, Math.round(((R.ageTauxPlein ?? 67) - a) * 4));
    const decote = Math.min(manque, manqueAge, 20);
    const taux = (R.tauxPlein ?? 50) - decote * (R.decoteParTrimestre ?? 0.625);
    const prorata = Math.min(1, trimestres / regles.trimestres);
    // Surcote : +1,25 % par trimestre travaillé après l'âge légal au-delà de la durée requise (régime de base)
    const trimSurcote = decote === 0 ? Math.max(0, Math.min(trimApresLegal, trimestres - regles.trimestres)) : 0;
    const surcote = trimSurcote * (R.surcoteParTrimestre ?? 1.25);
    // Enfants : +10 % pour avoir eu ou élevé au moins 3 enfants (base, et complémentaire Agirc-Arrco)
    const majEnfants = enfants >= 3 ? (R.majorationTroisEnfants ?? 10) : 0;
    const baseBrute = sam * (taux / 100) * prorata * (1 + surcote / 100) * (1 + majEnfants / 100);
    // Complémentaire réduite elle aussi sans taux plein (approximation : même proportion que la base) ; plus de malus depuis décembre 2023
    const complBrute = points * (R.agircValeurPoint ?? 1.4587) * (taux / (R.tauxPlein ?? 50)) * (1 + majEnfants / 100);
    const net = ((baseBrute + complBrute) * (R.netSurBrutPension ?? 90)) / 100 / 12;
    return { age: a, taux, decote, prorata, base: (baseBrute * (R.netSurBrutPension ?? 90)) / 100 / 12, complementaire: (complBrute * (R.netSurBrutPension ?? 90)) / 100 / 12, net, apres: apresImpot(net), tauxPlein: decote === 0, surcote, trimSurcote, majEnfants };
  };
  return {
    naissance, regles, debut, trimestres, passes, futurs, trimEnfants, enfants, sam, points: Math.round(points),
    annees: annees.length, auLegal: calcul(regles.ageLegal), aTauxPlein: calcul(R.ageTauxPlein ?? 67),
    demande: calcul(Number(ageDemande) || regles.ageLegal),
  };
}
