/** The headers a desktop Chrome on macOS sends with a same-origin fetch(). */
export function chromeHeaders(
  ua: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "user-agent": ua,
    accept: "*/*",
    "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
    "accept-encoding": "gzip, deflate, br, zstd",
    "sec-ch-ua": '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    origin: "https://site.dev",
    ...extra,
  };
}
