# Two tokens per party: info token and RSVP code

Each party has two independent credentials: a random, opaque `info_token` used in the pre-invitation info-collection URL, and a memorable `rsvp_code` (e.g. KALEL) revealed on the printed invitation and used to authenticate the RSVP flow. When the couple does not pick a personalized code, a random five-letter one (drawn from a no-vowel alphabet that avoids confusable letters and accidental words) is generated when the party is created.

They are kept separate because info collection happens months before invitations are mailed, while the RSVP code is meant to be a surprise that guests first encounter in print, so it must not leak through the earlier info-collection link.
