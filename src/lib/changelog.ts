import changelog from "../../CHANGELOG.md?raw";
import { version } from "../../package.json";

export const APP_VERSION = version;

export interface ReleaseNote {
  version: string;
  date: string | null;
  summary: string;
  items: string[];
}

function plain(text: string): string {
  return text.replace(/`([^`]+)`/g, "$1").trim();
}

export function parseChangelog(markdown: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  for (const chunk of markdown.split(/\n(?=## v)/)) {
    const match = chunk.match(
      /^## (v\d+\.\d+\.\d+)(?:\s+·\s+(\d{4}-\d{2}-\d{2}))?\s*\n+([\s\S]*)$/,
    );
    if (!match) continue;
    const summary: string[] = [];
    const items: string[] = [];
    for (const line of match[3].split("\n")) {
      const bullet = line.match(/^- (.+)$/);
      if (bullet) {
        items.push(plain(bullet[1]));
        continue;
      }
      if (line.trim() && items.length === 0) summary.push(plain(line));
    }
    notes.push({
      version: match[1],
      date: match[2] ?? null,
      summary: summary.join(" "),
      items,
    });
  }
  return notes;
}

export const RELEASE_NOTES = parseChangelog(changelog);
