// =====================================================================
//  Empreinte automatique des caches du service worker (sans dépendance).
//
//   node outils/empreinte-shell.mjs             réécrit CACHE_VERSION et CACHE_DONNEES dans service-worker.js
//   node outils/empreinte-shell.mjs --verifier  n'écrit rien, code 1 si les empreintes sont périmées
//
//  shell   : SHA-256 (12 premiers caractères hexa) du chemin et du contenu de chaque fichier du tableau SHELL.
//  donnees : même calcul sur tous les fichiers dvf/*.json triés (indépendant du code : les données DVF ne sont
//            re-téléchargées que si elles changent).
// =====================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PREFIXE = "plan-patrimoine-";

/** Chaînes entre guillemets du littéral « const SHELL = [ … ]; » (commentaires ignorés, échappements gérés). */
export function cheminsShell(texteSW) {
  const m = /const SHELL = \[([\s\S]*?)\n\];/.exec(texteSW) ?? /const SHELL = \[([\s\S]*?)\];/.exec(texteSW);
  if (!m) throw new Error("Tableau SHELL introuvable dans service-worker.js");
  const corps = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  return [...corps.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
}

const hache = (parties) => {
  const h = createHash("sha256");
  for (const [chemin, contenu] of parties) { h.update(chemin); h.update("\0"); h.update(contenu); h.update("\0"); }
  return h.digest("hex").slice(0, 12);
};

export function empreintes(racine) {
  const sw = readFileSync(join(racine, "service-worker.js"), "utf8");
  const fichiers = cheminsShell(sw).map((c) => (c === "./" ? "index.html" : c));
  const shell = hache(fichiers.filter((c, i) => fichiers.indexOf(c) === i).map((c) => [c, readFileSync(join(racine, c))]));
  let donnees = "";
  try {
    const noms = readdirSync(join(racine, "dvf")).filter((n) => n.endsWith(".json")).sort();
    donnees = hache(noms.map((n) => [`dvf/${n}`, readFileSync(join(racine, "dvf", n))]));
  } catch { donnees = hache([]); }
  return { shell, donnees };
}

export function versionsDeclarees(texteSW) {
  const shell = /const CACHE_VERSION = "plan-patrimoine-([^"]*)"/.exec(texteSW)?.[1] ?? null;
  const donnees = /const CACHE_DONNEES = "plan-patrimoine-dvf-([^"]*)"/.exec(texteSW)?.[1] ?? null;
  return { shell, donnees };
}

function cli() {
  const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fichier = join(racine, "service-worker.js");
  const texte = readFileSync(fichier, "utf8");
  const avant = versionsDeclarees(texte), apres = empreintes(racine);
  const identique = avant.shell === apres.shell && avant.donnees === apres.donnees;
  if (process.argv.includes("--verifier")) {
    if (identique) { console.log(`Empreinte du cache à jour (shell ${apres.shell}, données ${apres.donnees}).`); return; }
    console.error("Empreinte du cache périmée : lance node outils/empreinte-shell.mjs");
    process.exitCode = 1; return;
  }
  const maj = texte
    .replace(/const CACHE_VERSION = "[^"]*";/, `const CACHE_VERSION = "${PREFIXE}${apres.shell}";`)
    .replace(/const CACHE_DONNEES = .*;/, `const CACHE_DONNEES = "${PREFIXE}dvf-${apres.donnees}";`);
  if (maj !== texte) writeFileSync(fichier, maj);
  console.log(`Avant : shell ${avant.shell ?? "?"}, données ${avant.donnees ?? "?"}\nAprès : shell ${apres.shell}, données ${apres.donnees}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
