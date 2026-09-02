---
name: Discord tournament runtime
description: Operational constraints for the Discord tournament bot.
---

The Discord bot requires the privileged Guild Members intent for member selection, role assignment, and private referee-thread membership; role-based Staff and Arbiter access is configured separately from Administrator access.

**Why:** Discord UI components and guild member APIs do not provide an unrestricted server-side member picker without the relevant intent, and permission checks must remain explicit at every interaction.

**How to apply:** Keep Discord permissions centralized and re-check the acting member on every button, menu, modal, and command; treat missing privileged intents or role IDs as configuration failures, not as authorization fallbacks.