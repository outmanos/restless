import { models } from 'insomnia-data';
import { describe, expect, it } from 'vitest';

import { mapAuthentication } from './auth';
import { convertTemplate } from './template';

function map(mode: string, values: Record<string, unknown> = {}) {
  const unsupported: string[] = [];
  const result = mapAuthentication(
    { mode, values },
    { convert: text => convertTemplate(text), unsupported: detail => unsupported.push(detail) },
  );
  return { result, unsupported };
}

describe('mapAuthentication', () => {
  it('reads inherit as "nothing set", which restless inherits from, and none as a choice', () => {
    expect(map('inherit')).toEqual({ result: undefined, unsupported: [] });
    expect(map('none')).toEqual({ result: { type: 'none' }, unsupported: [] });
  });

  it('maps basic, bearer and digest, converting {{var}}', () => {
    expect(map('basic', { username: '{{user}}', password: 'p' }).result).toEqual({
      type: 'basic',
      username: '{{ _.user }}',
      password: 'p',
    });
    expect(map('bearer', { token: '{{bearer_auth_token}}' }).result).toEqual({
      type: 'bearer',
      token: '{{ _.bearer_auth_token }}',
    });
    expect(map('digest', { username: 'admin', password: 'password' }).result).toEqual({
      type: 'digest',
      username: 'admin',
      password: 'password',
    });
  });

  it('puts the NTLM domain in front of the user name, since restless has one field for both', () => {
    expect(map('ntlm', { username: 'ntlmtest', password: 'x', domain: 'CORP' }).result).toEqual({
      type: 'ntlm',
      username: 'CORP\\ntlmtest',
      password: 'x',
    });
    expect(map('ntlm', { username: 'ntlmtest', password: 'x', domain: '' }).result).toEqual({
      type: 'ntlm',
      username: 'ntlmtest',
      password: 'x',
    });
  });

  it('maps an API key to the header or the query', () => {
    expect(map('apikey', { key: 'X-Key', value: 'v', placement: 'header' }).result).toEqual({
      type: 'apikey',
      key: 'X-Key',
      value: 'v',
      addTo: 'header',
    });
    expect(map('apikey', { key: 'k', value: 'v', placement: 'queryparams' }).result).toMatchObject({
      addTo: 'queryParams',
    });
  });

  it('maps AWS Signature v4 to IAM, and says a profile name is not kept', () => {
    expect(
      map('awsv4', {
        accessKeyId: 'AKIA',
        secretAccessKey: 's',
        sessionToken: '',
        service: 'execute-api',
        region: 'eu-west-1',
        profileName: '',
      }),
    ).toEqual({
      result: { type: 'iam', accessKeyId: 'AKIA', secretAccessKey: 's', service: 'execute-api', region: 'eu-west-1' },
      unsupported: [],
    });
    expect(map('awsv4', { accessKeyId: 'a', profileName: 'work' }).unsupported).toEqual([
      'AWS profile names are not supported, the keys were kept',
    ]);
  });

  describe('OAuth 1', () => {
    it('maps the fields', () => {
      expect(
        map('oauth1', {
          consumerKey: 'ck',
          consumerSecret: 'cs',
          accessToken: 'at',
          accessTokenSecret: 'ats',
          callbackUrl: 'http://cb',
          verifier: 'v',
          signatureMethod: 'HMAC-SHA256',
          privateKey: '',
          privateKeyType: 'text',
          timestamp: '',
          nonce: 'n',
          version: '1.0',
          realm: 'r',
          placement: 'header',
          includeBodyHash: true,
        }),
      ).toEqual({
        result: {
          type: 'oauth1',
          signatureMethod: 'HMAC-SHA256',
          consumerKey: 'ck',
          consumerSecret: 'cs',
          tokenKey: 'at',
          tokenSecret: 'ats',
          version: '1.0',
          nonce: 'n',
          callback: 'http://cb',
          realm: 'r',
          verifier: 'v',
          includeBodyHash: true,
        },
        unsupported: [],
      });
    });

    it('says what restless cannot do: other signature methods, a key in a file, other placements', () => {
      const { result, unsupported } = map('oauth1', {
        signatureMethod: 'RSA-SHA512',
        privateKey: 'keys/private.pem',
        privateKeyType: 'file',
        placement: 'query',
      });
      expect(result).toEqual({ type: 'oauth1' });
      expect(unsupported).toEqual([
        'OAuth 1 signature method RSA-SHA512 is not supported',
        'An OAuth 1 private key kept in a file is not supported',
        'OAuth 1 parameters can only go in the header',
      ]);
    });
  });

  describe('OAuth 2', () => {
    it('maps authorization code with PKCE, and drops the default Bearer prefix', () => {
      expect(
        map('oauth2', {
          grantType: 'authorization_code',
          authorizationUrl: 'http://auth',
          accessTokenUrl: 'http://token',
          callbackUrl: 'http://cb',
          clientId: 'id',
          clientSecret: 'secret',
          scope: 'read',
          state: 's',
          pkce: true,
          credentialsPlacement: 'basic_auth_header',
          tokenPlacement: 'header',
          tokenHeaderPrefix: 'Bearer',
        }),
      ).toEqual({
        result: {
          type: 'oauth2',
          grantType: 'authorization_code',
          authorizationUrl: 'http://auth',
          accessTokenUrl: 'http://token',
          clientId: 'id',
          clientSecret: 'secret',
          scope: 'read',
          redirectUrl: 'http://cb',
          state: 's',
          usePkce: true,
          pkceMethod: 'S256',
        },
        unsupported: [],
      });
    });

    it('maps client credentials, with the credentials in the body, and a custom prefix', () => {
      expect(
        map('oauth2', {
          grantType: 'client_credentials',
          accessTokenUrl: 'http://token',
          clientId: 'id',
          clientSecret: 'secret',
          scope: 'admin',
          credentialsPlacement: 'body',
          tokenPlacement: 'header',
          tokenHeaderPrefix: 'JWT',
        }).result,
      ).toEqual({
        type: 'oauth2',
        grantType: 'client_credentials',
        accessTokenUrl: 'http://token',
        clientId: 'id',
        clientSecret: 'secret',
        scope: 'admin',
        credentialsInBody: true,
        tokenPrefix: 'JWT',
      });
    });

    it('maps password', () => {
      expect(
        map('oauth2', {
          grantType: 'password',
          accessTokenUrl: 'http://token',
          username: 'u',
          password: 'p',
          clientId: 'id',
          clientSecret: 's',
        }).result,
      ).toEqual({
        type: 'oauth2',
        grantType: 'password',
        accessTokenUrl: 'http://token',
        clientId: 'id',
        clientSecret: 's',
        username: 'u',
        password: 'p',
      });
    });

    it('maps implicit, which has no secret and no token URL', () => {
      expect(
        map('oauth2', {
          grantType: 'implicit',
          authorizationUrl: 'http://auth',
          callbackUrl: 'http://cb',
          clientId: 'id',
          clientSecret: 'ignored',
          accessTokenUrl: 'ignored',
        }).result,
      ).toEqual({
        type: 'oauth2',
        grantType: 'implicit',
        authorizationUrl: 'http://auth',
        clientId: 'id',
        redirectUrl: 'http://cb',
        responseType: 'token',
      });
    });

    it('says what it cannot keep', () => {
      expect(
        map('oauth2', {
          grantType: 'client_credentials',
          additionalParameters: true,
          tokenPlacement: 'url',
          tokenQueryKey: 'access_token',
        }).unsupported,
      ).toEqual([
        'OAuth 2 additional parameters are not supported',
        'Sending the OAuth 2 token in the URL is not supported, it goes in the header',
      ]);
      expect(map('oauth2', { grantType: 'device_code' })).toEqual({
        result: { type: 'none' },
        unsupported: ['OAuth 2 grant type "device_code" is not supported, the request is sent without it'],
      });
    });
  });

  it.each(['wsse', 'akamai-edgegrid', 'made-up'])('sends the request without %s, and says so', mode => {
    expect(map(mode, { username: 'SECRET-USER' })).toEqual({
      result: { type: 'none' },
      unsupported: [`Authentication mode "${mode}" is not supported, the request is sent without it`],
    });
  });

  it('only produces what the restless authentication schema accepts', () => {
    const inputs: [string, Record<string, unknown>][] = [
      ['none', {}],
      ['basic', { username: 'u', password: 'p' }],
      ['bearer', { token: 't' }],
      ['digest', { username: 'u', password: 'p' }],
      ['ntlm', { username: 'u', password: 'p', domain: 'D' }],
      ['apikey', { key: 'k', value: 'v', placement: 'queryparams' }],
      ['awsv4', { accessKeyId: 'a', secretAccessKey: 's', region: 'r', service: 'x' }],
      ['oauth1', { consumerKey: 'c', signatureMethod: 'PLAINTEXT', includeBodyHash: true }],
      ['oauth2', { grantType: 'authorization_code', pkce: true, credentialsPlacement: 'body' }],
      ['oauth2', { grantType: 'client_credentials', tokenHeaderPrefix: 'JWT' }],
      ['oauth2', { grantType: 'password', username: 'u', password: 'p' }],
      ['oauth2', { grantType: 'implicit', callbackUrl: 'http://cb' }],
      ['wsse', {}],
    ];
    for (const [mode, values] of inputs) {
      const parsed = models.request.AuthenticationSchema.safeParse(map(mode, values).result ?? {});
      expect(parsed.success, `${mode} ${JSON.stringify(values)}`).toBe(true);
    }
  });
});
