import React from 'react';

/**
 * Shared line icons (24×24, stroke = currentColor). Keep them visually
 * consistent: 1.7 stroke width, round caps/joins.
 */
export type IconName =
  | 'history'
  | 'robot'
  | 'eye'
  | 'gear'
  | 'exit'
  | 'refresh'
  | 'bulb'
  | 'undo'
  | 'cards'
  | 'users'
  | 'wifi'
  | 'globe'
  | 'chevron-right'
  | 'close'
  | 'trophy'
  | 'book'
  | 'copy'
  | 'play'
  | 'clock'
  | 'plus'
  | 'check'
  | 'layers'
  | 'scroll'
  | 'maximize'
  | 'minimize';

const PATHS: Record<IconName, React.ReactNode> = {
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4.5v4h4" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  robot: (
    <>
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 4.5V8M9 13h.01M15 13h.01M9.5 16.2h5" />
      <circle cx="12" cy="3.8" r="1" />
      <path d="M2.5 12.5v3M21.5 12.5v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  exit: (
    <>
      <path d="M9.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3.5" />
      <path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7" />
      <path d="M3.5 12A8.5 8.5 0 0 1 18.3 6.3" />
      <path d="M18.5 2.8v3.7h-3.7M5.5 21.2v-3.7h3.7" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2h5c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3Z" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5 4 9.5 8.5 14" />
      <path d="M4 9.5h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="6.5" width="11" height="15" rx="2" transform="rotate(-10 8.5 14)" />
      <path d="M12.8 4.6 18.6 3.5a2 2 0 0 1 2.3 1.6l2 11a2 2 0 0 1-1.6 2.3l-3.8.7" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0" />
      <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
      <path d="M8.7 16a5 5 0 0 1 6.6 0" />
      <circle cx="12" cy="19.3" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8.5 7.5h7" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  scroll: (
    <>
      <path d="M6 3.5h11a2 2 0 0 1 2 2V18" />
      <path d="M6 3.5a2 2 0 0 0-2 2v1h4v-1a2 2 0 0 0-2-2ZM8 6.5V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1H11.5" />
      <path d="M11 9h5M11 12.5h5" />
    </>
  ),
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
};

interface IconProps {
  name: IconName;
  className?: string;
  size?: number | string;
  strokeWidth?: number;
  title?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  className = 'btn-icon',
  size,
  strokeWidth = 1.7,
  title,
}) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={title ? undefined : true}
    role={title ? 'img' : undefined}
  >
    {title && <title>{title}</title>}
    {PATHS[name]}
  </svg>
);
