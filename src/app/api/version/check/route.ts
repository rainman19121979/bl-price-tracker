import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { redis } from "@/lib/redis";
import { rateLimit } from "@/lib/rate-limit";
import { isVersionNewer } from "@/lib/semver-compare";
import pkg from "../../../../../package.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_KEY = "app:version-check";
const CACHE_TTL_SEC = 6 * 3600; // 6h
const GITHUB_TIMEOUT_MS = 5000;
const REPO = "rainman19121979/bl-price-tracker";

interface CheckResponse {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  error?: string;
}

/**
 * Admin-only: prueft ob eine neuere Release-Version auf GitHub existiert.
 * 6h Redis-Cache -- typischerweise 4 GitHub-Requests/Tag, weit unter dem
 * anonymen 60/h/IP-Limit.
 * Zusaetzlicher Rate-Cap 10/h pro Admin (falls jemand den Cache umgehen will).
 * Netzwerk-Fehler oder GitHub-Ausfaelle → hasUpdate:false + error-Feld,
 * UI zeigt dann nur die aktuelle Version ohne Badge.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = session.user.id;
  const rl = await rateLimit(`version-check:${userId}`, 10, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Zu viele Update-Checks. Warte ${rl.resetSec}s.` },
      { status: 429 }
    );
  }

  const current = pkg.version;

  // Cache-Hit
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CheckResponse;
      // "current" ueberschreiben -- wenn die App-Version zwischen Cache-Writes
      // hochgezogen wurde, sollte hasUpdate frisch berechnet werden.
      parsed.current = current;
      parsed.hasUpdate = parsed.latest ? isVersionNewer(parsed.latest, current) : false;
      return NextResponse.json(parsed);
    }
  } catch {
    // Redis-Ausfall → weiter zu GitHub
  }

  // Cache-Miss → GitHub API
  let response: CheckResponse = {
    current, latest: null, hasUpdate: false,
    releaseUrl: null, releaseName: null, publishedAt: null,
  };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GITHUB_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        {
          signal: ctrl.signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "bl-price-tracker-update-check",
          },
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const data = await res.json() as {
        tag_name?: string; name?: string; html_url?: string; published_at?: string;
      };
      const latest = data.tag_name ?? null;
      response = {
        current,
        latest,
        hasUpdate: latest ? isVersionNewer(latest, current) : false,
        releaseUrl: data.html_url ?? null,
        releaseName: data.name ?? latest,
        publishedAt: data.published_at ?? null,
      };
    } else if (res.status === 404) {
      response.error = "Noch keine Releases auf GitHub veroeffentlicht";
    } else {
      response.error = `GitHub API ${res.status}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    response.error = msg.includes("aborted") ? "GitHub-Timeout" : `Netzwerkfehler: ${msg}`;
  }

  // Cache auch die Fehler-Antwort (kurz), damit ein GitHub-Ausfall nicht
  // jedes UI-Reload zu einem Retry fuehrt.
  try {
    const cacheTtl = response.error ? 300 : CACHE_TTL_SEC; // 5 Min bei Fehler
    await redis.setex(CACHE_KEY, cacheTtl, JSON.stringify(response));
  } catch {
    // Redis-Ausfall → weiter, nicht kritisch
  }

  return NextResponse.json(response);
}
