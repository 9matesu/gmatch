# Domination effects — MANUAL OS verification checklist

> These checks require a real Windows desktop and (for cross-peer steps) a
> second machine or a second instance. They are **manual by definition**:
> no automated test in this repo claims them. Record the observed result per
> step. Automated coverage (protocol, consent, receipts, clamps, geometry,
> restore plans) lives in `src/utils/dominationMesh*.test.ts`,
> `electron/dom-video-core.test.cjs` and `electron/wallpaper-core` tests.

Setup for every run: two installs (or dev + packaged) signed in as two
identities with each other's keys known (roster), receiver on Windows with
`Receive` enabled and the relevant consent switches on. Sender: Domination →
Send → effect.

## 1. Wallpaper (OS tier)

| # | Step | Expected observable | Pass |
|---|------|---------------------|------|
| 1.1 | Receiver turns **Wallpaper** on, **OS wallpaper (high impact)** off. Sender sends wallpaper. | gMatch background changes; the WINDOWS desktop wallpaper is UNTOUCHED. | ☐ |
| 1.2 | Receiver turns **OS wallpaper (high impact)** on. Sender resends. | The Windows desktop wallpaper changes to the sent image within ~5s. | ☐ |
| 1.3 | Wait for the effect duration. | The original wallpaper is restored automatically. | ☐ |
| 1.4 | Resend; press Esc in gMatch before the duration ends. | Wallpaper restores promptly (the in-app effect clears; the OS swap is restored by the effect cleanup). | ☐ |
| 1.5 | Resend; quit gMatch entirely mid-effect (before duration). | Wallpaper is restored by the app on quit — the desktop is never left with the sent image. | ☐ |
| 1.6 | Sender sends a wallpaper with the receiver's OS tier off and only Wallpaper on. | Sender's outbox shows **landed** (in-app executed) — not a fabricated OS success. | ☐ |
| 1.7 | Sender sends an oversized (>25 MB) or non-image media. | Receiver refuses; sender sees **failed**, desktop untouched. | ☐ |

## 2. Message / Banner (native toast)

| # | Step | Expected observable | Pass |
|---|------|---------------------|------|
| 2.1 | gMatch focused. Sender sends a message. | The in-app toast renders AND a Windows toast appears in the Action Center (from `gMatch`). | ☐ |
| 2.2 | Minimize gMatch to the taskbar. Sender sends again. | The Windows toast still appears while minimized; clicking it (or returning) shows the in-app toast was rendered. | ☐ |
| 2.3 | Same for **Banner text**. | Large in-app overlay + OS toast. | ☐ |
| 2.4 | Receiver turns Message off; sender resends. | Nothing renders; sender sees **declined**. | ☐ |

## 3. Video popup (dedicated window)

| # | Step | Expected observable | Pass |
|---|------|---------------------|------|
| 3.1 | Sender sends popup_video (https mp4/webm). | A separate player window opens (muted, close button), ~960×540, above the desktop — visible even if gMatch is minimized. | ☐ |
| 3.2 | Wait for the duration, or close the window early. | The window closes by itself at the duration (or on Close); the sender's outbox shows **completed**. | ☐ |
| 3.3 | Sender sends an unreachable URL. | The window closes; sender sees **failed** (did-fail-load path). | ☐ |
| 3.4 | Quit gMatch while the window plays. | The player window closes with the app (never orphaned). | ☐ |

## 4. Blur (scope honesty)

| # | Step | Expected observable | Pass |
|---|------|---------------------|------|
| 4.1 | Sender sends blur. | Only the gMatch window content blurs. Other applications and the desktop are NEVER affected. | ☐ |
| 4.2 | Wait for the duration / press Esc. | The blur clears automatically (restoration). | ☐ |

## 5. Photo request (cross-peer)

| # | Step | Expected observable | Pass |
|---|------|---------------------|------|
| 5.1 | Sender sends a photo request. | Receiver gets the approval prompt. | ☐ |
| 5.2 | Receiver **Declines**. | Sender's outbox shows **declined**. No camera light ever. | ☐ |
| 5.3 | Receiver **Allows once** (mesh path). | One frame is captured and delivered sealed to the sender; sender's outbox shows **completed**. No server media store involved. | ☐ |
| 5.4 | Receiver denies the OS camera permission. | Sender sees **failed** (capture declined), never success. | ☐ |

## 6. Two machines (physical)

Repeat 1.2–1.3, 2.1–2.2, 3.1–3.3 and 5.3 with the peers on **two different
machines** (different LANs via TURN if needed). Same-machine two-instance runs
exercise the protocol but not NAT traversal — record which you ran.
