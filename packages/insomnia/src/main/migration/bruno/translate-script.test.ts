import { describe, expect, it } from 'vitest';

import {
  BRUNO_ASSERTION_OPERATORS,
  BRUNO_SCRIPT_RULES,
  buildAssertionTests,
  buildPostResponseVariables,
  buildPreRequestVariables,
  findLeftovers,
  translateBrunoExpression,
  translateBrunoScript,
} from './translate-script';

const LOWERCASED_HEADERS =
  'Object.fromEntries(insomnia.response.headers.map(__h => [__h.key.toLowerCase(), __h.value], {}))';

// One or more cases for every rule, keyed by the rule name
const RULE_CASES: Record<string, { input: string; expected: string }[]> = {
  'bru.getAllEnvVars': [{ input: 'bru.getAllEnvVars()', expected: 'insomnia.environment.toObject()' }],
  'bru.deleteAllEnvVars': [{ input: 'bru.deleteAllEnvVars();', expected: 'insomnia.environment.clear();' }],
  'bru.getEnvName': [{ input: 'const n = bru.getEnvName();', expected: 'const n = insomnia.environment.name;' }],
  'bru.getEnvVar': [{ input: 'bru.getEnvVar("host")', expected: 'insomnia.environment.get("host")' }],
  'bru.setEnvVar': [
    {
      input: 'bru.setEnvVar("foo", "bar", { persist: true })',
      expected: 'insomnia.environment.set("foo", "bar", { persist: true })',
    },
  ],
  'bru.hasEnvVar': [{ input: 'bru.hasEnvVar("a")', expected: 'insomnia.environment.has("a")' }],
  'bru.deleteEnvVar': [{ input: 'bru.deleteEnvVar("a")', expected: 'insomnia.environment.unset("a")' }],

  'bru.getAllVars': [{ input: 'bru.getAllVars()', expected: 'insomnia.variables.toObject()' }],
  'bru.getVar': [{ input: 'bru.getVar("token")', expected: 'insomnia.variables.get("token")' }],
  'bru.hasVar': [{ input: 'bru.hasVar("token")', expected: 'insomnia.variables.has("token")' }],
  'bru.setVar': [
    {
      input: 'bru.setVar("token", res.body.token)',
      expected: 'insomnia.environment.set("token", insomnia.response.json().token)',
    },
  ],
  'bru.deleteVar': [{ input: 'bru.deleteVar("token")', expected: 'insomnia.environment.unset("token")' }],

  'bru.getAllCollectionVars': [
    { input: 'bru.getAllCollectionVars()', expected: 'insomnia.collectionVariables.toObject()' },
  ],
  'bru.deleteAllCollectionVars': [
    { input: 'bru.deleteAllCollectionVars()', expected: 'insomnia.collectionVariables.clear()' },
  ],
  'bru.getCollectionVar': [{ input: 'bru.getCollectionVar("a")', expected: 'insomnia.collectionVariables.get("a")' }],
  'bru.setCollectionVar': [
    { input: 'bru.setCollectionVar("a", 1)', expected: 'insomnia.collectionVariables.set("a", 1)' },
  ],
  'bru.hasCollectionVar': [{ input: 'bru.hasCollectionVar("a")', expected: 'insomnia.collectionVariables.has("a")' }],
  'bru.deleteCollectionVar': [
    { input: 'bru.deleteCollectionVar("a")', expected: 'insomnia.collectionVariables.unset("a")' },
  ],

  'bru.getAllGlobalEnvVars': [{ input: 'bru.getAllGlobalEnvVars()', expected: 'insomnia.globals.toObject()' }],
  'bru.deleteAllGlobalEnvVars': [{ input: 'bru.deleteAllGlobalEnvVars()', expected: 'insomnia.globals.clear()' }],
  'bru.getGlobalEnvVar': [{ input: 'bru.getGlobalEnvVar("a")', expected: 'insomnia.globals.get("a")' }],
  'bru.setGlobalEnvVar': [{ input: 'bru.setGlobalEnvVar("a", 1)', expected: 'insomnia.globals.set("a", 1)' }],
  'bru.hasGlobalEnvVar': [{ input: 'bru.hasGlobalEnvVar("a")', expected: 'insomnia.globals.has("a")' }],
  'bru.deleteGlobalEnvVar': [{ input: 'bru.deleteGlobalEnvVar("a")', expected: 'insomnia.globals.unset("a")' }],

  'bru.getFolderVar': [{ input: 'bru.getFolderVar("a")', expected: 'insomnia.variables.get("a")' }],
  'bru.getRequestVar': [{ input: 'bru.getRequestVar("a")', expected: 'insomnia.variables.get("a")' }],

  'bru.interpolate': [
    { input: 'bru.interpolate("{{host}}/ping")', expected: 'insomnia.variables.replaceIn("{{host}}/ping")' },
  ],
  'bru.setNextRequest': [
    { input: 'bru.setNextRequest("login")', expected: 'insomnia.execution.setNextRequest("login")' },
    { input: 'bru.runner.setNextRequest("login")', expected: 'insomnia.execution.setNextRequest("login")' },
  ],
  'bru.runner.skipRequest': [{ input: 'bru.runner.skipRequest()', expected: 'insomnia.execution.skipRequest()' }],

  'req.getUrl': [{ input: 'req.getUrl()', expected: 'insomnia.request.url.toString()' }],
  'req.setUrl': [{ input: 'req.setUrl("http://x")', expected: 'insomnia.request.url.update("http://x")' }],
  'req.getMethod': [{ input: 'req.getMethod()', expected: 'insomnia.request.method' }],
  'req.setMethod': [
    { input: 'req.setMethod("POST");', expected: '(insomnia.request.method = "POST");' },
    { input: 'req.setMethod(pick("a", "b"))', expected: '(insomnia.request.method = pick("a", "b"))' },
  ],
  'req.getHeaders': [{ input: 'req.getHeaders()', expected: 'insomnia.request.headers.toObject()' }],
  'req.getHeader': [{ input: 'req.getHeader("bruno")', expected: 'insomnia.request.headers.get("bruno")' }],
  'req.setHeader': [
    {
      input: "req.setHeader('bruno', 'is-the-future');",
      expected: "insomnia.request.upsertHeader({ key: 'bruno', value: 'is-the-future' });",
    },
    {
      input: 'req.setHeader("Authorization", `Basic ${encoded}`)',
      expected: 'insomnia.request.upsertHeader({ key: "Authorization", value: `Basic ${encoded}` })',
    },
  ],
  'req.deleteHeader': [
    {
      input: 'req.deleteHeader("bruno")',
      expected: 'insomnia.request.removeHeader("bruno", { ignoreCase: true })',
    },
  ],
  'req.getName': [{ input: 'req.getName()', expected: 'insomnia.info.requestName' }],
  'req.url': [{ input: 'req.url.includes("x")', expected: 'insomnia.request.url.toString().includes("x")' }],
  'req.method': [{ input: 'if (req.method === "GET") {}', expected: 'if (insomnia.request.method === "GET") {}' }],
  'req.headers': [{ input: 'req.headers["x"]', expected: 'insomnia.request.headers.toObject()["x"]' }],

  'res.getStatusText': [{ input: 'res.getStatusText()', expected: 'insomnia.response.status' }],
  'res.getStatus': [{ input: 'res.getStatus()', expected: 'insomnia.response.code' }],
  'res.getResponseTime': [{ input: 'res.getResponseTime()', expected: 'insomnia.response.responseTime' }],
  'res.getBody': [{ input: 'res.getBody().id', expected: 'insomnia.response.json().id' }],
  'res.getHeader': [
    {
      input: 'res.getHeader("content-type")',
      expected:
        'insomnia.response.headers.find(__h => __h.key.toLowerCase() === String("content-type").toLowerCase())?.value',
    },
  ],
  'res.getHeaders': [{ input: 'res.getHeaders()', expected: LOWERCASED_HEADERS }],
  'res.statusText': [{ input: 'res.statusText', expected: 'insomnia.response.status' }],
  'res.status': [
    { input: 'expect(res.status).to.equal(200)', expected: 'insomnia.expect(insomnia.response.code).to.equal(200)' },
  ],
  'res.responseTime': [{ input: 'res.responseTime < 500', expected: 'insomnia.response.responseTime < 500' }],
  'res.body': [{ input: 'res.body.items[0]', expected: 'insomnia.response.json().items[0]' }],
  'res.headers': [{ input: "res.headers['content-type']", expected: `${LOWERCASED_HEADERS}['content-type']` }],

  'test.skip': [{ input: 'test.skip("later", () => {})', expected: 'insomnia.test.skip("later", () => {})' }],
  'test': [{ input: 'test("ok", function () {});', expected: 'insomnia.test("ok", function () {});' }],
  'expect': [{ input: 'expect(1).to.equal(1)', expected: 'insomnia.expect(1).to.equal(1)' }],
};

describe('rule table', () => {
  it('has cases for every rule and no stale ones', () => {
    expect(Object.keys(RULE_CASES).sort()).toEqual(BRUNO_SCRIPT_RULES.map(rule => rule.name).sort());
  });

  for (const [name, cases] of Object.entries(RULE_CASES)) {
    it.each(cases)(`${name}: $input`, ({ input, expected }) => {
      const { code, leftovers } = translateBrunoExpression(input);
      expect(code).toBe(expected);
      expect(leftovers).toEqual([]);
    });
  }
});

describe('rule boundaries', () => {
  it('leaves longer identifiers, property chains and strings alone', () => {
    for (const script of [
      'myreq.url',
      'obj.res.status',
      'const label = "res.status";',
      "const label = 'bru.getVar';",
      'greet("x")', // not test(
      'mytest("x")',
      'unexpected(1)',
    ]) {
      expect(translateBrunoExpression(script).code).toBe(script);
    }
  });

  it('does not rewrite assignments, which a read translation would break', () => {
    const { code, leftovers } = translateBrunoExpression('req.url = "http://x";');
    expect(code).toBe('req.url = "http://x";');
    expect(leftovers).toEqual(['req.url']);
  });

  it('keeps comparisons', () => {
    expect(translateBrunoExpression('res.status == 200').code).toBe('insomnia.response.code == 200');
  });

  it('translates nested calls of the same function', () => {
    expect(translateBrunoExpression("req.setHeader('a', req.getHeader('b'))").code).toBe(
      "insomnia.request.upsertHeader({ key: 'a', value: insomnia.request.headers.get('b') })",
    );
    expect(translateBrunoExpression("req.setHeader('a', req.getHeader('b') + req.getHeader('c'))").code).toBe(
      "insomnia.request.upsertHeader({ key: 'a', value: insomnia.request.headers.get('b') + insomnia.request.headers.get('c') })",
    );
  });

  it('handles parentheses, commas and quotes inside call arguments', () => {
    expect(translateBrunoExpression(`req.setHeader('x', ')')`).code).toBe(
      `insomnia.request.upsertHeader({ key: 'x', value: ')' })`,
    );
    expect(translateBrunoExpression('req.setHeader("a,b", fn(1, 2))').code).toBe(
      'insomnia.request.upsertHeader({ key: "a,b", value: fn(1, 2) })',
    );
    expect(translateBrunoExpression('req.setHeader(\n  "a",\n  "b"\n)').code).toBe(
      'insomnia.request.upsertHeader({ key: "a", value: "b" })',
    );
  });

  it('leaves a call with the wrong number of arguments for the leftover scan', () => {
    const { code, leftovers } = translateBrunoExpression('req.setHeader("only-name")');
    expect(code).toBe('req.setHeader("only-name")');
    expect(leftovers).toEqual(['req.setHeader']);
  });

  it('is stable when run twice', () => {
    const once = translateBrunoExpression(
      'bru.setVar("a", res.getBody().b); test("t", () => expect(res.status).to.equal(200));',
    ).code;
    expect(translateBrunoExpression(once).code).toBe(once);
  });
});

describe('leftover scan', () => {
  it('finds what the rules do not translate', () => {
    expect(
      findLeftovers(
        [
          'await bru.runRequest("ping");',
          'await bru.sleep(10);',
          'res.setBody({});',
          'req.setBody("x");',
          'res("data.items");',
          'const crypto = require("crypto");',
          'expect.fail("no");',
        ].join('\n'),
      ),
    ).toEqual(['bru.runRequest', 'bru.sleep', 'res.setBody', 'req.setBody', 'res()', 'require()', 'expect.fail']);
  });

  it('finds nothing in translated code', () => {
    expect(
      findLeftovers('insomnia.test("a", () => { insomnia.expect(insomnia.response.code).to.equal(200); });'),
    ).toEqual([]);
  });

  it('names the whole member path', () => {
    expect(findLeftovers('bru.runner.stopExecution(); bru.cookies.jar();')).toEqual([
      'bru.runner.stopExecution',
      'bru.cookies.jar',
    ]);
  });

  describe('ignores what is not code', () => {
    it.each([
      ['a string', 'console.log("req.url and bru.getVar and require(x)");'],
      ['a single-quoted string', "const label = 'res.status is bru.sleep';"],
      ['a template literal text', 'console.log(`uses req.url and res.body`);'],
      ['a line comment', '// bru.runRequest would go here\nconst a = 1;'],
      ['a block comment', '/* res.setBody(x)\n   bru.sleep(1) */ const a = 1;'],
      // from a real Bruno test: the title mentions bru.setVar, the code does not call it
      ['a test title', 'test("runtime vars set via bru.setVar preserve types", () => {});'],
    ])('%s', (_label, code) => {
      expect(findLeftovers(code)).toEqual([]);
    });

    it('still finds code inside ${ } of a template literal', () => {
      expect(findLeftovers('console.log(`slept ${await bru.sleep(1)} ms`);')).toEqual(['bru.sleep']);
      expect(findLeftovers('const s = `a ${`b ${req.setBody(1)}`} c`;')).toEqual(['req.setBody']);
    });

    it('does not let a quote that never closes hide the lines after it', () => {
      expect(findLeftovers('const a = "oops\nawait bru.runRequest("ping");')).toEqual(['bru.runRequest']);
      expect(findLeftovers('/"/.test(x);\nbru.sleep(1);')).toEqual(['bru.sleep']);
    });

    it('does not let an escaped quote end a string early', () => {
      expect(findLeftovers('const a = "say \\" req.url \\" now";')).toEqual([]);
      expect(findLeftovers('const a = "x\\\\"; bru.sleep(1);')).toEqual(['bru.sleep']);
    });
  });
});

describe('translateBrunoScript', () => {
  it('translates a post-response script with tests', () => {
    const script = [
      'bru.setVar("token", res.body.token);',
      'test("status", function () {',
      '  expect(res.getStatus()).to.equal(200);',
      '});',
    ].join('\n');
    expect(translateBrunoScript(script)).toEqual({
      code: [
        'insomnia.environment.set("token", insomnia.response.json().token);',
        'insomnia.test("status", function () {',
        '  insomnia.expect(insomnia.response.code).to.equal(200);',
        '});',
      ].join('\n'),
      partial: false,
      leftovers: [],
    });
  });

  it('translates a real Bruno script (basic auth through a header)', () => {
    const script = [
      'const username = "bruno";',
      'const password = "della";',
      '',
      'const authString = `${username}:${password}`;',
      'const encodedAuthString = btoa(authString);',
      '',
      'req.setHeader("Authorization", `Basic ${encodedAuthString}`);',
    ].join('\n');
    const result = translateBrunoScript(script);
    expect(result.partial).toBe(false);
    expect(result.code).toContain(
      'insomnia.request.upsertHeader({ key: "Authorization", value: `Basic ${encodedAuthString}` });',
    );
  });

  describe.each([
    ['bru.runRequest', 'const r = await bru.runRequest("ping");\nbru.setVar("x", 1);'],
    ['require()', 'const btoa = require("btoa");\nreq.setHeader("a", btoa("b"));'],
    ['res()', 'const items = res("data.items");'],
    ['req.setBody', 'req.setBody({ a: 1 });'],
  ])('with %s left over', (leftover, script) => {
    const result = translateBrunoScript(script);

    it('reports it as partly translated', () => {
      expect(result.partial).toBe(true);
      expect(result.leftovers).toContain(leftover);
    });

    it('comments the original out at the top, line by line', () => {
      expect(result.code.startsWith('// restless: this Bruno script was only partly translated.')).toBe(true);
      for (const line of script.split('\n')) {
        expect(result.code).toContain(`// ${line}`);
      }
      expect(result.code).toContain(`// Still to port by hand: ${result.leftovers.join(', ')}`);
    });

    it('keeps the translated part after the comment', () => {
      const body = result.code.split('// End of the original script.\n\n')[1];
      expect(body).toBeDefined();
      expect(body).not.toContain('bru.setVar');
    });
  });

  it('does not mention anything when the script is fully translated', () => {
    expect(translateBrunoScript('bru.setVar("a", 1);').code).toBe('insomnia.environment.set("a", 1);');
  });
});

describe('buildPreRequestVariables', () => {
  it('writes insomnia.variables.set lines with typed values', () => {
    expect(
      buildPreRequestVariables([
        { name: 'req_str', value: 'request_string', enabled: true },
        { name: 'req_num', value: 42, enabled: true },
        { name: 'req_bool', value: true, enabled: true },
        { name: 'req_obj', value: { key: 'value' }, enabled: true },
      ]),
    ).toBe(
      [
        'insomnia.variables.set("req_str", "request_string");',
        'insomnia.variables.set("req_num", 42);',
        'insomnia.variables.set("req_bool", true);',
        'insomnia.variables.set("req_obj", {"key":"value"});',
      ].join('\n'),
    );
  });

  it('converts {{var}} references in string values and reports the ones it cannot convert', () => {
    const issues: unknown[] = [];
    expect(
      buildPreRequestVariables(
        [
          { name: 'token', value: '{{request_pre_var_token}}', enabled: true },
          { name: 'secret', value: '{{process.env.SECRET}}', enabled: true },
        ],
        issue => issues.push(issue),
      ),
    ).toBe(
      [
        'insomnia.variables.set("token", "{{ _.request_pre_var_token }}");',
        'insomnia.variables.set("secret", "{{process.env.SECRET}}");',
      ].join('\n'),
    );
    expect(issues).toEqual([{ kind: 'process-env', expression: 'process.env.SECRET' }]);
  });

  it('keeps disabled variables as comments instead of dropping them', () => {
    expect(buildPreRequestVariables([{ name: 'off', value: 'x', enabled: false }])).toBe('// disabled: off');
  });
});

describe('buildPostResponseVariables', () => {
  it('turns response expressions into runtime variables', () => {
    expect(
      buildPostResponseVariables([
        { name: 'token', value: 'res.body.token', enabled: true },
        { name: 'status', value: 'res.status', enabled: true, local: true },
      ]),
    ).toEqual({
      code: [
        'insomnia.environment.set("token", insomnia.response.json().token);',
        'insomnia.variables.set("status", insomnia.response.code);',
      ].join('\n'),
      unsupported: [],
    });
  });

  it('reports expressions it cannot translate and leaves them out', () => {
    expect(buildPostResponseVariables([{ name: 'id', value: 'res("data.id")', enabled: true }])).toEqual({
      code: '',
      unsupported: [{ name: 'id', reason: 'uses res()' }],
    });
  });
});

describe('buildAssertionTests', () => {
  const lineFor = (expression: string, operator: string, value = '', enabled = true) =>
    buildAssertionTests([{ expression, operator, value, enabled }]);

  it('writes one insomnia.test per assertion', () => {
    expect(lineFor('res.status', 'eq', '200')).toEqual({
      code: 'insomnia.test("res.status: eq 200", () => { insomnia.expect(insomnia.response.code).to.equal(200); });',
      unsupported: [],
    });
  });

  it.each([
    ['eq', '200', '.to.equal(200)'],
    ['neq', '200', '.to.not.equal(200)'],
    ['gt', '1', '.to.be.above(1)'],
    ['gte', '1', '.to.be.at.least(1)'],
    ['lt', '1', '.to.be.below(1)'],
    ['lte', '1', '.to.be.at.most(1)'],
    ['in', '1, 2, a', '.to.be.oneOf([1, 2, "a"])'],
    ['in', '[1,2]', '.to.be.oneOf([1, 2])'],
    ['notIn', '1,2', '.to.not.be.oneOf([1, 2])'],
    ['contains', 'abc', '.to.include("abc")'],
    ['notContains', 'abc', '.to.not.include("abc")'],
    ['length', '3', '.to.have.lengthOf(3)'],
    ['matches', '^a+$', '.to.match(new RegExp("^a+$"))'],
    ['matches', '/^a+$/', '.to.match(new RegExp("^a+$"))'],
    ['notMatches', '^a', '.to.not.match(new RegExp("^a"))'],
    ['startsWith', 'ab', '.to.satisfy(__v => typeof __v === "string" && __v.startsWith("ab"))'],
    ['endsWith', 'ab', '.to.satisfy(__v => typeof __v === "string" && __v.endsWith("ab"))'],
    ['between', '1, 5', '.to.be.within(1, 5)'],
    ['isEmpty', '', '.to.be.empty'],
    ['isNotEmpty', '', '.to.not.be.empty'],
    ['isNull', '', '.to.be.null'],
    ['isUndefined', '', '.to.be.undefined'],
    ['isDefined', '', '.to.not.be.undefined'],
    ['isTruthy', '', '.to.be.true'],
    ['isFalsy', '', '.to.be.false'],
    ['isJson', '', '.to.satisfy(__v => typeof __v === "object" && __v !== null)'],
    ['isNumber', '', '.to.be.a("number")'],
    ['isString', '', '.to.be.a("string")'],
    ['isBoolean', '', '.to.be.a("boolean")'],
    ['isArray', '', '.to.be.a("array")'],
  ])('maps %s %s', (operator, value, chain) => {
    const { code, unsupported } = lineFor('res.body.x', operator, value);
    expect(unsupported).toEqual([]);
    expect(code).toContain(`insomnia.expect(insomnia.response.json().x)${chain}; });`);
  });

  it('covers every operator Bruno has', () => {
    expect(BRUNO_ASSERTION_OPERATORS).toHaveLength(28);
  });

  it.each([
    ['foo', '"foo"'],
    ["'foo'", '"foo"'],
    ['"foo"', '"foo"'],
    [`"'foo'"`, `"'foo'"`],
    ['123', '123'],
    ['"123"', '"123"'],
    ['0123', '123'],
    ['"0123"', '"0123"'],
    ['9007199254740991999', '"9007199254740991999"'],
    ['null', 'null'],
    ['"null"', '"null"'],
    ['true', 'true'],
    ['undefined', 'undefined'],
    ['Authentication successful', '"Authentication successful"'],
  ])('reads the operand %s the way Bruno does', (operand, js) => {
    expect(lineFor('res.body.x', 'eq', operand).code).toContain(`.to.equal(${js});`);
  });

  it('keeps {{var}} operands as a template for replaceIn', () => {
    expect(lineFor('res.body.id', 'eq', '{{userId}}').code).toContain(
      '.to.equal(insomnia.variables.replaceIn("{{userId}}"));',
    );
  });

  it('reads a bare res.body as JSON, or as text when the body is not JSON', () => {
    const { code } = lineFor('res.body', 'eq', 'pong');
    expect(code.split('\n')[0]).toContain('const __bruBody = () => { try { return insomnia.response.json(); }');
    expect(code).toContain('insomnia.expect(__bruBody()).to.equal("pong");');
  });

  it('reports an operator it does not know, and an expression it cannot translate', () => {
    expect(lineFor('res.status', 'approximately', '200')).toEqual({
      code: '',
      unsupported: [{ name: 'res.status', reason: 'operator "approximately" has no equivalent' }],
    });
    expect(lineFor('res("data.id")', 'eq', '1')).toEqual({
      code: '',
      unsupported: [{ name: 'res("data.id")', reason: 'uses res()' }],
    });
  });

  it('keeps disabled assertions as comments', () => {
    expect(lineFor('res.status', 'eq', '200', false).code).toBe('// disabled: res.status: eq 200');
  });

  it('handles expressions that are more than a property path', () => {
    expect(lineFor('res.body.numberBig.toString()', 'eq', "'9007199254740992000'").code).toContain(
      'insomnia.expect(insomnia.response.json().numberBig.toString()).to.equal("9007199254740992000");',
    );
  });
});
