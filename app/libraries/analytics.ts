import { useEffect } from "react";

import { TOKEN_STORAGE_KEY } from "@/libraries/admin-api";

/**
 * Umami's tracker, which the server adds to the page only when analytics are
 * set up (pkg/server/analytics.go). It records pageviews, including route
 * changes, on its own. Without it, events go nowhere.
 */
declare global {
  interface Window {
    umami?: {
      track: (event?: string, data?: Record<string, string>) => void;
      identify: (id: string) => Promise<void>;
    };
    /** Named by the tracker tag's data-before-send attribute. */
    umamiBeforeSend?: (
      type: string,
      payload: Record<string, unknown>,
    ) => Record<string, unknown>;
  }
}

const VISITOR_STORAGE_KEY = "analytics_visitor";
/** Umami's distinct ID column holds 50 characters. */
const VISITOR_MAX_LENGTH = 50;

/** The name this page load has announced with umami.identify. */
let announcedVisitor: string | null = null;
/** Who this page load's last send was labeled as, and on which page. */
let lastSent: { visitor: string | null; url: unknown } | undefined;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Records something a visitor did, as "Category: action" (like "FAQ: open").
 * Umami truncates event names past 50 characters, so keep them short and put
 * detail in data.
 */
export function trackEvent(
  category: string,
  action: string,
  data?: Record<string, string>,
): void {
  window.umami?.track(`${category}: ${action}`, data);
}

/**
 * Labels everything this browser sends with a guest's name from now on, across
 * reloads and return visits, so Umami shows who did what. A browser signed in
 * to the admin is skipped: the couple opens guests' links, and those visits
 * aren't the guest's.
 */
export function identifyVisitor(name: string): void {
  if (readStorage(TOKEN_STORAGE_KEY) !== null) {
    return;
  }
  const visitor = name.slice(0, VISITOR_MAX_LENGTH);
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, visitor);
  } catch {
    // Ignore storage failures (e.g. private mode); the visit stays anonymous.
    return;
  }
  // A guest link's pageview usually goes out before the guest's name arrives, and
  // Umami keeps anonymous and named activity in separate sessions. Those pages
  // may send nothing else, so record the page again under the name, or the guest
  // who opens a link, fills it in, and leaves would stay anonymous. A send from
  // another page means this page's own pageview is still on its way, and it will
  // pick up the name.
  if (lastSent?.visitor !== visitor && lastSent?.url === location.href) {
    window.umami?.track();
  }
}

/** Stops labeling this browser, for when it stops being that guest's. */
export function forgetVisitor(): void {
  try {
    localStorage.removeItem(VISITOR_STORAGE_KEY);
  } catch {
    // Ignore storage failures; there is nothing useful to do about them.
  }
}

/** Identifies the visitor once a page has loaded the guest's name. */
export function useIdentifyVisitor(name: string | undefined): void {
  useEffect(() => {
    if (name) {
      identifyVisitor(name);
    }
  }, [name]);
}

// The tracker calls this on every send. Going through it rather than only
// umami.identify means there's nothing to replay on each page load, when the
// tracker loads at its own pace, so a return visit is labeled from the start (bar
// the rare load where a cached tracker runs before this module does).
//
// The name on an event labels its session, but Umami only stitches a person's
// sessions together (a new one comes with each IP address, device, and month)
// from an identify, so each page load also sends one. The tracker runs this hook
// for that send too, which is why identify sends don't announce again. An
// explicit undefined clears a forgotten visitor, since the tracker keeps the
// last name it was told until the page reloads.
window.umamiBeforeSend = (type, payload) => {
  const visitor =
    readStorage(TOKEN_STORAGE_KEY) === null
      ? readStorage(VISITOR_STORAGE_KEY)
      : null;
  if (type !== "identify") {
    lastSent = { visitor, url: payload.url };
    if (visitor && visitor !== announcedVisitor) {
      announcedVisitor = visitor;
      void window.umami?.identify(visitor);
    }
  }
  if (!visitor) {
    announcedVisitor = null;
  }
  return { ...payload, id: visitor ?? undefined };
};
