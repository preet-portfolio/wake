// Copy check: compile wake's TypeScript to plain, unminified JS so it can be
// compared token by token with uji/script.js, then run jscpd over both.
// Writes reports/jscpd/ (json + html) and prints a one-line verdict.
// jscpd skips files over 1000 lines by default, and uji/script.js has 1393,
// so the limits are raised; a positive control showed the default passes silently.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const tmp = "reports/jscpd/compiled";
fs.rmSync("reports/jscpd", { recursive: true, force: true });
fs.mkdirSync(`${tmp}/wake`, { recursive: true });
fs.mkdirSync(`${tmp}/uji`, { recursive: true });
execFileSync("npx", ["tsc", "-p", ".", "--noEmit", "false", "--outDir", `${tmp}/wake`, "--declaration", "false", "--removeComments"], { stdio: "inherit" });
// compare against Noah Doersing's original file, not our fork (which has our own additions)
fs.writeFileSync(`${tmp}/uji/script.js`, execFileSync("git", ["-C", "../uji", "show", "HEAD:script.js"]));

execFileSync("npx", ["jscpd", tmp, "--min-tokens", "30", "--max-lines", "100000", "--max-size", "10mb", "--reporters", "json,html,console", "--output", "reports/jscpd", "--format", "javascript", "--silent"], { stdio: "inherit" });

const report = JSON.parse(fs.readFileSync("reports/jscpd/jscpd-report.json", "utf8"));
const cross = report.duplicates.filter(d => (d.firstFile.name.includes("/uji/")) !== (d.secondFile.name.includes("/uji/")));
// guard against a silent pass: both sides must actually have been scanned
const sources = report.statistics.total.sources;
const ujiLines = fs.readFileSync(`${tmp}/uji/script.js`, "utf8").split("\n").length;
if (sources < 2 || report.statistics.total.lines < ujiLines) {
    console.error(`jscpd scanned too little (${sources} files, ${report.statistics.total.lines} lines); uji alone has ${ujiLines}`);
    process.exit(2);
}
const result = { minTokens: 30, scanned: report.statistics.total, totalClones: report.duplicates.length, clonesBetweenWakeAndUji: cross.length, cross };
fs.writeFileSync("reports/jscpd/verdict.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify({ filesScanned: sources, linesScanned: report.statistics.total.lines, totalClones: result.totalClones, clonesBetweenWakeAndUji: result.clonesBetweenWakeAndUji }));
process.exit(cross.length ? 1 : 0);
