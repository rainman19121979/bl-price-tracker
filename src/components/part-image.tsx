"use client";

import { useState } from "react";
import Image from "next/image";

interface PartImageProps {
  partNo: string;
  colorId: number;
  itemType?: string; // PART, MINIFIG, SET
  size?: "sm" | "md" | "lg";
  className?: string;
}

// BrickLink image URL patterns:
// PART:    PN/{colorId}/{partNo}.png
// MINIFIG: MN/0/{partNo}.png
// SET:     SN/0/{partNo}.png

function buildImageUrl(partNo: string, colorId: number, itemType: string): string {
  switch (itemType) {
    case "MINIFIG":
      return `https://img.bricklink.com/ItemImage/MN/0/${partNo}.png`;
    case "SET":
      return `https://img.bricklink.com/ItemImage/SN/0/${partNo}.png`;
    default: // PART
      return `https://img.bricklink.com/ItemImage/PN/${colorId}/${partNo}.png`;
  }
}

export function PartImage({ partNo, colorId, itemType = "PART", size = "md", className }: PartImageProps) {
  const [error, setError] = useState(false);
  const sizeMap = { sm: 20, md: 32, lg: 96 };
  const px = sizeMap[size];
  const url = buildImageUrl(partNo, colorId, itemType);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center rounded bg-gray-100 text-[8px] text-gray-400 shrink-0 ${className || ""}`}
        style={{ width: px, height: px }}
      >
        {partNo.slice(0, 5)}
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt={partNo}
      width={px}
      height={px}
      loading="lazy"
      unoptimized={size === "sm"}
      onError={() => setError(true)}
      className={`rounded object-contain bg-white shrink-0 ${className || ""}`}
      style={{ width: px, height: px }}
    />
  );
}
