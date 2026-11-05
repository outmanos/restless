import { describe, expect, it } from 'vitest';

import { convertTemplate, type TemplateIssue } from './template';

describe('convertTemplate', () => {
  it.each([
    ['{{host}}/ping', '{{ _.host }}/ping'],
    ['{{ host }}', '{{ _.host }}'],
    ['{{a}}-{{b}}', '{{ _.a }}-{{ _.b }}'],
    ['no variables here', 'no variables here'],
    ['', ''],
    ['{{}}', '{{}}'],
  ])('%s', (input, expected) => {
    expect(convertTemplate(input)).toBe(expected);
  });

  it('keeps object paths as paths', () => {
    expect(convertTemplate('{{user.name}}')).toBe('{{ _.user.name }}');
  });

  it('uses bracket notation for names that are not identifiers, like the Postman importer', () => {
    expect(convertTemplate('{{env-var2}}')).toBe("{{ _['env-var2'] }}");
    expect(convertTemplate('{{my var}}')).toBe("{{ _['my var'] }}");
    expect(convertTemplate('{{a.b-c}}')).toBe("{{ _.a['b-c'] }}");
    expect(convertTemplate('{{1st}}')).toBe("{{ _['1st'] }}");
  });

  it('converts inside JSON bodies', () => {
    expect(convertTemplate('{\n  "n": {{coll_num}},\n  "o": {{coll_obj}}\n}')).toBe(
      '{\n  "n": {{ _.coll_num }},\n  "o": {{ _.coll_obj }}\n}',
    );
  });

  it('maps dynamic variables that restless has a generator for', () => {
    expect(convertTemplate('{{$guid}}')).toBe("{% faker 'guid' %}");
    expect(convertTemplate('id={{$randomInt}}&t={{$isoTimestamp}}')).toBe(
      "id={% faker 'randomInt' %}&t={% faker 'isoTimestamp' %}",
    );
  });

  it('points a reference at the new name when the variable had to be renamed', () => {
    const renames = new Map([['api.url', 'api_url']]);
    expect(convertTemplate('{{api.url}}/v1 {{other}}', undefined, renames)).toBe('{{ _.api_url }}/v1 {{ _.other }}');
  });

  describe('leaves what it cannot convert as written, and reports it', () => {
    it.each([
      ['{{process.env.TOKEN}}', 'process-env', 'process.env.TOKEN'],
      ['{{$notARealGenerator}}', 'dynamic-variable', '$notARealGenerator'],
      ['{{?prompt}}', 'prompt-variable', '?prompt'],
      ['{{$oauth2.credentials.access_token}}', 'dynamic-variable', '$oauth2.credentials.access_token'],
    ])('%s', (input, kind, expression) => {
      const issues: TemplateIssue[] = [];
      expect(convertTemplate(`before ${input} after`, issue => issues.push(issue))).toBe(`before ${input} after`);
      expect(issues).toEqual([{ kind, expression }]);
    });

    it('still converts the rest of the string', () => {
      const issues: TemplateIssue[] = [];
      expect(convertTemplate('{{host}}?k={{process.env.KEY}}', issue => issues.push(issue))).toBe(
        '{{ _.host }}?k={{process.env.KEY}}',
      );
      expect(issues).toHaveLength(1);
    });
  });
});
