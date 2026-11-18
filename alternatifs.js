// =====================================================================
//  PLACEMENTS ALTERNATIFS : SCPI (fiscalité réelle, SCPI européennes, délai de jouissance) et nue-propriété temporaire
//  Pur, aucun DOM, aucun accès au stockage. Les taux réglementaires viennent de fiscal.js (PRELEVEMENTS) ; les valeurs du foyer
//  (revenu imposable, parts, tranche marginale) sont passées en paramètres par un adaptateur côté moteur.js (tauxGains) ou app.js.
//  Résultats indicatifs : ils ne remplacent ni le calcul de l'administration ni un conseil personnalisé.
//
//  Fiscalité des SCPI : les loyers distribués sont des revenus fonciers (régime réel, revenus distribués nets de charges ; le micro-foncier
//  n'est pas modélisé), imposés au barème de l'impôt sur le revenu et aux prélèvements sociaux (PRELEVEMENTS.PS_PATRIMOINE).
//  SCPI européennes : les revenus de source étrangère sont en principe imposés dans le pays de situation de l'immeuble, puis, en France,
//  soit exonérés avec « taux effectif » (la France calcule l'impôt comme si ces revenus étaient imposables, au prorata des revenus
//  français), soit imposés avec crédit d'impôt égal à l'impôt français ; les deux mécanismes donnent le même coût pour le foyer
//  (conventions fiscales bilatérales). Les prélèvements sociaux ne sont pas dus sur ces revenus pour les affiliés à un régime de
//  sécurité sociale de l'Union européenne.
// =====================================================================

import { impotBareme, PRELEVEMENTS } from "./fiscal.js";
import { triAnnuel } from "./locatif.js";

// Hypothèse (non réglementaire) quand la tranche marginale est inconnue : tranche courante des épargnants qui investissent en SCPI
export const TMI_PAR_DEFAUT = 30;
// Revenu de référence (en euros) pour exprimer la fiscalité en pourcentage
const REVENU_REFERENCE = 1000;

const nombre = (x) => (x === "" || x == null ? NaN : Number(x));
const positif = (x) => { const n = nombre(x); return Number.isFinite(n) && n > 0 ? n : 0; };

/**
 * Fiscalité des revenus d'une SCPI pour un foyer.
 * foyer : { revenuImposable (€/an, hors SCPI), parts, partsBase (facultatif), tmi (%) }. Si revenuImposable et parts sont connus : calcul exact
 * par différence d'impôt (barème, décote et plafonnement du quotient familial de fiscal.js) ; sinon approche « revenu × tranche marginale ».
 * options : partEtrangere (% des revenus de source européenne), impotEtranger (% retenu à l'étranger sur ces revenus).
 * Retour : { tauxGlobal (%), irFrance, psFrance, impotEtranger, surcoutTauxEffectif, mode: "exact"|"approche", tmiEstimee }.
 */
export function fiscaliteScpi(foyer, revenuScpi, { partEtrangere = 0, impotEtranger = 0 } = {}) {
  const revenu = positif(revenuScpi);
  const pe = Math.min(100, positif(partEtrangere)), taxeEtr = positif(impotEtranger);
  const Rfr = revenu * (1 - pe / 100), Re = revenu * (pe / 100);
  const parts = positif(foyer?.parts), R0 = nombre(foyer?.revenuImposable);
  const exact = parts > 0 && Number.isFinite(R0) && R0 >= 0;
  const impotEtrangerEuros = (Re * taxeEtr) / 100;
  let irFrance, surcout = 0, tmiEstimee = false;
  if (exact) {
    const base = positif(foyer.partsBase) > 0 ? positif(foyer.partsBase) : parts;
    const impot = (r) => impotBareme(r, parts, base).impot;
    irFrance = impot(R0 + Rfr) - impot(R0);
    // Taux effectif : les revenus étrangers, exonérés en France, relèvent le taux appliqué aux revenus français
    const total = R0 + Rfr + Re;
    surcout = total > 0 ? (impot(total) * (R0 + Rfr)) / total - impot(R0 + Rfr) : 0;
    surcout = Math.max(0, surcout);
  } else {
    const tmi = nombre(foyer?.tmi);
    tmiEstimee = !Number.isFinite(tmi);
    irFrance = (Rfr * (tmiEstimee ? TMI_PAR_DEFAUT : tmi)) / 100;
  }
  const psFrance = (Rfr * PRELEVEMENTS.PS_PATRIMOINE) / 100;
  const tauxGlobal = revenu > 0 ? ((irFrance + psFrance + surcout + impotEtrangerEuros) / revenu) * 100 : 0;
  return { tauxGlobal, irFrance, psFrance, impotEtranger: impotEtrangerEuros, surcoutTauxEffectif: surcout, mode: exact ? "exact" : "approche", tmiEstimee };
}

/** Taux global d'imposition (%) des revenus d'une SCPI pour ce foyer, sur 1 000 € de revenus (voir fiscaliteScpi). */
export const tauxFiscalScpi = (foyer, options) => fiscaliteScpi(foyer, REVENU_REFERENCE, options).tauxGlobal;

/** Part (%) du versement perdue pendant le délai de jouissance (les parts ne rapportent rien tant que le délai court). */
export const coutJouissance = (tauxDistribution, delaiMois) => (positif(tauxDistribution) * positif(delaiMois)) / 12;

/** Délai de jouissance retenu (mois) : celui du profil s'il est renseigné, sinon l'hypothèse du plan (plan.hypotheses.scpi). */
export function delaiJouissance(hypotheses, delaiProfil = null) {
  const saisi = nombre(delaiProfil);
  return Number.isFinite(saisi) && saisi >= 0 ? saisi : positif(hypotheses?.scpi?.delaiJouissanceMois);
}

/** Frais d'entrée effectifs (%) d'une souscription de SCPI : frais de souscription + manque à gagner du délai de jouissance. */
export function fraisEntreeScpiEffectifs(hypotheses, delaiProfil = null) {
  return positif(hypotheses?.fraisEntree?.scpi) + coutJouissance(hypotheses?.rendements?.scpi, delaiJouissance(hypotheses, delaiProfil));
}

/** Décote (%) de la nue-propriété sur une durée : valeur actualisée des revenus abandonnés (estimation économique, pas un barème). */
export function decoteNuePropriete(tauxDistribution, dureeAns) {
  const d = positif(tauxDistribution), n = positif(dureeAns);
  return d > 0 && n > 0 ? (1 - Math.pow(1 + d / 100, -n)) * 100 : 0;
}

/**
 * Nue-propriété temporaire contre pleine propriété, sur la durée du démembrement. Tous les taux sont en %.
 * La pleine propriété verse chaque année un revenu net d'impôt (tauxFiscal : taux global de fiscaliteScpi), la première année réduite
 * par le délai de jouissance ; la nue-propriété ne verse rien mais s'achète avec une décote et se retrouve en pleine propriété à l'échéance.
 * Retour : { decote, decoteEstimee, valeurFinaleNP, triNP, triPP (%), ecart (points), revenusNetsPP (total), fluxPP, avertissements }, ou null si les entrées sont inexploitables.
 */
export function comparerNuePropriete({ montant, dureeAns, tauxDistribution, revalorisation = 0, decote = null, fraisEntree = 0, delaiJouissanceMois = 0, tauxFiscal = 0 } = {}) {
  const M = positif(montant), n = Math.round(positif(dureeAns));
  if (!(M > 0) || n < 1) return null;
  const d = positif(tauxDistribution) / 100, g = (Number.isFinite(nombre(revalorisation)) ? nombre(revalorisation) : 0) / 100;
  const frais = Math.min(99, positif(fraisEntree)) / 100, fisc = Math.min(100, positif(tauxFiscal)) / 100;
  const saisie = nombre(decote);
  const decoteEstimee = !(Number.isFinite(saisie) && saisie > 0);
  const dec = decoteEstimee ? decoteNuePropriete(d * 100, n) : Math.min(99, saisie);

  // Nue-propriété : aucun revenu, valeur de la pleine propriété retrouvée à l'échéance
  const valeurAcquise = (M * (1 - frais)) / (1 - dec / 100);
  const valeurFinaleNP = valeurAcquise * Math.pow(1 + g, n);
  const triNP = (Math.pow(valeurFinaleNP / M, 1 / n) - 1) * 100;

  // Pleine propriété : revenus nets chaque fin d'année, revente à la valeur des parts
  const parts0 = M * (1 - frais);
  const prorata = Math.max(0, 12 - positif(delaiJouissanceMois)) / 12;
  const fluxPP = [-M];
  let revenusNetsPP = 0;
  for (let k = 1; k <= n; k++) {
    const valeurParts = parts0 * Math.pow(1 + g, k - 1);
    const revenu = d * valeurParts * (1 - fisc) * (k === 1 ? prorata : 1);
    revenusNetsPP += revenu;
    fluxPP.push(revenu + (k === n ? parts0 * Math.pow(1 + g, n) : 0));
  }
  const triPP = triAnnuel(fluxPP) * 100;

  const avertissements = [
    "À la revente, le prix d'acquisition retenu est celui de la nue-propriété : la décote entre dans la plus-value immobilière imposable (" + String(PRELEVEMENTS.IR_PV_IMMO).replace(".", ",") + " % + prélèvements sociaux, abattements pour durée de détention).",
    "Pendant le démembrement, les parts ne sont pas dans ton assiette IFI (c'est l'usufruitier qui la supporte).",
  ];
  if (decoteEstimee) avertissements.push("Décote estimée : la décote réelle est fixée par la société de gestion.");
  return { decote: dec, decoteEstimee, valeurFinaleNP, triNP, triPP, ecart: triNP - triPP, revenusNetsPP, fluxPP, avertissements };
}
