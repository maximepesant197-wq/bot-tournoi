---
name: Discord tournament runtime
description: Operational constraints for the Discord tournament bot.
---

The Discord bot requires the privileged Guild Members intent for member selection, role assignment, and private referee-thread membership; role-based Staff and Arbiter access is configured separately from Administrator access.

**Why:** Discord UI components and guild member APIs do not provide an unrestricted server-side member picker without the relevant intent, and permission checks must remain explicit at every interaction.

**How to apply:** Keep Discord permissions centralized and re-check the acting member on every button, menu, modal, and command; treat missing privileged intents or role IDs as configuration failures, not as authorization fallbacks.

Destructive actions must stay scoped: team deletion removes the team’s Discord resources and linked registration, tournament deletion resets tournament data while preserving teams, and member removal protects Staff/Admin, bots, and team captains.

**Why:** These resources have different ownership and lifecycle boundaries; combining them can accidentally remove a team’s private Discord setup or leave an invalid captain state.

**How to apply:** Give each destructive scope its own Staff panel action and confirmation, then revalidate the target and permissions immediately before mutating Discord or PostgreSQL state.