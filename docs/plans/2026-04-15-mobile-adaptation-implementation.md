# Mobile Adaptation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a phone-ready experience for auth, lobby, matchmaking / room, and gameplay, all under one system-wide landscape semantic mobile standard.

**Architecture:** Keep `mode.js` responsible only for device and semantic viewport state, then scope mobile layout rules by page. Every main page must preserve landscape business semantics on phones, with portrait hold rendered as a mapped version of the same semantic layout. Inner modules must size from shared semantic edges rather than raw physical viewport units.

Implementation guardrail:
- for auth, lobby, matchmaking / room, and gameplay, only the outer landscape-semantic mapping layer may differ between portrait and landscape holds
- inner modules must not define a second portrait-only size system

**Tech Stack:** Vanilla HTML/CSS/JS, browser viewport emulation, Node test runner.

---

### Task 1: Capture the page-scoped mobile contract

**Files:**
- Modify: `daily-billiards-vanilla_web/src/layout/mode.js`
- Test: `daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add a focused assertion that body classes expose enough state to distinguish mobile portrait viewport from mobile landscape viewport while preserving the fixed landscape semantic mode for coarse-pointer devices.

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='coarse-pointer phones render landscape classes even before device rotation' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: the new assertion fails until the extra mobile contract is exposed.

**Step 3: Write minimal implementation**

Keep `applyLayoutMode()` setting semantic layout classes and expose viewport-orientation-specific CSS variables or classes needed by page-level mobile rules.

**Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='coarse-pointer phones render landscape classes even before device rotation' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: PASS

### Task 2: Make the lobby phone-ready first

**Files:**
- Modify: `daily-billiards-vanilla_web/style.css`
- Modify: `daily-billiards-vanilla_web/index.html`
- Test: `daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add assertions covering the lobby mobile contract:
- dedicated lobby panel remains intact
- portrait coarse-pointer lobby uses a full-height rotated landscape canvas
- the main lobby regions (`header`, `mode icons`, `stage`, `bottom nav`) all have portrait-mobile-specific rules

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='logged-in flow exposes lobby as a dedicated overlay view' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: FAIL after adding the stronger assertions.

**Step 3: Write minimal implementation**

Refactor lobby mobile CSS so portrait phones:
- minimize wasted black bars
- preserve all lobby actions
- keep the functional area visually dominant
- avoid clipping left rail, main cards, right rail, or bottom nav

**Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern='logged-in flow exposes lobby as a dedicated overlay view|coarse-pointer phones render landscape classes even before device rotation' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: PASS

**Step 5: Visual verification**

Use browser emulation for:
- `390x844` mobile portrait
- `844x390` mobile landscape

Expected:
- same lobby feature set in both holds
- no oversized black borders
- primary actions remain readable and tappable

### Task 3: Bring auth into the same semantic layout standard

**Files:**
- Modify: `daily-billiards-vanilla_web/style.css`
- Modify: `daily-billiards-vanilla_web/index.html`
- Test: `daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add assertions that auth view:
- is covered by the same coarse-pointer semantic layout contract as the rest of the game
- does not define a separate portrait-only inner size system
- keeps one consistent semantic size source across phone holds

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern='auth flow uses a dedicated mobile page shell without sharing lobby layout rules' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: FAIL after strengthening the assertions.

**Step 3: Write minimal implementation**

Refactor auth so it follows the same product-level semantic rule:
- same semantic layout logic across portrait and landscape holds
- no independent portrait-only sizing branch
- controls and panel rhythm derived from semantic edges
- still keep auth styling decoupled from lobby modules

**Step 4: Run test to verify it passes**

Run the targeted node test again.

Expected: PASS

### Task 4: Re-verify matchmaking / room under the shared semantic rule

**Files:**
- Modify: `daily-billiards-vanilla_web/style.css`
- Modify: `daily-billiards-vanilla_web/index.html`
- Modify: `daily-billiards-vanilla_web/src/ui/overlay-views.js`
- Test: `daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add assertions for matchmaking panel mobile layout rules and state content visibility.

**Step 2: Run test to verify it fails**

Run a targeted node test for matchmaking-related assertions.

Expected: FAIL

**Step 3: Write minimal implementation**

Make matchmaking read like a dedicated phone status page that still follows the shared system rule:
- keep lobby as the backdrop
- use a status layer aligned with the landscape semantic structure
- keep room status readable at a glance
- keep cancel / return action stable and reachable
- keep one shared semantic scale for the status layer across portrait and landscape holds

**Step 4: Run test to verify it passes**

Run the targeted node test again.

Expected: PASS

### Task 5: Make gameplay phone-ready under the shared semantic rule

**Files:**
- Modify: `daily-billiards-vanilla_web/style.css`
- Modify: `daily-billiards-vanilla_web/index.html`
- Modify: `daily-billiards-vanilla_web/src/ui/dom-ui.js`
- Test: `daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add assertions for phone portrait and landscape gameplay HUD rules:
- score boxes readable
- timers visible on active player only
- power bars and player metadata remain within viewport

**Step 2: Run test to verify it fails**

Run targeted gameplay-related tests.

Expected: FAIL

**Step 3: Write minimal implementation**

Rescope gameplay HUD rules by page state so the shared landscape semantic layout remains intact in both phone holds without clipping or unreadable controls.

**Step 4: Run test to verify it passes**

Run the targeted gameplay tests.

Expected: PASS

### Task 6: End-to-end phone verification

**Files:**
- Verify only

**Step 1: Manual verification**

Verify this chain in mobile portrait and landscape:
- auth
- lobby
- matchmaking / room
- gameplay

**Step 2: Command verification**

Run:
- `node --test --test-name-pattern='coarse-pointer phones render landscape classes even before device rotation|logged-in flow exposes lobby as a dedicated overlay view' daily-billiards-vanilla_web/network-sync.test.mjs`

Expected: PASS

**Step 3: Browser verification**

Use browser emulation screenshots for:
- lobby portrait
- lobby landscape
- auth portrait
- matchmaking portrait
- gameplay portrait and landscape

Expected:
- no clipped key controls
- no oversized black borders for auth, lobby, matchmaking, or gameplay
- tappable controls remain reachable
