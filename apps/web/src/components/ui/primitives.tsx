"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function AppLink({
  href,
  children,
  className,
  onClick,
}: Readonly<{
  href: string;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}>) {
  const router = useRouter();
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}

export function Badge({
  children,
  muted = false,
}: Readonly<{ children: ReactNode; muted?: boolean }>) {
  return (
    <span className={`badge${muted ? " badge-muted" : ""}`}>{children}</span>
  );
}

export function Panel({
  children,
  className = "",
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <section className={`panel ${className}`}>{children}</section>;
}
