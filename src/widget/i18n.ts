export const MESSAGES = {
  en: {
    label: "I'm not a bot",
    start: "Check that I'm not a bot",
    signals: "Reading the browser…",
    rules: "Cross-checking…",
    pow: "Proof of work…",
    model: "Asking the model…",
    verify: "Verifying…",
    human: "Verified",
    unsure: "One more step",
    bot: "Looks automated",
    error: "Check failed, try again",
    slideHint: "Slide the handle into the marked zone",
    slideLabel: "Slider: move it into the zone with the arrow keys, then press Enter",
    slideRetry: "Not quite, try again",
    retry: "Try again",
    details: "Details",
    score: "Bot probability",
    flags: "Signals raised",
    pow_took: "Proof of work",
    unsigned: "Front-only: this result is advisory, not signed by a server.",
    by: "notabot, open source",
  },
  fr: {
    label: "Je ne suis pas un robot",
    start: "Vérifier que je ne suis pas un robot",
    signals: "Lecture du navigateur…",
    rules: "Recoupement…",
    pow: "Preuve de travail…",
    model: "Avis du modèle…",
    verify: "Vérification…",
    human: "Vérifié",
    unsure: "Encore une étape",
    bot: "Semble automatisé",
    error: "Échec, réessayez",
    slideHint: "Glissez la poignée dans la zone marquée",
    slideLabel: "Curseur : amenez-le dans la zone avec les flèches, puis Entrée",
    slideRetry: "Presque, réessayez",
    retry: "Réessayer",
    details: "Détails",
    score: "Probabilité de robot",
    flags: "Signaux levés",
    pow_took: "Preuve de travail",
    unsigned: "Front seul : résultat indicatif, non signé par un serveur.",
    by: "notabot, open source",
  },
} as const;

export type Lang = keyof typeof MESSAGES;
export type MessageKey = keyof (typeof MESSAGES)["en"];

export function langOf(value: string | null | undefined): Lang {
  const v = (value || (typeof navigator !== "undefined" ? navigator.language : "") || "en")
    .toLowerCase()
    .slice(0, 2);
  return v === "fr" ? "fr" : "en";
}
