// Shadow DOM styles of <notabot-check>. Hosts restyle it with the --notabot-* variables.
export const STYLES = `
:host {
  display: inline-block;
  width: min(100%, 340px);
  font: 15px/1.4 var(--notabot-font, ui-sans-serif, system-ui, sans-serif);
  color-scheme: light dark;
}
.box {
  --bg: var(--notabot-bg, #fbfaf7);
  --fg: var(--notabot-fg, #1b1d1a);
  --muted: var(--notabot-muted, #5d635b);
  --line: var(--notabot-border, #cfd2c8);
  --accent: var(--notabot-accent, #1f6f4a);
  --warn: var(--notabot-warn, #a8650a);
  --bad: var(--notabot-bad, #b3261e);
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: var(--notabot-radius, 10px);
  padding: 12px 14px 8px;
  display: grid;
  gap: 10px;
}
@media (prefers-color-scheme: dark) {
  .box[data-theme="auto"] {
    --bg: var(--notabot-bg, #171a17);
    --fg: var(--notabot-fg, #e9ece4);
    --muted: var(--notabot-muted, #a3aa9f);
    --line: var(--notabot-border, #3a4038);
    --accent: var(--notabot-accent, #5cc28e);
    --warn: var(--notabot-warn, #e3a24a);
    --bad: var(--notabot-bad, #f08a80);
  }
}
.box[data-theme="dark"] {
  --bg: var(--notabot-bg, #171a17);
  --fg: var(--notabot-fg, #e9ece4);
  --muted: var(--notabot-muted, #a3aa9f);
  --line: var(--notabot-border, #3a4038);
  --accent: var(--notabot-accent, #5cc28e);
  --warn: var(--notabot-warn, #e3a24a);
  --bad: var(--notabot-bad, #f08a80);
}
.row { display: flex; align-items: center; gap: 12px; }
.seal {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 7px;
  border: 2px solid var(--muted);
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  transition: border-color .2s, background-color .2s;
}
.seal:focus-visible, .handle:focus-visible, .retry:focus-visible, .by:focus-visible, summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.seal:disabled { cursor: default; }
.mark { width: 14px; height: 14px; display: block; }
[data-state="checking"] .seal { border-color: var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
[data-state="human"] .seal { border-color: var(--accent); background: var(--accent); }
[data-state="human"] .mark {
  width: 8px; height: 14px; border: solid var(--bg); border-width: 0 3px 3px 0;
  transform: translateY(-2px) rotate(45deg);
}
[data-state="bot"] .seal, [data-state="error"] .seal { border-color: var(--bad); }
[data-state="bot"] .mark, [data-state="error"] .mark {
  background: linear-gradient(45deg, transparent 43%, var(--bad) 43% 57%, transparent 57%),
              linear-gradient(-45deg, transparent 43%, var(--bad) 43% 57%, transparent 57%);
}
[data-state="challenge"] .seal { border-color: var(--warn); }
.text { display: grid; min-width: 0; flex: 1; }
.label { font-weight: 600; }
.status { color: var(--muted); font-size: 13px; min-height: 1.4em; }
[data-state="human"] .status { color: var(--accent); }
[data-state="bot"] .status, [data-state="error"] .status { color: var(--bad); }
[data-state="challenge"] .status { color: var(--warn); }
.retry {
  font: inherit; font-size: 13px; color: var(--fg); background: transparent;
  border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer;
}
.slide { display: grid; gap: 8px; }
.hint { margin: 0; font-size: 13px; color: var(--muted); }
.track {
  position: relative; height: 34px; border-radius: 8px;
  background: color-mix(in srgb, var(--line) 45%, transparent);
  touch-action: none;
}
.zone {
  position: absolute; top: 3px; bottom: 3px; border-radius: 6px;
  border: 2px dashed var(--warn);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
}
.handle {
  position: absolute; top: 2px; left: 0; width: 30px; height: 30px; margin-left: -2px;
  border-radius: 7px; background: var(--fg); cursor: grab; touch-action: none;
  box-shadow: 0 1px 3px rgb(0 0 0 / .25);
}
.handle:active { cursor: grabbing; }
.details { font-size: 13px; color: var(--muted); }
.details summary { cursor: pointer; width: max-content; list-style: none; display: inline-flex; align-items: center; gap: 6px; }
.details summary::-webkit-details-marker { display: none; }
.details summary::before {
  content: ""; width: 6px; height: 6px; border: solid currentColor; border-width: 0 1.5px 1.5px 0;
  transform: rotate(-45deg); transition: transform .2s;
}
.details[open] summary::before { transform: rotate(45deg); }
.details dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 6px 0 0; }
.details dt { color: var(--muted); }
.details dd { margin: 0; color: var(--fg); overflow-wrap: anywhere; }
.note { margin: 6px 0 0; font-size: 12px; }
.by { justify-self: end; font-size: 11px; color: var(--muted); text-decoration: none; }
.by:hover { text-decoration: underline; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  [data-state="checking"] .seal { animation-duration: 2.4s; }
  .seal { transition: none; }
}
`;
