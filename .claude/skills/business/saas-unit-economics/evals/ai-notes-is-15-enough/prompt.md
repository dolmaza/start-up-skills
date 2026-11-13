---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

quick sanity check pls. we charge $15/month per workspace for our AI meeting-notes app. 40 paying workspaces, avg 6 seats each, a seat records ~20 meetings a month. each meeting = one Sonnet call, ~12k input tokens and ~1.5k output (pricing $3 / $15 per million). infra is Render, $85/mo total, plus $20 for a Sentry plan. Stripe takes 2.9% + 30c per charge. is $15 enough or are we losing money? write up the answer in pricing.md
