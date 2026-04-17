# Club Table Realism Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the gameplay table to a realistic club-style wooden billiards table without changing table geometry, physics, or mobile semantic layout behavior.

**Architecture:** Keep the current `2:1` table geometry and stage fitting logic intact. Improve realism by layering static visual treatments in the Pixi static table renderer and mirroring the same hierarchy in the Canvas fallback renderer. Protect the work with focused render-contract tests so later UI changes do not flatten the table back into simple color blocks.

**Tech Stack:** Vanilla JS, PixiJS, Canvas 2D fallback, Node test runner

---

### Task 1: Lock the render contract in tests

**Files:**
- Modify: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`
- Test: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add assertions that require:
- Pixi static table rendering to include distinct wood border, cloth sprite, cushion layer, and pocket edge treatment
- Canvas fallback rendering to include layered wood, cloth, cushion, and pocket shading sections

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern='club table realism render contract' /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
```

Expected: FAIL because the new realism-specific signatures are not fully present yet.

**Step 3: Write minimal implementation**

Add targeted regex-based assertions that describe the intended visual layers without overspecifying exact color values.

**Step 4: Run test to verify it passes**

Run the same command and confirm PASS.

**Step 5: Commit**

```bash
git add /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
git commit -m "test: lock club table realism render contract"
```

### Task 2: Upgrade the Pixi static table to club-style realism

**Files:**
- Modify: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/pixi-renderer.js`
- Modify: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/constants.js`
- Test: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Ensure the render-contract test expects:
- layered wood border treatment
- richer cloth texture usage
- more dimensional cushions
- stronger pocket edge handling

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern='club table realism render contract' /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
```

Expected: FAIL or partial FAIL if the new Pixi-specific cues are missing.

**Step 3: Write minimal implementation**

In `drawStaticTable()`:
- refine outer wood frame with layered fills/highlights
- deepen cushion treatment with lighter inner edge and darker outer edge
- enrich pocket edge graphics and shadowing
- preserve current geometry, pocket positions, and `visualRailThickness` behavior

**Step 4: Run test to verify it passes**

Run the same targeted test and confirm PASS.

**Step 5: Commit**

```bash
git add /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/pixi-renderer.js /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
git commit -m "feat: add club-style realism to pixi table"
```

### Task 3: Bring the Canvas fallback up to the same visual hierarchy

**Files:**
- Modify: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/table-renderer.js`
- Test: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Extend the contract so the Canvas renderer must also show:
- layered wood border
- richer cloth treatment
- dimensional cushions
- enhanced pocket shading

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern='club table realism render contract' /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
```

Expected: FAIL because Canvas fallback still uses flatter drawing.

**Step 3: Write minimal implementation**

Update `drawGame()` table section to mirror the same realism hierarchy as Pixi:
- richer wood border
- more natural club-green cloth
- cushion shading
- pocket edge depth

**Step 4: Run test to verify it passes**

Run the same targeted test and confirm PASS.

**Step 5: Commit**

```bash
git add /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/table-renderer.js /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
git commit -m "feat: match canvas fallback to club table realism"
```

### Task 4: Verify gameplay layout and room-page compatibility

**Files:**
- Modify: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`
- Test: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs`

**Step 1: Write the failing test**

Add or tighten assertions that the realism work did not change:
- room layout structure
- side panel layout rules
- lack of bottom control bar
- semantic mobile mapping assumptions

**Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern='gameplay room layout splits tools top and players on short rails without a bottom control bar|gameplay uses the same semantic long-short sizing model across phone holds|club table realism render contract' /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
```

Expected: FAIL only if the realism work accidentally changed room structure or semantics.

**Step 3: Write minimal implementation**

Only make small corrective changes if realism work accidentally disturbed the room page. Do not redesign the room UI here.

**Step 4: Run test to verify it passes**

Run the same combined command and confirm PASS.

**Step 5: Commit**

```bash
git add /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
git commit -m "test: protect gameplay layout while upgrading table realism"
```

### Task 5: Browser verification on live room page

**Files:**
- Verify only: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/pixi-renderer.js`
- Verify only: `/Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/table-renderer.js`

**Step 1: Run the local preview**

Run the existing local preview and open:

```bash
http://127.0.0.1:8081/?dev=play
```

**Step 2: Verify horizontal phone semantics**

Confirm:
- wood frame reads as real wood, not flat brown
- cloth reads as club table cloth, not neon green panel
- pockets feel deeper and more physical
- current room HUD layout is still intact

**Step 3: Verify rotated portrait mapping**

Confirm:
- same horizontal gameplay scene is mapped into portrait hold
- table realism survives the mapping without aliasing or obvious clipping

**Step 4: Record residual issues**

Write down only concrete follow-up issues such as:
- pocket edge too heavy
- cloth too bright
- wood highlight too glossy

**Step 5: Commit**

```bash
git add /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/pixi-renderer.js /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/src/render/table-renderer.js /Users/majunjie/Desktop/台球/daily-billiards-vanilla_web/network-sync.test.mjs
git commit -m "feat: ship first pass of club table realism"
```
