# Model routing (mandatory)

Every dispatched worker, reviewer or doc task MUST run on a **mixture of free
models**, never one shared model. A single model is rate-limited within a few
concurrent agents, which stalls work silently. Pick the best model **per job**
and rotate providers so no two busy agents share one model.

## The mixture

> **Verified 2026-11-27:** `crowllm` needs paid credit for most models
> (`Add credits to continue`), and `kilo` models WITHOUT a `:free` suffix are
> paid (`kilo/deepseek/deepseek-v4.1-flash-1017-fast` returned *add credits*).
> Use only the lanes in the table below.

| Job | Primary | Alternate 1 | Alternate 2 |
|---|---|---|---|
| **CODING** — implementation, tests, refactors | `kilo/baidu/ernie-5.5-flash-preview:free` | `tokenharbor/deepseek-v4.1-flash:free` | `anymodel/am/free` |
| **UI / VISION** — layout, tokens, screenshot judgment | `kilo/nvidia/nemotron-3.5-super-vl:free` | `anymodel/am/free` | `9router/Full` |
| **REVIEW** — read-only critique | `tokenharbor/deepseek-v4.1-flash:free` | `tokenharbor/mimo-v2.6-flash:free` | `kilo/baidu/ernie-5.5-flash-preview:free` |
| **DOCS** — SPEC/architecture prose | `tokenharbor/deepseek-v4-flash:free` | `kilo/baidu/ernie-5.5-flash-preview:free` | `anymodel/am/free` |
| **FALLBACK ROUTER** — when the above are busy | `anymodel/am/free` | `9router/Full` | — |

`HY4` (`kilo/tencent/hy4`, `opencode/hy4-flash-free`, `crowllm/hy4-flash:free`)
is **exhausted — never use it**. Prefer lanes from different providers: run
parallel work as `kilo` + `tokenharbor` + `anymodel`, never three on one lane.

## Rules

1. **One model, one job, one provider per wave.** When launching N parallel
   workers, give each a DIFFERENT row/alternate so requests spread across
   `kilo`, `crowllm`, `tokenharbor`, `anymodel` and `9router`.
2. **Best fit first.** Coding → ERNIE/DeepSeek/Qwen. Visual or screenshot work
   → a vision model (GLM-4.6v, Nemotron Super VL, Omni Flash). Prose → GLM-5.3
   Flash or DeepSeek. Reviews → ERNIE / GLM thinking / Grok.
3. **Detect a stall.** No heartbeat and no file write for ~5 minutes, or a
   visible `Rate limit exceeded`, means that model is throttled. Wait **3–5
   minutes**, then relaunch the SAME task on the next alternate for its job
   (never the same model immediately).
4. **Never block a wave on one model.** If the primary is cold, launch on
   Alternate 1 immediately; a wave runs on mixed models, not one queue.
5. **Subagents too.** Every `subagent` call passes an explicit `model` from this
   table. Never inherit a single default for a whole batch.
6. **Report the model in the receipt.** `worker_done` and dispatch specs name
   the model that ran, so a throttle is attributable.

## How it is applied

- Orchestrated workers: `orca orchestration worker-start ... --agent opencode
  --model <id>` (the `--model` flag; `\-\-worktree current` is required for an
  OpenCode model id).
- Subagents: the `model` argument of the subagent call.
- Default fallback when nothing is chosen: the config default
  (`kilo/baidu/ernie-5.5-flash-preview:free`).
