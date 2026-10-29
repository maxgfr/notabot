import type { NotabotSignals } from "../../src/signals/types";

type L = { en: string; fr: string };
export type Privacy = "low" | "medium" | "high";

export interface Field {
  id: string;
  label: L;
  /** What the value tells a site, in one line. */
  reveals: L;
  privacy: Privacy;
  /** Rules this reading feeds: the row is marked when one of them is raised. */
  rules?: string[];
  value(s: NotabotSignals): string;
}

export interface Group {
  id: string;
  title: L;
  intro: L;
  fields: Field[];
}

const yes = (b: boolean | null | undefined) =>
  b === null || b === undefined ? "—" : b ? "true" : "false";
const list = (a: string[] | undefined) => (a?.length ? a.join(", ") : "—");
const num = (n: number | null | undefined, unit = "") =>
  n === null || n === undefined ? "—" : `${n}${unit}`;

export const GROUPS: Group[] = [
  {
    id: "identity",
    title: { en: "What it declares", fr: "Ce qu'il déclare" },
    intro: {
      en: "The browser's own claims. Free to lie about, so they are only worth checking against everything else.",
      fr: "Ce que le navigateur affirme de lui-même. Mentir ici ne coûte rien : ça ne vaut que recoupé avec le reste.",
    },
    fields: [
      {
        id: "ua",
        rules: [
          "headless-user-agent",
          "os-mismatch",
          "engine-mismatch",
          "mobile-without-touch",
          "chrome-object-missing",
        ],
        label: { en: "User agent", fr: "User agent" },
        reveals: {
          en: "Browser, version and system, as claimed.",
          fr: "Navigateur, version et système, tels que revendiqués.",
        },
        privacy: "medium",
        value: (s) => s.env.userAgent,
      },
      {
        id: "uadata",
        rules: ["headless-brand", "os-mismatch"],
        label: { en: "Client hints", fr: "Client hints" },
        reveals: {
          en: "The same claims in structured form, with model and architecture.",
          fr: "Les mêmes affirmations, structurées, avec modèle et architecture.",
        },
        privacy: "medium",
        value: (s) =>
          s.env.uaData
            ? [
                list(s.env.uaData.brands),
                s.env.uaData.platform,
                s.env.uaData.platformVersion,
                s.env.uaData.architecture,
                s.env.uaData.bitness,
                s.env.uaData.model,
              ]
                .filter(Boolean)
                .join(" · ")
            : "—",
      },
      {
        id: "platform",
        rules: ["os-mismatch"],
        label: { en: "Platform", fr: "Plateforme" },
        reveals: {
          en: "The system, a second time, from an older API.",
          fr: "Le système, une seconde fois, par une API plus ancienne.",
        },
        privacy: "low",
        value: (s) => `${s.env.platform || "—"} · ${s.env.vendor || "—"}`,
      },
      {
        id: "engine",
        rules: ["engine-mismatch"],
        label: { en: "JavaScript engine", fr: "Moteur JavaScript" },
        reveals: {
          en: "eval.toString() is 33 characters in V8, 37 elsewhere: the engine cannot pretend.",
          fr: "eval.toString() fait 33 caractères sous V8, 37 ailleurs : le moteur ne peut pas mentir.",
        },
        privacy: "low",
        value: (s) =>
          `${s.automation.engineObserved} (eval ${s.env.evalLength}) · error text: ${s.env.errorFingerprint}`,
      },
    ],
  },
  {
    id: "locale",
    title: { en: "Where it says it is", fr: "Où il dit se trouver" },
    intro: {
      en: "A server compares these with the IP's location; the page compares them with each other.",
      fr: "Un serveur les compare à la localisation de l'IP ; la page les compare entre eux.",
    },
    fields: [
      {
        id: "languages",
        rules: ["language-mismatch", "empty-languages"],
        label: { en: "Languages", fr: "Langues" },
        reveals: {
          en: "Your reading languages, in order of preference.",
          fr: "Vos langues de lecture, par ordre de préférence.",
        },
        privacy: "medium",
        value: (s) => `${list(s.env.languages)} · Intl ${s.env.intlLocale}`,
      },
      {
        id: "timezone",
        rules: ["timezone-mismatch"],
        label: { en: "Time zone", fr: "Fuseau horaire" },
        reveals: {
          en: "Roughly where you are. The name and the clock offset must agree.",
          fr: "À peu près où vous êtes. Le nom et le décalage de l'horloge doivent concorder.",
        },
        privacy: "high",
        value: (s) => {
          const o = -s.env.timezoneOffset;
          const sign = o >= 0 ? "+" : "−";
          return `${s.env.timezone} · UTC${sign}${Math.floor(Math.abs(o) / 60)}:${String(Math.abs(o) % 60).padStart(2, "0")}`;
        },
      },
    ],
  },
  {
    id: "machine",
    title: { en: "What the machine is", fr: "Ce qu'est la machine" },
    intro: {
      en: "Hardware is hard to fake consistently: a cheap server, a VM or a phone farm each leave a different shape.",
      fr: "Le matériel est difficile à imiter de façon cohérente : serveur, VM ou ferme de téléphones laissent chacun leur trace.",
    },
    fields: [
      {
        id: "screen",
        label: { en: "Screen", fr: "Écran" },
        reveals: {
          en: "Display size, density and colour depth.",
          fr: "Taille, densité et profondeur de couleur de l'écran.",
        },
        privacy: "medium",
        value: (s) =>
          `${s.env.screen.width}×${s.env.screen.height} @${s.env.screen.pixelRatio}x · ${s.env.screen.colorDepth}-bit · avail ${s.env.screen.availWidth}×${s.env.screen.availHeight}`,
      },
      {
        id: "window",
        rules: ["outer-size-zero"],
        label: { en: "Window", fr: "Fenêtre" },
        reveals: {
          en: "Inner versus outer size: a headless browser often has no window around the page.",
          fr: "Taille intérieure et extérieure : un navigateur headless n'a souvent pas de fenêtre autour de la page.",
        },
        privacy: "low",
        value: (s) =>
          `inner ${s.env.window.innerWidth}×${s.env.window.innerHeight} · outer ${s.env.window.outerWidth}×${s.env.window.outerHeight}`,
      },
      {
        id: "cpu",
        rules: ["implausible-hardware"],
        label: { en: "Cores · memory", fr: "Cœurs · mémoire" },
        reveals: {
          en: "Logical cores and a rounded memory size.",
          fr: "Cœurs logiques et une mémoire arrondie.",
        },
        privacy: "low",
        value: (s) => `${num(s.env.hardwareConcurrency)} · ${num(s.env.deviceMemory, " GB")}`,
      },
      {
        id: "touch",
        rules: ["mobile-without-touch"],
        label: { en: "Touch points", fr: "Points tactiles" },
        reveals: {
          en: "Whether the screen is touch, to compare with a phone user agent.",
          fr: "Si l'écran est tactile, à comparer avec un user agent de téléphone.",
        },
        privacy: "low",
        value: (s) => num(s.env.maxTouchPoints),
      },
      {
        id: "gpu",
        rules: ["software-renderer", "os-mismatch"],
        label: { en: "Graphics card", fr: "Carte graphique" },
        reveals: {
          en: "Your GPU by name through WebGL; SwiftShader or llvmpipe mean software rendering.",
          fr: "Votre GPU, nommé par WebGL ; SwiftShader ou llvmpipe signifient un rendu logiciel.",
        },
        privacy: "high",
        value: (s) =>
          s.hardware.webgl
            ? `${s.hardware.webgl.unmaskedRenderer ?? s.hardware.webgl.renderer} · ${s.hardware.webgl.extensions} ext · max tex ${s.hardware.webgl.maxTextureSize}`
            : "—",
      },
      {
        id: "webgpu",
        label: { en: "WebGPU adapter", fr: "Adaptateur WebGPU" },
        reveals: {
          en: "GPU vendor and architecture, by the newer API.",
          fr: "Fabricant et architecture du GPU, par l'API récente.",
        },
        privacy: "medium",
        value: (s) =>
          s.hardware.webgpu
            ? `${s.hardware.webgpu.vendor} · ${s.hardware.webgpu.architecture}`
            : "—",
      },
    ],
  },
  {
    id: "prints",
    title: { en: "How it renders", fr: "Comment il dessine" },
    intro: {
      en: "The same drawing comes out slightly different on every graphics stack. The hashes are a fingerprint.",
      fr: "Le même dessin sort légèrement différent selon la pile graphique. Les empreintes en découlent.",
    },
    fields: [
      {
        id: "canvas",
        rules: ["canvas-noise", "fingerprint-functions-replaced"],
        label: { en: "Canvas", fr: "Canvas" },
        reveals: {
          en: "Text and shapes drawn twice: two different reads mean noise was injected.",
          fr: "Texte et formes dessinés deux fois : deux lectures différentes trahissent du bruit injecté.",
        },
        privacy: "high",
        value: (s) =>
          s.hardware.canvas
            ? `${s.hardware.canvas.hash} · ${s.hardware.canvas.stable ? "stable" : "unstable"}`
            : "—",
      },
      {
        id: "webglscene",
        label: { en: "WebGL scene", fr: "Scène WebGL" },
        reveals: {
          en: "A shader's pixels: the strings can be swapped, the output rarely.",
          fr: "Les pixels d'un shader : on change les chaînes, rarement le rendu.",
        },
        privacy: "high",
        value: (s) => s.hardware.webgl?.sceneHash ?? "—",
      },
      {
        id: "audio",
        label: { en: "Audio", fr: "Audio" },
        reveals: {
          en: "An oscillator through a compressor, rendered offline.",
          fr: "Un oscillateur passé dans un compresseur, rendu hors ligne.",
        },
        privacy: "high",
        value: (s) =>
          s.hardware.audio
            ? `${s.hardware.audio.hash} · Σ ${s.hardware.audio.sum.toFixed(4)}`
            : "—",
      },
      {
        id: "fonts",
        label: { en: "Fonts", fr: "Polices" },
        reveals: {
          en: "Installed fonts, found by measuring text.",
          fr: "Polices installées, trouvées en mesurant du texte.",
        },
        privacy: "high",
        value: (s) => `${s.hardware.fonts.length}: ${list(s.hardware.fonts)}`,
      },
      {
        id: "codecs",
        label: { en: "Codecs", fr: "Codecs" },
        reveals: {
          en: "Media formats the browser plays; builds differ.",
          fr: "Formats lisibles ; ils varient d'une version à l'autre.",
        },
        privacy: "low",
        value: (s) =>
          Object.entries(s.env.codecs)
            .filter(([, v]) => v !== "no")
            .map(([k]) => k)
            .join(", ") || "—",
      },
    ],
  },
  {
    id: "settings",
    title: { en: "How it is set up", fr: "Comment il est réglé" },
    intro: {
      en: "Preferences and permissions. Automation tools leave odd defaults here.",
      fr: "Préférences et permissions. Les outils d'automatisation y laissent des valeurs étranges.",
    },
    fields: [
      {
        id: "privacy",
        label: { en: "Privacy signals", fr: "Signaux vie privée" },
        reveals: {
          en: "Cookies, Do Not Track and Global Privacy Control.",
          fr: "Cookies, Do Not Track et Global Privacy Control.",
        },
        privacy: "low",
        value: (s) =>
          `cookies ${yes(s.env.cookieEnabled)} · DNT ${s.env.doNotTrack ?? "—"} · GPC ${yes(s.env.globalPrivacyControl)} · PDF ${yes(s.env.pdfViewerEnabled)}`,
      },
      {
        id: "permissions",
        rules: ["notification-permission-mismatch"],
        label: { en: "Permissions", fr: "Permissions" },
        reveals: {
          en: "What the site may ask for, and what it was told.",
          fr: "Ce que le site peut demander, et ce qu'on lui répond.",
        },
        privacy: "low",
        value: (s) =>
          Object.entries(s.env.permissions)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ") || "—",
      },
      {
        id: "devices",
        label: { en: "Media devices", fr: "Périphériques" },
        reveals: {
          en: "How many microphones, speakers and cameras, without names.",
          fr: "Combien de micros, haut-parleurs et caméras, sans leurs noms.",
        },
        privacy: "medium",
        value: (s) =>
          s.env.mediaDevices
            ? `mic ${s.env.mediaDevices.audioinput} · out ${s.env.mediaDevices.audiooutput} · cam ${s.env.mediaDevices.videoinput}`
            : "—",
      },
      {
        id: "prefs",
        label: { en: "Display preferences", fr: "Préférences d'affichage" },
        reveals: {
          en: "Dark mode, reduced motion, contrast, pointer type.",
          fr: "Mode sombre, animations réduites, contraste, type de pointeur.",
        },
        privacy: "low",
        value: (s) =>
          Object.entries(s.env.mediaQueries)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(", ") || "—",
      },
      {
        id: "network",
        label: { en: "Connection", fr: "Connexion" },
        reveals: {
          en: "A rough idea of the network, where the browser shares it.",
          fr: "Une idée du réseau, quand le navigateur la partage.",
        },
        privacy: "low",
        value: (s) =>
          s.env.connection
            ? `${s.env.connection.effectiveType ?? "—"} · rtt ${num(s.env.connection.rtt, " ms")} · ${num(s.env.connection.downlink, " Mb/s")}`
            : "—",
      },
    ],
  },
  {
    id: "tells",
    title: { en: "Automation tells", fr: "Indices d'automatisation" },
    intro: {
      en: "What Selenium, Playwright, Puppeteer and stealth plugins leave behind, or forget to hide.",
      fr: "Ce que Selenium, Playwright, Puppeteer et les plugins « stealth » laissent derrière eux, ou oublient de cacher.",
    },
    fields: [
      {
        id: "webdriver",
        rules: ["webdriver", "webdriver-own-property"],
        label: { en: "navigator.webdriver", fr: "navigator.webdriver" },
        reveals: {
          en: "True when the browser is driven by automation.",
          fr: "Vrai quand le navigateur est piloté par un automate.",
        },
        privacy: "low",
        value: (s) =>
          `${yes(s.automation.webdriver)}${s.automation.webdriverOwnProperty ? " · redefined on navigator" : ""}`,
      },
      {
        id: "headless",
        rules: ["headless-user-agent", "headless-brand"],
        label: { en: "Headless marks", fr: "Marques headless" },
        reveals: {
          en: "HeadlessChrome in the user agent or the brands.",
          fr: "HeadlessChrome dans le user agent ou les marques.",
        },
        privacy: "low",
        value: (s) =>
          `UA ${yes(s.automation.headlessUserAgent)} · brand ${yes(s.automation.headlessBrand)}`,
      },
      {
        id: "globals",
        rules: ["automation-globals"],
        label: { en: "Automation globals", fr: "Globales d'automates" },
        reveals: {
          en: "Variables and attributes injected by drivers.",
          fr: "Variables et attributs injectés par les pilotes.",
        },
        privacy: "low",
        value: (s) => list(s.automation.automationGlobals),
      },
      {
        id: "plugins",
        rules: ["plugins-not-genuine", "no-plugins"],
        label: { en: "Plugins", fr: "Plugins" },
        reveals: {
          en: "Count and whether they are the real objects.",
          fr: "Nombre, et s'il s'agit des vrais objets.",
        },
        privacy: "low",
        value: (s) =>
          `${s.automation.plugins} plugins · ${s.automation.mimeTypes} types · genuine ${yes(s.automation.pluginsGenuine)}`,
      },
      {
        id: "chrome",
        rules: ["chrome-object-missing"],
        label: { en: "window.chrome", fr: "window.chrome" },
        reveals: {
          en: "Present in every desktop Chrome.",
          fr: "Présent dans tout Chrome de bureau.",
        },
        privacy: "low",
        value: (s) => (s.automation.chromeObjectMissing ? "missing" : "present or not expected"),
      },
    ],
  },
  {
    id: "lies",
    title: { en: "Lies and second opinions", fr: "Mensonges et contre-expertises" },
    intro: {
      en: "A stealth layer rewrites what the page reads. Rewritten functions stop looking native, and a fresh iframe or a worker, which it forgot, tells the truth.",
      fr: "Une couche « stealth » réécrit ce que lit la page. Les fonctions réécrites ne paraissent plus natives, et une iframe neuve ou un worker, oubliés, disent la vérité.",
    },
    fields: [
      {
        id: "natives",
        rules: ["native-functions-replaced", "fingerprint-functions-replaced", "tostring-patched"],
        label: { en: "Native functions", fr: "Fonctions natives" },
        reveals: {
          en: "Getters and functions checked with a clean realm's toString.",
          fr: "Getters et fonctions vérifiés avec le toString d'un domaine propre.",
        },
        privacy: "low",
        value: (s) =>
          `${s.tampering.checked - s.tampering.lies.length}/${s.tampering.checked} native${s.tampering.toStringPatched ? " · toString patched" : ""}${s.tampering.lies.length ? ` · ${s.tampering.lies.join("; ")}` : ""}`,
      },
      {
        id: "iframe",
        rules: ["iframe-mismatch"],
        label: { en: "Fresh iframe", fr: "Iframe neuve" },
        reveals: {
          en: "Same questions in a new realm: any difference is a patch.",
          fr: "Les mêmes questions dans un domaine neuf : tout écart est un patch.",
        },
        privacy: "low",
        value: (s) =>
          s.iframe
            ? s.iframe.mismatches.length
              ? `differs: ${s.iframe.mismatches.join(", ")}`
              : "agrees"
            : "—",
      },
      {
        id: "worker",
        rules: ["worker-mismatch"],
        label: { en: "Web Worker", fr: "Web Worker" },
        reveals: {
          en: "Same questions from a worker thread.",
          fr: "Les mêmes questions depuis un worker.",
        },
        privacy: "low",
        value: (s) =>
          s.worker
            ? s.worker.mismatches.length
              ? `differs: ${s.worker.mismatches.join(", ")}`
              : "agrees"
            : "—",
      },
    ],
  },
];

/** French explanations of the rules (English ships with the package). */
export const RULES_FR: Record<string, string> = {
  webdriver: "navigator.webdriver vaut true : le navigateur se dit piloté par un automate.",
  "webdriver-own-property":
    "webdriver est défini sur navigator lui-même et non sur Navigator.prototype : une couche stealth l'a masqué.",
  "headless-user-agent": "Le user agent nomme un navigateur headless.",
  "headless-brand": "navigator.userAgentData liste une marque headless.",
  "automation-globals":
    "Des globales ou attributs laissés par Selenium, Playwright, Puppeteer, PhantomJS…",
  "native-functions-replaced":
    "Des getters de navigator ou des fonctions de base ne sont plus natifs : quelque chose réécrit ce que lit la page.",
  "fingerprint-functions-replaced":
    "Des fonctions canvas, WebGL ou audio ont été remplacées : souvent une extension vie privée, parfois un bot.",
  "tostring-patched":
    "Function.prototype.toString lui-même a été remplacé, pour faire passer des fonctions patchées pour natives.",
  "iframe-mismatch":
    "Une iframe neuve répond autrement que la page : la page a été patchée, pas le nouveau domaine.",
  "worker-mismatch": "Un Web Worker répond autrement que la page.",
  "engine-mismatch": "Le user agent annonce un moteur, le JavaScript en révèle un autre.",
  "os-mismatch":
    "Le user agent, navigator.platform, userAgentData et le GPU nomment des systèmes différents.",
  "timezone-mismatch":
    "Le nom du fuseau et le décalage de l'horloge ne concordent pas : l'un des deux a été forcé.",
  "mobile-without-touch": "Un user agent de téléphone sur un écran sans tactile.",
  "language-mismatch": "navigator.language n'est pas la première de navigator.languages.",
  "empty-languages": "navigator.languages est vide, comme dans certains navigateurs headless.",
  "outer-size-zero":
    "La fenêtre n'a pas de taille extérieure : il n'y a pas de vraie fenêtre autour de la page.",
  "chrome-object-missing": "Un Chrome de bureau sans l'objet window.chrome qu'il a toujours.",
  "plugins-not-genuine":
    "navigator.plugins ou mimeTypes ne sont pas de vrais PluginArray / MimeTypeArray.",
  "no-plugins": "Un Chromium de bureau sans plugin PDF, comme les anciens headless.",
  "notification-permission-mismatch":
    "Notification.permission dit denied, l'API Permissions dit prompt : une bizarrerie headless.",
  "software-renderer":
    "WebGL tourne sur un rendu logiciel (SwiftShader, llvmpipe) : serveurs et headless, parfois des VM.",
  "implausible-hardware": "Un nombre de cœurs ou une mémoire qu'aucun appareil réel ne déclare.",
  "canvas-noise": "Le même dessin canvas se relit différemment : du bruit a été injecté.",
  "untrusted-events":
    "Des évènements créés par un script (isTrusted = false) plutôt que par une personne.",
  "input-without-keys": "Des champs modifiés sans touche ni collage : un script les a remplis.",
  "robotic-pointer":
    "Le pointeur avance en lignes parfaitement droites, à pas égaux ou à vitesse constante : le trajet d'un script, quoi que fasse son horloge.",
  "no-coalesced-events":
    "Les évènements de pointeur ne portent aucun échantillon brut, comme souvent les synthétiques.",
  "pointer-no-slowdown":
    "Les gestes du pointeur arrivent à pleine vitesse sans jamais corriger leur direction : une main ralentit et ajuste en approchant de sa cible.",
  "robotic-typing":
    "Touches enfoncées et relâchées au métronome : un script qui tape avec un délai fixe. Le rythme d'une personne varie.",
  "robotic-scroll":
    "Défilement au métronome : le même écart à chaque fois, comme la boucle d'un script.",
  "honeypot-filled":
    "Un champ qu'aucune personne ne voit ni n'atteint a été rempli : ce que fait un script qui remplit tout. Certains outils de saisie automatique aussi.",
};
