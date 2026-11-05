import type { AuthTypeOAuth1, AuthTypeOAuth2, RequestAuthentication } from 'insomnia-data';

import { asString, type BrunoAuth } from './read';

export interface AuthContext {
  // Converts {{var}} in a value
  convert: (text: string) => string;
  // Something about the authentication could not be carried over
  unsupported: (detail: string) => void;
}

const OAUTH1_SIGNATURE_METHODS = new Set(['HMAC-SHA1', 'HMAC-SHA256', 'RSA-SHA1', 'PLAINTEXT']);
const OAUTH2_GRANT_TYPES = new Set(['authorization_code', 'client_credentials', 'password', 'implicit']);
// What the PKCE challenge is in restless. Bruno has one method, S256.
const PKCE_S256 = 'S256';

// Drops what is empty, so the document only holds what the collection set
function compact<T extends object>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
  ) as T;
}

/**
 * `undefined` means the request or folder inherits, which restless writes as "no authentication set".
 * `none` is a choice in both apps: it stops the inheritance.
 */
export function mapAuthentication(auth: BrunoAuth, context: AuthContext): RequestAuthentication | undefined {
  const values = auth.values;
  const text = (value: unknown) => context.convert(asString(value));

  switch (auth.mode) {
    case 'inherit': {
      return undefined;
    }
    case 'none': {
      return { type: 'none' };
    }
    case 'basic': {
      return { type: 'basic', username: text(values.username), password: text(values.password) };
    }
    case 'bearer': {
      return { type: 'bearer', token: text(values.token) };
    }
    case 'digest': {
      return { type: 'digest', username: text(values.username), password: text(values.password) };
    }
    case 'ntlm': {
      // restless has one field for both, and libcurl reads DOMAIN\user
      const domain = text(values.domain);
      const username = text(values.username);
      return { type: 'ntlm', username: domain ? `${domain}\\${username}` : username, password: text(values.password) };
    }
    case 'apikey': {
      return {
        type: 'apikey',
        key: text(values.key),
        value: text(values.value),
        addTo: values.placement === 'queryparams' ? 'queryParams' : 'header',
      };
    }
    case 'awsv4': {
      if (asString(values.profileName)) {
        context.unsupported('AWS profile names are not supported, the keys were kept');
      }
      return compact({
        type: 'iam' as const,
        accessKeyId: text(values.accessKeyId),
        secretAccessKey: text(values.secretAccessKey),
        sessionToken: text(values.sessionToken),
        region: text(values.region),
        service: text(values.service),
      });
    }
    case 'oauth1': {
      return mapOAuth1(values, context);
    }
    case 'oauth2': {
      return mapOAuth2(values, context);
    }
    default: {
      context.unsupported(`Authentication mode "${auth.mode}" is not supported, the request is sent without it`);
      return { type: 'none' };
    }
  }
}

function mapOAuth1(values: Record<string, any>, context: AuthContext): AuthTypeOAuth1 {
  const text = (value: unknown) => context.convert(asString(value));
  const signatureMethod = asString(values.signatureMethod);
  if (signatureMethod && !OAUTH1_SIGNATURE_METHODS.has(signatureMethod)) {
    context.unsupported(`OAuth 1 signature method ${signatureMethod} is not supported`);
  }
  if (values.privateKeyType === 'file' && values.privateKey) {
    context.unsupported('An OAuth 1 private key kept in a file is not supported');
  }
  if (asString(values.placement) && values.placement !== 'header') {
    context.unsupported('OAuth 1 parameters can only go in the header');
  }
  return compact({
    type: 'oauth1' as const,
    signatureMethod: OAUTH1_SIGNATURE_METHODS.has(signatureMethod) ? (signatureMethod as AuthTypeOAuth1['signatureMethod']) : undefined,
    consumerKey: text(values.consumerKey),
    consumerSecret: text(values.consumerSecret),
    tokenKey: text(values.accessToken),
    tokenSecret: text(values.accessTokenSecret),
    privateKey: values.privateKeyType === 'file' ? undefined : text(values.privateKey),
    version: text(values.version),
    nonce: text(values.nonce),
    timestamp: text(values.timestamp),
    callback: text(values.callbackUrl),
    realm: text(values.realm),
    verifier: text(values.verifier),
    includeBodyHash: values.includeBodyHash === true ? true : undefined,
  });
}

function mapOAuth2(values: Record<string, any>, context: AuthContext): RequestAuthentication {
  const text = (value: unknown) => context.convert(asString(value));
  const grantType = asString(values.grantType);
  if (!OAUTH2_GRANT_TYPES.has(grantType)) {
    context.unsupported(`OAuth 2 grant type "${grantType}" is not supported, the request is sent without it`);
    return { type: 'none' };
  }
  if (values.additionalParameters) {
    context.unsupported('OAuth 2 additional parameters are not supported');
  }
  if (values.tokenPlacement === 'url') {
    context.unsupported('Sending the OAuth 2 token in the URL is not supported, it goes in the header');
  }
  const isImplicit = grantType === 'implicit';
  const usesCode = grantType === 'authorization_code';
  const prefix = asString(values.tokenHeaderPrefix).trim();

  return compact({
    type: 'oauth2' as const,
    grantType: grantType as AuthTypeOAuth2['grantType'],
    authorizationUrl: usesCode || isImplicit ? text(values.authorizationUrl) : undefined,
    accessTokenUrl: isImplicit ? undefined : text(values.accessTokenUrl),
    clientId: text(values.clientId),
    clientSecret: isImplicit ? undefined : text(values.clientSecret),
    scope: text(values.scope),
    username: grantType === 'password' ? text(values.username) : undefined,
    password: grantType === 'password' ? text(values.password) : undefined,
    redirectUrl: usesCode || isImplicit ? text(values.callbackUrl) : undefined,
    state: usesCode || isImplicit ? text(values.state) : undefined,
    usePkce: usesCode && values.pkce === true ? true : undefined,
    pkceMethod: usesCode && values.pkce === true ? PKCE_S256 : undefined,
    credentialsInBody: isImplicit || values.credentialsPlacement !== 'body' ? undefined : true,
    responseType: isImplicit ? ('token' as const) : undefined,
    // Bruno writes the default, Bearer, out in full
    tokenPrefix: prefix && prefix !== 'Bearer' && values.tokenPlacement !== 'url' ? prefix : undefined,
  });
}
