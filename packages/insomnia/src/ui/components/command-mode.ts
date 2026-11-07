import { searchSettings,SETTINGS_INDEX, type SettingsIndexEntry } from './settings/settings-index';

// Command mode of the command palette (Ctrl+Shift+P, or typing > in the palette): actions and settings, as opposed
// to the requests and collections that plain search finds.
export interface PaletteCommand {
  id: string;
  title: string;
  // Other words someone might type
  keywords?: string[];
  run: () => void;
}

export const COMMAND_PREFIX = '>';

export const isCommandInput = (input: string) => input.trimStart().startsWith(COMMAND_PREFIX);

// What was typed after the >
export const commandQuery = (input: string) => input.trimStart().slice(COMMAND_PREFIX.length).trim();

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// Every typed word has to start a word in the title, or appear in the keywords. Earlier matches rank first.
export const searchCommands = (query: string, commands: PaletteCommand[]): PaletteCommand[] => {
  const typed = words(query);
  if (!typed.length) {
    return commands;
  }
  const scored = commands.flatMap(command => {
    const titleWords = words(command.title);
    const keywordWords = words((command.keywords ?? []).join(' '));
    let score = 0;
    for (const word of typed) {
      const inTitle = titleWords.findIndex(titleWord => titleWord.startsWith(word));
      if (inTitle !== -1) {
        score += 10 - Math.min(inTitle, 9);
      } else if (keywordWords.some(keyword => keyword.startsWith(word))) {
        score += 1;
      } else {
        return [];
      }
    }
    return [{ command, score }];
  });
  return scored.sort((a, b) => b.score - a.score).map(item => item.command);
};

// The settings a command-mode search shows. Nothing until something is typed, so the list opens on commands.
export const settingsForQuery = (query: string): SettingsIndexEntry[] =>
  query.trim() ? searchSettings(query, SETTINGS_INDEX).slice(0, 8) : [];
