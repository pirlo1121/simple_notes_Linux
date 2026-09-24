// Paleta de comandos: "/nombre argumentos".

export interface CommandContext {
  newNote(title?: string): void;
  focusSearch(query?: string): void;
  togglePin(): void;
  deleteCurrent(): void;
  openToday(): void;
  showRecent(): void;
  showHistory(): void;
  showTags(): void;
  openFolder(): void;
  toggleAutostart(): void;
  toggleSidebar(): void;
  dockWindow(): void;
  showHelp(): void;
  hide(): void;
  quit(): void;
}

export interface Command {
  name: string;
  aliases?: string[];
  title: string;
  /** Texto de ayuda para el argumento, p. ej. "[título]". */
  args?: string;
  shortcut?: string;
  run(ctx: CommandContext, args: string): void;
}

export interface CommandMatch {
  command: Command;
  args: string;
}

/** "/new Idea genial" -> { name: "new", args: "Idea genial" } */
export function parseCommandInput(input: string): { name: string; args: string } {
  const body = input.replace(/^\//, '');
  const space = body.search(/\s/);
  return space < 0
    ? { name: body.toLowerCase(), args: '' }
    : { name: body.slice(0, space).toLowerCase(), args: body.slice(space + 1).trim() };
}

export class CommandRegistry {
  private commands: Command[] = [];

  register(...commands: Command[]): this {
    this.commands.push(...commands);
    return this;
  }

  all(): readonly Command[] {
    return this.commands;
  }

  /** Comandos que encajan con lo escrito, del más al menos probable. */
  match(input: string): CommandMatch[] {
    const { name, args } = parseCommandInput(input);
    if (!name) return this.commands.map((command) => ({ command, args }));
    const scored: { command: Command; score: number }[] = [];
    for (const command of this.commands) {
      const names = [command.name, ...(command.aliases ?? [])];
      let score = 0;
      if (names.includes(name)) score = 4;
      else if (command.name.startsWith(name)) score = 3;
      else if (names.some((n) => n.startsWith(name))) score = 2;
      else if (isSubsequence(command.name, name) || command.title.toLowerCase().includes(name)) score = 1;
      if (score) scored.push({ command, score });
    }
    return scored.sort((a, b) => b.score - a.score).map(({ command }) => ({ command, args }));
  }
}

function isSubsequence(hay: string, needle: string): boolean {
  let i = 0;
  for (const c of hay) if (c === needle[i]) i++;
  return i === needle.length;
}
