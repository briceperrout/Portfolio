// =====================================================================
//  CRÉDITS EN COURS, INDEMNITÉS DE REMBOURSEMENT ANTICIPÉ (IRA) ET ARBITRAGE « REMBOURSER OU PLACER »
//  Pur, aucun DOM, aucun accès au stockage : la date est injectée (`aujourdhui`) et ni `plan` ni `profil` ne sont modifiés.
//  Les indemnités légales viennent de fiscal.js (CREDIT, fiscalite/2026.js), jamais codées ici.
//  Modèle d'un crédit : { id, type: "immo"|"conso"|"auto"|"etudiant"|"revolving"|"ptz"|"autre", libelle, capitalRestant,
//  taux (% annuel), finCredit ("AAAA-MM"), mensualite (hors assurance, facultative), assuranceMensuelle (€ fixe),
//  tauxVariable, usage ("residence"|"locatif", immo), regimeReel (locatif) }.
//  Résultats indicatifs : ils ne remplacent ni le tableau d'amortissement de la banque ni un conseil personnalisé.
// =====================================================================

import { CREDIT, PRELEVEMENTS } from "./fiscal.js";
import { mensualitePret } from "./locatif.js";
import { TMI_PAR_DEFAUT } from "./alternatifs.js";
import { tmiDe, tauxGains, montantSecurite, capitalDe, eur } from "./moteur.js";

export const TYPES_CREDIT = {
  immo: "Immobilier", conso: "Consommation", auto: "Auto", etudiant: "Étudiant", revolving: "Renouvelable (revolving)", ptz: "Prêt à taux zéro (PTZ)", autre: "Autre",
};
// Types soumis aux règles du crédit à la consommation pour l'indemnité de remboursement anticipé
const TYPES_CONSO = ["conso", "auto", "etudiant", "autre"];
const MAX_MOIS = 600; // garde-fou des échéanciers

const nombre = (x) => (x === "" || x == null ? NaN : Number(x));
const positif = (x) => { const n = nombre(x); return Number.isFinite(n) && n > 0 ? n : 0; };
const arrondi2 = (x) => Math.round(x * 100) / 100;
const indexMois = (d) => d.getFullYear() * 12 + d.getMonth();
const AAAA_MM = /^(\d{4})-(\d{2})$/;
function indexFin(fin) {
  if (typeof fin === "number" && Number.isFinite(fin)) return Math.round(fin) * 12 + 11;
  const s = String(fin ?? "").trim();
  const m = AAAA_MM.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return Number(m[1]) * 12 + Number(m[2]) - 1;
  if (/^\d{4}$/.test(s)) return Number(s) * 12 + 11; // une année seule : fin décembre
  return null;
}
const moisVersAAAAMM = (idx) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;

/** Mois entre `aujourdhui` et la fin du crédit (≥ 0, arrondi au mois). 0 si la fin est inconnue ou passée. */
export function moisRestants(credit, aujourdhui = new Date()) {
  const f = indexFin(credit?.finCredit);
  return f == null ? 0 : Math.max(0, f - indexMois(aujourdhui));
}

/**
 * Échéancier mensuel : [{ mois, interets, capital, crd }] jusqu'à extinction (600 mois au plus).
 * Si la mensualité ne couvre pas les intérêts (ou est nulle), retourne [] avec la propriété `insuffisant = true`.
 */
export function echeancierMensuel(capital, tauxAnnuel, mensualite) {
  const lignes = [];
  lignes.insuffisant = false;
  let K = Number(capital) || 0;
  if (!(K > 0.005)) return lignes;
  const i = (Number(tauxAnnuel) || 0) / 100 / 12, m = Number(mensualite);
  if (!(m > 0) || (i > 0 && m <= K * i + 1e-9)) { lignes.insuffisant = true; return lignes; }
  for (let mois = 1; mois <= MAX_MOIS && K > 0.005; mois++) {
    const interets = K * i, paye = Math.min(m, K + interets), cap = paye - interets;
    K = Math.max(0, K - cap);
    lignes.push({ mois, interets, capital: cap, crd: K > 0.005 ? K : 0 });
  }
  if (K > 0.005) lignes.insuffisant = true;
  return lignes;
}

/** Copie du crédit avec des nombres valides, la mensualité complétée (annuité constante sur la durée restante) et le drapeau `incomplet`. */
export function normaliserCredit(credit, aujourdhui = new Date()) {
  const c = { ...(credit ?? {}) };
  c.type = c.type in TYPES_CREDIT ? c.type : "autre";
  c.capitalRestant = positif(c.capitalRestant);
  const t = nombre(c.taux);
  c.taux = Number.isFinite(t) && t >= 0 ? t : null;
  c.assuranceMensuelle = positif(c.assuranceMensuelle);
  c.tauxVariable = !!c.tauxVariable;
  c.regimeReel = !!c.regimeReel;
  if (c.type === "immo") c.usage = c.usage === "locatif" ? "locatif" : "residence";
  let m = positif(c.mensualite);
  if (c.taux != null && c.capitalRestant > 0) {
    const n = moisRestants(c, aujourdhui);
    if (!(m > 0) && n > 0) m = mensualitePret(c.capitalRestant, c.taux, n / 12);
    // Fin inconnue mais mensualité connue : la fin se déduit de l'échéancier
    if (indexFin(c.finCredit) == null && m > 0) {
      const e = echeancierMensuel(c.capitalRestant, c.taux, m);
      if (e.length) c.finCredit = moisVersAAAAMM(indexMois(aujourdhui) + e.length);
    }
  }
  c.mensualite = m;
  c.incomplet = c.taux == null || (c.capitalRestant > 0 && !(m > 0));
  return c;
}

/** Crédits du foyer, normalisés : le crédit du logement (logement.creditRestant, tauxCredit, assuranceCredit) puis `profil.credits`. */
export function creditsDuProfil(profil, aujourdhui = new Date()) {
  const liste = [];
  const L = profil?.logement ?? {};
  if (positif(L.creditRestant) > 0) {
    liste.push(normaliserCredit({
      id: "logement", type: "immo", libelle: "Crédit du logement", capitalRestant: L.creditRestant, taux: L.tauxCredit,
      finCredit: L.finCredit, mensualite: L.mensualite, assuranceMensuelle: L.assuranceCredit,
      usage: L.usage === "loue" ? "locatif" : "residence", regimeReel: L.regime === "reel" || L.regime === "lmnp-reel",
    }, aujourdhui));
  }
  (Array.isArray(profil?.credits) ? profil.credits : []).forEach((c, k) => {
    if (c && typeof c === "object") liste.push(normaliserCredit({ ...c, id: c.id ?? `credit-${k + 1}` }, aujourdhui));
  });
  return liste;
}

/** Somme des mensualités (assurance comprise) de `profil.credits`, hors crédit du logement : dérive `creditsMensuels`. */
export function mensualitesConso(profil, aujourdhui = new Date()) {
  const somme = (Array.isArray(profil?.credits) ? profil.credits : [])
    .map((c) => normaliserCredit(c, aujourdhui))
    .reduce((s, c) => s + (c.capitalRestant > 0 ? c.mensualite + c.assuranceMensuelle : 0), 0);
  return arrondi2(somme);
}
/** Source unique de `creditsMensuels` : la somme de la liste si elle n'est pas vide, sinon la valeur saisie (comportement historique). */
export function creditsMensuelsDe(profil, aujourdhui = new Date()) {
  return Array.isArray(profil?.credits) && profil.credits.length > 0 ? mensualitesConso(profil, aujourdhui) : (Number(profil?.creditsMensuels) || 0);
}

// ------------------------------------------------------------------ indemnité de remboursement anticipé
/**
 * Indemnité de remboursement anticipé et règle appliquée. Options : `ira` = "legale" (défaut), "aucune" ou un montant ;
 * `dejaRembourse12Mois` : capital déjà remboursé par anticipation sur les 12 derniers mois (seuil du crédit à la consommation).
 */
export function iraCredit(credit, capitalRembourse, aujourdhui = new Date(), { ira = "legale", dejaRembourse12Mois = 0 } = {}) {
  const c = normaliserCredit(credit, aujourdhui);
  const R = Math.min(positif(capitalRembourse), c.capitalRestant);
  if (ira === "aucune") return { ira: 0, regle: "Aucune indemnité (hypothèse choisie)" };
  if (typeof ira === "number" && Number.isFinite(ira)) return { ira: Math.max(0, ira), regle: "Indemnité saisie" };
  if (c.type === "ptz") return { ira: 0, regle: "Prêt à taux zéro : aucun intérêt, rien à gagner à le rembourser" };
  if (c.type === "immo") {
    const { moisInterets, plafondPctCRD } = CREDIT.immobilier;
    const brut = (R * (c.taux ?? 0) / 100) * (moisInterets / 12), plafond = (plafondPctCRD / 100) * c.capitalRestant;
    return { ira: Math.min(brut, plafond), regle: `${moisInterets} mois d'intérêts (plafond ${plafondPctCRD} % du capital restant dû)` };
  }
  const K = CREDIT.consommation;
  if (c.type === "revolving") return { ira: 0, regle: "Crédit renouvelable : taux non fixe, aucune indemnité" };
  if (c.tauxVariable) return { ira: 0, regle: "Taux non fixe : aucune indemnité" };
  if (R + positif(dejaRembourse12Mois) <= K.seuilSansIndemnite) return { ira: 0, regle: `Aucune indemnité jusqu'à ${eur(K.seuilSansIndemnite)} remboursés sur 12 mois` };
  const n = moisRestants(c, aujourdhui), pctApplique = n > K.seuilMois ? K.pctPlusUnAn : K.pctMoinsUnAn;
  const ech = echeancierMensuel(c.capitalRestant, c.taux ?? 0, c.mensualite);
  const interetsRestants = ech.insuffisant ? Infinity : ech.reduce((s, l) => s + l.interets, 0);
  return {
    ira: Math.min((R * pctApplique) / 100, interetsRestants),
    regle: `${String(pctApplique).replace(".", ",")} % du capital remboursé (${n > K.seuilMois ? `plus de ${K.seuilMois} mois restants` : `${K.seuilMois} mois restants ou moins`}), sans dépasser les intérêts restants`,
  };
}

// ------------------------------------------------------------------ remboursement anticipé
const paiements = (ech, assurance, n) => Array.from({ length: n }, (_, k) => (k < ech.length ? ech[k].interets + ech[k].capital + assurance : 0));
const sommeInterets = (ech) => ech.reduce((s, l) => s + l.interets, 0);

/**
 * Remboursement anticipé de `capitalRembourse` (borné au capital restant) : mode "duree" (mensualité conservée, durée réduite)
 * ou "mensualite" (durée conservée, mensualité recalculée). `fluxLiberes` : € libérés chaque mois sur l'horizon initial.
 */
export function rembourserAnticipe(credit, capitalRembourse, mode = "duree", aujourdhui = new Date()) {
  const c = normaliserCredit(credit, aujourdhui);
  const R = Math.min(positif(capitalRembourse), c.capitalRestant);
  const avantEch = echeancierMensuel(c.capitalRestant, c.taux ?? 0, c.mensualite);
  const nAvant = avantEch.length;
  const reste = c.capitalRestant - R;
  let apresEch, mensualiteApres;
  if (reste <= 0.005) { apresEch = []; mensualiteApres = 0; apresEch.insuffisant = false; }
  else if (mode === "mensualite") {
    mensualiteApres = nAvant > 0 ? mensualitePret(reste, c.taux ?? 0, nAvant / 12) : c.mensualite;
    apresEch = echeancierMensuel(reste, c.taux ?? 0, mensualiteApres);
  } else {
    mensualiteApres = c.mensualite;
    apresEch = echeancierMensuel(reste, c.taux ?? 0, mensualiteApres);
  }
  const horizon = Math.max(moisRestants(c, aujourdhui), nAvant);
  const ass = c.assuranceMensuelle;
  const pAvant = paiements(avantEch, ass, horizon), pApres = paiements(apresEch, ass, horizon);
  const moisGagnes = nAvant - apresEch.length;
  const avant = { mensualite: c.mensualite, mois: nAvant, interets: sommeInterets(avantEch) };
  const apres = { mensualite: mensualiteApres, mois: apresEch.length, interets: sommeInterets(apresEch) };
  return {
    capitalRembourse: R,
    avant, apres,
    interetsEconomises: avant.interets - apres.interets,
    assuranceEconomisee: mode === "mensualite" ? 0 : ass * Math.max(0, moisGagnes),
    fluxLiberes: pAvant.map((p, k) => p - pApres[k]),
    mensualiteInsuffisante: !!(avantEch.insuffisant || apresEch.insuffisant),
  };
}

/** Taux de rendement interne annualisé (%) de −sortie à t0 puis flux[k] au mois k+1 (bissection sur le taux mensuel). null si indéterminé. */
export function triMensuel(sortie, flux) {
  const S = Number(sortie);
  if (!(S > 0) || !Array.isArray(flux) || !flux.some((f) => f > 0)) return null;
  const valeur = (i) => flux.reduce((s, f, k) => s + f / Math.pow(1 + i, k + 1), 0) - S;
  let lo = -0.99, hi = 1;
  if (valeur(lo) < 0 || valeur(hi) > 0) return null;
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2;
    if (valeur(mid) > 0) lo = mid; else hi = mid;
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}

// ------------------------------------------------------------------ rendement d'une enveloppe, épargne de précaution
/** Classe d'actifs d'une enveloppe selon l'ordre de remplissage du plan (l'apport protégé « projet » ne sert qu'en dernier recours). */
export function classeEnveloppe(plan, enveloppe) {
  const contient = (cl) => (plan?.remplissage?.[cl] ?? []).some((x) => (typeof x === "string" ? x : x?.id) === enveloppe);
  const ordre = Object.keys(plan?.classes ?? {});
  return ordre.find((cl) => cl !== "projet" && contient(cl)) ?? (contient("projet") ? "projet" : null);
}
const rendementClasse = (plan, classe) => Number(plan?.hypotheses?.rendements?.[classe]) || 0;
const fiscaliteGains = (plan, enveloppe, profil) => tauxGains(plan, profil, enveloppe);
// Rendement net d'une épargne sans risque : la classe « sécurité » placée sur le Livret A (fiscalité de cette enveloppe)
const rendementNetPrudent = (plan) => rendementClasse(plan, "securite") * (1 - fiscaliteGains(plan, "livretA") / 100);

/** Épargne de précaution : total des livrets (enveloppes de la classe sécurité), cible du plan (montantSecurite) et excédent. */
export function epargnePrecaution(plan, profil) {
  const ids = (plan?.remplissage?.securite ?? []).map((x) => (typeof x === "string" ? x : x?.id));
  const livrets = ids.reduce((s, id) => s + positif(profil?.placements?.[id]), 0);
  const cible = montantSecurite(plan, { ...profil, capital: capitalDe(profil ?? {}) });
  return { livrets, cible, excedent: Math.max(0, livrets - cible) };
}

// ------------------------------------------------------------------ arbitrage rembourser / placer
/**
 * Compare deux emplois du même décaissement (capital remboursé + indemnité) jusqu'à la fin initiale du crédit :
 * « placer » (capitalisé dans l'enveloppe) ou « rembourser » (mensualités libérées placées mois par mois).
 * Le verdict compare le rendement garanti du remboursement au rendement net espéré du placement, majoré d'une prime de risque
 * (hypothèse de plan.hypotheses.primeRisqueRemboursement) quand le placement n'est pas sans risque. Simulation indicative.
 */
export function arbitrerRemboursement(plan, profil, credit, capitalRembourse, { mode = "duree", enveloppe = "pea", ira, aujourdhui = new Date() } = {}) {
  const c = normaliserCredit(credit, aujourdhui);
  const R = Math.min(positif(capitalRembourse), c.capitalRestant);
  const opt = ira === undefined ? {} : { ira };
  const I = iraCredit(c, R, aujourdhui, opt);
  const base = { ira: I.ira, regle: I.regle, capitalRembourse: R, sortie: R + I.ira, interetsEconomises: 0, assuranceEconomisee: 0, gainCertain: 0, valeurPlacer: 0, valeurRembourser: 0, ecart: 0, rendementGaranti: null, rendementNetEspere: 0, prime: 0, verdict: "sans-objet", avertissements: [], avant: null, apres: null };
  if (c.type === "ptz") { base.avertissements.push("Prêt à taux zéro : il ne coûte aucun intérêt, le rembourser par anticipation n'apporte rien."); return base; }
  if (c.incomplet || !(R > 0)) { base.avertissements.push("Crédit incomplet : renseignez le taux, la fin et la mensualité pour comparer."); return base; }

  const rb = rembourserAnticipe(c, R, mode, aujourdhui);
  const classe = classeEnveloppe(plan, enveloppe);
  const r = rendementClasse(plan, classe), fisc = fiscaliteGains(plan, enveloppe, profil) / 100;
  const rm = Math.pow(1 + r / 100, 1 / 12) - 1;
  const S = R + I.ira, h = rb.fluxLiberes.length;
  const net = (valeur, verse) => valeur - Math.max(0, valeur - verse) * fisc;
  const valeurPlacer = net(S * Math.pow(1 + rm, h), S);
  const brutRb = rb.fluxLiberes.reduce((s, f, k) => s + f * Math.pow(1 + rm, h - k - 1), 0);
  const valeurRembourser = net(brutRb, rb.fluxLiberes.reduce((s, f) => s + f, 0));
  const garanti = triMensuel(S, rb.fluxLiberes);
  const netEspere = r * (1 - fisc);
  const risque = plan?.classes?.[classe]?.risque;
  const prime = risque === "nul" || risque === "faible" ? 0 : Number(plan?.hypotheses?.primeRisqueRemboursement ?? 2);
  const gainCertain = rb.interetsEconomises + rb.assuranceEconomisee - I.ira;

  const av = [];
  try {
    const { livrets, cible } = epargnePrecaution(plan, profil);
    if (livrets - S < cible) av.push(`Épargne de précaution : après ce décaissement, tes livrets (${eur(Math.max(0, livrets - S))}) passeraient sous la cible du plan (${eur(cible)}). Garde d'abord une réserve pour les imprévus.`);
  } catch { /* profil incomplet : pas de contrôle de précaution */ }
  av.push("Un remboursement anticipé est irréversible : l'argent ne pourra pas être repris, sauf à emprunter de nouveau, probablement plus cher.");
  if (c.tauxVariable) av.push("Taux variable : le coût futur du crédit peut évoluer, la simulation retient le taux actuel.");
  if (rb.mensualiteInsuffisante) av.push("La mensualité ne couvre pas les intérêts : vérifiez les données du crédit, le calcul est incomplet.");
  if (prime > 0) av.push("Le placement alternatif n'est pas garanti : son rendement espéré peut ne pas être atteint, alors que l'économie d'intérêts est certaine.");

  return {
    ...base,
    interetsEconomises: rb.interetsEconomises, assuranceEconomisee: rb.assuranceEconomisee, gainCertain,
    valeurPlacer, valeurRembourser, ecart: valeurRembourser - valeurPlacer,
    rendementGaranti: garanti, rendementNetEspere: netEspere, prime,
    verdict: garanti != null && garanti + prime >= netEspere ? "rembourser" : "placer",
    avertissements: av, avant: rb.avant, apres: rb.apres, mode,
  };
}

// ------------------------------------------------------------------ priorisation
/**
 * Crédits classés par coût net décroissant. Coût net = taux, sauf bien locatif au régime réel (intérêts déductibles :
 * taux × (1 − (TMI + prélèvements sociaux))). Exclus, avec motif : PTZ, taux nul, crédit incomplet.
 * `prioritaire` : coût net supérieur au rendement net d'une épargne sans risque.
 */
export function prioriserCredits(plan, profil, aujourdhui = new Date()) {
  const tmi = tmiDe(profil ?? {}) ?? TMI_PAR_DEFAUT;
  const prudent = rendementNetPrudent(plan);
  const credits = [], exclus = [];
  for (const c of creditsDuProfil(profil, aujourdhui)) {
    const id = { id: c.id, libelle: c.libelle || TYPES_CREDIT[c.type], type: c.type };
    if (c.type === "ptz") { exclus.push({ ...id, motif: "Prêt à taux zéro : à conserver" }); continue; }
    if (c.incomplet) { exclus.push({ ...id, motif: "Crédit incomplet : taux ou mensualité manquants" }); continue; }
    if (!(c.taux > 0)) { exclus.push({ ...id, motif: "Taux nul : aucun intérêt à économiser" }); continue; }
    const deductible = c.type === "immo" && c.usage === "locatif" && c.regimeReel;
    const coutNet = deductible ? c.taux * (1 - (tmi + PRELEVEMENTS.PS_PATRIMOINE) / 100) : c.taux;
    const n = moisRestants(c, aujourdhui);
    credits.push({ ...id, taux: c.taux, coutNet, capitalRestant: c.capitalRestant, moisRestants: n, iraTotale: iraCredit(c, c.capitalRestant, aujourdhui).ira, prioritaire: coutNet > prudent });
  }
  credits.sort((a, b) => b.coutNet - a.coutNet);
  return { credits, exclus, rendementNetPrudent: prudent };
}
