/* Service worker for Sheep It.
 *
 * Pushes carry no payload (encrypting one needs crypto the stdlib-only
 * gateway cannot do), so on wake we fetch the agent list ourselves and
 * describe whatever is no longer working. */

const IDLE = ["idle", "done", "blocked"];

/* The home screen icon itself is frozen at install time - iOS snapshots it and
   never asks again - so the badge is the only part of it that can still say
   something. It carries the number of agents waiting on you. Badges need the
   same notification permission as this push, so by the time we are here it is
   granted. */
async function setBadge(count) {
  try {
    if (!("setAppBadge" in self.navigator)) return;
    if (count > 0) await self.navigator.setAppBadge(count);
    else await self.navigator.clearAppBadge();
  } catch (err) {
    /* badge unsupported or permission revoked mid-flight */
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let title = "Agent finished";
      let body = "An agent is waiting for you.";

      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        const data = await res.json();
        const done = (data.agents || []).filter(
          (a) => a.has_agent && IDLE.includes(a.status)
        );
        await setBadge(done.length);
        if (done.length === 1) {
          title = done[0].name || "Agent finished";
          body = done[0].title || `${done[0].status} — tap to open`;
        } else if (done.length > 1) {
          title = `${done.length} agents waiting`;
          body = done.map((a) => a.name).join(", ");
        }
      } catch (err) {
        /* offline or gateway down: the generic text above still fires */
      }

      await self.registration.showNotification(title, {
        body,
        tag: "herdr-agent",       // collapse repeats into one notification
        renotify: true,
        icon: "/icon.svg",
        badge: "/icon.svg",
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    })()
  );
});
