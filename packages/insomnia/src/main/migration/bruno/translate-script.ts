import { convertTemplate, type TemplateIssue } from './template';

/**
 * Translates Bruno scripts (`bru`, `req`, `res`, `test`, `expect`) to the restless scripting API.
 * Every target below exists in packages/insomnia-scripting-environment.
 *
 * !Please keep the order: longer names must come before the shorter names they start with.
 * !Anything these rules do not know stays as it was, and the leftover scan below reports it.
 */

export interface TextRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

// Rules that need the arguments of a call, for example to wrap them in an object
export interface CallRule {
  name: string;
  // Matches up to and including the opening parenthesis
  callee: RegExp;
  transform: (args: string[]) => string;
}

export type ScriptRule = TextRule | CallRule;

export interface ScriptTranslation {
  code: string;
  partial: boolean;
  // Bruno APIs that are still in `code`, for the report
  leftovers: string[];
}

// Not preceded by an identifier character, a dot, a dash or a quote, so `my.req.url` and "res.status" are left alone
const START = String.raw`(?<![\w$.\-"'\x60])`;
// Not an assignment, which a read translation would turn into invalid code
const NOT_ASSIGNED = String.raw`(?!\s*=(?!=))`;

const text = (name: string, source: string, replacement: string): TextRule => ({
  name,
  pattern: new RegExp(START + source, 'g'),
  replacement,
});

const call = (name: string, source: string, transform: (args: string[]) => string): CallRule => ({
  name,
  callee: new RegExp(START + source + String.raw`\(`, 'g'),
  transform,
});

// Bruno lowercases response header names, the restless response keeps what the server sent
const LOWERCASED_RESPONSE_HEADERS =
  'Object.fromEntries(insomnia.response.headers.map(__h => [__h.key.toLowerCase(), __h.value], {}))';

export const BRUNO_SCRIPT_RULES: ScriptRule[] = [
  // --- environment variables ---
  text('bru.getAllEnvVars', String.raw`bru\.getAllEnvVars\(`, 'insomnia.environment.toObject('),
  text('bru.deleteAllEnvVars', String.raw`bru\.deleteAllEnvVars\(`, 'insomnia.environment.clear('),
  text('bru.getEnvName', String.raw`bru\.getEnvName\(\s*\)`, 'insomnia.environment.name'),
  text('bru.getEnvVar', String.raw`bru\.getEnvVar\(`, 'insomnia.environment.get('),
  text('bru.setEnvVar', String.raw`bru\.setEnvVar\(`, 'insomnia.environment.set('),
  text('bru.hasEnvVar', String.raw`bru\.hasEnvVar\(`, 'insomnia.environment.has('),
  text('bru.deleteEnvVar', String.raw`bru\.deleteEnvVar\(`, 'insomnia.environment.unset('),

  // --- runtime variables ---
  // Bruno keeps runtime variables for the whole session. insomnia.variables only lives for one send, so a value
  // set here (a login token, say) would be gone for the next request. The environment keeps it.
  text('bru.getAllVars', String.raw`bru\.getAllVars\(`, 'insomnia.variables.toObject('),
  text('bru.getVar', String.raw`bru\.getVar\(`, 'insomnia.variables.get('),
  text('bru.hasVar', String.raw`bru\.hasVar\(`, 'insomnia.variables.has('),
  text('bru.setVar', String.raw`bru\.setVar\(`, 'insomnia.environment.set('),
  text('bru.deleteVar', String.raw`bru\.deleteVar\(`, 'insomnia.environment.unset('),

  // --- collection variables, which restless keeps in the base environment ---
  text('bru.getAllCollectionVars', String.raw`bru\.getAllCollectionVars\(`, 'insomnia.collectionVariables.toObject('),
  text('bru.deleteAllCollectionVars', String.raw`bru\.deleteAllCollectionVars\(`, 'insomnia.collectionVariables.clear('),
  text('bru.getCollectionVar', String.raw`bru\.getCollectionVar\(`, 'insomnia.collectionVariables.get('),
  text('bru.setCollectionVar', String.raw`bru\.setCollectionVar\(`, 'insomnia.collectionVariables.set('),
  text('bru.hasCollectionVar', String.raw`bru\.hasCollectionVar\(`, 'insomnia.collectionVariables.has('),
  text('bru.deleteCollectionVar', String.raw`bru\.deleteCollectionVar\(`, 'insomnia.collectionVariables.unset('),

  // --- global environment variables ---
  text('bru.getAllGlobalEnvVars', String.raw`bru\.getAllGlobalEnvVars\(`, 'insomnia.globals.toObject('),
  text('bru.deleteAllGlobalEnvVars', String.raw`bru\.deleteAllGlobalEnvVars\(`, 'insomnia.globals.clear('),
  text('bru.getGlobalEnvVar', String.raw`bru\.getGlobalEnvVar\(`, 'insomnia.globals.get('),
  text('bru.setGlobalEnvVar', String.raw`bru\.setGlobalEnvVar\(`, 'insomnia.globals.set('),
  text('bru.hasGlobalEnvVar', String.raw`bru\.hasGlobalEnvVar\(`, 'insomnia.globals.has('),
  text('bru.deleteGlobalEnvVar', String.raw`bru\.deleteGlobalEnvVar\(`, 'insomnia.globals.unset('),

  // --- folder and request variables are local variables here ---
  text('bru.getFolderVar', String.raw`bru\.getFolderVar\(`, 'insomnia.variables.get('),
  text('bru.getRequestVar', String.raw`bru\.getRequestVar\(`, 'insomnia.variables.get('),

  // --- interpolation and runner control ---
  text('bru.interpolate', String.raw`bru\.interpolate\(`, 'insomnia.variables.replaceIn('),
  text('bru.setNextRequest', String.raw`bru\.(?:runner\.)?setNextRequest\(`, 'insomnia.execution.setNextRequest('),
  text('bru.runner.skipRequest', String.raw`bru\.runner\.skipRequest\(`, 'insomnia.execution.skipRequest('),

  // --- request ---
  text('req.getUrl', String.raw`req\.getUrl\(\s*\)`, 'insomnia.request.url.toString()'),
  text('req.setUrl', String.raw`req\.setUrl\(`, 'insomnia.request.url.update('),
  text('req.getMethod', String.raw`req\.getMethod\(\s*\)`, 'insomnia.request.method'),
  call('req.setMethod', String.raw`req\.setMethod`, args =>
    args.length === 1 ? `(insomnia.request.method = ${args[0]})` : `req.setMethod(${args.join(', ')})`,
  ),
  text('req.getHeaders', String.raw`req\.getHeaders\(\s*\)`, 'insomnia.request.headers.toObject()'),
  text('req.getHeader', String.raw`req\.getHeader\(`, 'insomnia.request.headers.get('),
  call('req.setHeader', String.raw`req\.setHeader`, args =>
    args.length === 2
      ? `insomnia.request.upsertHeader({ key: ${args[0]}, value: ${args[1]} })`
      : `req.setHeader(${args.join(', ')})`,
  ),
  call('req.deleteHeader', String.raw`req\.deleteHeader`, args =>
    args.length === 1
      ? `insomnia.request.removeHeader(${args[0]}, { ignoreCase: true })`
      : `req.deleteHeader(${args.join(', ')})`,
  ),
  text('req.getName', String.raw`req\.getName\(\s*\)`, 'insomnia.info.requestName'),
  text('req.url', String.raw`req\.url\b` + NOT_ASSIGNED, 'insomnia.request.url.toString()'),
  text('req.method', String.raw`req\.method\b` + NOT_ASSIGNED, 'insomnia.request.method'),
  text('req.headers', String.raw`req\.headers\b` + NOT_ASSIGNED, 'insomnia.request.headers.toObject()'),

  // --- response ---
  text('res.getStatusText', String.raw`res\.getStatusText\(\s*\)`, 'insomnia.response.status'),
  text('res.getStatus', String.raw`res\.getStatus\(\s*\)`, 'insomnia.response.code'),
  text('res.getResponseTime', String.raw`res\.getResponseTime\(\s*\)`, 'insomnia.response.responseTime'),
  text('res.getBody', String.raw`res\.getBody\(\s*\)`, 'insomnia.response.json()'),
  call('res.getHeader', String.raw`res\.getHeader`, args =>
    args.length === 1
      ? `insomnia.response.headers.find(__h => __h.key.toLowerCase() === String(${args[0]}).toLowerCase())?.value`
      : `res.getHeader(${args.join(', ')})`,
  ),
  text('res.getHeaders', String.raw`res\.getHeaders\(\s*\)`, LOWERCASED_RESPONSE_HEADERS),
  text('res.statusText', String.raw`res\.statusText\b` + NOT_ASSIGNED, 'insomnia.response.status'),
  text('res.status', String.raw`res\.status\b` + NOT_ASSIGNED, 'insomnia.response.code'),
  text('res.responseTime', String.raw`res\.responseTime\b` + NOT_ASSIGNED, 'insomnia.response.responseTime'),
  text('res.body', String.raw`res\.body\b` + NOT_ASSIGNED, 'insomnia.response.json()'),
  text('res.headers', String.raw`res\.headers\b` + NOT_ASSIGNED, LOWERCASED_RESPONSE_HEADERS),

  // --- tests ---
  text('test.skip', String.raw`test\.skip\(`, 'insomnia.test.skip('),
  text('test', String.raw`test\(`, 'insomnia.test('),
  text('expect', String.raw`expect\(`, 'insomnia.expect('),
];

// What is still Bruno-only after the rules ran
const LEFTOVER_PATTERNS: { pattern: RegExp; label?: string }[] = [
  { pattern: new RegExp(START + String.raw`(?:bru|req|res)(?:\.[A-Za-z_$][\w$]*)+`, 'g') },
  { pattern: new RegExp(START + String.raw`res\s*\(`, 'g'), label: 'res()' },
  { pattern: new RegExp(START + String.raw`require\s*\(`, 'g'), label: 'require()' },
  { pattern: new RegExp(START + String.raw`expect\.[A-Za-z_$][\w$]*`, 'g') },
];

/**
 * Blanks out string and comment contents, keeping every position. What a script says about `bru.` in a log
 * message or a comment is not a call. Code inside `${ }` of a template literal is code, and is kept.
 */
export function maskNonCode(code: string): string {
  const out = [...code];
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (out[i] !== '\n') {
        out[i] = ' ';
      }
    }
  };
  // `{` depth at which each open `${` was entered, so the matching `}` returns to the template
  const templates: number[] = [];
  let braces = 0;
  let i = 0;
  // Reads template text from `i` until its closing backtick or the next `${`
  const readTemplate = () => {
    const start = i;
    while (i < code.length && code[i] !== '`' && !(code[i] === '$' && code[i + 1] === '{')) {
      i += code[i] === '\\' ? 2 : 1;
    }
    blank(start, Math.min(i, code.length));
    if (code[i] === '$') {
      templates.push(braces++);
      i += 2;
    } else {
      i++;
    }
  };

  while (i < code.length) {
    const char = code[i];
    if (char === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      blank(i, stop);
      i = stop;
    } else if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? code.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (char === '"' || char === "'") {
      // These cannot span lines, so a quote that never closes only hides the rest of its own line
      let end = i + 1;
      while (end < code.length && code[end] !== char && code[end] !== '\n') {
        end += code[end] === '\\' ? 2 : 1;
      }
      blank(i + 1, Math.min(end, code.length));
      i = code[end] === char ? end + 1 : end;
    } else if (char === '`') {
      i++;
      readTemplate();
    } else if (char === '{') {
      braces++;
      i++;
    } else if (char === '}') {
      braces--;
      i++;
      if (templates.length > 0 && templates.at(-1) === braces) {
        templates.pop();
        readTemplate();
      }
    } else {
      i++;
    }
  }
  return out.join('');
}

export function findLeftovers(code: string): string[] {
  const found = new Set<string>();
  const masked = maskNonCode(code);
  for (const { pattern, label } of LEFTOVER_PATTERNS) {
    for (const match of masked.matchAll(pattern)) {
      found.add(label ?? match[0]);
    }
  }
  return [...found];
}

// Index of the parenthesis that closes the one opened just before `start`, or -1
function findClosingParen(code: string, start: number): number {
  let depth = 1;
  for (let i = start; i < code.length; i++) {
    const char = code[i];
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i);
      if (i === -1) {
        return -1;
      }
    } else if (char === '/' && code[i + 1] === '/') {
      const end = code.indexOf('\n', i);
      if (end === -1) {
        return -1;
      }
      i = end;
    } else if (char === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) {
        return -1;
      }
      i = end + 1;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return i;
    }
  }
  return -1;
}

// Index of the quote that closes the string opened at `start`, or -1
function skipString(code: string, start: number): number {
  const quote = code[start];
  for (let i = start + 1; i < code.length; i++) {
    if (code[i] === '\\') {
      i++;
    } else if (code[i] === quote) {
      return i;
    }
  }
  return -1;
}

function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < args.length; i++) {
    const char = args[i];
    if (char === '"' || char === "'" || char === '`') {
      const end = skipString(args, i);
      const stop = end === -1 ? args.length - 1 : end;
      current += args.slice(i, stop + 1);
      i = stop;
    } else if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      if ('([{'.includes(char)) {
        depth++;
      } else if (')]}'.includes(char)) {
        depth--;
      }
      current += char;
    }
  }
  if (current.trim() || parts.length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function applyCallRule(code: string, rule: CallRule): string {
  const pattern = new RegExp(rule.callee.source, 'g');
  let result = '';
  let cursor = 0;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const argsStart = match.index + match[0].length;
    const close = findClosingParen(code, argsStart);
    if (close === -1) {
      continue;
    }
    result += code.slice(cursor, match.index) + rule.transform(splitArguments(code.slice(argsStart, close)));
    cursor = close + 1;
    pattern.lastIndex = cursor;
  }
  return result + code.slice(cursor);
}

function applyRules(script: string): string {
  let translated = script;
  for (const rule of BRUNO_SCRIPT_RULES) {
    if ('callee' in rule) {
      // Nested calls of the same function need a second pass
      for (let pass = 0; pass < 3; pass++) {
        const next = applyCallRule(translated, rule);
        if (next === translated) {
          break;
        }
        translated = next;
      }
    } else {
      translated = translated.replaceAll(rule.pattern, rule.replacement);
    }
  }
  return translated;
}

const commentOut = (script: string) =>
  script
    .split(/\r?\n/)
    .map(line => `// ${line}`.trimEnd())
    .join('\n');

export function translateBrunoScript(script: string): ScriptTranslation {
  const code = applyRules(script);
  const leftovers = findLeftovers(code);
  if (leftovers.length === 0) {
    return { code, partial: false, leftovers };
  }
  const header = [
    '// restless: this Bruno script was only partly translated.',
    `// Still to port by hand: ${leftovers.join(', ')}`,
    '// The original script, commented out:',
    commentOut(script),
    '// End of the original script.',
  ].join('\n');
  return { code: `${header}\n\n${code}`, partial: true, leftovers };
}

// For one-line expressions (assertions, post-response variables) where a header comment makes no sense
export function translateBrunoExpression(expression: string): { code: string; leftovers: string[] } {
  const code = applyRules(expression);
  return { code, leftovers: findLeftovers(code) };
}

// --- generated code: variables and assertions ---

export interface BrunoVariableInput {
  name: string;
  value: unknown;
  enabled: boolean;
  local?: boolean;
}

export interface BrunoAssertionInput {
  expression: string;
  operator: string;
  value: string;
  enabled: boolean;
}

export interface UnsupportedItem {
  name: string;
  reason: string;
}

export interface GeneratedScript {
  code: string;
  unsupported: UnsupportedItem[];
}

const toJs = (value: unknown): string => (value === undefined ? 'null' : JSON.stringify(value));

/** Pre-request variables become `insomnia.variables.set` lines, for the top of a pre-request script */
export function buildPreRequestVariables(
  variables: BrunoVariableInput[],
  onIssue?: (issue: TemplateIssue) => void,
): string {
  return variables
    .filter(variable => variable.name)
    .map(variable => {
      if (!variable.enabled) {
        return `// disabled: ${variable.name}`;
      }
      const value = typeof variable.value === 'string' ? convertTemplate(variable.value, onIssue) : variable.value;
      return `insomnia.variables.set(${toJs(variable.name)}, ${toJs(value)});`;
    })
    .join('\n');
}

/** Post-response variables hold an expression on the response, for example `res.body.token` */
export function buildPostResponseVariables(variables: BrunoVariableInput[]): GeneratedScript {
  const unsupported: UnsupportedItem[] = [];
  const lines: string[] = [];
  for (const variable of variables) {
    if (!variable.name) {
      continue;
    }
    if (!variable.enabled) {
      lines.push(`// disabled: ${variable.name}`);
      continue;
    }
    const { code, leftovers } = translateBrunoExpression(String(variable.value ?? ''));
    if (leftovers.length > 0) {
      unsupported.push({ name: variable.name, reason: `uses ${leftovers.join(', ')}` });
      continue;
    }
    // Bruno keeps these as runtime variables, an @ prefix makes them local to the request
    const target = variable.local ? 'insomnia.variables' : 'insomnia.environment';
    lines.push(`${target}.set(${toJs(variable.name)}, ${code});`);
  }
  return { code: lines.join('\n'), unsupported };
}

const UNARY_OPERATORS = new Set([
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isUndefined',
  'isDefined',
  'isTruthy',
  'isFalsy',
  'isJson',
  'isNumber',
  'isString',
  'isBoolean',
  'isArray',
]);

// operator -> the chai call that follows `insomnia.expect(value)`. `$` is the operand.
const ASSERTION_CHAINS: Record<string, string> = {
  eq: '.to.equal($)',
  neq: '.to.not.equal($)',
  gt: '.to.be.above($)',
  gte: '.to.be.at.least($)',
  lt: '.to.be.below($)',
  lte: '.to.be.at.most($)',
  in: '.to.be.oneOf($)',
  notIn: '.to.not.be.oneOf($)',
  contains: '.to.include($)',
  notContains: '.to.not.include($)',
  length: '.to.have.lengthOf($)',
  matches: '.to.match($)',
  notMatches: '.to.not.match($)',
  startsWith: '.to.satisfy(__v => typeof __v === "string" && __v.startsWith($))',
  endsWith: '.to.satisfy(__v => typeof __v === "string" && __v.endsWith($))',
  between: '.to.be.within($)',
  isEmpty: '.to.be.empty',
  isNotEmpty: '.to.not.be.empty',
  isNull: '.to.be.null',
  isUndefined: '.to.be.undefined',
  isDefined: '.to.not.be.undefined',
  isTruthy: '.to.be.true',
  isFalsy: '.to.be.false',
  isJson: '.to.satisfy(__v => typeof __v === "object" && __v !== null)',
  isNumber: '.to.be.a("number")',
  isString: '.to.be.a("string")',
  isBoolean: '.to.be.a("boolean")',
  isArray: '.to.be.a("array")',
};

export const BRUNO_ASSERTION_OPERATORS = Object.keys(ASSERTION_CHAINS);

// A bare `res.body` is the parsed JSON, or the raw text when the response is not JSON
const BODY_HELPER =
  'const __bruBody = () => { try { return insomnia.response.json(); } catch (e) { return insomnia.response.text(); } };';

// One operand the way Bruno reads it: literals stay literals, everything else is a string
function operandToJs(operand: string): string {
  const value = operand.trim();
  if (['true', 'false', 'null', 'undefined'].includes(value)) {
    return value;
  }
  const quoted = /^"(.*)"$|^'(.*)'$/s.exec(value);
  if (quoted) {
    return JSON.stringify(quoted[1] ?? quoted[2]);
  }
  const number = Number(value);
  if (value !== '' && !Number.isNaN(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER) {
    return String(number);
  }
  // {{var}} stays in Bruno's form: this string goes through insomnia.variables.replaceIn
  return value.includes('{{')
    ? `insomnia.variables.replaceIn(${JSON.stringify(value)})`
    : JSON.stringify(value);
}

function operandsToJs(operator: string, operand: string): string {
  if (operator === 'in' || operator === 'notIn') {
    const list = operand.trim().replace(/^\[(.*)\]$/s, '$1');
    return `[${list.split(',').map(operandToJs).join(', ')}]`;
  }
  if (operator === 'between') {
    return operand.split(',').map(operandToJs).join(', ');
  }
  if (operator === 'matches' || operator === 'notMatches') {
    const pattern = operand.trim().replace(/^\/(.*)\/$/s, '$1');
    return `new RegExp(${JSON.stringify(pattern)})`;
  }
  return operandToJs(operand);
}

/** Bruno assertions become `insomnia.test` calls, for the end of the after-response script */
export function buildAssertionTests(assertions: BrunoAssertionInput[]): GeneratedScript {
  const unsupported: UnsupportedItem[] = [];
  const lines: string[] = [];
  let needsBodyHelper = false;

  for (const assertion of assertions) {
    const title = `${assertion.expression}: ${assertion.operator}${assertion.value ? ` ${assertion.value}` : ''}`;
    if (!assertion.enabled) {
      lines.push(`// disabled: ${title}`);
      continue;
    }
    const chain = ASSERTION_CHAINS[assertion.operator];
    if (!chain) {
      unsupported.push({ name: assertion.expression, reason: `operator "${assertion.operator}" has no equivalent` });
      continue;
    }
    const isBareBody = assertion.expression.trim() === 'res.body';
    const { code: subject, leftovers } = translateBrunoExpression(assertion.expression);
    if (leftovers.length > 0) {
      unsupported.push({ name: assertion.expression, reason: `uses ${leftovers.join(', ')}` });
      continue;
    }
    needsBodyHelper ||= isBareBody;
    const operand = UNARY_OPERATORS.has(assertion.operator) ? '' : operandsToJs(assertion.operator, assertion.value);
    lines.push(
      `insomnia.test(${JSON.stringify(title)}, () => { insomnia.expect(${isBareBody ? '__bruBody()' : subject})${chain.replaceAll('$', () => operand)}; });`,
    );
  }
  return { code: needsBodyHelper ? [BODY_HELPER, ...lines].join('\n') : lines.join('\n'), unsupported };
}
