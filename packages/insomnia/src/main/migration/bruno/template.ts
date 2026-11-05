import { fakerFunctions } from 'insomnia-data/common';

import { forceBracketNotation } from '~/common/templating/utils';

export type TemplateIssueKind = 'process-env' | 'dynamic-variable' | 'prompt-variable';

export interface TemplateIssue {
  kind: TemplateIssueKind;
  // The reference as written, for example `process.env.TOKEN`. Never a value.
  expression: string;
}

const TEMPLATE_TAG = /\{\{([^{}]*)\}\}/g;
const IDENTIFIER = /^[\p{ID_Start}_$][\p{ID_Continue}$‌‍]*$/u;

// `a.b-c` becomes `_.a['b-c']`: plain identifiers use dots, anything else uses bracket notation
function toLookup(name: string) {
  return name
    .split('.')
    .reduce((lookup, segment) => (IDENTIFIER.test(segment) ? `${lookup}.${segment}` : forceBracketNotation(lookup, segment)), '_');
}

/**
 * Turns Bruno's `{{var}}` into `{{ _.var }}`.
 *
 * `{{process.env.X}}`, unknown `{{$dynamic}}` variables and `{{?prompt}}` variables have no restless
 * equivalent. They are left exactly as written and handed to `onIssue`, so the caller can report them.
 */
export function convertTemplate(
  text: string,
  onIssue?: (issue: TemplateIssue) => void,
  // Variables that had to be renamed to be stored, by their Bruno name
  renames?: ReadonlyMap<string, string>,
): string {
  if (!text || !text.includes('{{')) {
    return text;
  }
  return text.replace(TEMPLATE_TAG, (tag, inner: string) => {
    const expression = inner.trim();
    if (!expression) {
      return tag;
    }
    if (expression.startsWith('process.env.')) {
      onIssue?.({ kind: 'process-env', expression });
      return tag;
    }
    if (expression.startsWith('$')) {
      const generator = expression.slice(1);
      if (Object.prototype.hasOwnProperty.call(fakerFunctions, generator)) {
        return `{% faker '${generator}' %}`;
      }
      onIssue?.({ kind: 'dynamic-variable', expression });
      return tag;
    }
    if (expression.startsWith('?')) {
      onIssue?.({ kind: 'prompt-variable', expression });
      return tag;
    }
    return `{{ ${toLookup(renames?.get(expression) ?? expression)} }}`;
  });
}
