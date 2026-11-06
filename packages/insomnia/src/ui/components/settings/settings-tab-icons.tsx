import React, { type FC, type ReactNode } from 'react';

// One small icon per Preferences tab. Drawn with currentColor so they follow the theme.
const icon = (paths: ReactNode): FC<{ className?: string }> => {
  const TabIcon: FC<{ className?: string }> = ({ className }) => (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
  return TabIcon;
};

export const settingsTabIcons = {
  appearance: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </>,
  ),
  editor: icon(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />),
  keyboard: icon(
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </>,
  ),
  requests: icon(<path d="M4 8h14l-4-4M20 16H6l4 4" />),
  security: icon(<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />),
  data: icon(
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </>,
  ),
  plugins: icon(<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3" />),
  credentials: icon(
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3" />
    </>,
  ),
  scripting: icon(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M13 15h4" />
    </>,
  ),
  ai: icon(
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  ),
  about: icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5h.01" />
    </>,
  ),
};
