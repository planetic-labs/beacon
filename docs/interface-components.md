# Shared interface components

React Aria is the common interaction layer for desktop and mobile. Keep product
layout and content logic independent of it; preserve existing application CSS.

- `app-button.tsx`: native button contract plus Aria press/focus behavior. Use it
  for application buttons, including forms, native file pickers and drag sources.
  `title` and `data-tooltip` are rendered through the shared Aria Tooltip.
- `ui.tsx`: `Dialog` for application dialogs; `OverlayDialog` for custom layouts.
  Both use Aria overlays, focus containment, dismissal and focus restoration.
- `action-menu.tsx`: standard action lists with keyboard navigation.
- `action-panel.tsx`: mixed interactive controls inside a dismissible popover.
- `message-actions.tsx`: context-menu invocation via Aria (mouse, touch and keyboard),
  Menu navigation, application-specific reactions and message permissions.
- Attachment category tabs use Aria Tabs. Forms use Aria Form with native validation.

Keep native text/file inputs, selects, media controls, links and semantic navigation
where their browser behavior is sufficient. Do not replace them merely to increase
library usage. Third-party media and emoji widgets retain their own interaction
models. Layout, message scrolling, offline state and keyboard viewport sizing are
application responsibilities, not responsibilities of the component library.

New overlays must reuse the shared components rather than introducing document
keydown listeners, manual focus traps or independent long-press timers.

## Chat performance

Do not mount desktop hover toolbars or mouse tooltips in the mobile message tree.
Buttons must not instantiate both hook-based and component-based press handling
for the same rendered control. The shared interaction context supplies the device
mode without per-button media-query subscriptions.

History JSX is cached against the data and selection state it displays. Unrelated
chat-list, presence and dialog updates must not rebuild every message. Preserve
array references when refreshing identical user/chat lists. Repeated identity
checks during socket reconnects must also preserve an unchanged identity object;
keep the authentication request and apply changed identity/permission data. When adding content
or controls, include every displayed dependency in the history cache key and
verify reply/edit/selection behavior as well as performance.

`tests/browser-input-performance.ts` exercises a synthetic 300-message chat under
CPU throttling and reports focus/menu latency. Its viewport check simulates a
keyboard resize; it does not replace testing the real keyboard on a phone.

## Message interactions

On mobile, tap text or the non-interactive area of a message to open its action
menu. A touch hold enters selection mode and selects that message; subsequent
message taps toggle selection. Keep native link/media actions working and suppress
the trailing click after a hold. On desktop retain hover shortcuts and context
menus. Pinned messages use a separate floating card below the header.

- `touch-swipe.ts`: delegated horizontal touch gestures for message replies and chat folders. It preserves native vertical scrolling, edge navigation and media controls. Use one listener per scroll surface; update only the active row during a gesture. Long-press selection remains in React Aria.
