import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  size?: number;
}

function base({ size = 18, className, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
    ...rest,
  };
}

export function LinkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M10.2 13.8a4.2 4.2 0 0 0 5.94 0l3.1-3.1a4.2 4.2 0 0 0-5.94-5.94l-1.6 1.6" />
      <path d="M13.8 10.2a4.2 4.2 0 0 0-5.94 0l-3.1 3.1a4.2 4.2 0 0 0 5.94 5.94l1.6-1.6" />
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 17.5v1.6a1.9 1.9 0 0 0 1.9 1.9h11.2a1.9 1.9 0 0 0 1.9-1.9v-1.6" />
    </svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.8" y="4" width="18.4" height="12.4" rx="2.2" />
      <path d="M9 20h6M12 16.4V20" />
    </svg>
  );
}

export function MousePointerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 3 6.5 16.2 2.3-6.4 6.4-2.3L5 3Z" />
      <path d="m13.4 13.4 4.2 4.2" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" />
      <path d="M19.2 13.2a7.4 7.4 0 0 0 0-2.4l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.1-1.2L14.5 3h-5l-.3 2.6a7.6 7.6 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.1 1.2l.3 2.6h5l.3-2.6a7.6 7.6 0 0 0 2.1-1.2l2.3.9 2-3.4-2-1.5Z" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 5 6v5.2c0 4.4 2.9 8 7 9.8 4.1-1.8 7-5.4 7-9.8V6l-7-3Z" />
      <path d="m9.2 11.8 2 2 3.6-3.7" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2.4" />
      <path d="M15 9V6.4A2.4 2.4 0 0 0 12.6 4H6.4A2.4 2.4 0 0 0 4 6.4v6.2A2.4 2.4 0 0 0 6.4 15H9" />
    </svg>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4.2" width="18" height="15.6" rx="2.4" />
      <circle cx="8.6" cy="9.4" r="1.6" />
      <path d="m4.2 17.4 4.9-4.6a1.6 1.6 0 0 1 2.2 0l3.6 3.4 2-1.9a1.6 1.6 0 0 1 2.2 0l2.7 2.5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5 12.5 4.4 4.3L19 6.8" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.6 12S5.7 5.8 12 5.8 21.4 12 21.4 12 18.3 18.2 12 18.2 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.5 9.5 0 0 1 12 6c6.3 0 9.4 6 9.4 6a16 16 0 0 1-2.4 3.2" />
      <path d="M6.2 7.4A16 16 0 0 0 2.6 12s3.1 6 9.4 6a9.8 9.8 0 0 0 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20 11a8 8 0 1 0-2.1 6.3" />
      <path d="M20 4.5V11h-6.2" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4.8" y="10" width="14.4" height="10" rx="2.4" />
      <path d="M8.2 10V7.4a3.8 3.8 0 0 1 7.6 0V10" />
      <path d="M12 14v2.2" />
    </svg>
  );
}

export function HashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 3 7.8 21M16.2 3l-1.7 18M4 8.6h16M3.4 15.4h16" />
    </svg>
  );
}

export function FullscreenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 4H4.8A.8.8 0 0 0 4 4.8V9M15 4h4.2a.8.8 0 0 1 .8.8V9M9 20H4.8a.8.8 0 0 1-.8-.8V15M15 20h4.2a.8.8 0 0 0 .8-.8V15" />
    </svg>
  );
}

export function ExitFullscreenIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 9h4.2a.8.8 0 0 0 .8-.8V4M20 9h-4.2a.8.8 0 0 1-.8-.8V4M4 15h4.2a.8.8 0 0 1 .8.8V20M20 15h-4.2a.8.8 0 0 0-.8.8V20" />
    </svg>
  );
}

export function PowerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v9" />
      <path d="M6.6 6.8a7.6 7.6 0 1 0 10.8 0" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4 2.8 20h18.4L12 4Z" />
      <path d="M12 9.4v4.8M12 17.4h.01" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8V17M12 7.4h.01" />
    </svg>
  );
}

export function ServerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3.4" y="4" width="17.2" height="6.4" rx="1.8" />
      <rect x="3.4" y="13.6" width="17.2" height="6.4" rx="1.8" />
      <path d="M7 7.2h.01M7 16.8h.01M11 7.2h.01M11 16.8h.01" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.4h17.6M3.2 14.6h17.6" />
      <path d="M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z" />
    </svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.2" />
      <path d="M6 9.8h.01M9.4 9.8h.01M12.8 9.8h.01M16.2 9.8h.01M19.6 9.8h.01M6 12.8h.01M9.4 12.8h.01M12.8 12.8h.01M16.2 12.8h.01M19.6 12.8h.01M7.4 15.6h9.2" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12h15M13.4 6.2 19.2 12l-5.8 5.8" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 13.9 9l5.5 1.9-5.5 1.9L12 18.3l-1.9-5.5L4.6 10.9 10.1 9 12 3.5Z" />
      <path d="M18.6 15.8 19.3 18l2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7.7-2.2Z" />
    </svg>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.4A2.4 2.4 0 0 1 6.4 3H20v15.2H6.4A2.4 2.4 0 0 0 4 20.6V5.4Z" />
      <path d="M4 18.2A2.4 2.4 0 0 1 6.4 15.8H20M8 7.4h8M8 10.8h5.4" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.2 11.6 20 4.4l-4.6 15.2-4.1-5.7-7.1-2.3Z" />
      <path d="m11.3 13.9 8.7-9.5" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.4 12.4a7.4 7.4 0 0 1-7.4 7.4H8.2L4 21.6v-5.1a7.4 7.4 0 0 1-1.4-4.1 7.4 7.4 0 0 1 7.4-7.4h3a7.4 7.4 0 0 1 7.4 7.4Z" />
      <path d="M8.6 10.4h7.2M8.6 13.6h4.8" />
    </svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="4.6" width="14" height="16" rx="2.2" />
      <path d="M9.2 4.6V3.8A1.5 1.5 0 0 1 10.7 2.3h2.6a1.5 1.5 0 0 1 1.5 1.5v.8" />
      <path d="M8.6 10.2h6.8M8.6 13.8h4.4" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6.4" y="4.6" width="3.8" height="14.8" rx="1.3" />
      <rect x="13.8" y="4.6" width="3.8" height="14.8" rx="1.3" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.4 4.8v14.4L19.6 12 7.4 4.8Z" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10.8" cy="10.8" r="6.4" />
      <path d="m15.6 15.6 4.4 4.4" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m5.4 9 6.6 6.4L18.6 9" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 3l18 18" />
      <path d="M8.8 15.2a4.6 4.6 0 0 1 6.4 0M5.6 11.8a9.4 9.4 0 0 1 3-1.8M15.4 10a9.4 9.4 0 0 1 3 1.8M2.4 8.4a14 14 0 0 1 4-2.3M17.6 6.1a14 14 0 0 1 4 2.3" />
      <path d="M12 19h.01" />
    </svg>
  );
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg
      {...base(props)}
      fill={filled ? "currentColor" : "none"}
      strokeWidth={filled ? 1.2 : 1.8}
    >
      <path d="m12 3.6 2.62 5.31 5.86.85-4.24 4.13 1 5.84L12 16.97l-5.24 2.76 1-5.84-4.24-4.13 5.86-.85L12 3.6Z" />
    </svg>
  );
}

export function ThumbUpIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7.5 10.5 11 4.2a2 2 0 0 1 2 2v3.3h4.1a2 2 0 0 1 1.95 2.45l-1.15 5.2A2 2 0 0 1 15.95 19H7.5" />
      <path d="M7.5 10.5H4.6a.6.6 0 0 0-.6.6v7.3a.6.6 0 0 0 .6.6h2.9Z" />
    </svg>
  );
}
