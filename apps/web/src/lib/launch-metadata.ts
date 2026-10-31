const MAX_LOGO_BYTES = 20_000;

export async function prepareLaunchLogo(file: File): Promise<{
  mime: "image/webp";
  base64: string;
  previewUrl: string;
}> {
  if (!file.type.startsWith("image/")) throw new Error("LOGO_FILE_INVALID");
  if (file.size > 5_000_000) throw new Error("LOGO_FILE_TOO_LARGE");
  const bitmap = await createImageBitmap(file);
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("LOGO_PROCESSING_UNAVAILABLE");
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
  let quality = 0.86;
  let blob: Blob | null = null;
  while (quality >= 0.35) {
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size <= MAX_LOGO_BYTES) break;
    quality -= 0.1;
  }
  if (!blob || blob.size > MAX_LOGO_BYTES)
    throw new Error("LOGO_COMPRESSION_FAILED");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    mime: "image/webp",
    base64: btoa(binary),
    previewUrl: URL.createObjectURL(blob),
  };
}
