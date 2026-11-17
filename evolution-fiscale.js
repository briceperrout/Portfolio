// =====================================================================
//  ÉVOLUTION DE LA FISCALITÉ — « et si les règles changeaient ? »
//  Des scénarios de changement (pistes réellement débattues à l'automne
//  2026 pour le budget 2027, et quelques cas extrêmes) appliqués à partir
//  d'une année choisie. Ce ne sont pas des prévisions : ils servent à voir
//  à quel point ton plan dépend de la fiscalité d'aujourd'hui.
// =====================================================================

import { PRELEVEMENTS, PFU as PFU_ACTUEL } from "./fiscal.js";

// Réglages d'un changement :
//  dPS     : prélèvements sociaux, en points (18,6 % aujourd'hui sur la plupart des placements, 17,2 % sur l'assurance-vie et les loyers)
//  dIR     : part « impôt sur le revenu » de la flat tax, en points (12,8 % aujourd'hui)
//  peaIR   : le PEA de plus de 5 ans paie aussi l'impôt sur le revenu (comme un compte-titres)
//  avFin   : l'assurance-vie de plus de 8 ans perd son taux réduit (7,5 %) et paie la flat tax entière
//  livrets : Livret A, LDDS, LEP et Livret Jeune deviennent imposés comme les autres intérêts
//  perDed  : part de l'économie d'impôt du PER qui reste (100 % = inchangée)
//  perSortie : tranche d'imposition appliquée à la sortie du PER (null = celle du plan)
//  lmnp    : l'amortissement en location meublée (LMNP au réel) reste possible
export const NEUTRE = { dPS: 0, dIR: 0, peaIR: false, avFin: false, livrets: false, perDed: 100, perSortie: null, lmnp: true };

export const SCENARIOS_FISCAUX = [
  { id: "ps", nom: "Prélèvements sociaux +1,4 point", court: "CSG +1,4 pt",
    texte: "Piste discutée pour le budget de la Sécurité sociale 2027 : flat tax à 32,8 % au lieu de 31,4 %, sur tous les placements et les loyers.",
    h: { dPS: 1.4 } },
  { id: "pfu", nom: "Flat tax à 34,4 %", court: "Flat tax 34,4 %",
    texte: "Amendement déposé à l'automne 2026 (sur les dividendes), étendu ici à tous les gains : la part impôt passe de 12,8 % à 15,8 %.",
    h: { dIR: 3 } },
  { id: "av", nom: "Assurance-vie moins avantageuse", court: "Assurance-vie",
    texte: "Après 8 ans, plus de taux réduit de 7,5 % : les gains paient la flat tax entière, comme un compte-titres. Souvent évoqué, jamais voté.",
    h: { avFin: true } },
  { id: "pea", nom: "PEA imposé comme un compte-titres", court: "PEA",
    texte: "Après 5 ans, les gains paieraient aussi l'impôt sur le revenu (12,8 %) en plus des prélèvements sociaux. Cas extrême, jamais proposé sérieusement.",
    h: { peaIR: true } },
  { id: "livrets", nom: "Livrets imposés", court: "Livrets",
    texte: "Les intérêts du Livret A, du LDDS et du LEP seraient imposés comme ceux d'un livret bancaire. Cas extrême.",
    h: { livrets: true } },
  { id: "per", nom: "PER moins avantageux", court: "PER",
    texte: "Économie d'impôt réduite de moitié (déduction plafonnée) et sortie taxée à 30 % au lieu de ta tranche prévue à la retraite.",
    h: { perDed: 50, perSortie: 30 } },
  { id: "lmnp", nom: "Fin de l'amortissement en meublé (LMNP)", court: "LMNP",
    texte: "Proposé dans le projet de budget 2027 sous forme de plafond, retiré par les députés fin octobre 2026 ; le Sénat peut le remettre. Ici, l'amortissement disparaît complètement.",
    h: { lmnp: false } },
  { id: "noir", nom: "Scénario noir : tout à la fois", court: "Tout à la fois",
    texte: "Hausse des prélèvements sociaux et de la flat tax, assurance-vie, PEA, livrets et PER moins avantageux, fin de l'amortissement en meublé.",
    h: { dPS: 1.4, dIR: 3, avFin: true, peaIR: true, livrets: true, perDed: 50, perSortie: 30, lmnp: false } },
  { id: "baisse", nom: "Retour à la flat tax de 30 %", court: "Baisse",
    texte: "Les prélèvements sociaux reviennent à 17,2 %, comme de 2018 à 2025 : flat tax à 30 %.",
    h: { dPS: -1.4 } },
];

const PFU = ["livretBancaire", "pel", "cto", "plateformeCrypto", "coldWallet", "per"];
const AV = ["assuranceVie", "assuranceVieUC"];
const LIVRETS = ["livretA", "ldds", "lep", "livretJeune"];
const ECART_PS = Math.round((PRELEVEMENTS.PS_CAPITAL - PRELEVEMENTS.PS_PATRIMOINE) * 10) / 10; // 1,4 point
export const IR_PFU = PRELEVEMENTS.IR_PFU;

// Le plan avec les nouvelles règles (copie : le plan d'origine n'est pas modifié)
export function planFiscal(plan, hSaisi) {
  const h = { ...NEUTRE, ...hSaisi };
  const F = plan.fiscalite ?? {}, G = F.gains ?? {};
  const pfu = (G.cto ?? PFU_ACTUEL) + h.dPS + h.dIR;
  const gains = { ...G };
  for (const e of Object.keys(G)) {
    if (PFU.includes(e)) gains[e] = G[e] + h.dPS + h.dIR;
    else if (AV.includes(e)) gains[e] = h.avFin ? pfu - ECART_PS /* prélèvements de l'assurance-vie : 17,2 % */ : G[e] + h.dPS;
    else if (e === "pea") gains[e] = G[e] + h.dPS + (h.peaIR ? IR_PFU + h.dIR : 0);
    else if (LIVRETS.includes(e)) gains[e] = h.livrets ? pfu : G[e];
    else if (G[e] > 0) gains[e] = G[e] + h.dPS;   // SCPI, autres
  }
  const or = F.or ? { ...F.or, plusValue: F.or.plusValue + h.dPS } : F.or;
  const locatif = { ps: (F.locatif?.ps ?? PRELEVEMENTS.PS_PATRIMOINE) + h.dPS, amortissementLMNP: h.lmnp };
  const per = { ...(plan.per ?? {}), ...(h.perSortie != null ? { tmiRetraite: h.perSortie } : {}) };
  return { ...plan, fiscalite: { ...F, gains, or, locatif }, per };
}

// Option à passer à la projection : nouvelles règles à partir de l'année « annee » (0 = cette année)
export function optionFiscale(plan, hSaisi, annee) {
  const h = { ...NEUTRE, ...hSaisi };
  const p = planFiscal(plan, h);
  return { annee: Math.max(0, Math.round(annee)), plan: p, perDeduction: h.perDed / 100, tauxLivrets: h.livrets ? (p.fiscalite.gains.livretA ?? 0) / 100 : 0, h };
}

// Taux sur les gains, produit par produit : aujourd'hui et dans le scénario
export function comparerTaux(plan, hSaisi) {
  const h = { ...NEUTRE, ...hSaisi };
  const a = plan.fiscalite?.gains ?? {}, b = planFiscal(plan, h).fiscalite.gains;
  const lignes = [
    ["Livret A, LDDS, LEP", "livretA"], ["Livret bancaire, PEL", "livretBancaire"], ["PEA (après 5 ans)", "pea"],
    ["Assurance-vie (après 8 ans)", "assuranceVie"], ["Compte-titres, bitcoin", "cto"], ["PER (gains à la sortie)", "per"], ["SCPI (loyers et gains)", "scpi"],
  ].map(([nom, e]) => ({ nom, e, avant: a[e] ?? 0, apres: b[e] ?? 0 }));
  lignes.push({ nom: "Loyers (prélèvements sociaux)", e: "locatif", avant: plan.fiscalite?.locatif?.ps ?? PRELEVEMENTS.PS_PATRIMOINE, apres: (plan.fiscalite?.locatif?.ps ?? PRELEVEMENTS.PS_PATRIMOINE) + h.dPS });
  return lignes;
}
export const estNeutre = (h) => JSON.stringify({ ...NEUTRE, ...h }) === JSON.stringify(NEUTRE);
