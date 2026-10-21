---
name: angular-standards
description: >-
  Angular change standards for the Austerlitz Simulated Battle Planner.
  Use when editing Angular code, templates, styles, routes, or tests in this
  repository, or when the user asks for Angular standards.
---

# Angular standards

Apply these when changing Angular code in this planner.

## Decision order

1. Preserve current behaviour, user journeys, API contracts, validation, permissions, routing, shared component contracts, styling, test utilities, and data mapping unless the task changes them.
2. Prefer current recommended Angular practice for new or modified code.
3. Follow this app's file placement, naming, and domain terms when they still fit that practice.
4. Inside the requested change, improve a local pattern that is outdated, overly complex, weakly typed, fragile, hard to test, or inconsistent with recommended Angular practice.

Use Plan mode or `/grill-me` only when recommended practice would change behaviour, a public contract, or the architecture, and that change is not already decided. Skip both when the edit is clear and low risk.

## Practice

- Existing code shows current behaviour. It is not a permanent design.
- Make the smallest safe change that satisfies the request.
- Prefer simple, readable code. Avoid premature abstraction and extra architecture.
- Do not add libraries, frameworks, design systems, state-management approaches, or architectural patterns without explicit approval.
- Do not rewrite unrelated files or make formatting-only edits outside the request.
- Do not invent business rules, API fields, validation, permissions, product behaviour, or user journeys.
- Do not change user-visible behaviour unless explicitly requested.

## This app

- Standalone components, bootstrapped with `bootstrapApplication`. Do not add NgModules.
- This app does not use `zone.js`. After async work that the template must show, call `ChangeDetectorRef.markForCheck()`.
- Keep domain terms already used in the planner, including federation, battalion group, SIM sheet, and turn.
- Right-click opens a menu. Double-click removes. Use that pair for federation chips and for new interactions of the same kind.
