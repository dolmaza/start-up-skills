---
name: grill-me
description: >-
  Interview the user relentlessly about an idea, plan, or design until you reach
  shared understanding, resolving every branch of the decision tree before writing
  anything. Use when turning a vague brief into a precise spec, or whenever a task
  has unresolved design decisions. Ask one question at a time, each with a
  recommended default.
---

# Grill Me

> Adapted from the **grill-me** skill by Matt Pocock
> (https://github.com/mattpocock/skills — `skills/productivity/grill-me`). Credit to
> the original author; this version is tailored for requirements authoring.

Conduct an intensive, systematic interrogation of the idea until you and the user
share the same mental model. Do not start producing the artifact while design
branches are still ambiguous — surface and resolve them first.

## The method

1. **Map the decision tree.** From the raw brief, list every open decision branch:
   actors, scope edges, each flow's happy/alternate/error paths, business rules,
   data shape & validation, permissions, non-functionals, success metrics,
   acceptance criteria, and explicit out-of-scope. Order them by dependency
   (answering A may reshape B).

2. **Ask one question at a time.** Present a single, focused question — never a
   wall of them. With each question, include **your recommended answer** (a
   sensible default) so the user can simply confirm ("yes / use the default") or
   correct you. State *why* it's your recommendation in one line.

3. **Resolve before moving on.** Don't advance to a dependent branch until the
   current one is settled. If the user is unsure, either propose a default and mark
   it provisional, or park it as an **Open Question** — never silently guess.

4. **Consult sources directly.** When the answer can be found rather than asked —
   the codebase, existing specs or design docs, the constitutions — read them
   instead of making the user explain. Ask only what genuinely lives in the
   user's head.

5. **Reflect back.** Periodically summarize what's been decided in your own words
   and ask the user to confirm. Mirroring catches misunderstandings early.

6. **Know when to stop.** Stop grilling when every branch is either decided or
   explicitly parked as an Open Question, and the user confirms the picture is
   complete. Then — and only then — produce the artifact.

## Style
- One question per turn; always offer a recommended default.
- Prefer concrete, decidable questions ("Should an empty cart block checkout, yes/no?")
  over open prompts ("How should the cart work?").
- Use multiple-choice when the options are discrete; free-form when they aren't.
- Be relentless but efficient: skip what you can infer or look up; never re-ask
  something already answered or discoverable.
