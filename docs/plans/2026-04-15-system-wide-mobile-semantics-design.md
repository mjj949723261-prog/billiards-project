# System-Wide Mobile Semantics Design

**Date:** 2026-04-15

## Goal

Make the entire game product follow one mobile adaptation standard:

- auth
- lobby
- matchmaking / room state
- gameplay

Every main page must preserve the same landscape semantic layout on phones, regardless of whether the player is physically holding the device in portrait or landscape.

## Product Rule

This is a system rule, not a page exception.

For every game-facing page:

1. The business layout is defined in landscape semantics.
2. Landscape device hold renders that semantic layout directly.
3. Portrait device hold renders the same semantic layout mapped into the real viewport.
4. Inner modules must keep one semantic size system.
5. No page may introduce a second portrait-only size system for the same controls.

This means a player should feel that the whole product is one consistent game, not a set of unrelated responsive pages.

## Why This Direction

### Option A: System-wide single semantic layer

Use one landscape semantic layout model for all main pages, then map it into the real phone viewport.

Pros:
- consistent visual hierarchy across the whole game
- stable control size and placement across device holds
- easier to extend to future lobby, room, and gameplay states
- avoids page-by-page drift

Cons:
- requires stricter discipline in CSS and layout scoping
- more up-front cleanup

### Option B: Page-by-page mobile adaptation

Let each page define its own portrait and landscape behavior.

Pros:
- faster for one isolated page

Cons:
- breaks product consistency
- creates different sizing logic for similar controls
- increases regression risk each time a page is touched

### Option C: Fixed canvas scale-to-fit

Build a desktop-like scene and scale it into the phone viewport.

Pros:
- fast to mock

Cons:
- creates thumbnail feel
- produces black bars
- makes controls unstable across phone sizes
- not acceptable for a production mobile game

**Decision:** Use Option A.

## Layout Model

### Outer layer

The outer layer reads:

- pointer type
- physical viewport width and height
- physical orientation

For coarse-pointer phones, the outer layer always enables landscape semantic mode for game pages.

It also derives:

- semantic long edge
- semantic short edge

Rules:

- in physical landscape, semantic long edge = physical width
- in physical landscape, semantic short edge = physical height
- in physical portrait, semantic long edge = physical height
- in physical portrait, semantic short edge = physical width

### Inner layer

The inner layer must size from semantic edges, not raw physical `vw` or `vh`, except for true full-screen containers.

Allowed:
- full-page containers using `100vw` / `100vh`
- derived CSS custom properties based on semantic edges
- page-scoped modules reading shared semantic variables

Forbidden:
- direct raw `vw` / `vh` on game-like inner modules
- separate portrait-only size overrides for buttons, rails, cards, or HUD elements
- nested orientation logic inside page modules

## Page Design

### Auth

Auth now becomes part of the same system rule.

That means:
- it is no longer treated as a normal mobile web form page
- its visual structure must still be authored in landscape semantics
- portrait phones must show the same semantic structure mapped into the viewport
- button scale, card scale, spacing rhythm, and hierarchy must remain consistent across holds

Auth may keep its own component styling, but it may not use a separate orientation-specific size system.

### Lobby

Lobby remains the reference page for the system.

Requirements:
- full-screen functional area
- stable header, rail, stage, side modes, and bottom nav
- same semantic sizing in both phone holds
- no thumbnail feel

### Matchmaking / Room

Matchmaking remains layered over lobby context.

Requirements:
- share lobby direction semantics
- same semantic size logic as lobby
- no generic centered web modal behavior
- readable room state, room ID, and cancel action in both holds

### Gameplay

Gameplay is the strictest page.

Requirements:
- preserve gameplay landscape semantics
- readable timers, score, turn status, power, and player identity
- no clipped HUD
- same semantic sizing in both holds

## Architecture Boundaries

To keep coupling low:

- `src/layout/mode.js` owns only device and semantic viewport state
- page HTML owns structure
- page CSS owns page-scoped layout rules
- page controllers own state and interactions

No page should encode semantic-orientation math in business logic.

## Verification Standard

A page is not complete unless:

1. Portrait and landscape phone holds show the same semantic layout.
2. The page fills the screen as a real product page.
3. No large meaningless black bars remain.
4. Same-class controls keep the same semantic scale across holds.
5. Key actions remain reachable and readable.
6. Targeted tests cover page-specific mobile layout assertions.
7. Browser verification confirms the rendered result, not just DOM structure.

## Execution Order

1. Upgrade shared documentation and tests to treat this as a system rule.
2. Bring auth into the same semantic layout standard.
3. Re-verify matchmaking / room against the same rule.
4. Rework gameplay HUD and stage layout under the same rule.
5. Run portrait and landscape phone verification across the whole flow.
