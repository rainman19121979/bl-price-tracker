import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

interface ImportedPart {
  partNo: string;
  colorId: number;
}

function parseBSX(xmlText: string): ImportedPart[] {
  const parts: ImportedPart[] = [];
  // Match <Item> blocks in BSX XML
  const itemRegex = /<Item>[\s\S]*?<\/Item>/g;
  const itemNoRegex = /<ItemID>(.*?)<\/ItemID>/;
  const colorRegex = /<ColorID>(.*?)<\/ColorID>/;

  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const block = match[0];
    const itemNoMatch = itemNoRegex.exec(block);
    const colorMatch = colorRegex.exec(block);

    if (itemNoMatch?.[1]) {
      const partNo = itemNoMatch[1].trim();
      const colorId = colorMatch?.[1] ? parseInt(colorMatch[1].trim()) : 0;
      if (partNo && !isNaN(colorId)) {
        parts.push({ partNo, colorId });
      }
    }
  }

  return parts;
}

function parseCSV(csvText: string): ImportedPart[] {
  const parts: ImportedPart[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length < 2) return parts;

  // Parse header to find column indices
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const partNoIdx = header.findIndex(
    (h) => h === "part_no" || h === "partno" || h === "item_id" || h === "itemid"
  );
  const colorIdIdx = header.findIndex(
    (h) => h === "color_id" || h === "colorid" || h === "color"
  );

  if (partNoIdx === -1) {
    throw new Error(
      "CSV must have a column named part_no, partno, item_id, or itemid"
    );
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const partNo = cols[partNoIdx];
    const colorId = colorIdIdx >= 0 ? parseInt(cols[colorIdIdx]) : 0;

    if (partNo && !isNaN(colorId)) {
      parts.push({ partNo, colorId });
    }
  }

  return parts;
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "A file is required" },
      { status: 400 }
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: "File must not be empty" },
      { status: 400 }
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File must be smaller than 5 MB" },
      { status: 400 }
    );
  }

  const text = await file.text();
  let importedParts: ImportedPart[];

  try {
    // Detect format: BSX (XML) vs CSV
    const isBSX =
      file.name.endsWith(".bsx") ||
      file.name.endsWith(".xml") ||
      text.trimStart().startsWith("<");

    if (isBSX) {
      importedParts = parseBSX(text);
    } else {
      importedParts = parseCSV(text);
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to parse file",
        details: error instanceof Error ? error.message : "Unknown parse error",
      },
      { status: 400 }
    );
  }

  if (importedParts.length === 0) {
    return NextResponse.json(
      { error: "No valid parts found in file" },
      { status: 400 }
    );
  }

  // Deduplicate by partNo+colorId
  const seen = new Set<string>();
  const uniqueParts = importedParts.filter((p) => {
    const key = `${p.partNo}:${p.colorId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let addedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (const { partNo, colorId } of uniqueParts) {
    try {
      // Upsert part
      let part = await prisma.part.findUnique({
        where: {
          partNo_colorId_itemType: { partNo, colorId, itemType: "PART" },
        },
      });

      if (!part) {
        part = await prisma.part.create({
          data: { partNo, colorId, itemType: "PART" },
        });
      }

      // Check if already on watchlist (manual entry without BL lot ID)
      const existing = await prisma.userWatchlist.findFirst({
        where: { userId, partId: part.id, newOrUsed: "U", blInventoryId: null },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      // Add to watchlist with newOrUsed="U" (file import doesn't know condition)
      await prisma.userWatchlist.create({
        data: { userId, partId: part.id, newOrUsed: "U" },
      });
      // Crawler picks stale parts dynamically from user_watchlists — no queue needed.
      addedCount++;
    } catch (error) {
      errors.push(
        `${partNo}/${colorId}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return NextResponse.json({
    message: `Import complete: ${addedCount} parts added, ${skippedCount} already on watchlist`,
    totalInFile: uniqueParts.length,
    added: addedCount,
    skipped: skippedCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}
