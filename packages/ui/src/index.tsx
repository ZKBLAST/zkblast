import type { CSSProperties } from "react";

const badgeStyle: CSSProperties = {
  border: "1px solid #3b4431",
  borderRadius: "999px",
  color: "#c7ea46",
  fontSize: "0.75rem",
  padding: "0.45rem 0.7rem",
  textTransform: "uppercase",
};

export function NetworkBadge({
  environment,
}: Readonly<{ environment: string | undefined }>) {
  return <span style={badgeStyle}>{environment ?? "not configured"}</span>;
}
