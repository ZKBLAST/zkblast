"use client";

import { CircleDashed } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function isNearlySquare(width: number, height: number) {
  if (width <= 0 || height <= 0) return false;
  const ratio = width / height;
  return ratio >= 0.9 && ratio <= 1.1;
}

export function completedImageState(
  image: Pick<HTMLImageElement, "complete" | "naturalWidth">,
) {
  if (!image.complete) return "loading";
  return image.naturalWidth > 0 ? "ready" : "failed";
}

type Props = { url: string | null; label: string; className?: string };

export function AssetLogo(props: Props) {
  return <LogoImage key={props.url ?? "missing"} {...props} />;
}

function LogoImage({ url, label, className = "" }: Props) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState(url ? "loading" : "failed");
  const [square, setSquare] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !url) return;
    const status = completedImageState(image);
    if (status !== "loading") {
      setStatus(status);
      setSquare(isNearlySquare(image.naturalWidth, image.naturalHeight));
      return;
    }
    const timeout = window.setTimeout(() => {
      setStatus(completedImageState(image) === "ready" ? "ready" : "failed");
      setSquare(isNearlySquare(image.naturalWidth, image.naturalHeight));
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [url]);

  return (
    <span
      className={`${className} grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-white bg-white`}
      title={label}
      aria-label={label}
      aria-busy={status === "loading"}
    >
      <span className="relative grid size-full place-items-center overflow-hidden rounded-full">
        {url && status !== "failed" ? (
          <>
            {status === "loading" && (
              <span
                className="logo-shimmer absolute inset-0 rounded-full"
                aria-hidden="true"
              />
            )}
            <img
              ref={imageRef}
              src={url}
              alt=""
              referrerPolicy="no-referrer"
              className={`${square ? "size-full scale-[1.08] object-cover" : "size-full object-contain p-1"} transition-opacity duration-200 ${status === "ready" ? "opacity-100" : "opacity-0"}`}
              onLoad={(event) => {
                setSquare(
                  isNearlySquare(
                    event.currentTarget.naturalWidth,
                    event.currentTarget.naturalHeight,
                  ),
                );
                setStatus("ready");
              }}
              onError={() => setStatus("failed")}
            />
          </>
        ) : (
          <CircleDashed className="size-4 text-black" aria-hidden="true" />
        )}
      </span>
    </span>
  );
}
