import { type HttpVersion, HttpVersions, type ProxyScope, ProxyScopes } from 'insomnia-data/common';
import React, { type FC } from 'react';

import { useRootLoaderData } from '~/ui/hooks/use-root-loader-data';

import { BooleanSetting } from './boolean-setting';
import { EnumSetting } from './enum-setting';
import { MaskedSetting } from './masked-setting';
import { NumberSetting } from './number-setting';
import { SettingsHeading } from './settings-section';
import { TextSetting } from './text-setting';

export const Requests: FC = () => {
  const { settings } = useRootLoaderData()!;

  return (
    <div>
      <SettingsHeading first>Sending requests</SettingsHeading>
      <BooleanSetting label="Follow redirects" setting="followRedirects" />
      <BooleanSetting
        label="Validate certificates"
        setting="validateSSL"
        help="If checked, validate SSL certificates for API requests. This does not affect SSL certificate validation during authentication."
      />
      <div className="form-row pad-top-sm">
        <EnumSetting<HttpVersion>
          label="Preferred HTTP version"
          setting="preferredHttpVersion"
          values={[
            { value: HttpVersions.default, name: 'Default' },
            { value: HttpVersions.V1_0, name: 'HTTP 1.0' },
            { value: HttpVersions.V1_1, name: 'HTTP 1.1' },
            { value: HttpVersions.V2PriorKnowledge, name: 'HTTP/2 PriorKnowledge' },
            { value: HttpVersions.V2_0, name: 'HTTP/2' },
            // Enable when our version of libcurl supports HTTP/3
            // see: https://github.com/JCMais/node-libcurl/issues/233
            // { value: HttpVersions.v3, name: 'HTTP/3' },
          ]}
          help="Select the preferred HTTP version for requests. The version will fall back if it can’t be negotiated."
        />
      </div>
      <div className="form-row pad-top-sm">
        <NumberSetting
          label="Maximum redirects"
          setting="maxRedirects"
          help="Enter the maximum amount of redirects to follow. Enter -1 for unlimited redirects."
          min={-1}
        />
        <NumberSetting
          label="Request timeout (ms)"
          setting="timeout"
          help="Enter the maximum milliseconds allotted before a request will timeout. Enter 0 to disable timeouts. "
          min={0}
          step={100}
        />
      </div>

      <SettingsHeading>Network proxy</SettingsHeading>
      <BooleanSetting
        label="Enable proxy"
        setting="proxyEnabled"
        help="If checked, enables a global network proxy on all requests sent through Restless. This proxy supports Basic Auth, digest, and NTLM authentication."
      />
      <div className="pt-4">
        <EnumSetting<ProxyScope>
          label="Use proxy for"
          setting="proxyScope"
          disabled={!settings.proxyEnabled}
          values={[
            { value: ProxyScopes.requests, name: 'Only when sending requests in Restless' },
            { value: ProxyScopes.all, name: 'All traffic sent by Restless' },
          ]}
          help="When All traffic is selected, Restless uses the configured proxy for all calls, including login, git, auto-updates, etc."
        />
      </div>
      <div className="form-row pad-top-sm">
        <MaskedSetting
          label="Proxy for HTTP"
          setting="httpProxy"
          help="Enter a HTTP or SOCKS4/5 proxy starting with appropriate prefix from the following (http://, socks4://, socks5://)"
          placeholder="localhost:8005"
        />
        <MaskedSetting
          label="Proxy for HTTPS"
          setting="httpsProxy"
          help="Enter a HTTPS or SOCKS4/5 proxy starting with appropriate prefix from the following (https://, socks4://, socks5://)"
          placeholder="localhost:8005"
        />
        <TextSetting
          label="No proxy"
          setting="noProxy"
          help="Enter a comma-separated list of hostnames that do not require a proxy. To include all subdomains of a domain, prefix it with a dot (e.g., .example.com)."
          placeholder="localhost,127.0.0.1"
        />
      </div>

      <SettingsHeading>Response history</SettingsHeading>
      <BooleanSetting
        label="Filter responses by environment"
        setting="filterResponsesByEnv"
        help="If checked, only show responses sent under the active environment. "
      />
      <div className="form-row pad-top-sm">
        <NumberSetting
          label="Response history limit"
          setting="maxHistoryResponses"
          help="Enter the number of responses to keep for each request. Enter -1 to keep all response history."
          min={-1}
        />
        <NumberSetting
          label="Max timeline chunk size (KiB)"
          setting="maxTimelineDataSizeKB"
          help="Enter the maximum size in kibibytes to show on the response timeline. Decrease the number for less detailed responses."
          min={0}
        />
      </div>
    </div>
  );
};
