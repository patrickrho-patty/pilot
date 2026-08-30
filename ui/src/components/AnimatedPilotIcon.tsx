import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function AnimatedPilotIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      className={cn("pilot-thinking-icon", className)}
      aria-hidden="true"
      {...props}
    >
      <g stroke="currentColor">
        <circle cx="12" cy="12" r="8.75" strokeWidth="1.75" opacity="0.35" />
        <circle cx="12" cy="12" r="4.5" strokeWidth="1.5" opacity="0.2" />
      </g>
      <path
        className="pilot-thinking-icon-path"
        d="M12 12 L17.6 6.4"
        pathLength={85.717}
        stroke="var(--color-chart-3)"
        strokeWidth="2"
      />
      <circle cx="15.9" cy="14.8" r="1.8" fill="var(--color-chart-3)" />
    </svg>
  );
}

/** Full-page loading state: a large, centered, gray animated pilot. */
export function PilotLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedPilotIcon className="h-24 w-24 text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
