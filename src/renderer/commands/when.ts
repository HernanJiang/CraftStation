export type CommandWhenContext = Record<string, boolean | string | number | null | undefined>;

type Token =
  | { type: "identifier"; value: string }
  | { type: "string"; value: string }
  | { type: "operator"; value: "!" | "&&" | "||" | "==" | "!=" }
  | { type: "paren"; value: "(" | ")" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (two === "&&" || two === "||" || two === "==" || two === "!=") {
      tokens.push({ type: "operator", value: two });
      i += 2;
      continue;
    }
    if (ch === "!") {
      tokens.push({ type: "operator", value: "!" });
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: "paren", value: ch });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = "";
      i += 1;
      while (i < input.length && input[i] !== quote) {
        value += input[i]!;
        i += 1;
      }
      i += input[i] === quote ? 1 : 0;
      tokens.push({ type: "string", value });
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(input.slice(i));
    if (!match) {
      throw new Error(`Invalid when clause near "${input.slice(i)}"`);
    }
    tokens.push({ type: "identifier", value: match[0] });
    i += match[0].length;
  }
  return tokens;
}

export function evaluateWhenClause(
  clause: string | undefined,
  context: CommandWhenContext,
): boolean {
  if (!clause?.trim()) return true;
  const parser = new WhenParser(tokenize(clause), context);
  return parser.parse();
}

class WhenParser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly context: CommandWhenContext,
  ) {}

  parse(): boolean {
    const value = this.parseOr();
    if (this.peek()) return false;
    return value;
  }

  private parseOr(): boolean {
    let value = this.parseAnd();
    while (this.consumeOperator("||")) {
      value = this.parseAnd() || value;
    }
    return value;
  }

  private parseAnd(): boolean {
    let value = this.parseNot();
    while (this.consumeOperator("&&")) {
      value = this.parseNot() && value;
    }
    return value;
  }

  private parseNot(): boolean {
    if (this.consumeOperator("!")) return !this.parseNot();
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parseValue();
    if (this.consumeOperator("==")) {
      return String(left) === String(this.parseValue());
    }
    if (this.consumeOperator("!=")) {
      return String(left) !== String(this.parseValue());
    }
    return Boolean(left);
  }

  private parseValue(): boolean | string | number | null | undefined {
    const token = this.next();
    if (!token) return false;
    if (token.type === "string") return token.value;
    if (token.type === "identifier") return this.context[token.value] ?? false;
    if (token.type === "paren" && token.value === "(") {
      const value = this.parseOr();
      if (!this.consumeParen(")")) return false;
      return value;
    }
    return false;
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    return this.tokens[this.index++];
  }

  private consumeOperator(value: "!" | "&&" | "||" | "==" | "!="): boolean {
    const token = this.peek();
    if (token?.type !== "operator" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private consumeParen(value: "(" | ")"): boolean {
    const token = this.peek();
    if (token?.type !== "paren" || token.value !== value) return false;
    this.index += 1;
    return true;
  }
}
