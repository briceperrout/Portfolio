// =====================================================================
//  PROJECTION — évolution du patrimoine année par année, en appliquant
//  le plan chaque année (paliers, âge, apport, achat de la résidence).
//  Scénario central (rendements moyens) + éventail de scénarios tirés
//  au hasard selon la volatilité de chaque classe.
// =====================================================================
import { fluxLocatif, projetLocatifDe, echeancier } from "./locatif.js";
import { PRELEVEMENTS, PFU, PLAFONDS, foyerFiscal, revenuImposablePension } from "./fiscal.js";
import { planifierRetraits, impotsAuDeces, STRATEGIES_DECUMULATION } from "./pension.js";
import { droitsSurRegistre, reserveAVTransmissible } from "./succession.js";
import { totalGroupe, allocationCible, actuelParClasse, repartirEnEnveloppes, capitalDe, achatResidence, analyser, chargesProprietaire, normaliserFoyer, resideEnFrance, paysDe, facteurSalaire, interessementPlace, locatifFinancable } from "./moteur.js";

const somme = (o) => Object.values(o).reduce((s, x) => s + x, 0);

// Générateur pseudo-aléatoire reproductible (mêmes scénarios à chaque affichage)
export function generateur(graine) {
  let a = graine >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let reserve = null;
  const gauss = () => {
    if (reserve !== null) { const r = reserve; reserve = null; return r; }
    const u = Math.max(rnd(), 1e-12), v = rnd();
    const rayon = Math.sqrt(-2 * Math.log(u));
    reserve = rayon * Math.sin(2 * Math.PI * v);
    return rayon * Math.cos(2 * Math.PI * v);
  };
  // Uniforme [0, 1) du même flux : transitions de régime (corrélations dynamiques). Jamais appelée en mode indépendant.
  gauss.uniforme = rnd;
  return gauss;
}

// Rendement annuel tiré au hasard : loi log-normale de moyenne m et d'écart-type s
// lognormal(m, s, z) : même loi à partir d'une gaussienne standard z déjà tirée (éventuellement corrélée)
function lognormal(m, s, z) {
  if (!s) return m;
  const sl = Math.sqrt(Math.log(1 + (s * s) / ((1 + m) * (1 + m))));
  const ml = Math.log(1 + m) - (sl * sl) / 2;
  return Math.exp(ml + sl * z) - 1;
}
function tirage(m, s, gauss) {
  if (!s) return m;
  return lognormal(m, s, gauss());
}

// ------------------------------------------------------------- corrélations dynamiques par régime
// Deux régimes de marché (normal / crise) : en crise, les actifs risqués chutent ensemble (corrélations fortes entre
// bourse, bitcoin et SCPI) et l'or et le prudent jouent leur rôle de refuge. Matrices définies positives.
export const MATRICES_CORRELATION = {
  ordre: ["bourse", "or", "bitcoin", "scpi", "prudent"],
  normal: [[1, .05, .35, .30, 0], [.05, 1, .1, 0, .1], [.35, .1, 1, .1, 0], [.30, 0, .1, 1, .2], [0, .1, 0, .2, 1]],
  crise: [[1, -.2, .85, .6, -.3], [-.2, 1, -.1, -.1, .2], [.85, -.1, 1, .55, -.2], [.6, -.1, .55, 1, -.1], [-.3, .2, -.2, -.1, 1]],
};
// Chaîne de Markov à deux états : `entree` = probabilité de passer de normal à crise, `maintien` = de rester en crise.
// Rendement (moyenne m, écart-type s, en %) des classes en régime de crise.
export const REGIMES = { entree: 0.08, maintien: 0.35, crise: { bourse: { m: -22, s: 18 }, bitcoin: { m: -55, s: 50 }, scpi: { m: -4, s: 6 } } };
const proportionCrise = () => REGIMES.entree / (REGIMES.entree + 1 - REGIMES.maintien);

// Décomposition de Cholesky : L triangulaire inférieure avec L·Lᵀ = M ; erreur si M n'est pas définie positive
export function cholesky(M) {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let t = M[i][j];
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(t > 1e-12)) throw new Error("cholesky : la matrice n'est pas définie positive.");
        L[i][j] = Math.sqrt(t);
      } else L[i][j] = t / L[j][j];
    }
  }
  return L;
}

// Rendements par régime (en %) qui préservent, sur le mélange des deux régimes, la moyenne m et la variance s² de chaque classe.
// Classes sans régime de crise propre, ou dont la variance « normale » serait négative : mêmes (m, s) dans les deux régimes
// (seule la corrélation s'applique).
export function etalonnerRegimes(rendements, volatilites = {}) {
  const pi = proportionCrise();
  const sortie = {};
  for (const c of Object.keys(rendements)) {
    const m = rendements[c] ?? 0, s = volatilites?.[c] ?? 0, K = REGIMES.crise[c];
    sortie[c] = { normal: { m, s }, crise: { m, s } };
    if (!K || !(s > 0)) continue;
    const mn = (m - pi * K.m) / (1 - pi);
    const s2n = (s * s - pi * (K.s * K.s + (K.m - m) ** 2) - (1 - pi) * (mn - m) ** 2) / (1 - pi);
    if (s2n < 0) continue;
    sortie[c] = { normal: { m: mn, s: Math.sqrt(s2n) }, crise: { m: K.m, s: K.s } };
  }
  return sortie;
}

// Préparation (une fois par série de tirages) : null si les classes sont supposées indépendantes
export function preparerCorrelations(H) {
  if (H?.correlations === "independantes") return null;
  return { ordre: MATRICES_CORRELATION.ordre, L: { normal: cholesky(MATRICES_CORRELATION.normal), crise: cholesky(MATRICES_CORRELATION.crise) },
    params: etalonnerRegimes(H.rendements, H.volatilites ?? {}) };
}

// Rendements (fractions) d'UNE année pour les classes de `ordre` : transition de régime, gaussiennes corrélées par Cholesky,
// puis transformation log-normale avec les (m, s) du régime. Classes de volatilité nulle : rendement moyen, inchangé.
export function rendementsCorreles(corr, gauss, regimePrecedent) {
  const u = gauss.uniforme();
  const regime = u < (regimePrecedent === "crise" ? REGIMES.maintien : REGIMES.entree) ? "crise" : "normal";
  const g = corr.ordre.map(() => gauss());
  const L = corr.L[regime];
  const r = {};
  corr.ordre.forEach((c, i) => {
    let z = 0;
    for (let j = 0; j <= i; j++) z += L[i][j] * g[j];
    const P = corr.params[c]?.[regime];
    if (P && P.s > 0) r[c] = lognormal(P.m / 100, P.s / 100, z);
  });
  return { regime, r };
}

// Indice d'inflation cumulé : indice(y) = prix à l'année y / prix à l'année `depuis` (0 = aujourd'hui).
// Convention : l'année k du scénario (rendement ET inflation de choc.annees[k - choc.debut]) s'écoule entre le point k et
// le point k+1, comme le rendement appliqué par la boucle de simuler : le point y a donc subi les inflations des années 0..y-1.
// Sans inflation dans le choc : exactement Math.pow(1 + infl, y - depuis) (résultats identiques à l'ancienne formule).
function fabriqueIndiceInflation(infl, choc) {
  const A = choc?.annees;
  if (!A?.some((a) => a?.inflation != null)) return (y, depuis = 0) => Math.pow(1 + infl, y - depuis);
  const tab = [1];
  const jusqua = (y) => {
    while (tab.length <= y) {
      const j = tab.length - 1, a = j >= choc.debut && j < choc.debut + A.length ? A[j - choc.debut] : null;
      tab.push(tab[j] * (1 + (a?.inflation != null ? a.inflation / 100 : infl)));
    }
  };
  return (y, depuis = 0) => { jusqua(Math.max(y, depuis)); return tab[y] / tab[depuis]; };
}

// Achat retenu pour la projection : date impérative, sinon âge idéal
export function achatPourProjection(plan, profil) {
  const a = achatResidence(plan, { ...profil, capital: capitalDe(profil) });
  if (!a) return null;
  const p = a.imperatif && a.horizon ? a.horizon : a.choisi && !a.choisi.horsLimite ? a.choisi : a.ideal;
  if (!p || !(p.duree >= 1)) return null;
  const pr = profil.projetRP ?? {};
  const charges = chargesProprietaire(plan, { prix: a.prix, typeLogement: pr.typeLogement, surface: pr.surface, loyerMarcheMensuel: pr.loyerEquivalent || pr.loyerEstime || null, chargesCoproMensuelles: pr.chargesCoproMensuelles ?? null });
  return { annees: p.annees, age: p.age, prix: a.prix, apportRequis: p.apportRequis, pret: p.pret, mensualite: p.mensualite, duree: p.duree, imperatif: a.imperatif, epargneApport: a.epargneApport, aide: a.aide ?? 0,
    mensualites: p.mensualites, restantDu: p.restantDu, lissageImpossible: !!p.lissageImpossible, ptz: p.ptz ?? null, pretBancaire: p.pretBancaire, typeLogement: pr.typeLogement, surface: pr.surface ?? null, charges, loyerMarche: pr.loyerEquivalent || pr.loyerEstime || null };
}

// Taux d'impôt sur les gains d'un compte (en %) : le cold wallet suit le taux du bitcoin, l'AV en unités de compte
// celui de l'assurance-vie ; hors de France, taux moyen du pays de résidence pour tous les comptes
function fabriqueTauxDe(plan, profil, F) {
  const alias = { coldWallet: "plateformeCrypto", assuranceVieUC: "assuranceVie" };
  const tauxPays = resideEnFrance(profil) ? null : paysDe(plan, profil).impotGains;
  return (e) => tauxPays ?? F.gains[alias[e] ?? e] ?? F.gains[e] ?? 0;
}

// Impôt si tout était vendu : % des gains selon le compte, régime le plus favorable pour l'or
function impotsSortie(plan, v, base, annees, profil) {
  const F = plan.fiscalite;
  if (!F) return 0;
  const lignes = repartirEnEnveloppes(plan, v, {}, profil);
  let total = 0;
  for (const c of Object.keys(v)) {
    const gain = Math.max(0, v[c] - (base[c] ?? 0));
    if (v[c] <= 0) continue;
    if (c === "or" && F.or) {
      const abatt = Math.max(0, 1 - (F.or.abattementParAnApres2Ans / 100) * Math.max(0, annees - 2));
      total += Math.min((F.or.taxeForfaitaire / 100) * v[c], (F.or.plusValue / 100) * gain * abatt);
      continue;
    }
    if (gain <= 0) continue;
    const ls = lignes.filter((l) => l.classe === c && l.enveloppe);
    const poids = ls.reduce((s, l) => s + l.montant, 0);
    const tauxDe = fabriqueTauxDe(plan, profil, F);
    const taux = poids > 0 ? ls.reduce((s, l) => s + l.montant * tauxDe(l.enveloppe), 0) / poids : 0;
    total += (gain * taux) / 100;
  }
  return total;
}

// ------------------------------------------------------------- registre fiscal de la retraite
// Les classes d'actifs (v, base) restent la référence de la simulation ; le registre ne sert qu'à décider quoi retirer
// de quel compte (ordre fiscalement optimal, voir planifierRetraits) et l'impôt correspondant.
const ENVELOPPES_LIVRETS = ["livretA", "ldds", "lep", "livretJeune", "livretBancaire", "pel"];
const ENVELOPPES_AV = ["assuranceVie", "assuranceVieUC"];
const anneeOuv = (dateStr, defaut) => { const a = parseInt(String(dateStr ?? "").slice(0, 4), 10); return a > 1900 ? a : defaut; };

// Prélèvements d'une année sous un scénario de réforme (fiscF.h) : seuls les paramètres que planifierRetraits sait
// appliquer sont repris (prélèvements sociaux, part impôt de la flat tax, assurance-vie, PEA) ; livrets et sortie du PER non.
function prelevementsReforme(h = {}) {
  const dPS = Number(h.dPS) || 0, dIR = Number(h.dIR) || 0;
  return { ...PRELEVEMENTS, IR_PFU: PRELEVEMENTS.IR_PFU + dIR, PS_CAPITAL: PRELEVEMENTS.PS_CAPITAL + dPS, PS_PATRIMOINE: PRELEVEMENTS.PS_PATRIMOINE + dPS,
    IR_AV_8ANS: h.avFin ? PRELEVEMENTS.IR_PFU + dIR : PRELEVEMENTS.IR_AV_8ANS, PEA_IR: !!h.peaIR };
}

// Taux de sortie (en %) d'une poche « autres », recalculé chaque année (or : régime le plus favorable, exprimé sur la plus-value)
function tauxPocheAutre(meta, poche, plan, profil, annees, tauxDe, tauxPays) {
  const F = plan.fiscalite;
  if (!F) return poche.taux;
  if (meta.kind === "pays") return tauxPays ?? 0;
  if (meta.kind === "or") {
    if (!F.or) return 0;
    const pg = poche.valeur > 0 ? Math.max(0, 1 - poche.base / poche.valeur) : 0;
    if (pg <= 0) return 0;
    const abatt = Math.max(0, 1 - (F.or.abattementParAnApres2Ans / 100) * Math.max(0, annees - 2));
    return Math.min(F.or.taxeForfaitaire / pg, F.or.plusValue * abatt);
  }
  return tauxDe(meta.kind === "classe" ? "cto" : meta.e);
}

function majTauxAutres(registre, meta, plan, profil, annees) {
  const F = plan.fiscalite;
  if (!F) return;
  const tauxDe = fabriqueTauxDe(plan, profil, F);
  const tauxPays = resideEnFrance(profil) ? null : paysDe(plan, profil).impotGains;
  for (const a of registre.autres) a.taux = tauxPocheAutre(meta[a.id] ?? { kind: "classe" }, a, plan, profil, annees, tauxDe, tauxPays);
}

const totalRegistre = (r) => r.livrets.valeur + r.av.apres70.valeur + r.av.avant70.valeur + r.pea.valeur + r.cto.valeur + r.per.valeur + r.autres.reduce((t, a) => t + a.valeur, 0);

// Multiplie les valeurs (et, si demandé, les prix de revient) de toutes les poches
function echellePoches(r, k, avecPrix) {
  r.livrets.valeur *= k;
  for (const c of [r.av.apres70, r.av.avant70]) { c.valeur *= k; if (avecPrix) c.primes *= k; }
  r.pea.valeur *= k; r.cto.valeur *= k; r.per.valeur *= k;
  if (avecPrix) { r.pea.versements *= k; r.cto.base *= k; r.per.versementsDeduits *= k; }
  for (const a of r.autres) { a.valeur *= k; if (avecPrix) a.base *= k; }
}

// Recale le registre sur le total des classes (filet de sécurité contre les dérives : événements, rééquilibrage)
function recalerRegistre(r, cible) {
  const t = totalRegistre(r);
  if (t > 0) echellePoches(r, Math.max(0, cible) / t, false);
  else if (cible > 0) { r.cto.valeur += cible; r.cto.base += cible; }
}

// Construit le registre des poches à partir des classes d'actifs : chaque classe est répartie entre ses enveloppes
// selon les lignes de repartirEnEnveloppes (comme impotsSortie), puis chaque enveloppe devient une poche.
function registreRetraite(plan, profil, v, base, cumulPER, annees) {
  const F = plan.fiscalite;
  const reg = { livrets: { valeur: 0 }, av: { apres70: { valeur: 0, primes: 0 }, avant70: { valeur: 0, primes: 0 }, ancien8: false },
    pea: { valeur: 0, versements: 0, ancien5: false }, cto: { valeur: 0, base: 0 }, per: { valeur: 0, versementsDeduits: 0 }, autres: [] };
  const meta = {};
  const autre = (id, kind, e, valeur, bs) => {
    let a = reg.autres.find((x) => x.id === id);
    if (!a) { a = { id, valeur: 0, base: 0, taux: 0 }; reg.autres.push(a); meta[id] = { kind, e }; }
    a.valeur += valeur; a.base += bs;
  };
  const france = resideEnFrance(profil);
  const lignes = france ? repartirEnEnveloppes(plan, v, {}, profil) : [];
  const avTotal = { valeur: 0, gain: 0 };
  for (const c of Object.keys(v)) {
    const val = v[c];
    if (!(val > 0)) continue;
    const bs = Math.min(val, Math.max(0, base[c] ?? val)), gain = val - bs;
    if (c === "or") { autre("orPhysique", france ? "or" : "pays", null, val, bs); continue; }
    if (!france) { autre(c, "pays", null, val, bs); continue; }
    const ls = lignes.filter((l) => l.classe === c && l.enveloppe);
    const poids = ls.reduce((t, l) => t + l.montant, 0);
    if (!(poids > 0)) {
      if (c === "securite" || c === "projet") reg.livrets.valeur += val; else autre(c, "classe", null, val, bs);
      continue;
    }
    for (const l of ls) {
      const part = l.montant / poids, vl = val * part, gl = gain * part, e = l.enveloppe;
      if (ENVELOPPES_LIVRETS.includes(e)) reg.livrets.valeur += vl;
      else if (ENVELOPPES_AV.includes(e)) { avTotal.valeur += vl; avTotal.gain += gl; }
      else if (e === "pea") { reg.pea.valeur += vl; reg.pea.versements += vl - gl; }
      else if (e === "cto" || e === "comptesEtrangers") { reg.cto.valeur += vl; reg.cto.base += vl - gl; }
      else if (e === "per") { reg.per.valeur += vl; reg.per.versementsDeduits += vl - gl; }
      else autre(e, "env", e, vl, vl - gl);
    }
  }
  // Assurance-vie : primes versées après 70 ans (article 757 B) dans un compartiment à part
  if (avTotal.valeur > 0) {
    const primes = Math.max(0, avTotal.valeur - avTotal.gain);
    const pa = Math.min(primes, Math.max(0, Number(profil.assuranceVie?.versementsApres70) || 0));
    const va = primes > 0 ? avTotal.valeur * (pa / primes) : 0;
    reg.av.apres70 = { valeur: va, primes: pa };
    reg.av.avant70 = { valeur: avTotal.valeur - va, primes: primes - pa };
  }
  if (france) {
    // PER : le prix de revient est le cumul des versements déduits ; si les lignes ne contiennent aucun PER alors
    // que des versements ont été faits, on en découpe un au prorata sur PEA, compte-titres et autres (hors or)
    if (reg.per.valeur > 0) reg.per.versementsDeduits = Math.min(cumulPER > 0 ? cumulPER : reg.per.versementsDeduits, reg.per.valeur);
    else if (cumulPER > 0) {
      const pool = reg.pea.valeur + reg.cto.valeur + reg.autres.filter((a) => a.id !== "orPhysique").reduce((t, a) => t + a.valeur, 0);
      const pv = Math.min(cumulPER, pool);
      if (pv > 0) {
        const k = 1 - pv / pool;
        reg.pea.valeur *= k; reg.pea.versements *= k; reg.cto.valeur *= k; reg.cto.base *= k;
        for (const a of reg.autres) if (a.id !== "orPhysique") { a.valeur *= k; a.base *= k; }
        reg.per = { valeur: pv, versementsDeduits: pv };
      }
    }
  }
  reg.autres = reg.autres.filter((a) => a.valeur > 0);
  return { registre: reg, meta };
}

function mensualiteCredit(plan, pret, duree) {
  const i = plan.achatRP.tauxCredit / 100 / 12, n = duree * 12;
  return i === 0 ? pret / n : (pret * i) / (1 - Math.pow(1 + i, -n));
}

// Ce qu'il faut prendre sur les placements chaque mois à la retraite (euros d'aujourd'hui) :
// revenu voulu moins la retraite publique, à partir de l'âge où elle est versée
const besoinA = (r, age) => Math.max(0, (r.revenu ?? 0) - (age >= (r.agePension ?? 0) ? r.pension ?? 0 : 0));

export { fluxLocatif } from "./locatif.js";

// fiscF : évolution de la fiscalité à partir de l'année fiscF.annee (0 = cette année) : fiscF.plan porte les
// nouveaux taux, fiscF.perDeduction la part de l'économie d'impôt du PER qui reste, fiscF.tauxLivrets l'impôt sur les intérêts des livrets
function simuler(plan, profil, { achat, gauss, detail, per, retraite = null, choc = null, ansImpots = null, fiscF = null, correl = null }) {
  const apres = (y) => !!fiscF && y >= fiscF.annee;
  const planT = (y) => (apres(y) ? fiscF.plan : plan);
  const an0 = new Date().getFullYear();
  const prelevementsAn = (y) => (apres(y) ? prelevementsReforme(fiscF.h) : PRELEVEMENTS);
  const strategie = STRATEGIES_DECUMULATION.includes(retraite?.strategie) ? retraite.strategie : STRATEGIES_DECUMULATION.includes(profil.retraite?.priorite) ? profil.retraite.priorite : "transmettre";
  const ouvAV = anneeOuv(profil.assuranceVie?.dateOuverture, an0), ouvPEA = anneeOuv(profil.pea?.dateOuverture, an0);
  let registre = null, metaAutres = null; // registre fiscal par compte, construit au premier passage à la retraite
  const H = plan.hypotheses;
  const classes = Object.keys(plan.classes);
  const C0 = capitalDe(profil);
  const cible0 = allocationCible(plan, { ...profil, capital: C0 }).alloc;
  let v = actuelParClasse(plan, cible0, profil.placements ?? {});
  for (const c of classes) v[c] ??= 0;
  // Prix de revient : l'argent réellement versé sur chaque compte (PEA, compte-titres, assurance-vie, crypto),
  // pour calculer l'impôt sur les vrais gains ; sinon, on suppose qu'il n'y a pas encore de gain
  const P0 = profil.placements ?? {}, VS = profil.verses ?? {};
  const cout = { ...P0 };
  const repartir = (ids, total) => { const t = ids.reduce((s2, e) => s2 + (P0[e] ?? 0), 0); if (t > 0 && total > 0) for (const e of ids) cout[e] = (total * (P0[e] ?? 0)) / t; };
  if (Number(profil.pea?.versements) > 0 && (P0.pea ?? 0) > 0) cout.pea = Number(profil.pea.versements);
  if (Number(VS.cto) > 0) cout.cto = Number(VS.cto);
  repartir(["assuranceVie", "assuranceVieUC"], Number(VS.assuranceVie) || 0);
  repartir(["plateformeCrypto", "coldWallet"], Number(VS.crypto) || 0);
  const idsDe = (c) => (plan.remplissage?.[c] ?? []).map((x) => (typeof x === "string" ? x : x.id));
  const ratioClasse = (c, f) => { const ids = idsDe(c).filter((e) => (P0[e] ?? 0) > 0); const t = ids.reduce((s2, e) => s2 + P0[e], 0); return t > 0 ? ids.reduce((s2, e) => s2 + P0[e] * f(e), 0) / t : null; };
  let base = Object.fromEntries(classes.map((c) => { const r = ratioClasse(c, (e) => (P0[e] > 0 ? cout[e] / P0[e] : 1)); return [c, v[c] * (r ?? 1)]; }));
  // Frais réels au-delà des frais de référence du plan : retirés chaque année du rendement de la classe
  const FR = plan.fraisReference ?? {}, FP = profil.frais ?? {};
  const fraisEnv = (e) => {
    const k = e === "assuranceVie" || e === "assuranceVieUC" ? "assuranceVie" : e === "per" ? "per" : e === "pea" || e === "cto" || e === "comptesEtrangers" ? "bourse" : null;
    return k && FP[k] !== "" && FP[k] != null ? Math.max(0, Number(FP[k]) - (FR[k] ?? 0)) : 0;
  };
  const fraisClasse = Object.fromEntries(classes.map((c) => [c, (ratioClasse(c, fraisEnv) ?? 0) / 100]));
  const nb = Math.max(0, (H.ageFinProjection ?? 70) - profil.age);
  const loyer = profil.proprietaire && (profil.logement?.usage ?? "rp") === "rp" ? 0 : profil.loyerMensuel ?? 0;
  let bien = 0, dette = 0, mensualite = 0, credit = 0, finPret = -1, achete = false;
  // Euros courants comme le reste de la simulation (événements, retraite) : le loyer d'aujourd'hui et les charges suivent l'inflation
  const mensAn = (y) => achat?.mensualites?.[y - achat.annees] ?? achat?.mensualite ?? 0;
  const chargesAn = (y) => {
    const C = achat?.charges;
    if (!achete || !C) return 0;
    return (C.taxeFonciere + C.copro) * indiceInflation(y, achat.annees) + (achat.prix > 0 ? (C.entretien * bien) / achat.prix : 0);
  };
  let cumulPER = 0; // versements PER déduits, imposés au barème à la sortie
  const interAn = interessementPlace(profil);
  // Logement déjà détenu : ta part de sa valeur, et ta part du crédit restant (remboursée en ligne droite)
  const L = profil.proprietaire ? profil.logement ?? {} : {};
  let bienEx = Math.max(0, Number(L.valeur) || 0) * (L.part > 0 ? Math.min(100, L.part) : 100) / 100;
  let detteEx = Math.max(0, Number(L.creditRestant) || 0);
  const anneesCreditEx = Math.max(1, (Number(L.finCredit) || new Date().getFullYear()) - new Date().getFullYear());
  const remboursementEx = detteEx / anneesCreditEx;
  // Mensualité du crédit en cours (ta part) : libérée à la fin du crédit (ou à la revente) ; pour un bien loué, elle est dans le flux locatif
  const mensualiteEx = detteEx > 0 ? Math.max(0, Number(L.mensualite) || 0) * 12 : 0;
  const locatif = fluxLocatif(plan, profil);
  // Projet d'investissement locatif à crédit
  const PL = projetLocatifDe(plan, profil);
  const PLF = fiscF && PL ? projetLocatifDe(fiscF.plan, profil) : PL;
  let bienL = 0, detteL = 0, acquisL = null, locatifEtat = null;
  const garderOr = "or" in v && !profil.retraite?.vendreOr && (plan.reequilibrage?.jamaisVendre ?? []).includes("orPhysique");
  const vendreAuAchat = !!(achat && L.vendrePourAchat && (L.usage ?? "rp") === "rp");
  let venduA = null;
  const infl = (H.inflation ?? 0) / 100;
  const indiceInflation = fabriqueIndiceInflation(infl, choc);
  let regime = "normal"; // régime de marché du tirage (corrélations dynamiques)
  // Événements de vie (montants en euros d'aujourd'hui)
  const evts = (profil.evenements ?? []).filter((e) => Number(e.age) > 0);
  const evtsDe = (age) => evts.filter((e) => age >= Number(e.age) && age < Number(e.age) + Math.max(1, Number(e.annees) || 1));
  let verse = C0; // argent mis : capital de départ + épargne versée − apport sorti pour l'achat
  const points = [];
  let registreFinal = null; // registre fiscal à l'horizon (détail seulement), rattaché au dernier point

  for (let y = 0; y <= nb; y++) {
    const age = profil.age + y;
    let evenement = null;
    if (achat && y === achat.annees && !achete) {
      // Revente du logement actuel pour financer le nouveau : le produit net (valeur moins crédit restant) rejoint l'apport
      if (vendreAuAchat && bienEx > 0) {
        const produit = Math.max(0, bienEx - detteEx);
        v.securite += produit; base.securite += produit; verse += produit;
        bienEx = 0; detteEx = 0; venduA = y;
      }
      const total = somme(v);
      const pris = Math.max(0, achat.apportRequis - (achat.aide ?? 0)); // l'aide familiale vient de l'extérieur
      // (l'investissement locatif éventuel est traité plus bas)
      if (total >= pris) {
        let reste = pris;
        for (const c of ["projet", "securite", "prudent", "bourse", "or", "bitcoin", "scpi"]) {
          if (!(c in v) || reste <= 0) continue;
          const r = Math.min(v[c], reste);
          if (v[c] > 0) base[c] *= (v[c] - r) / v[c];
          v[c] -= r; reste -= r;
        }
        verse -= pris;
        bien = achat.prix; dette = achat.pret; mensualite = achat.mensualite;
        credit = mensualiteCredit(plan, achat.pret, achat.duree);
        finPret = y + (achat.mensualites ? achat.mensualites.length : achat.duree); achete = true; evenement = "achat";
      } else evenement = "achat-impossible";
    }

    // Investissement locatif : l'apport sort des placements l'année de l'achat
    if (PL && y === PL.annees && acquisL == null) {
      const tot = somme(v);
      // La banque refuse si, avec ce crédit (et celui de la résidence s'il court encore), l'endettement dépasse 35 %
      const fin = locatifFinancable(plan, profil, { mensualiteRP: achete && y < finPret ? mensualite : 0, sansLogementActuel: venduA != null });
      if (fin && !fin.ok) { acquisL = -1; locatifEtat = "refuse"; }
      else if (tot >= PL.apport) {
        let reste = PL.apport;
        for (const c of ["projet", "securite", "prudent", "bourse", "or", "bitcoin", "scpi"]) {
          if (!(c in v) || reste <= 0) continue;
          const r = Math.min(v[c], reste);
          if (v[c] > 0) base[c] *= (v[c] - r) / v[c];
          v[c] -= r; reste -= r;
        }
        verse -= PL.apport; acquisL = y; bienL = PL.prix; detteL = PL.pret;
        evenement = evenement ?? "locatif"; locatifEtat = "achat";
      } else { acquisL = -1; evenement = evenement ?? "locatif-impossible"; locatifEtat = "impossible"; }
    }
    const financier = somme(v);
    const facteur = facteurSalaire(plan, profil, y);
    const point = { age, annees: y, financier, bien: bien + bienEx + bienL, dette: dette + detteEx + detteL, net: financier + bien + bienEx + bienL - dette - detteEx - detteL, evenement, verse };
    if (locatifEtat && y === PL?.annees) point.locatif = locatifEtat;
    if (detail) {
      point.classes = { ...v };
      const actif = age < (H.ageRetraite ?? 64);
      point.salaire = actif ? profil.salaireNetMensuel * facteur : 0;
      point.epargne = actif ? profil.epargneMensuelle * (H.epargneSuitLeSalaire ? facteur : 1) + (achete ? loyer * indiceInflation(y) - (y < finPret ? mensAn(y) : 0) - chargesAn(y) / 12 : 0) : -(achete ? (y < finPret ? mensAn(y) : 0) + chargesAn(y) / 12 : 0);
      point.retraitNet = retraite && age >= retraite.age ? besoinA(retraite, age) * indiceInflation(y) : 0;
      point.cumulPER = cumulPER;
      point.impotPlacements = impotsSortie(planT(y), v, base, y, profil);
      point.impotPER = (cumulPER * (planT(y).per?.tmiRetraite ?? 0)) / 100;
      // Pour le taux d'impôt des retraits : avant et après le changement de fiscalité
      point.impotAvant = fiscF ? impotsSortie(plan, v, base, y, profil) : point.impotPlacements;
      point.impotApres = fiscF ? impotsSortie(fiscF.plan, v, base, y, profil) : point.impotPlacements;
      point.baseTotal = somme(base);
      point.gains = Object.keys(v).reduce((t, c) => t + Math.max(0, v[c] - (base[c] ?? 0)), 0);
      point.apresImpots = financier - point.impotPlacements - point.impotPER + bien + bienEx + bienL - dette - detteEx - detteL;
    } else if (ansImpots?.has(y)) {
      // Monte Carlo : impôt de sortie de CE scénario, avec sa propre composition et ses propres gains
      point.impot = impotsSortie(planT(y), v, base, y, profil) + (cumulPER * (planT(y).per?.tmiRetraite ?? 0)) / 100;
    }
    points.push(point);
    if (y === nb) { if (registreFinal) point.registreFinal = registreFinal; break; }

    // 1. Rendements de l'année (ou ceux d'une crise rejouée)
    const totAvant = somme(v);
    const anneeCrise = choc && y >= choc.debut && y < choc.debut + choc.annees.length ? choc.annees[y - choc.debut] : null;
    let rCor = null;
    if (gauss && correl && !anneeCrise) { const t = rendementsCorreles(correl, gauss, regime); regime = t.regime; rCor = t.r; }
    for (const c of classes) {
      const m = (H.rendements[c] ?? 0) / 100, s = (H.volatilites?.[c] ?? 0) / 100;
      const rc = anneeCrise?.[c === "projet" ? "securite" : c];
      let r = rc != null ? rc / 100 : rCor && rCor[c] != null ? rCor[c] : gauss ? tirage(m, s, gauss) : m;
      // Livrets imposés (simulation fiscale) : l'impôt est pris chaque année sur les intérêts de l'épargne de sécurité
      if (c === "securite" && apres(y) && fiscF.tauxLivrets > 0 && r > 0) r *= 1 - fiscF.tauxLivrets;
      v[c] *= 1 + r - (fraisClasse[c] ?? 0);
    }
    // Le registre suit la performance globale (les bases ne bougent pas : tout le gain est latent)
    if (registre && totAvant > 0) echellePoches(registre, somme(v) / totAvant, false);
    // 2. Épargne de l'année (s'arrête à la retraite), corrigée du crédit et du loyer
    const facteurEp = H.epargneSuitLeSalaire ? facteur : 1;
    const actif = age < (H.ageRetraite ?? 64);
    let ep = actif ? profil.epargneMensuelle * facteurEp * 12 : 0;
    // Événements de vie : pause d'épargne (année sabbatique…)
    const evAn = evtsDe(age);
    if (evAn.some((e) => e.type === "pause")) ep = 0;
    // Fin du crédit en cours (résidence, secondaire) ou revente : la mensualité redevient de l'épargne
    if (actif && mensualiteEx > 0 && !locatif && (y >= anneesCreditEx || (venduA != null && y >= venduA))) ep += mensualiteEx * facteurEp;
    // Après l'achat : le loyer économisé s'ajoute à l'épargne tant qu'on travaille ; le crédit reste à payer
    if (achete) ep += (actif ? loyer * 12 * indiceInflation(y) : 0) - (y < finPret ? mensAn(y) * 12 : 0) - chargesAn(y);
    // PER : versements (déjà inclus dans l'épargne) et économie d'impôt réépargnée
    if (per?.actif && age < Math.min(H.ageRetraite ?? 64, 70)) {
      const versePER = per.annuel * facteurEp;
      cumulPER += versePER;
      if (plan.per?.reinvestirEconomie) ep += ((versePER * (per.tauxEffectif ?? per.tmi)) / 100) * (apres(y) ? fiscF.perDeduction ?? 1 : 1);
    }
    // Bien loué : loyers − charges − impôt − crédit (tant qu'il court), relevés de l'inflation ; continue à la retraite
    // (échéancier réel : les intérêts baissent chaque année, l'impôt au régime réel monte, le crédit s'arrête à sa date)
    // Option « ne pas compter les loyers à la retraite » : à partir du départ, les loyers nets positifs ne servent plus à la retraite
    // (le crédit qui court encore, lui, reste à payer)
    const sansLoyers = profil.retraite?.compterLoyers === false && age >= (retraite?.age ?? H.ageRetraite ?? 64);
    const loyersNets = (cf) => (sansLoyers && cf > 0 ? 0 : cf);
    if (locatif && venduA == null) ep += loyersNets(fluxLocatif(planT(y), profil, y).cashflow);
    // Investissement locatif acquis : loyers − charges − impôt − crédit de l'année
    if (acquisL != null && acquisL >= 0 && y >= acquisL) ep += loyersNets((apres(y) ? PLF : PL).flux(y - acquisL).cashflow);
    // Événements de vie : rentrées (héritage, donation, prime…) et dépenses (études, voiture, travaux…)
    for (const e of evAn) {
      const m = Math.max(0, Number(e.montant) || 0) * indiceInflation(y);
      if (e.type === "entree") ep += m;
      else if (e.type === "depense") ep -= m;
    }
    if (ep < 0) {
      // Dépense plus grande que l'épargne de l'année : prise sur les placements au prorata
      const tot = somme(v), out = Math.min(tot, -ep);
      if (tot > 0) { const k = (tot - out) / tot; for (const c of classes) { v[c] *= k; base[c] *= k; } if (registre) echellePoches(registre, k, true); }
      verse -= out; ep = 0;
    }
    v.securite += ep;
    verse += ep;
    if (ep > 0) { base.securite += ep; if (registre) registre.livrets.valeur += ep; }
    // Intéressement et participation placés sur l'épargne salariale (en bourse), nets de CSG et CRDS : c'est ton argent
    if (actif && interAn > 0) {
      const it = interAn * facteurEp * (1 - (plan.abondement?.prelevements ?? 9.7) / 100);
      v.bourse += it; base.bourse += it; verse += it;
    }
    // Abondement de l'employeur : argent offert, placé en bourse tant qu'on travaille (pas compté dans « l'argent mis »)
    if (actif && per?.abondement?.abondementAn > 0) {
      const ab = per.abondement.abondementAn * (1 - (plan.abondement?.prelevements ?? 9.7) / 100);
      v.bourse += ab; base.bourse += ab;
    }
    // Retraite : on se verse le revenu voulu (en euros d'aujourd'hui, donc relevé de l'inflation),
    // pris dans l'ordre fiscalement optimal du registre (planifierRetraits) ; impôt sur les gains vendus compris
    if (retraite && age >= retraite.age) {
      // facteurCapital (recherche du capital nécessaire) : capital de départ multiplié, gains et base dans les mêmes proportions
      if (retraite.facteurCapital != null && age === retraite.age) for (const c of classes) { v[c] *= retraite.facteurCapital; base[c] *= retraite.facteurCapital; }
      const net = 12 * besoinA(retraite, age) * indiceInflation(y);
      if (!registre) ({ registre, meta: metaAutres } = registreRetraite(planT(y), profil, v, base, cumulPER, y));
      // Filet de sécurité : le registre doit rester égal au total des classes (événements, rééquilibrage)
      let ecart = Math.abs(totalRegistre(registre) - somme(v));
      if (ecart > 1) recalerRegistre(registre, somme(v));
      majTauxAutres(registre, metaAutres, planT(y), profil, y);
      registre.av.ancien8 = an0 + y - ouvAV >= 8;
      registre.pea.ancien5 = an0 + y - ouvPEA >= 5;
      const ff = foyerFiscal(profil), indexation = indiceInflation(y);
      const pensionAn = age >= (retraite.agePension ?? 0) ? 12 * (retraite.pension ?? 0) * indexation : 0;
      const ctx = {
        parts: ff.parts, partsBase: ff.partsBase, indexation, couple: !!profil.marie,
        revenuImposableAutre: revenuImposablePension(pensionAn, { pensionnes: profil.couple && profil.marie ? 2 : 1, indexation }),
        anneesRestantesPER: Math.max(1, 85 - age), reserveLivrets: net / 2, garderOr, prelevements: prelevementsAn(y), ordreEtape3: retraite.ordreEtape3 === "ctoDabord" ? "ctoDabord" : "peaDabord",
        reserveTransmissionAV: reserveAVTransmissible(profil),
      };
      const res = planifierRetraits(registre, net, ctx, strategie);
      registre = res.registre;
      // Sortie des classes : brut retiré moins le surplus réinvesti. L'or physique est gardé (pour la transmission) :
      // on vend d'abord le reste, l'or seulement en dernier recours
      const ordre = garderOr ? [classes.filter((c) => c !== "or"), ["or"]] : [classes];
      let reste = Math.max(0, res.brut - res.surplus);
      for (const groupe of ordre) {
        const tot = groupe.reduce((s2, c) => s2 + v[c], 0);
        if (reste <= 0 || tot <= 0) continue;
        const pris = Math.min(tot, reste), k = (tot - pris) / tot;
        for (const c of groupe) { v[c] *= k; base[c] *= k; }
        verse -= pris; reste -= pris;
      }
      cumulPER = registre.per.versementsDeduits;
      const ecart2 = Math.abs(totalRegistre(registre) - somme(v));
      if (ecart2 > 1) recalerRegistre(registre, somme(v));
      if (detail) {
        point.ecartRegistre = Math.max(ecart, ecart2);
        point.retraits = res.retraits; point.impotRetraits = res.impots; point.brutRetraits = res.brut;
        point.avAvant70 = registre.av.avant70.valeur; point.insuffisant = res.insuffisant;
        // Part du patrimoine emportée par les impôts dus au décès sur les gains latents (hors droits de succession : voir droitsSuccession*)
        const totalFin = totalRegistre(registre);
        point.tauxDeces = totalFin > 0 ? impotsAuDeces(registre, prelevementsAn(y)) / totalFin : 0;
        // Avant-dernier exercice : copie du registre après retraits, rattachée au dernier point (droitsPlacementsFinaux la remet à l'échelle de son `financier`)
        if (y === nb - 1) registreFinal = JSON.parse(JSON.stringify(registre));
      }
    }
    // 3. Crédit et valeur du bien
    if (achete && y < finPret) {
      const i = plan.achatRP.tauxCredit / 100 / 12;
      if (achat.restantDu) dette = achat.restantDu(y - achat.annees);
      else dette = i === 0 ? Math.max(0, dette - credit * 12) : Math.max(0, dette * Math.pow(1 + i, 12) - (credit * (Math.pow(1 + i, 12) - 1)) / i);
      if (y + 1 >= finPret) dette = 0;
    }
    bien *= 1 + (H.valorisationImmobiliere ?? 0) / 100;
    bienEx *= 1 + (H.valorisationImmobiliere ?? 0) / 100;
    if (acquisL != null && acquisL >= 0 && y >= acquisL) { bienL = PL.valeur(y - acquisL + 1); detteL = PL.ech.restant(y - acquisL); }
    detteEx = Math.max(0, detteEx - remboursementEx);

    // 4. Rééquilibrage vers la cible du plan pour l'année suivante
    const total = somme(v);
    if (total <= 0) { for (const c of classes) { v[c] = 0; base[c] = 0; } continue; }
    let objectifApport = null;
    if (achat && !achete && y + 1 < achat.annees + 1) {
      const k = achat.annees - (y + 1);
      const futur = achat.epargneApport * 12 * k;
      objectifApport = { montant: Math.max(0, achat.apportRequis - (achat.aide ?? 0) - futur), horizonAnnees: k, imperatif: achat.imperatif };
    }
    // Panique : tout vendre après la 1re année de crise, rester sur le livret 2 ans, puis revenir au plan
    const dp = choc ? choc.debut + (choc.decalagePanique ?? 0) : 0;
    const enPanique = choc?.panique && y >= dp && y < dp + 2;
    let cible = enPanique ? Object.fromEntries(classes.map((c) => [c, c === "securite" ? total : 0]))
      : allocationCible(plan, { ...profil, age: age + 1, capital: total, objectifApport, planchers: {} }, { rapide: true }).alloc;
    // Or physique : jamais vendu pour rééquilibrer (règle du plan) ; le surplus reste, les autres classes sont réduites d'autant
    if (garderOr && !enPanique && (cible.or ?? 0) < v.or) {
      cible = { ...cible };
      const surplus = v.or - (cible.or ?? 0), autres = classes.filter((c) => c !== "or").reduce((s2, c) => s2 + (cible[c] ?? 0), 0);
      if (autres > 0) { const k = Math.max(0, autres - surplus) / autres; for (const c of classes) if (c !== "or") cible[c] = (cible[c] ?? 0) * k; }
      cible.or = v.or;
    }
    for (const c of classes) {
      const avant = v[c], apres = cible[c] ?? 0;
      if (apres < avant) base[c] = avant > 0 ? base[c] * (apres / avant) : 0;
      else base[c] += apres - avant;
      v[c] = apres;
    }
  }
  return points;
}

// ------------------------------------------------------------- situation future
// « Et si j'avais 30 ans ? » : la situation estimée à un âge futur, en
// supposant que le plan a été suivi d'ici là (scénario central). Le capital,
// le salaire et l'épargne peuvent être remplacés par des valeurs choisies.
export function situationFuture(plan, profilSaisi, f) {
  const base = normaliserFoyer(plan, profilSaisi);
  const agePers = base.agePrincipal ?? base.age;
  const n = Math.max(0, Math.round((f.age ?? agePers) - agePers));
  const H = plan.hypotheses;
  const per = analyser(plan, base).per;
  const central = simuler(plan, base, { achat: null, detail: true, per });
  const pt = central[Math.min(n, central.length - 1)];
  const croissance = facteurSalaire(plan, base, n);
  const capitalEstime = pt.financier;
  const capital = f.capital > 0 ? f.capital : capitalEstime;
  const classes = Object.fromEntries(Object.entries(pt.classes).map(([c, x]) => [c, capitalEstime > 0 ? (x * capital) / capitalEstime : 0]));
  const aujourdHui = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const futur = {
    ...base,
    age: base.age + n, agePrincipal: agePers + n, ageEmprunteur: (base.ageEmprunteur ?? base.age) + n,
    ...(base.couple ? { ageConjoint: base.ageConjoint + n } : {}),
    salaireNetMensuel: f.salaire > 0 ? f.salaire : base.salaireNetMensuel * croissance,
    epargneMensuelle: f.epargne > 0 ? f.epargne : base.epargneMensuelle * (H.epargneSuitLeSalaire ? croissance : 1),
    depensesMensuelles: (base.depensesMensuelles ?? 0) * croissance,
    salaireDans10Ans: null, hausseSalaire10: null, jeune: agePers + n <= 25,
  };
  // Comptes : là où le plan aurait placé ce capital
  const lignes = repartirEnEnveloppes(plan, classes, {}, { ...futur, pea: { ...base.pea, versements: 0 } });
  const placements = {};
  for (const l of lignes) if (l.enveloppe) placements[l.enveloppe] = (placements[l.enveloppe] ?? 0) + l.montant;
  futur.placements = placements;
  if ((placements.pea ?? 0) > 0) futur.pea = { ...base.pea, ouvert: true, dateOuverture: base.pea?.ouvert ? base.pea.dateOuverture : aujourdHui, versements: Math.min(placements.pea, (plan.enveloppes.pea?.plafond ?? Infinity) * (base.personnes ?? 1)) };
  futur.peaPrincipal = futur.pea;
  if ((placements.assuranceVie ?? 0) + (placements.assuranceVieUC ?? 0) > 0 && !base.assuranceVie?.dateOuverture) futur.assuranceVie = { type: base.assuranceVie?.type || "Contrat en ligne (gestion libre)", dateOuverture: aujourdHui };
  let achatAvant = false;
  if (base.projetRP?.actif && base.projetRP.imperatif) {
    const h = (base.projetRP.horizonAnnees ?? 0) - n;
    if (h < 0) { achatAvant = true; futur.projetRP = { ...base.projetRP, actif: false }; }
    else futur.projetRP = { ...base.projetRP, horizonAnnees: h };
  }
  return { profil: futur, annees: n, capitalEstime, capital, achatAvant, estime: { capital: !(f.capital > 0), salaire: !(f.salaire > 0), epargne: !(f.epargne > 0) } };
}

const quantile = (tri, q) => {
  const pos = (tri.length - 1) * q, b = Math.floor(pos), r = pos - b;
  return tri[b + 1] !== undefined ? tri[b] + r * (tri[b + 1] - tri[b]) : tri[b];
};

// Paramètres de la retraite par capitalisation pour un profil
export function parametresRetraite(plan, profil) {
  const R = plan.retraite ?? {}, H = plan.hypotheses;
  const revenu = Math.max(0, Number(profil.retraite?.revenu) > 0 ? Number(profil.retraite.revenu) : R.revenuMensuelDefaut ?? 0);
  const pension = Math.max(0, Number(profil.retraite?.pension) || R.pensionDefaut || 0);
  const ageLegal = H.ageRetraite ?? 64;
  const ageFin = ageLegal + (R.dureeAnnees ?? 30);       // le revenu est versé jusqu'à 94 ans
  // Départ anticipé possible si le capital le permet ; jamais après l'âge légal
  const choisi = Number(profil.retraite?.ageDepart) || 0;
  const age = choisi > 0 ? Math.min(ageLegal, Math.max(Math.round(choisi), Math.ceil(profil.agePrincipal ?? profil.age ?? 0))) : ageLegal;
  // La retraite publique n'est versée qu'à partir de son âge (âge légal public par défaut), même si l'on s'arrête avant
  const agePension = Math.max(age, Number(profil.retraite?.agePension) || plan.retraitePublique?.ageLegal || ageLegal);
  return { age, ageLegal, ageFin, duree: ageFin - age, revenu, pension, agePension, besoin: Math.max(0, revenu - pension), anticipe: age < ageLegal };
}
// Plan dont l'âge de fin d'activité est celui du départ choisi, projeté jusqu'à 94 ans
function planDepart(plan, age, ageFin) {
  const H = plan.hypotheses;
  return { ...plan, hypotheses: { ...H, ageRetraite: age, ageFinProjection: Math.max(H.ageFinProjection ?? 70, ageFin) } };
}

// Droits de succession attribuables aux placements au dernier point d'une trajectoire (euros constants, succession.js) ;
// null si le profil manque ou si le registre final est indisponible alors qu'il reste du patrimoine.
function droitsPlacementsFinaux(profil, f, defl) {
  if (!profil || !f) return null;
  if (!f.registreFinal) return f.financier <= 1 ? 0 : null; // patrimoine épuisé : rien à transmettre
  try {
    const an = new Date().getFullYear() + (f.annees ?? 0);
    // Le registre copié date de l'exercice précédent (état après retraits, avant la dernière revalorisation) : on le met à l'échelle
    // du dernier point (f.financier), puis en euros constants. totalRegistre compte les mêmes poches que `financier` (écart < 1 €).
    const total = totalRegistre(f.registreFinal);
    const echelle = (total > 0 ? f.financier / total : 1) / defl(f);
    return droitsSurRegistre(profil, f.registreFinal, { annee: an, ageDefunt: (profil.agePrincipal ?? profil.age) + (f.annees ?? 0), echelle }).droitsPlacements;
  } catch (e) { return null; }
}

// Choix de l'ordre de l'étape 3 (PEA d'abord ou compte-titres d'abord) par anticipation : on simule les deux ordres sur le
// scénario central (rendements moyens) et on retient le meilleur. Le choix se fait UNE fois, sur ce scénario, et non à
// chaque tirage Monte-Carlo : un look-ahead par tirage donnerait à chaque chemin la connaissance de son propre avenir
// (biais d'anticipation) et surestimerait la robustesse du plan. Les tirages héritent de l'ordre retenu.
// Critères : 1) âge d'épuisement le plus tardif (jamais = meilleur) ; 2) patrimoine final net des impôts dus au décès ET des droits de
// succession (succession.js), en euros réels : calculé seulement à égalité d'âge d'épuisement, droits = 0 si indisponibles pour l'un des deux ; 3) impôts de retraits cumulés (réels) les plus faibles ; égalité complète : 'peaDabord'.
function choisirOrdre(plan, profil, { achat, per, retraite, fiscF = null, infl = 0, iR = 0 }) {
  const evaluerOrdre = (ordre) => {
    const points = simuler(plan, profil, { achat, detail: true, per, retraite: { ...retraite, ordreEtape3: ordre }, fiscF });
    const defl = (pt) => Math.pow(1 + infl, pt?.annees ?? 0);
    const ageEpuisement = points.find((pt) => pt.age >= retraite.age && pt.insuffisant)?.age ?? null;
    const dernier = points[points.length - 1];
    const dernierTaux = [...points].reverse().find((pt) => pt.tauxDeces != null)?.tauxDeces ?? 0;
    const netFinalReel = (dernier.financier * (1 - dernierTaux)) / defl(dernier);
    const impotsReels = points.reduce((t, pt) => (pt.age >= retraite.age && pt.impotRetraits != null ? t + pt.impotRetraits / defl(pt) : t), 0);
    return { ordre, points, ageEpuisement, netFinalReel, impotsReels, defl, netApresDroits: null };
  };
  const a = evaluerOrdre("peaDabord"), b = evaluerOrdre("ctoDabord");
  // Net après droits des deux candidats (une seule fois, et seulement si le critère est atteint)
  const evaluerDroits = () => {
    if (a.netApresDroits != null) return;
    const da = droitsPlacementsFinaux(profil, a.points[a.points.length - 1], a.defl), db = droitsPlacementsFinaux(profil, b.points[b.points.length - 1], b.defl);
    const ok = da != null && db != null;
    a.netApresDroits = a.netFinalReel - (ok ? da : 0); b.netApresDroits = b.netFinalReel - (ok ? db : 0);
  };
  const meilleur = (x, y) => {
    if (x.ageEpuisement !== y.ageEpuisement) {
      if (x.ageEpuisement == null) return true;
      if (y.ageEpuisement == null) return false;
      return x.ageEpuisement > y.ageEpuisement;
    }
    evaluerDroits();
    if (Math.abs(x.netApresDroits - y.netApresDroits) > 1) return x.netApresDroits > y.netApresDroits;
    if (Math.abs(x.impotsReels - y.impotsReels) > 1) return x.impotsReels < y.impotsReels;
    return false;
  };
  const retenu = meilleur(b, a) ? b : a, autre = retenu === a ? b : a;
  return {
    ordre: retenu.ordre, points: retenu.points,
    autre: { ordre: autre.ordre, ageEpuisement: autre.ageEpuisement, netFinalReel: autre.netFinalReel, netApresDroits: autre.netApresDroits },
    netFinalReel: retenu.netFinalReel, netApresDroits: retenu.netApresDroits, ageEpuisement: retenu.ageEpuisement,
    // Écart sur le critère qui a départagé : net après droits si les deux ordres durent aussi longtemps, sinon net hors droits
    gainOrdreReel: retenu.netApresDroits != null ? retenu.netApresDroits - autre.netApresDroits : retenu.netFinalReel - autre.netFinalReel,
  };
}

// Comparaison ordre optimal / retrait au prorata, sur les années de retraite où aucun des deux n'est à court d'argent
function comparerDecumulation(central, prorata, iR, strategie, infl = 0, choix = null, profil = null) {
  const defl = (pt) => Math.pow(1 + infl, pt?.annees ?? 0);
  let impotsOptimise = 0, impotsProrata = 0, impotsOptimiseReel = 0, impotsProrataReel = 0, anneesComparees = 0;
  for (let i = iR; i < central.length; i++) {
    const a = central[i], b = prorata[i];
    if (!a?.retraits || !b?.retraits || a.insuffisant || b.insuffisant) continue;
    impotsOptimise += a.impotRetraits; impotsProrata += b.impotRetraits;
    impotsOptimiseReel += a.impotRetraits / defl(a); impotsProrataReel += b.impotRetraits / defl(b);
    anneesComparees++;
  }
  const epuise = (pts) => pts.find((p, i) => i >= iR && p.insuffisant)?.age ?? null;
  const exemples = [0, 5, 10].map((o) => central[iR + o]).filter((p) => p?.retraits)
    .map((p) => ({ age: p.age, annees: p.annees, brut: p.brutRetraits, impots: p.impotRetraits, retraits: p.retraits.map((r) => ({ ...r })) }));
  const fa = central[central.length - 1], fb = prorata[prorata.length - 1];
  const patrimoineFinalOptimiseReel = fa.financier / defl(fa), patrimoineFinalProrataReel = fb.financier / defl(fb);
  const netReel = (pts, f) => {
    const taux = [...pts].reverse().find((pt) => pt.tauxDeces != null)?.tauxDeces ?? 0;
    return (f.financier * (1 - taux)) / defl(f);
  };
  const patrimoineFinalNetReel = netReel(central, fa), patrimoineFinalNetProrataReel = netReel(prorata, fb);
  // Droits de succession estimés sur le registre final (euros constants, scénario central ; succession.js). Ils s'ajoutent aux
  // champs existants : patrimoineFinalNetReel reste « hors droits de succession », patrimoineFinalNetApresDroitsReel = net − droits.
  // `droitsSuccession*` = part des droits attribuable aux placements (la résidence principale n'y est pas imputée) ; null sans registre.
  const droitsDe = (pts, f) => droitsPlacementsFinaux(profil, f, defl);
  const droitsSuccessionOptimise = droitsDe(central, fa), droitsSuccessionProrata = droitsDe(prorata, fb);
  const apresDroits = (net, d) => (d == null ? null : net - d);
  return {
    ordreEtape3: choix?.ordre ?? "peaDabord", gainOrdreReel: choix?.gainOrdreReel ?? 0, gainOrdreApresDroits: choix?.netApresDroits != null, ageEpuisementAutreOrdre: choix?.autre?.ageEpuisement ?? null,
    droitsSuccessionOptimise, droitsSuccessionProrata,
    patrimoineFinalNetApresDroitsReel: apresDroits(patrimoineFinalNetReel, droitsSuccessionOptimise), patrimoineFinalNetApresDroitsProrataReel: apresDroits(patrimoineFinalNetProrataReel, droitsSuccessionProrata),
    patrimoineFinalNetReel, patrimoineFinalNetProrataReel, gainPatrimoineNetReel: patrimoineFinalNetReel - patrimoineFinalNetProrataReel,
    strategie, impotsOptimise, impotsProrata, economie: impotsProrata - impotsOptimise, anneesComparees,
    impotsOptimiseReel, impotsProrataReel, economieReel: impotsProrataReel - impotsOptimiseReel,
    patrimoineFinalOptimiseReel, patrimoineFinalProrataReel, gainPatrimoineReel: patrimoineFinalOptimiseReel - patrimoineFinalProrataReel, ageFinal: fa.age,
    ageEpuisementOptimise: epuise(central), ageEpuisementProrata: epuise(prorata),
    patrimoineFinalOptimise: central[central.length - 1].financier, patrimoineFinalProrata: prorata[prorata.length - 1].financier,
    avAvant70Final: [...central].reverse().find((pt) => pt.avAvant70 != null)?.avAvant70 ?? 0, exemples,
  };
}

// Scénario central et hypothèses de retraite : base commune à projeter() et projeterCentral(),
// pour que le central soit strictement le même avec ou sans tirages au hasard.
function centralEtRetraite(planSaisi, profilSaisi, { inclureAchat = true, prolonger = true, fiscF = null } = {}) {
  const profil = normaliserFoyer(planSaisi, profilSaisi);
  const PR = parametresRetraite(planSaisi, profil);
  // La projection va jusqu'à la fin de la retraite (94 ans) ; l'activité s'arrête à l'âge de départ choisi
  const plan = prolonger ? planDepart(planSaisi, PR.age, PR.ageFin) : { ...planSaisi, hypotheses: { ...planSaisi.hypotheses, ageRetraite: PR.age } };
  const achat = inclureAchat ? achatPourProjection(plan, profil) : null;
  const per = analyser(plan, profil).per;
  const iR = PR.age - profil.age;
  // Retraits : ordre fiscalement optimal choisi par `profil.retraite.priorite` (transmettre / consommer)
  const strategie = STRATEGIES_DECUMULATION.includes(profil.retraite?.priorite) ? profil.retraite.priorite : "transmettre";
  const infl = (plan.hypotheses.inflation ?? 0) / 100;
  const base = { age: PR.age, revenu: PR.revenu, pension: PR.pension, agePension: PR.agePension, strategie };
  const choix = choisirOrdre(plan, profil, { achat, per, retraite: base, fiscF, infl, iR });
  const retraite = { ...base, ordreEtape3: choix.ordre };
  const central = choix.points;
  const decumulation = iR >= 0 && iR < central.length - 1
    ? comparerDecumulation(central, simuler(plan, profil, { achat, detail: true, per, retraite: { ...retraite, strategie: "prorata" }, fiscF }), iR, strategie, infl, choix, profil)
    : null;
  return { profil, PR, plan, achat, per, iR, retraite, central, decumulation };
}

// `legere` (niveau Débutant) : mêmes tirages (même graine, même nombre) donc même probaDure, mais sans l'éventail
// ni le détail « après impôts » ni la recherche des revenus possibles ; `eventail` vaut alors null.
// `tirages` : nombre de scénarios imposé (recherches rapides ; sans lui, celui du plan).
export function projeter(planSaisi, profilSaisi, { inclureAchat = true, prolonger = true, analyseRetraite = true, fiscF = null, legere = false, tirages = null } = {}) {
  const { profil, PR, plan, achat, per, iR, retraite, central, decumulation } = centralEtRetraite(planSaisi, profilSaisi, { inclureAchat, prolonger, fiscF });
  const n = Math.max(50, Math.min(2000, tirages ?? plan.hypotheses.simulations ?? 500));
  const gauss = generateur(20261111);
  const correl = preparerCorrelations(plan.hypotheses);
  const chemins = [];
  const ansImpots = legere ? null : new Set(central.map((p, i) => i).filter((i) => i % 5 === 0 || i === iR || i === central.length - 1 || central[i].evenement === "achat"));
  for (let k = 0; k < n; k++) chemins.push(simuler(plan, profil, { achat, gauss, per, retraite, ansImpots, fiscF, correl }));
  const eventail = legere ? null : central.map((p, i) => {
    const vals = chemins.map((c) => c[i].financier).sort((a, b) => a - b);
    const gagnants = chemins.filter((c) => c[i].financier >= c[i].verse).length;
    const e = { age: p.age, p10: quantile(vals, 0.1), p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), probaGain: gagnants / n };
    if (ansImpots.has(i)) {
      // Après impôts : chaque scénario avec son propre impôt, puis les quantiles de ce résultat
      const apres = chemins.map((c) => ({ a: c[i].financier - (c[i].impot ?? 0), t: c[i].impot ?? 0 })).sort((x, y) => x.a - y.a);
      const q = (k) => apres[Math.round(k * (apres.length - 1))];
      Object.assign(e, { a10: q(0.1).a, t10: q(0.1).t, a50: q(0.5).a, t50: q(0.5).t, a90: q(0.9).a, t90: q(0.9).t });
    }
    return e;
  });
  const achatsRates = achat ? chemins.filter((c) => c.some((p) => p.evenement === "achat-impossible")).length : 0;
  // Retraite : chances que l'argent dure jusqu'au bout, et revenus possibles (scénario central)
  let ret = null;
  if (iR >= 0 && iR < central.length - 1) {
    const dernier = central.length - 1;
    const infl = (plan.hypotheses.inflation ?? 0) / 100;
    const reel = (v, i) => v / Math.pow(1 + infl, i);
    const tient = chemins.filter((c) => c[dernier].financier > 0.5).length / n;
    const transmet = chemins.filter((c) => c[iR].financier > 0 && reel(c[dernier].financier, dernier) >= reel(c[iR].financier, iR)).length / n;
    let preserve = null, consomme = null;
    if (analyseRetraite && !legere) {
      const essai = (revenu) => simuler(plan, profil, { achat, per, retraite: { ...retraite, revenu }, fiscF });
      const chercher = (ok) => { let bas = 0, haut = 50000; for (let k = 0; k < 24; k++) { const m = (bas + haut) / 2; if (ok(essai(m))) bas = m; else haut = m; } return bas; };
      preserve = chercher((pts) => reel(pts[dernier].financier, dernier) >= reel(pts[iR].financier, iR));
      consomme = chercher((pts) => pts[dernier].financier > 0.5);
    }
    ret = { ...PR, iR, dernier, probaDure: tient, probaTransmet: transmet,
      revenuPreserve: preserve, revenuConsomme: consomme,
      epuiseA: central.find((p, i) => i > iR && p.financier <= 0.5)?.age ?? null };
  }
  return { central, eventail, achat, per, simulations: n, achatsRates, retraite: ret, decumulation };
}

// Scénario central seulement (sans tirages au hasard) : rapide, pour classer plusieurs hypothèses fiscales
// et pour le niveau Débutant. Même `central`, `achat`, `per` et hypothèses de retraite que projeter() ;
// seules les mesures issues des tirages (probaDure, probaTransmet, revenus possibles) restent à null.
export function projeterCentral(planSaisi, profilSaisi, { inclureAchat = true, fiscF = null } = {}) {
  const { PR, achat, per, iR, central, decumulation } = centralEtRetraite(planSaisi, profilSaisi, { inclureAchat, fiscF });
  const dernier = central.length - 1;
  const ret = iR >= 0 && iR < dernier
    ? { ...PR, iR, dernier, probaDure: null, probaTransmet: null, revenuPreserve: null, revenuConsomme: null,
        epuiseA: central.find((p, i) => i > iR && p.financier <= 0.5)?.age ?? null }
    : null;
  return { central, iR, dernier, achat, per, eventail: null, simulations: 0, achatsRates: 0, retraite: ret, decumulation };
}

// Capital nécessaire à l'âge d'arrêt pour que l'argent dure jusqu'à la fin (scénario central, rendements moyens) :
// le capital de départ est multiplié par un facteur, cherché par dichotomie sur le même moteur que le reste.
// Retourne { capital, facteur } en euros de l'époque (à déflater comme le capital projeté), ou null si non défini.
export function capitalNecessaire(planSaisi, profilSaisi, { inclureAchat = true } = {}) {
  const { profil, plan, achat, per, iR, retraite, central } = centralEtRetraite(planSaisi, profilSaisi, { inclureAchat });
  const dernier = central.length - 1;
  if (!(iR >= 0 && iR < dernier) || !(central[iR].financier > 0)) return null;
  const dure = (f) => simuler(plan, profil, { achat, per, retraite: { ...retraite, facteurCapital: f } })[dernier].financier > 0.5;
  let bas = 0, haut = 1;
  while (!dure(haut)) { bas = haut; haut *= 2; if (haut > 64) return null; }
  for (let k = 0; k < 22; k++) { const m = (bas + haut) / 2; if (dure(m)) haut = m; else bas = m; }
  return { capital: central[iR].financier * haut, facteur: haut };
}

// Liberté financière (règle des 4 %) : capital de 25 fois les besoins annuels, âge où le capital placé l'atteint (« fire »)
// et âge « Coast FIRE » à partir duquel on pourrait ne plus rien épargner. Fonction pure : sert à l'onglet Retraite,
// au panneau « Liberté financière » de la Trajectoire et à la tuile du niveau Débutant (mêmes valeurs partout).
// `alloc` : allocation en euros par classe (pour le rendement moyen du portefeuille) ; sans elle, 5 % par défaut.
export function libertePatrimoine(r, H, alloc = {}) {
  const R = r?.retraite, C = r?.central;
  if (!R || !C?.length) return null;
  const infl = (H.inflation ?? 0) / 100;
  const besoinAn = Math.max(0, R.revenu - (R.pension > 0 ? R.pension : 0)) * 12;
  const objectif = besoinAn * 25;
  const tot = Object.values(alloc).reduce((t, x) => t + x, 0);
  const rNom = tot > 0 ? Object.entries(alloc).reduce((t, [c, m]) => t + (m * (H.rendements?.[c] ?? 0)) / 100, 0) / tot : 0.05;
  const rr = Math.max(0.005, (1 + rNom) / (1 + infl) - 1); // rendement réel moyen du portefeuille
  const reel = (p, i) => p.financier / Math.pow(1 + infl, i);
  const ageR = R.age;
  let coast = null, fire = null;
  for (let i = 0; i < C.length; i++) {
    const p = C[i]; if (p.age > ageR) break;
    const v = reel(p, i);
    if (!coast && v * Math.pow(1 + rr, ageR - p.age) >= objectif) coast = { age: p.age, v };
    if (!fire && v >= objectif) fire = { age: p.age, v };
  }
  return { besoinAn, objectif, rr, coast, fire, ageR, v0: reel(C[0], 0) };
}

// Mois de dépenses couverts par l'épargne de précaution (livrets), ou null si les dépenses sont inconnues
export function moisPrecaution(placements, depensesMensuelles) {
  const dep = Number(depensesMensuelles) || 0;
  return dep > 0 ? totalGroupe(placements, "livrets") / dep : null;
}

// Prévision de référence pour le suivi : valeurs annuelles des placements
// (scénario central et fourchette) à partir d'une situation donnée.
export function referenceSuivi(plan, profilSaisi, annees = 20) {
  const profil = normaliserFoyer(plan, profilSaisi);
  const H = plan.hypotheses;
  const p = { ...plan, hypotheses: { ...H, ageFinProjection: profil.age + annees, simulations: Math.min(H.simulations ?? 500, 300) } };
  const r = projeter(p, profil, { inclureAchat: true, prolonger: false, analyseRetraite: false });
  return r.central.map((pt, i) => ({
    c: Math.round(pt.financier), p10: Math.round(r.eventail[i].p10), p50: Math.round(r.eventail[i].p50), p90: Math.round(r.eventail[i].p90),
  }));
}


// ------------------------------------------------------------- suivi : prévision de référence
// Pures, partagées par l'onglet Suivi (app.js) et le centre d'alertes (alertes.js).
export const moisEntre = (a, b) => { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); };
export function prevuA(ref, mois) {
  if (!ref || mois < 0) return null;
  const t = mois / 12, i = Math.floor(t), f = t - i, n = ref.points.length - 1;
  if (i > n) return null;
  const a = ref.points[Math.min(i, n)], b = ref.points[Math.min(i + 1, n)];
  const k = (x) => a[x] + (b[x] - a[x]) * f;
  return { c: k("c"), p10: k("p10"), p50: k("p50"), p90: k("p90") };
}

// ------------------------------------------------------------- âge de départ possible
// Contexte préparé une fois, puis évaluations rapides pour un âge de départ
// et un revenu donnés : scénario central, ou N scénarios tirés au hasard
// (toujours les mêmes, pour que les comparaisons soient cohérentes).
export function contexteRetraite(planSaisi, profilSaisi) {
  const profil = normaliserFoyer(planSaisi, profilSaisi);
  const PR = parametresRetraite(planSaisi, profil);
  const plan64 = planDepart(planSaisi, PR.ageLegal, PR.ageFin);
  return { planSaisi, profil, PR, achat: achatPourProjection(plan64, profil), per: analyser(plan64, profil).per, infl: (planSaisi.hypotheses.inflation ?? 0) / 100, ordres: new Map() };
}
export function evaluerRetraite(ctx, { age, revenu = ctx.PR.revenu, scenarios = 0, seuil = 0.9 }) {
  const { profil, PR, achat, per, infl } = ctx;
  const plan = planDepart(ctx.planSaisi, age, PR.ageFin);
  const iA = age - profil.age, iF = PR.ageFin - profil.age;
  if (iA < 0 || iF <= iA) return null;
  const reel = (v, i) => v / Math.pow(1 + infl, i);
  // Retraite publique estimée automatiquement : elle dépend de l'âge d'arrêt (trimestres, décote)
  const pensionA = profil.retraite?.pensionParAge?.[age] ?? { pension: PR.pension, agePension: PR.agePension };
  const base = { age, revenu, pension: pensionA.pension, agePension: Math.max(age, pensionA.agePension) };
  // Ordre de l'étape 3 choisi sur le scénario central, mis en cache par (âge, revenu)
  const cle = `${age}|${revenu}`;
  if (!ctx.ordres) ctx.ordres = new Map();
  if (!ctx.ordres.has(cle)) ctx.ordres.set(cle, choisirOrdre(plan, profil, { achat, per, retraite: base, infl, iR: iA }));
  const choix = ctx.ordres.get(cle);
  const retraite = { ...base, ordreEtape3: choix.ordre };
  const juge = (pts) => ({ cap: reel(pts[iA].financier, iA), fin: reel(pts[iF].financier, iF) });
  if (!scenarios) {
    const j = juge(choix.points);
    return { ...j, preserve: j.cap > 0 && j.fin >= j.cap, dure: j.fin > 0.5 };
  }
  const gauss = generateur(20261112);
  const correl = preparerCorrelations(plan.hypotheses);
  const res = [];
  for (let k = 0; k < scenarios; k++) res.push(juge(simuler(plan, profil, { achat, gauss, per, retraite, correl })));
  const partPreserve = res.filter((j) => j.cap > 0 && j.fin >= j.cap).length / scenarios;
  const partDure = res.filter((j) => j.fin > 0.5).length / scenarios;
  const tri = (k) => res.map((j) => j[k]).sort((a, b) => a - b);
  const q = (k) => quantile(tri(k), 1 - seuil);
  return { partPreserve, partDure, preserve: partPreserve >= seuil, dure: partDure >= seuil, capPessimiste: q("cap"), finPessimiste: q("fin") };
}


// ------------------------------------------------------------- crises rejouées
// Rendements annuels approximatifs (en euros, en %) de crises passées, pour
// les classes du plan. Bourse : 70 % S&P 500 + 30 % STOXX Europe 600 en euros.
// Le bitcoin n'existait pas avant 2009 : on lui applique une chute comparable
// à celles de 2018 et 2022. Ce sont des ordres de grandeur, pas des données exactes.
export const CRISES = {
  "2008": { libelle: "Crise financière de 2008 (subprimes)", resume: "Faillite de Lehman Brothers : les bourses perdent près de 40 % en un an, puis remontent sur 2 à 3 ans.", annees: [
    { bourse: -37, or: 11, bitcoin: -70, scpi: -2, prudent: 3.5, securite: 3 },
    { bourse: 25, or: 20, bitcoin: 60, scpi: 3, prudent: 3.5, securite: 1.3 },
    { bourse: 19, or: 30, bitcoin: 30, scpi: 6, prudent: 3.2, securite: 1.5 },
    { bourse: 1, or: 14, bitcoin: 10, scpi: 5, prudent: 3, securite: 2 },
  ] },
  "2000": { libelle: "Bulle Internet (2000 à 2003)", resume: "Les valeurs technologiques s'effondrent : trois années de baisse d'affilée, environ −45 % au total, avant la reprise.", annees: [
    { bourse: -3, or: 2, bitcoin: -70, scpi: 3, prudent: 5.3, securite: 3 },
    { bourse: -10, or: 8, bitcoin: -20, scpi: 4, prudent: 5.3, securite: 3 },
    { bourse: -33, or: 6, bitcoin: 30, scpi: 5, prudent: 4.9, securite: 3 },
    { bourse: 7, or: -1, bitcoin: 80, scpi: 6, prudent: 4.5, securite: 2.3 },
  ] },
  "2022": { libelle: "Inflation et hausse des taux (2022)", resume: "Retour de l'inflation : actions et obligations baissent ensemble, le bitcoin perd près des deux tiers, puis rebond en 2023.", annees: [
    { bourse: -13, or: 6, bitcoin: -64, scpi: 4.5, prudent: 2, securite: 1 },
    { bourse: 20, or: 11, bitcoin: 150, scpi: -3, prudent: 2.6, securite: 3 },
  ] },
  pire: { libelle: "Crise très grave (scénario imaginé, pire que 2008)", resume: "Trois années de baisse (−60 % pour les actions au plus bas), une reprise lente, et l'immobilier qui recule aussi.", annees: [
    { bourse: -35, or: 15, bitcoin: -80, scpi: -10, prudent: 2, securite: 2 },
    { bourse: -25, or: 10, bitcoin: -30, scpi: -10, prudent: 1, securite: 1 },
    { bourse: -15, or: 0, bitcoin: 50, scpi: -5, prudent: 1, securite: 1 },
    { bourse: 25, or: -5, bitcoin: 100, scpi: 5, prudent: 2, securite: 2 },
    { bourse: 20, or: 0, bitcoin: 20, scpi: 5, prudent: 2, securite: 2 },
    { bourse: 15, or: 5, bitcoin: 0, scpi: 5, prudent: 2, securite: 2 },
  ] },
};

// Trois trajectoires (scénario central) : sans crise, crise en gardant le cap, crise en paniquant
export function simulerCrise(planSaisi, profilSaisi, { crise, ageDebut, inclureAchat = true }) {
  const profil = normaliserFoyer(planSaisi, profilSaisi);
  const PR = parametresRetraite(planSaisi, profil);
  const plan = planDepart(planSaisi, PR.age, PR.ageFin);
  const achat = inclureAchat ? achatPourProjection(plan, profil) : null;
  const per = analyser(plan, profil).per;
  const base = { age: PR.age, revenu: PR.revenu, pension: PR.pension, agePension: PR.agePension };
  // Ordre choisi sans la crise (on ne connaît pas la crise à l'avance), puis appliqué aux trois trajectoires
  const retraite = { ...base, ordreEtape3: choisirOrdre(plan, profil, { achat, per, retraite: base, infl: (plan.hypotheses.inflation ?? 0) / 100, iR: PR.age - profil.age }).ordre };
  const C = CRISES[crise];
  const debut = Math.max(0, Math.round(ageDebut - profil.age));
  const choc = { debut, annees: C.annees };
  return {
    sans: simuler(plan, profil, { achat, per, retraite }),
    garde: simuler(plan, profil, { achat, per, retraite, choc }),
    // La panique arrive au plus bas : on vend à la fin de la dernière année de baisse, on revient 2 ans plus tard
    panique: simuler(plan, profil, { achat, per, retraite, choc: { ...choc, panique: true, decalagePanique: Math.max(0, C.annees.findIndex((a) => a.bourse >= 0) - 1) } }),
    debut, crise: C, ageRetraite: PR.age,
  };
}

// ------------------------------------------------------------- backtest sur fenêtres historiques glissantes
// `series` : tableau trié par année de { annee, bourse, or, bitcoin|null, scpi, prudent, securite, inflation } (en %).
// Retourne les n − longueur + 1 fenêtres de `longueur` années consécutives.
// Bitcoin : données exploitables seulement à partir de BITCOIN_DEBUT. Avant fin 2017 (lancement des contrats à terme CME régulés),
// puis statut PSAN de l'AMF en 2019, un épargnant français n'avait pas d'accès réaliste et liquide ; on exclut aussi la phase de bulle
// initiale (2011→2025 = ×331 899 sans rééquilibrage). Avant BITCOIN_DEBUT (ou si bitcoin vaut null), on applique le rendement `bourse`.
export const BITCOIN_DEBUT = 2018;
// `estimations` : { classe: { de, a } } plages d'années non mesurées. Chaque fenêtre porte `anneesEstimees` { scpi, prudent, bitcoin }
// (nombre d'années de la fenêtre dans chaque plage ; bitcoin = années substituées), clés > 0 seulement, et `bitcoinSubstitue`
// (au moins une année substituée). Chaque année porte `estimee` : la liste des classes estimées cette année-là.
export function fenetresHistoriques(series, longueur, { estimations = {}, bitcoinDebut = BITCOIN_DEBUT } = {}) {
  const L = Math.round(longueur);
  if (!Array.isArray(series) || !(L >= 1) || series.length < L) return [];
  const fenetres = [];
  for (let i = 0; i + L <= series.length; i++) {
    const compte = {};
    const annees = series.slice(i, i + L).map((a) => {
      const estimee = [];
      for (const [c, pl] of Object.entries(estimations ?? {})) if (pl && a.annee >= pl.de && a.annee <= pl.a) estimee.push(c);
      let o = { ...a };
      if (a.bitcoin == null || a.annee < bitcoinDebut) { o = { ...a, bitcoin: a.bourse }; estimee.push("bitcoin"); }
      for (const c of estimee) compte[c] = (compte[c] ?? 0) + 1;
      return { ...o, estimee };
    });
    fenetres.push({ debut: series[i].annee, fin: series[i + L - 1].annee, bitcoinSubstitue: !!compte.bitcoin, anneesEstimees: compte, annees });
  }
  return fenetres;
}

// Rejoue le plan sur chaque fenêtre historique : années de la fenêtre = rendements ET inflation réels, hors fenêtre =
// hypothèses centrales. Départ : "maintenant" (année 0) ou "retraite" (année du départ à la retraite). Fenêtre tronquée
// à l'horizon de la projection. Ordre de décumulation = celui choisi pour le scénario central (pas de re-choix par fenêtre).
// Succès = même critère que la probabilité « le capital dure » : capital > 0,5 € à la fin de la projection.
// Montants en euros d'aujourd'hui (déflatés par l'indice d'inflation propre à chaque scénario).
export function backtesterHistorique(planSaisi, profilSaisi, { series, longueur = 30, depart = "retraite", inclureAchat = true, estimations = {} } = {}) {
  if (!Array.isArray(series) || !series.length) throw new Error("backtesterHistorique : `series` (rendements et inflation historiques annuels) est obligatoire.");
  if (depart !== "maintenant" && depart !== "retraite") throw new Error("backtesterHistorique : `depart` doit valoir « maintenant » ou « retraite ».");
  const { profil, PR, plan, achat, per, iR, retraite, central } = centralEtRetraite(planSaisi, profilSaisi, { inclureAchat });
  const dernier = central.length - 1;
  const infl = (plan.hypotheses.inflation ?? 0) / 100;
  const y0 = Math.min(dernier, depart === "maintenant" ? 0 : Math.max(0, iR));
  const L = Math.max(0, Math.min(Math.round(longueur), dernier - y0));
  const yFin = y0 + L;
  const fenetres = fenetresHistoriques(series, longueur, { estimations }).map((f) => {
    const choc = { debut: y0, annees: f.annees.slice(0, L) };
    const pts = simuler(plan, profil, { achat, detail: true, per, retraite, choc });
    const indice = fabriqueIndiceInflation(infl, choc);
    // Années estimées « comptant » : seulement celles où la classe est réellement détenue au début de l'année (valeur > 0 dans le scénario)
    const anneesEstimees = {};
    choc.annees.forEach((a, k) => { for (const c of a.estimee ?? []) if ((pts[y0 + k]?.classes?.[c] ?? 0) > 0) anneesEstimees[c] = (anneesEstimees[c] ?? 0) + 1; });
    const prod = choc.annees.reduce((p, a) => p * (1 + (a.inflation ?? 0) / 100), 1);
    return {
      debut: f.debut, fin: f.fin, bitcoinSubstitue: f.bitcoinSubstitue, anneesEstimees, anneesUtilisees: L,
      capitalReelFinFenetre: pts[yFin].financier / indice(yFin),
      ageEpuisement: pts.find((pt) => pt.age >= retraite.age && pt.insuffisant)?.age ?? null,
      succes: pts[dernier].financier > 0.5,
      inflationMoyenne: L > 0 ? (Math.pow(prod, 1 / L) - 1) * 100 : 0,
      trajectoireReelle: pts.slice(y0, yFin + 1).map((pt, k) => ({ age: pt.age, valeur: pt.financier / indice(y0 + k) })),
    };
  });
  const tri = [...fenetres].sort((a, b) => a.capitalReelFinFenetre - b.capitalReelFinFenetre);
  const resume = (f) => (f ? { debut: f.debut, fin: f.fin, capitalReelFinFenetre: f.capitalReelFinFenetre } : null);
  return {
    longueur: L, depart, ageDepart: profil.age + y0, fenetres,
    estimationsLibelles: { ...Object.fromEntries(Object.entries(estimations ?? {}).map(([c, e]) => [c, e.libelle])), bitcoin: "de bitcoin remplacé par les actions" },
    synthese: { nb: fenetres.length, tauxSucces: fenetres.length ? fenetres.filter((f) => f.succes).length / fenetres.length : null,
      pire: resume(tri[0]), mediane: resume(tri[Math.floor(tri.length / 2)]), meilleure: resume(tri[tri.length - 1]) },
    centralReelFinFenetre: central[yFin].financier / Math.pow(1 + infl, yFin),
  };
}

// ------------------------------------------------------------- scénario d'inflation persistante
// Hypothèses (documentées, en points de pourcentage) : pendant `duree` ans à partir de maintenant, l'inflation vaut `taux`.
// Les taux courts suivent l'inflation avec retard (livrets : taux − 1,5 pt, plancher 0,5 % ; prudent : +0,4 pt par an, plafonné à
// taux − 1 et jamais sous son rendement central) ; les actifs réels sont jugés en rendement réel central : bourse −3 pts les 3
// premières années (hausse des taux), or +2 pts (valeur refuge), SCPI −1 pt (loyers indexés avec retard), bitcoin inchangé.
export const SCENARIO_INFLATION = {
  tauxParDefaut: 5, dureeParDefaut: 10,
  ecartLivrets: 1.5, plancherLivrets: 0.5,
  prudentHausseParAn: 0.4, prudentEcartPlafond: 1,
  bourseChocReel: -3, bourseAnneesChoc: 3, orPrimeReelle: 2, scpiPrimeReelle: -1, bitcoinPrimeReelle: 0,
};

export function scenarioInflation(planSaisi, profilSaisi, { taux = SCENARIO_INFLATION.tauxParDefaut, duree = SCENARIO_INFLATION.dureeParDefaut, inclureAchat = true } = {}) {
  const S = SCENARIO_INFLATION;
  const { profil, plan, achat, per, retraite, central } = centralEtRetraite(planSaisi, profilSaisi, { inclureAchat });
  const H = plan.hypotheses, inflC = H.inflation ?? 0;
  const dernier = central.length - 1;
  const reelC = (c) => ((1 + (H.rendements[c] ?? 0) / 100) / (1 + inflC / 100) - 1) * 100; // rendement réel central, en %
  const nominal = (reel) => ((1 + reel / 100) * (1 + taux / 100) - 1) * 100;
  const prudentC = H.rendements.prudent ?? 0;
  const annees = [];
  for (let t = 0; t < duree; t++) {
    const livrets = Math.max(S.plancherLivrets, taux - S.ecartLivrets);
    annees.push({
      securite: livrets,
      prudent: Math.max(prudentC, Math.min(Math.max(prudentC, prudentC + S.prudentHausseParAn * (t + 1)), taux - S.prudentEcartPlafond)),
      bourse: nominal(reelC("bourse") + (t < S.bourseAnneesChoc ? S.bourseChocReel : 0)),
      or: nominal(reelC("or") + S.orPrimeReelle),
      scpi: nominal(reelC("scpi") + S.scpiPrimeReelle),
      bitcoin: nominal(reelC("bitcoin") + S.bitcoinPrimeReelle),
      inflation: taux,
    });
  }
  const choc = { debut: 0, annees };
  const pts = simuler(plan, profil, { achat, detail: true, per, retraite, choc });
  const indice = fabriqueIndiceInflation(inflC / 100, choc);
  const indicesReels = Object.fromEntries(["securite", "prudent", "bourse", "or", "scpi", "bitcoin"].map((c) => {
    const serie = [100];
    annees.forEach((a) => serie.push(serie[serie.length - 1] * (1 + a[c] / 100) / (1 + taux / 100)));
    return [c, serie];
  }));
  const yFin = Math.min(duree, dernier);
  const centralReel = central[yFin].financier / Math.pow(1 + inflC / 100, yFin);
  const scenarioReel = pts[yFin].financier / indice(yFin);
  const epuise = (p) => p.find((pt) => pt.age >= retraite.age && pt.insuffisant)?.age ?? null;
  return {
    taux, duree, hypotheses: SCENARIO_INFLATION, indicesReels,
    patrimoine: { centralReel, scenarioReel, ecart: scenarioReel - centralReel, ecartPct: centralReel > 0 ? ((scenarioReel - centralReel) / centralReel) * 100 : null },
    retraite: { ageEpuisementCentral: epuise(central), ageEpuisementScenario: epuise(pts) },
  };
}

// Acheter ou louer : deux patrimoines comparés mois par mois. Celui qui paie le moins chaque mois (crédit + charges
// du propriétaire, ou loyer) place la différence sur SON portefeuille (PEA jusqu'à 150 000 € versés, puis compte-titres).
// Le locataire démarre avec l'apport investi. Résidence principale : plus-value exonérée.
export function acheterOuLouer(plan, { prix, apportInitial, mensualites = [], restantDu, charges = null, loyerMensuel = 0,
  horizon = 30, fraisReventePct = plan.achatRP?.fraisReventePct ?? 0, rendement = plan.hypotheses.rendements.bourse,
  valorisation = plan.hypotheses.valorisationImmobiliere, inflation = plan.hypotheses.inflation } = {}) {
  const M = Array.isArray(mensualites) ? mensualites : [];
  const credit = M.some((m) => Number(m) > 0);
  if (credit && typeof restantDu !== "function") throw new Error("acheterOuLouer : restantDu (capital restant dû) est obligatoire quand il y a un crédit.");
  const dette = (k) => {
    if (typeof restantDu !== "function") return 0;
    const v = restantDu(k);
    if (!Number.isFinite(v)) throw new Error(`acheterOuLouer : restantDu(${k}) n'est pas un nombre fini.`);
    return v;
  };
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const P = Math.max(0, num(prix)), apport = Math.max(0, num(apportInitial)), loyer0 = Math.max(0, num(loyerMensuel));
  const H = Math.max(1, Math.round(num(horizon)));
  const infl = num(inflation) / 100, val = num(valorisation) / 100;
  const rm = Math.pow(1 + num(rendement) / 100, 1 / 12) - 1;
  const tf = num(charges?.taxeFonciere) + num(charges?.copro), ent = num(charges?.entretien);
  const PLAFOND_PEA = PLAFONDS.pea;
  const nouveau = () => ({ pea: { v: 0, c: 0 }, cto: { v: 0, c: 0 } });
  const verser = (pf, x) => {
    if (!(x > 0)) return;
    const place = Math.max(0, PLAFOND_PEA - pf.pea.c), dansPea = Math.min(x, place);
    pf.pea.v += dansPea; pf.pea.c += dansPea;
    pf.cto.v += x - dansPea; pf.cto.c += x - dansPea;
  };
  const croitre = (pf) => { pf.pea.v *= 1 + rm; pf.cto.v *= 1 + rm; };
  const net = (pf, t) => {
    const taxPea = (t >= 5 ? PRELEVEMENTS.PS_CAPITAL : PFU) / 100;
    return pf.pea.v - Math.max(0, pf.pea.v - pf.pea.c) * taxPea + pf.cto.v - Math.max(0, pf.cto.v - pf.cto.c) * (PFU / 100);
  };
  const acheteur = nouveau(), locataire = nouveau();
  verser(locataire, apport);
  const fRev = num(fraisReventePct) / 100;
  const serie = [];
  let versAch = 0, versLoc = 0;
  // Point de départ (t = 0) : l'acheteur détient le bien net de frais de revente et de dette ; le locataire, tout le capital placé
  const dette0 = dette(-1);
  serie.push({ annee: 0, patrimoineAcheteur: P * (1 - fRev) - dette0, patrimoineLocataire: net(locataire, 0), ecart: P * (1 - fRev) - dette0 - net(locataire, 0),
    valeurBien: P, dette: dette0, fraisReventeDeduits: P * fRev, portefeuilleAcheteur: 0, portefeuilleLocataire: net(locataire, 0),
    versementsAcheteurCumules: 0, versementsLocataireCumules: 0, coutProprioMensuelMoyen: num(M[0]) + tf / 12 + ent / 12, loyerMensuel: loyer0 });
  for (let t = 1; t <= H; t++) {
    const k = t - 1, ind = Math.pow(1 + infl, k);
    const valeurDebut = P * Math.pow(1 + val, k);
    let sommeCout = 0;
    for (let m = 0; m < 12; m++) {
      const valeurMois = valeurDebut * Math.pow(1 + val, m / 12);
      const coutProprio = num(M[k]) + (tf / 12) * ind + (P > 0 ? (ent / 12) * (valeurMois / P) : 0);
      const loyer = loyer0 * ind;
      sommeCout += coutProprio;
      croitre(acheteur); croitre(locataire);
      if (coutProprio < loyer) { verser(acheteur, loyer - coutProprio); versAch += loyer - coutProprio; }
      else { verser(locataire, coutProprio - loyer); versLoc += coutProprio - loyer; }
    }
    const valeurBien = P * Math.pow(1 + val, t);
    const detteT = dette(k);
    const portefeuilleAcheteur = net(acheteur, t), portefeuilleLocataire = net(locataire, t);
    const patrimoineAcheteur = valeurBien * (1 - fRev) - detteT + portefeuilleAcheteur;
    const patrimoineLocataire = portefeuilleLocataire;
    serie.push({ annee: t, patrimoineAcheteur, patrimoineLocataire, ecart: patrimoineAcheteur - patrimoineLocataire,
      valeurBien, dette: detteT, fraisReventeDeduits: valeurBien * fRev, portefeuilleAcheteur, portefeuilleLocataire,
      versementsAcheteurCumules: versAch, versementsLocataireCumules: versLoc, coutProprioMensuelMoyen: sommeCout / 12, loyerMensuel: loyer0 * ind });
  }
  // Le point mort se cherche à partir de t = 1 : à t = 0 la perte initiale est visible mais ne compte pas comme un croisement
  const iPM = serie.findIndex((x) => x.annee >= 1 && x.patrimoineAcheteur >= x.patrimoineLocataire);
  const pointMort = iPM >= 0 ? serie[iPM].annee : null;
  const recroise = iPM >= 0 && serie.slice(iPM + 1).some((x) => x.patrimoineLocataire > x.patrimoineAcheteur);
  return { serie, pointMort, recroise, hypotheses: { rendement: num(rendement), valorisation: num(valorisation), inflation: num(inflation), fraisReventePct: num(fraisReventePct), horizon: H } };
}

// Comparaison acheter / louer pour l'achat retenu par la projection : même construction pour l'application et les tests.
// Capital de départ identique : le locataire place tout l'apport requis (frais de notaire compris, aide familiale comprise).
export function comparaisonAchatLocation(plan, profil, { horizon = 30 } = {}) {
  const ap = achatPourProjection(plan, profil);
  if (!ap) return null;
  const A = plan.achatRP;
  const loyer = ap.loyerMarche || profil.loyerMensuel || 0;
  if (!(loyer > 0)) return { ap, loyer: 0, resultat: null };
  const ech = ap.restantDu ? null : echeancier(ap.pret, A.tauxCredit, ap.duree, null);
  const restantDu = ap.restantDu ?? ((k) => ech.restant(k));
  // Frais annexes du prêt (garantie non restituée + dossier, sur le prêt total PTZ compris) : propres au comparatif.
  // Ils ne modifient ni le financement ni la trajectoire de projection ; le locataire place ce même capital, l'acheteur le perd.
  const fraisAnnexes = Math.max(0, ap.pret) * (A.fraisGarantiePctPret ?? 0) / 100 + (A.fraisDossier ?? 0);
  const fraisNotaire = ap.prix * (A.fraisNotairePourcent?.[profil.projetRP?.type] ?? 0) / 100;
  const apportInitial = Math.max(0, ap.apportRequis) + fraisAnnexes;
  const resultat = acheterOuLouer(plan, { prix: ap.prix, apportInitial, mensualites: ap.mensualites ?? [], restantDu, charges: ap.charges, loyerMensuel: loyer, horizon });
  return { ap, loyer, apportInitial, fraisAnnexes, fraisNotaire, restantDu, resultat };
}

// =====================================================================
//  IMPACT DES FRAIS — même placement (rendement brut), deux niveaux de frais annuels.
//  Fonction pure : capital initial + versements mensuels (fin de mois), capitalisation mensuelle (taux annuel / 12),
//  rendement net = rendement brut − frais (en points de pourcentage par an), en euros courants.
// =====================================================================
export const FRAIS_CHARGE = 2.0;    // % par an : assurance-vie bancaire, fonds actifs « maison »
export const FRAIS_OPTIMISE = 0.2;  // % par an : PEA + ETF
export const RENDEMENT_BRUT_FRAIS = 6; // % par an avant frais (même hypothèse que le tableau de la fiche « Les frais »)

export function comparerFrais({ capital = 0, mensuel = 0, annees = 30, rendementBrut = RENDEMENT_BRUT_FRAIS, fraisCharge = FRAIS_CHARGE, fraisOptimise = FRAIS_OPTIMISE, depensesMensuelles = 0 } = {}) {
  const C = Math.max(0, Number(capital) || 0), M = Math.max(0, Number(mensuel) || 0);
  const N = Math.min(60, Math.max(1, Math.round(Number(annees) || 1)));
  const rb = Number(rendementBrut) || 0;
  const serie = (frais) => {
    const m = (rb - frais) / 100 / 12; // taux mensuel proportionnel, comme le tableau de la fiche
    let v = C;
    const s = [C];
    for (let a = 1; a <= N; a++) {
      for (let i = 0; i < 12; i++) v = v * (1 + m) + M;
      s.push(v);
    }
    return s;
  };
  const charge = serie(fraisCharge), optimise = serie(fraisOptimise);
  const verse = C + M * 12 * N;
  const ecart = Math.max(0, optimise[N] - charge[N]);
  const depenses = Number(depensesMensuelles) > 0 ? Number(depensesMensuelles) : 0;
  return {
    annees: N, verse, charge, optimise,
    capitalCharge: charge[N], capitalOptimise: optimise[N],
    ecart,
    ecartPct: optimise[N] > 0 ? (100 * ecart) / optimise[N] : 0,
    anneesDepenses: depenses > 0 ? ecart / (12 * depenses) : null, // années de dépenses courantes que représente l'écart
    renteMensuelle4pct: (ecart * 0.04) / 12,                         // revenu mensuel perdu selon la règle des 4 %
  };
}
