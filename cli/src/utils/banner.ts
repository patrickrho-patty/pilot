import pc from "picocolors";

const PILOT_ART = [
  "██████╗  █████╗ ██████╗ ███████╗██████╗  ██████╗██╗     ██╗██████╗ ",
  "██╔══██╗██╔══██╗██╔══██╗██╔════╝██╔══██╗██╔════╝██║     ██║██╔══██╗",
  "██████╔╝███████║██████╔╝█████╗  ██████╔╝██║     ██║     ██║██████╔╝",
  "██╔═══╝ ██╔══██║██╔═══╝ ██╔══╝  ██╔══██╗██║     ██║     ██║██╔═══╝ ",
  "██║     ██║  ██║██║     ███████╗██║  ██║╚██████╗███████╗██║██║     ",
  "╚═╝     ╚═╝  ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝╚═╝     ",
] as const;

const TAGLINE = "The app people use to manage AI agents for work";

export function printPilotCliBanner(): void {
  const lines = [
    "",
    ...PILOT_ART.map((line) => pc.cyan(line)),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
