# Mobile Landscape Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the mobile web adaptation so the whole game keeps a single landscape-semantic layout and no longer relies on full-page CSS rotation.

**Architecture:** Preserve the current visual styling, but remove the portrait-viewport rotation layer and the matching input compensation logic. Mobile should behave like a scaled landscape desktop layout; portrait phones should show a rotate-device prompt instead of rotating the app shell.

**Tech Stack:** Vanilla JS, CSS, Pixi.js, Node test runner

---

### Task 1: Lock the intended mobile behavior in tests

**Files:**
- Modify: `network-sync.test.mjs`
- Test: `network-sync.test.mjs`

**Step 1: Write the failing test**

Add tests that assert:
- coarse-pointer phones still get `layout-landscape`
- portrait phones no longer rely on rotated `#app-wrapper`
- portrait phones expose a rotate prompt container

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "portrait phones show rotate prompt instead of rotating the app shell|semantic mobile landscape in a portrait viewport does not rotate the app wrapper" network-sync.test.mjs`

Expected: FAIL because the current CSS still rotates the shell and the prompt does not exist.

**Step 3: Write minimal implementation**

Add the smallest HTML/CSS/layout updates needed for the tests to pass.

**Step 4: Run test to verify it passes**

Run the same command and confirm both tests pass.

### Task 2: Remove portrait-shell rotation and unify mobile layout rules

**Files:**
- Modify: `style.css`
- Modify: `index.html`

**Step 1: Replace the rotated-shell rules**

Remove the `rotate(90deg)` handling for:
- `#app-wrapper`
- `.auth-shell`
- `.matchmaking-shell`
- `.lobby-shell`

Introduce a rotate-device overlay shown only for coarse-pointer portrait viewports.

**Step 2: Keep the current visual style**

Retain the existing backgrounds, panels, and HUD look while converting layout sizing to landscape-scaled rules.

**Step 3: Run targeted tests**

Run: `node --test --test-name-pattern "portrait phones show rotate prompt instead of rotating the app shell|coarse-pointer phones render landscape classes even before device rotation" network-sync.test.mjs`

Expected: PASS

### Task 3: Simplify input mapping back to direct canvas coordinates

**Files:**
- Modify: `src/game.js`
- Test: `network-sync.test.mjs`

**Step 1: Write/update the failing test**

Replace the current rotated-coordinate expectation with a direct canvas-mapping expectation for the new model.

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "mobile landscape gameplay uses direct canvas coordinates without wrapper rotation" network-sync.test.mjs`

Expected: FAIL until `updatePos()` is simplified.

**Step 3: Write minimal implementation**

Remove the portrait semantic-rotation compensation branch in `updatePos()` so input uses the same coordinate path as desktop gameplay.

**Step 4: Run test to verify it passes**

Run the same command and confirm PASS.

### Task 4: Verify the rebuilt mobile flow end-to-end

**Files:**
- Modify: `src/layout/mode.js` if needed
- Verify manually in browser emulation

**Step 1: Run focused regression checks**

Run:
- `node --test --test-name-pattern "coarse-pointer phones render landscape classes even before device rotation|portrait phones show rotate prompt instead of rotating the app shell|mobile landscape gameplay uses direct canvas coordinates without wrapper rotation" network-sync.test.mjs`

Expected: PASS

**Step 2: Manually verify in browser emulation**

Check:
- portrait phone shows rotate prompt
- landscape phone shows gameplay without shell rotation
- gameplay canvas and HUD preserve current visual style

**Step 3: Commit**

```bash
git add docs/plans/2026-04-16-mobile-landscape-rewrite.md index.html style.css src/game.js src/layout/mode.js network-sync.test.mjs
git commit -m "refactor: rebuild mobile landscape web adaptation"
```
