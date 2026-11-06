import * as os from 'node:os';

import { getAppBuildDate, getAppVersion, getProductName } from '../common/constants';

export interface AboutDetail { label: string; value: string }

// Shown in Preferences > About. The same lines are copied to the clipboard for bug reports.
export const getAboutDetails = (): AboutDetail[] => [
  { label: 'Version', value: `${getProductName()} ${getAppVersion()}` },
  { label: 'Build date', value: getAppBuildDate() },
  { label: 'OS', value: `${os.type()} ${os.arch()} ${os.release()}` },
  { label: 'Electron', value: process.versions.electron },
  { label: 'Node', value: process.versions.node },
  { label: 'Node ABI', value: process.versions.modules },
  { label: 'V8', value: process.versions.v8 },
  { label: 'Architecture', value: process.arch },
];
