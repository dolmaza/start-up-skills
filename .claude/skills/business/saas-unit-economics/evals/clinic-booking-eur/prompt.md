---
tags: [skill-creator]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

I run a booking SaaS for dental clinics in Portugal. Rails + Sidekiq + Postgres, all in docker compose on one Hetzner CX22 (€4.59/mo), Hetzner backups €0.92/mo, Postmark for email ($15/mo for 10k emails), and Claude Haiku summarizes appointment notes: roughly 30 summaries per clinic per day, about 2,000 input + 300 output tokens each. I'm also on Claude Pro ($20) for coding. 6 clinics pay today, each has ~400 patients who use the booking page every month. Next server sizes are CX32 at €7.59 and CX42 at €18.59. I'm not VAT registered (under the Portuguese small-business exemption). Card payments go through Stripe. Never load tested anything. What's the minimum monthly price I should charge per clinic, in EUR? Put the model in cost-model.yaml and give me the numbers.
