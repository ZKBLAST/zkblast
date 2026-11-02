import { createHash } from "node:crypto";
import { z } from "zod";

const reservedSlugs = new Set([
  "admin",
  "api",
  "docs",
  "launch",
  "launchpads",
  "perps",
  "pools",
  "settings",
  "support",
  "trade",
  "www",
  "zkblast",
]);
const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[<>\u0000-\u001f\u007f]/u.test(value), "Unsafe text");
const safeHttpsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === "https:", "HTTPS is required");
const optionalHttpsUrl = z
  .union([z.literal(""), safeHttpsUrl])
  .transform((value) => (value === "" ? null : value));
const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/iu)
  .transform((value) => value.toLowerCase());

export const launchpadSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .refine((value) => !reservedSlugs.has(value), "Reserved slug");

export const launchpadBrandingSchema = z
  .object({
    schemaVersion: z.literal(1),
    launchpadId: z.string().regex(/^[1-9]\d*$/u),
    slug: launchpadSlugSchema,
    name: safeText(80),
    description: safeText(500),
    primaryColor: color,
    backgroundColor: color,
    foregroundColor: color,
    websiteUrl: optionalHttpsUrl,
    xUrl: optionalHttpsUrl.refine(
      (value) =>
        !value ||
        /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//iu.test(value),
      "Invalid X URL",
    ),
  })
  .strict()
  .superRefine((value, context) => {
    if (contrastRatio(value.foregroundColor, value.backgroundColor) < 4.5) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["foregroundColor"],
        message: "Foreground/background contrast must be at least 4.5:1",
      });
    }
  });

export type LaunchpadBranding = z.infer<typeof launchpadBrandingSchema>;
export type LaunchpadImageKind = "logo" | "favicon";
export type LaunchpadImage = Readonly<{
  mime: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  bytes: Uint8Array;
}>;

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  const first = foreground.replace(/^#/u, "");
  const second = background.replace(/^#/u, "");
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 0) +
    0.7152 * channel(hex, 2) +
    0.0722 * channel(hex, 4);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function imageDimensions(mime: LaunchpadImage["mime"], bytes: Uint8Array) {
  if (mime === "image/png") {
    if (
      bytes.length < 24 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 ||
      bytes[12] !== 0x49 ||
      bytes[13] !== 0x48 ||
      bytes[14] !== 0x44 ||
      bytes[15] !== 0x52
    )
      throw new Error("LAUNCHPAD_IMAGE_SIGNATURE_INVALID");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime === "image/webp") {
    if (
      bytes.length < 30 ||
      String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP" ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "VP8X"
    )
      throw new Error("LAUNCHPAD_IMAGE_SIGNATURE_INVALID");
    return {
      width: uint24le(bytes, 24) + 1,
      height: uint24le(bytes, 27) + 1,
    };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("LAUNCHPAD_IMAGE_SIGNATURE_INVALID");
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff)
      throw new Error("LAUNCHPAD_IMAGE_SIGNATURE_INVALID");
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + length + 2 > bytes.length)
      throw new Error("LAUNCHPAD_IMAGE_SIGNATURE_INVALID");
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += length + 2;
  }
  throw new Error("LAUNCHPAD_IMAGE_DIMENSIONS_MISSING");
}

export function validateLaunchpadImage(
  kind: LaunchpadImageKind,
  mime: string,
  bytes: Uint8Array,
): LaunchpadImage {
  if (
    !(["image/png", "image/jpeg", "image/webp"] as const).includes(
      mime as never,
    )
  )
    throw new Error("LAUNCHPAD_IMAGE_MIME_INVALID");
  const maximumBytes = kind === "logo" ? 256_000 : 64_000;
  if (bytes.length === 0 || bytes.length > maximumBytes)
    throw new Error("LAUNCHPAD_IMAGE_SIZE_INVALID");
  const typedMime = mime as LaunchpadImage["mime"];
  const dimensions = imageDimensions(typedMime, bytes);
  const minimum = kind === "logo" ? 64 : 32;
  const maximum = kind === "logo" ? 1024 : 512;
  if (
    dimensions.width < minimum ||
    dimensions.height < minimum ||
    dimensions.width > maximum ||
    dimensions.height > maximum
  )
    throw new Error("LAUNCHPAD_IMAGE_DIMENSIONS_INVALID");
  return { mime: typedMime, ...dimensions, bytes };
}

export function launchpadBrandingHash(
  input: LaunchpadBranding,
  assets: Readonly<{
    logo?: Uint8Array | null;
    favicon?: Uint8Array | null;
  }> = {},
): `0x${string}` {
  const value = launchpadBrandingSchema.parse(input);
  const canonical = JSON.stringify({
    schemaVersion: value.schemaVersion,
    // The registry assigns launchpadId in the creation receipt. Ownership and
    // record identity remain bound by the signed branding message; excluding
    // the counter here makes the pre-deployment commitment race-free.
    slug: value.slug,
    name: value.name,
    description: value.description,
    primaryColor: value.primaryColor,
    backgroundColor: value.backgroundColor,
    foregroundColor: value.foregroundColor,
    websiteUrl: value.websiteUrl,
    xUrl: value.xUrl,
    logoSha256: assets.logo
      ? createHash("sha256").update(assets.logo).digest("hex")
      : null,
    faviconSha256: assets.favicon
      ? createHash("sha256").update(assets.favicon).digest("hex")
      : null,
  });
  return `0x${createHash("sha256").update(canonical).digest("hex")}`;
}
