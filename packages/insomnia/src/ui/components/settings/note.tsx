import React, { type FC, type PropsWithChildren } from 'react';

// A left aligned note, with a small ! in a circle at the start
export const Note: FC<PropsWithChildren<{ testId?: string }>> = ({ children, testId }) => (
  <div
    role="note"
    data-testid={testId}
    className="flex items-start gap-3 rounded-md border border-solid border-(--hl-md) bg-(--hl-xs) p-3 text-left text-sm"
  >
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-solid border-(--color-info) text-xs leading-none font-bold text-(--color-info)"
    >
      !
    </span>
    <div>{children}</div>
  </div>
);
