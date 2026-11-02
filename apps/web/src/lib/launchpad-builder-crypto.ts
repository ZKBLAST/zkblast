import { keccak256, stringToHex, type Hex } from "viem";

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function launchpadMetadataCommitment(
  input: Readonly<{
    slug: string;
    name: string;
    description: string;
    primaryColor: string;
    backgroundColor: string;
    foregroundColor: string;
    websiteUrl: string | null;
    xUrl: string | null;
    logoSha256?: string | null;
    faviconSha256?: string | null;
  }>,
): Promise<Hex> {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    slug: input.slug,
    name: input.name,
    description: input.description,
    primaryColor: input.primaryColor,
    backgroundColor: input.backgroundColor,
    foregroundColor: input.foregroundColor,
    websiteUrl: input.websiteUrl,
    xUrl: input.xUrl,
    logoSha256: input.logoSha256 ?? null,
    faviconSha256: input.faviconSha256 ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return bytesToHex(new Uint8Array(digest));
}

export type PreparedLaunchpadImage = Readonly<{
  mime: "image/png";
  base64: string;
  sha256: string;
  previewUrl: string;
}>;

export async function prepareLaunchpadImage(
  file: File,
  kind: "logo" | "favicon",
): Promise<PreparedLaunchpadImage> {
  if (!file.type.startsWith("image/"))
    throw new Error("Select a PNG, JPEG, or WebP image");
  if (file.size > 5_000_000) throw new Error("Image must be smaller than 5 MB");
  const bitmap = await createImageBitmap(file);
  const size = kind === "logo" ? 192 : 64;
  const maximumBytes = kind === "logo" ? 256_000 : 64_000;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image processing is unavailable in this browser");
  }
  context.clearRect(0, 0, size, size);
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(
    bitmap,
    (size - width) / 2,
    (size - height) / 2,
    width,
    height,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob || blob.size > maximumBytes)
    throw new Error(
      kind === "logo"
        ? "Processed logo is too complex; choose a simpler image"
        : "Processed favicon is too complex; choose a simpler image",
    );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    mime: "image/png",
    base64: btoa(binary),
    sha256: Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    previewUrl: URL.createObjectURL(blob),
  };
}

export function launchpadSlugCommitment(slug: string): Hex {
  return keccak256(stringToHex(slug));
}
