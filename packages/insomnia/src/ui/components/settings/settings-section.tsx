import React, { type FC, type PropsWithChildren } from 'react';

// Section heading shared by every Preferences tab. Sticks to the top of the scrolling panel.
export const SettingsHeading: FC<PropsWithChildren<{ first?: boolean }>> = ({ children, first }) => (
  <h2 className={`sticky top-0 left-0 z-10 bg-(--color-bg) pb-2 text-lg font-bold ${first ? 'pt-2' : 'pt-5'}`}>
    {children}
  </h2>
);
