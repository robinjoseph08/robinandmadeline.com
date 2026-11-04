# Guest identity in self-hosted analytics

Web analytics go to our self-hosted Umami through a same-origin proxy at `/stats`, and they deliberately include guest links (`/i/{info_token}`, `/u/{guestID}`), page titles with guest names, and a guest's name on each event once we know it. This is an exception to how we otherwise treat those values: database telemetry keeps Info Tokens and guest IDs out of its labels, and ADR 0003 and ADR 0009 treat them as credentials. Seeing who did what on the site is the point of having analytics for a guest list this small, and we run Umami ourselves, so the stored data stays with us. Cloudflare sits in front of our Umami and terminates TLS, so it can read these events in transit; we accept that for the same reason we use it for other self-hosted services. The cost is that access to the Umami dashboard is equivalent to holding those links, so it gets the same care as the admin.

Admin pages are the one thing held back, enforced in the proxy rather than the tracker so it holds whatever the tracker version does. The proxy also stops Umami's response headers from reaching visitors, because Cloudflare in front of Umami adds ones that would apply to this site's whole origin, such as telling browsers to send it reports about this site's network errors.

## Considered Options

- **Replacing tokens and names with route shapes before sending:** rejected; it was built first and removed, since it answers "what do guests do" but not "who did this", which is the question we want answered.
- **Calling Umami directly from the browser:** rejected; it exposes Umami's address and makes the admin exclusion and the visitor's real address depend on the client.
