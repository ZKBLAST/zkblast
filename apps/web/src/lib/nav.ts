export type NavItem = Readonly<{
  href: string;
  label: string;
  mode?: "perps";
}>;

export const nav: readonly NavItem[] = [
  { href: "/trade", label: "Pools" },
  { href: "/trade?mode=perps", label: "Perps", mode: "perps" },
  { href: "/analytics", label: "Analytics" },
  { href: "/docs", label: "Docs" },
];
