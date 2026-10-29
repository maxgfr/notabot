const en = {
  label: "I'm not a bot",
  start: "Check that I'm not a bot",
  signals: "Reading the browser…",
  rules: "Cross-checking…",
  pow: "Proof of work…",
  model: "Asking the model…",
  verify: "Verifying…",
  human: "Checked",
  unsure: "One more step",
  bot: "Looks automated",
  error: "Check failed, try again",
  errorExpired: "The check expired, try again",
  errorRefused: "The server refused this check",
  errorRate: "Too many attempts, wait a minute",
  errorNetwork: "Server unreachable, try again",
  slideHint: "Slide the handle into the marked zone",
  slideLabel: "Slider: move it into the zone with the arrow keys, then press Enter",
  slideRetry: "Not quite, try again",
  targetsHint: "Press the targets in order: 1, 2, 3",
  targetsRetry: "Not in order, try again",
  targetLabel: "Target {n}",
  retry: "Try again",
  details: "Details",
  score: "Bot probability",
  flags: "Signals raised",
  pow_took: "Proof of work",
  unsigned: "Front-only: this result is advisory, not signed by a server.",
  friction:
    "The extra step slows scripts down; it does not prove anyone human. Image and slider puzzles are solved by machines too.",
  by: "notabot, open source",
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const fr: Messages = {
  label: "Je ne suis pas un robot",
  start: "Vérifier que je ne suis pas un robot",
  signals: "Lecture du navigateur…",
  rules: "Recoupement…",
  pow: "Preuve de travail…",
  model: "Avis du modèle…",
  verify: "Vérification…",
  human: "Contrôle passé",
  unsure: "Encore une étape",
  bot: "Semble automatisé",
  error: "Échec, réessayez",
  errorExpired: "La vérification a expiré, réessayez",
  errorRefused: "Le serveur a refusé cette vérification",
  errorRate: "Trop d'essais, patientez une minute",
  errorNetwork: "Serveur injoignable, réessayez",
  slideHint: "Glissez la poignée dans la zone marquée",
  slideLabel: "Curseur : amenez-le dans la zone avec les flèches, puis Entrée",
  slideRetry: "Presque, réessayez",
  targetsHint: "Appuyez sur les cibles dans l'ordre : 1, 2, 3",
  targetsRetry: "Pas dans l'ordre, réessayez",
  targetLabel: "Cible {n}",
  retry: "Réessayer",
  details: "Détails",
  score: "Probabilité de robot",
  flags: "Signaux levés",
  pow_took: "Preuve de travail",
  unsigned: "Front seul : résultat indicatif, non signé par un serveur.",
  friction:
    "L'étape en plus freine les scripts ; elle ne prouve pas qu'on est humain. Les puzzles d'images et de curseur sont aussi résolus par des machines.",
  by: "notabot, open source",
};

const de: Messages = {
  label: "Ich bin kein Roboter",
  start: "Prüfen, dass ich kein Roboter bin",
  signals: "Browser wird gelesen…",
  rules: "Abgleich…",
  pow: "Rechenaufgabe…",
  model: "Modell wird gefragt…",
  verify: "Überprüfung…",
  human: "Geprüft",
  unsure: "Noch ein Schritt",
  bot: "Wirkt automatisiert",
  error: "Prüfung fehlgeschlagen, bitte erneut",
  errorExpired: "Die Prüfung ist abgelaufen, bitte erneut",
  errorRefused: "Der Server hat diese Prüfung abgelehnt",
  errorRate: "Zu viele Versuche, bitte eine Minute warten",
  errorNetwork: "Server nicht erreichbar, bitte erneut",
  slideHint: "Schieben Sie den Griff in die markierte Zone",
  slideLabel: "Schieberegler: mit den Pfeiltasten in die Zone, dann Enter",
  slideRetry: "Nicht ganz, bitte erneut",
  targetsHint: "Drücken Sie die Ziele der Reihe nach: 1, 2, 3",
  targetsRetry: "Nicht in der Reihenfolge, bitte erneut",
  targetLabel: "Ziel {n}",
  retry: "Erneut versuchen",
  details: "Details",
  score: "Roboter-Wahrscheinlichkeit",
  flags: "Ausgelöste Signale",
  pow_took: "Rechenaufgabe",
  unsigned: "Nur im Browser: Ergebnis unverbindlich, nicht von einem Server signiert.",
  friction:
    "Der zusätzliche Schritt bremst Skripte; er beweist nicht, dass jemand ein Mensch ist. Bild- und Schieberätsel lösen auch Maschinen.",
  by: "notabot, Open Source",
};

const es: Messages = {
  label: "No soy un robot",
  start: "Comprobar que no soy un robot",
  signals: "Leyendo el navegador…",
  rules: "Contrastando…",
  pow: "Prueba de trabajo…",
  model: "Consultando al modelo…",
  verify: "Verificando…",
  human: "Comprobado",
  unsure: "Un paso más",
  bot: "Parece automatizado",
  error: "Falló la comprobación, inténtelo de nuevo",
  errorExpired: "La comprobación caducó, inténtelo de nuevo",
  errorRefused: "El servidor rechazó esta comprobación",
  errorRate: "Demasiados intentos, espere un minuto",
  errorNetwork: "Servidor inaccesible, inténtelo de nuevo",
  slideHint: "Deslice el control hasta la zona marcada",
  slideLabel: "Control deslizante: llévelo a la zona con las flechas y pulse Intro",
  slideRetry: "Casi, inténtelo de nuevo",
  targetsHint: "Pulse los objetivos en orden: 1, 2, 3",
  targetsRetry: "No en orden, inténtelo de nuevo",
  targetLabel: "Objetivo {n}",
  retry: "Reintentar",
  details: "Detalles",
  score: "Probabilidad de robot",
  flags: "Señales activadas",
  pow_took: "Prueba de trabajo",
  unsigned: "Solo en el navegador: resultado orientativo, no firmado por un servidor.",
  friction:
    "El paso extra frena a los scripts; no prueba que nadie sea humano. Las máquinas también resuelven puzles de imágenes y deslizadores.",
  by: "notabot, código abierto",
};

/** The widget's strings by language; English is complete and the fallback for any missing key. */
export const MESSAGES: Record<string, Partial<Messages>> & { en: Messages } = { en, fr, de, es };

export type Lang = string;

/** Adds or completes a language: `registerMessages("it", { label: "Non sono un robot", … })`. */
export function registerMessages(lang: string, messages: Partial<Messages>): void {
  const code = lang.toLowerCase().slice(0, 2);
  MESSAGES[code] = { ...MESSAGES[code], ...messages };
}

/** The supported language of a code ("fr-CA" → "fr"), English when there is none. */
export function langOf(value: string | null | undefined): Lang {
  const v = (value || (typeof navigator !== "undefined" ? navigator.language : "") || "en")
    .toLowerCase()
    .slice(0, 2);
  return v in MESSAGES ? v : "en";
}
