// @usebruno/lang ships no types. These are the exports the Bruno reader uses.
declare module '@usebruno/lang' {
  export function bruToJsonV2(source: string): any;
  export function bruToEnvJsonV2(source: string): any;
  export function collectionBruToJson(source: string): any;
}
