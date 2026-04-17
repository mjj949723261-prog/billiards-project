# Mobile Adaptation Rules

## Goal

Deliver a phone-ready product, not a demo-only responsive page.

The mobile experience must satisfy these rules:

1. All key flows must be usable on real phones:
   - auth
   - lobby
   - matchmaking / room state
   - gameplay
2. The UI must adapt to the real viewport, not to a fixed demo canvas.
3. Horizontal gameplay semantics remain consistent across device holds.
4. No page may degrade into a thumbnail-like layout with oversized black bars.

## System-Level Layout Norm

This is the design norm for the whole game system, not just for the lobby.

For all game-like primary views:
- lobby
- matchmaking / room state
- gameplay
- future main in-game hub pages

the product must preserve a landscape semantic layout.

That means:
- device holding direction does not redefine the business layout
- landscape hold shows the semantic layout directly
- portrait hold still shows the same semantic layout mapped into the real viewport
- mobile adaptation starts from the real screen container, then distributes child regions inside it

This must be treated as a system rule, not as a page-specific exception.

## Core Principles

### 1. Screen-first, not fixed-canvas-first

Phone layouts must start from the actual viewport.

Correct approach:
- let the page container fill the screen first
- then allocate space to top, main, side, and bottom regions
- then size child modules inside those regions

Avoid:
- building a fixed-size desktop canvas first
- scaling or rotating the entire page until it fits

### 2. Fixed landscape semantics for game-like views

Lobby, matchmaking / room state, and gameplay are game-like views.

They should keep landscape semantic organization:
- profile / status area
- main stage area
- side actions
- bottom navigation or controls

This does **not** mean a fixed pixel canvas.
It means the same gameplay information hierarchy is preserved in both portrait and landscape phone holds.

Mandatory rule:
- if a game-like view uses landscape semantic mapping, that mapping is the only orientation adaptation layer allowed
- inner modules must not introduce a second orientation-specific size system
- buttons, titles, status blocks, room cards, and action areas must keep one shared semantic scale across device holds

Semantic edge rule:
- for game-like primary views, inner mobile sizing must be based on semantic long-edge and semantic short-edge measurements
- when the phone is held in landscape, semantic long-edge equals the physical width and semantic short-edge equals the physical height
- when the phone is held in portrait but the page still uses landscape semantics, semantic long-edge equals the physical height and semantic short-edge equals the physical width
- the same button group, rail, badge, icon row, hero card, and bottom navigation item must size from semantic edges, not from raw physical `vw` / `vh`

Forbidden:
- mapping the outer container for portrait phones and then re-scaling or re-laying out inner modules again
- keeping one landscape size system and a separate portrait-only inner size system for the same game-like component
- letting the same button or status element change visual scale just because the phone was physically rotated
- using raw physical `vw` / `vh` inside game-like inner modules when the intended size source should be semantic long-edge / short-edge

### 3. Page-scoped mobile rules

Mobile adaptation must be scoped per page:
- auth page
- lobby page
- matchmaking / room page
- gameplay page

Do not let one page's mobile fixes leak into another page's layout.

### 4. Real-phone range

The baseline phone range is:
- portrait width: `360px` to `430px`
- landscape height: common small-screen phone heights

At minimum, verify:
- `360x800`
- `390x844`
- `430x932`
- landscape equivalents

## Page Rules

### Auth page

Auth is a true mobile page, not a desktop modal squeezed onto a phone.

Requirements:
- stable input widths
- clear button hierarchy
- readable error state
- no awkward desktop panel feel on phones

### Lobby page

Lobby is a full-screen game hub.

Requirements:
- fill the phone screen first
- keep the functional area dominant
- avoid thumbnail feel
- preserve all lobby actions in both portrait and landscape
- keep the same landscape semantic information hierarchy

Implementation rule:
- portrait phones may rotate the semantic layout
- but the layout must still be derived from the full-screen container
- not from a fixed `844x390`-style canvas

### Matchmaking / room page

The room state is a dedicated phone state page.

Requirements:
- status is readable at a glance
- room id / waiting status is obvious
- cancel action is stable and reachable
- success, waiting, and error states are clearly separated

Current implementation rule:
- keep the lobby visible as the background context
- present matchmaking / room state as a dedicated status layer that follows the same landscape semantic direction as the lobby
- dim and blur the lobby behind it so the state dialog is dominant
- do not collapse back into a tiny generic modal with only one line of text
- do not use a generic web-style centered popup that ignores the lobby's directional structure
- do not create a portrait-only internal sizing scheme for the matchmaking layer; it must share the same semantic scale logic as the landscape state

### Gameplay page

Gameplay is the highest-priority phone experience.

Requirements:
- preserve landscape semantic gameplay layout
- keep timers, score, power, and player identity readable
- no clipped HUD
- no inaccessible actions
- portrait hold must remain fully usable, not broken

## Verification Standard

Do not mark a page complete unless all of the following are true:

1. The page works in portrait and landscape phone holds.
2. The page fills the screen as a product page, not as a shrunk mockup.
3. Key actions remain reachable and readable.
4. There are no large meaningless black bars.
5. The page has targeted test coverage or targeted mobile layout assertions.
6. For game-like views, portrait and landscape holds must share one semantic size system; only the outer mapping layer may differ.

## Current Implementation Direction

Current agreed direction:
- auth, lobby, matchmaking / room, and gameplay all use the same landscape semantic rule
- all of them adapt to the real phone viewport
- physical portrait hold still renders the same landscape business layout mapped into the viewport
- mobile layout starts from the screen container, not from a fixed-size scene
- inner modules on every main page must size from semantic long-edge / short-edge variables, not raw physical `vw` / `vh`
