# Remove Rotate Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the mobile portrait rotate-device prompt so the game always renders with landscape semantics.

**Architecture:** Keep the existing landscape-semantic mobile layout classes and direct-coordinate gameplay behavior. Delete the rotate overlay markup and portrait-only hide rules, then update the regression tests to assert the UI remains visible in portrait coarse-pointer viewports.

**Tech Stack:** HTML, CSS, Node test runner

---

### Task 1: Replace the rotate-overlay regression with the new expected behavior

**Files:**
- Modify: `network-sync.test.mjs`

**Step 1: Write the failing test**

Update the portrait mobile regression to assert:
- `index.html` does not contain `rotate-device-overlay`
- `style.css` does not contain `#rotate-device-overlay`
- portrait coarse-pointer rules do not hide `#ui-layer` or `#app-wrapper`

**Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "portrait coarse-pointer viewports keep the landscape-semantic UI visible without a rotate prompt" network-sync.test.mjs`
Expected: FAIL because the overlay and hide rules still exist.

**Step 3: Write minimal implementation**

Remove the rotate overlay markup and the related CSS selectors.

**Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern "portrait coarse-pointer viewports keep the landscape-semantic UI visible without a rotate prompt" network-sync.test.mjs`
Expected: PASS

### Task 2: Run broader regression coverage

**Files:**
- Verify: `network-sync.test.mjs`

**Step 1: Run targeted landscape-semantic regressions**

Run: `node --test --test-name-pattern "coarse-pointer phones render landscape classes even before device rotation|mobile landscape gameplay uses direct canvas coordinates without wrapper rotation|portrait coarse-pointer viewports keep the landscape-semantic UI visible without a rotate prompt" network-sync.test.mjs`
Expected: PASS
