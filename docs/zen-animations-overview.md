# Zen (Nightly) - All Smooth Motion & Animations

All Zen UI motion runs on two engines:

- `src/zen/vendor/motion.min.mjs` via `src/zen/common/modules/ZenUIManager.mjs:35` - `gZenUIManager.motion` → `motion.animate(el, {x,y,scale,opacity,transform}, {type:spring,bounce:0,duration})`
- `src/zen/common/modules/ZenUIManager.mjs:95` - `elementAnimate()` → native `Element.animate()` WAAPI wrapper

Guarded by `gReduceMotion` / `prefers-reduced-motion` (`ZenUIManager.mjs:13,438,1072,1148`).

Global tokens in `src/zen/common/styles/zen-theme.css:204`:

```css
--zen-tabbox-element-indent-transition: margin-inline-start 0.1s ease-in-out;
--zen-hidden-toolbar-transition-duration: 0.15s;
--zen-active-tab-scale: 0.985;
```

Compact bounce in `src/zen/compact-mode/sidebar.inc.css:159`:

```css
--zen-compact-mode-func: linear(...bounce...);
--zen-compact-mode-time: 0.25s;
```

---

## 1. Central keyframes library

File: `src/zen/common/styles/zen-animations.css:7-134`

| Keyframe                             | Lines   | Motion                                                      | Used in                                                                   |
| ------------------------------------ | ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `library-badge-download`             | 7-17    | `translateY 0 > 12px > 0`, `0.4s ease`                      | `zen-library-widget.css:50` download badge bounce                         |
| `zen-library-sprite-hover / unhover` | 19-37   | `background-position-x 0% <-> 100%`, `0.3s steps(36)`       | `zen-library-widget.css:33,36` 36-frame sprite                            |
| `zen-back-and-forth-text`            | 39-57   | `translateX marquee`, `10s infinite ease-in-out`            | `zen-media-controls.css:89` overflow label on hover                       |
| `zen-urlbar-searchmode`              | 60-69   | `box-shadow 20px > 250px`, `1s ease-out forwards`           | `zen-omnibox.css:309` search-mode glow flash                              |
| `zen-dialog-fade-in`                 | 71-81   | `opacity 0>1 + translateY(-10px>0)`, `0.3s ease-out`        | `zen-panels/dialog.css:14` `.dialogBox`                                   |
| `zen-dialog-fade-in-shifted`         | 83-93   | same but preserves `-10%` centering                         | `dialog.css:19` `.content-prompt-dialog`                                  |
| `zen-text-gradient`                  | 95-102  | `background-position 0% > -400%`, `5s / 2s linear infinite` | `zen-single-components.css:700`, `zen-sidebar-notification.css:7` shimmer |
| `zen-progress-bar-pulse`             | 104-114 | `scale .85>.95 + opacity .6>1`, `1s alternate infinite`     | `zen-single-components.css:770` loading bar                               |
| `zen-progress-bar-long-load`         | 116-126 | `left -100% > 100%`, `1s infinite delay .3s`                | indeterminate sweep, width 75%                                            |
| `zen-progress-bar-settle`            | 128-134 | `scale(1) + width:10rem`, `.3s ease-out forwards`           | settle state when `long-load=true`                                        |

---

## 2. Workspaces - tab-strip switch (core)

### 2.1 JS spring slide

File: `src/zen/spaces/ZenSpaceManager.mjs:1996-2234` `#animateTabs()`

- Duration source: `zen.workspaces.switch-animation-duration` / 1000 → `kGlobalAnimationDuration` at `2007-2009`. Also reused in `ZenSpaceCreation.mjs:93-98`.
- `2076-2087` Background crossfade: `motion.animate([browserBG, toolbarBG], {"--zen-background-opacity":[prev,1]}, {type:spring,bounce:0,duration:kGlobal})` + `documentElement[animating-background]`.
- `2089-2146` Tab strip: `zen-workspace` `transform:[existing, translateX(offset%)]` where `offset = (index - newIndex)*100` with shortest-path wrap `2017-2023`. Only `willBeVisible` animates, rest snap.
- `2147-2200` Essentials: `transform translateX(existing% > new%)` same spring. Gated by `shouldAnimateEssentials` at `354-356` (`containerSpecificEssentials || creatingWorkspaceId`).
- `2206-2215` Safety: `Promise.race([Promise.all(animations), timeout+50ms])`.
- Interrupt: `1663` `animations.complete()`.
- Sync follow: `1823-1940` `_organizeWorkspaceStripLocations(workspace, justMove, offsetPixels)` - sets `transform: translateX(diff*100 + offsetPixels/2%)` directly, `background-opacity = 1-abs(offset)/200`, `updateNoise(grain)`. Called from swipe, creation `283,417`, `1391,1457,1723,2405,2591`.
- `rAF: 201,559-560,1817,2389`, `setTimeout: 767-768,915,1094,1106-1107,2207` (animation timeout).

Linked prefs `105-143`: `zen.workspaces.scroll-modifier-key`, `natural-scroll`, `wrap-around-navigation`, `force-container-workspace`, `open-new-tab-if-last-unpinned-tab-is-closed`, `separate-essentials`, `active`, `debug`, `swipe-actions`, `zen.view.sidebar-expanded`, `zen.view.show-newtab-button-top`.

### 2.2 CSS chrome

File: `src/zen/spaces/zen-workspaces.css`

- `70-74` `#zen-workspaces-button toolbarbutton`: `transition: filter .2s, opacity .2s, width .1s, transform .2s` - hover/active/reorder fade.
- `102-105` reorder-mode dims to `opacity .2`.
- `274` `.zen-workspaces-actions`: `transition: opacity .1s` reveal on hover.
- `333-335` `zen-workspace`: `transition: padding-top .1s` (indicator / pinned collapse), guarded by `prefers-reduced-motion`.
- `374,387` `arrowscrollbox::before/after`: `transition: opacity .1s` overflow hairlines.
- `428` `indicator-stack`: `transition: margin-inline-end .1s` slide to reveal chevron.
- `438,464-466` `indicator-chevron`: `transition: transform .1s, opacity .15s; rotate(90deg>0deg)` when `collapsedpinnedtabs`.
- `407-410` `:not([animating-background],[swipe-gesture]) zen-workspace:not([active]) { content-visibility:hidden }` - perf gate.
- `164` `#zen-workspaces-button { scroll-behavior:smooth }`.

`src/zen/spaces/overflow-icons.inc.css:22,27`:

- dot `opacity 150ms`, icon `opacity 150ms, transform 150ms` → `scale(0)+opacity 0` collapsed to dot.

### 2.3 Swipe driver

File: `src/zen/spaces/ZenSpacesSwipe.mjs:1-333`

- `57-97` attach / `99-129` detach `MozSwipeGestureMayStart/Start/Update/End`.
- `183-270` Update: `delta * getIntPref(zen.workspaces.swipe-actions.delta-multiplier):197`, `forceMultiplier=min(1,1-abs(x)/(stripWidth*4.5))`, `rubberBand(offset,dim,0.55)`, `DAMPING=0.2, RUBBER=0.08`.
- Forwards to `ws._organizeWorkspaceStripLocations(..., translateX)` or `ZenLibrary.swipeProgress(damped)`.
- `272-293` End: `rawDirection` vs `ws.naturalScroll` (`zen.workspaces.natural-scroll`) → `changeWorkspaceShortcut()` or `Library.stopSwipe()`.
- `295-324` `onSwipeGestureAnimationEnd`: resets `zen.swipe.is-fast-swipe=false`, removes `swipe-gesture`, restores `--zen-background-opacity=1`.

### 2.4 Creation form

File: `src/zen/spaces/ZenSpaceCreation.mjs:93-143,369-448`

- `#spaceSwitchDuration`, `#dimUrlbar`: `motion.animate(gURLBar,{opacity:[1,0]},{duration,spring,bounce:0})`, `#restoreUrlbar` inverse + `gReduceMotion->complete()`.
- `#cleanup`: exit `animate(elements.reverse(),{y:[0,20],opacity:[1,0],filter:[blur(0),blur(2px)]},{duration:.3,spring,bounce:0,delay:stagger(.03)})`, re-enter `opacity[0,1] .3s spring`.

### 2.5 Smooth scroll

File: `src/zen/spaces/ZenSpaceIcons.mjs:17-24,162-183`

- `mouseover -> target.scrollIntoView({behavior:smooth, inline:nearest})`, active index → `buttons[selected].scrollIntoView({behavior:smooth})`.

---

## 3. Tabs / Vertical tabs / Essentials / Folders

File: `src/zen/tabs/zen-tabs/vertical-tabs.css`

- `142-145` separator: `transition: height .08s, padding .08s, opacity .06s ease-in-out`; `169-173` + `transform .1s` when `[movingtab]`.
- `186-188` separator button: `opacity .15s, visibility .15s`; `212` icon `transform .15s translateY(0>2px)` press + `@starting-style`.
- `320-323` `.tabbrowser-tab`: `transition: scale .1s ease, var(--zen-tabbox-element-indent-transition)` - indent slide on expand/collapse.
- `341-344` active press `scale:var(--zen-active-tab-scale) + rotate:.01deg` GPU hack; `348-350` icon `scale:.97`.
- `500-503` sublabel: `opacity/margin/max-height .1s + translateY(-4px)`.
- `895` splitter: `opacity .2s`.
- `1086-1088,1098` new-tab button: `scale .1s`, press `scale:.985`, `[movingtab] transform .1s`.
- `1137-1139` essentials container: `max-height .3s ease-out, grid-template-columns .3s ease-out` grid reflow slide.
- `1251` essential selected `::before`: `background .1s`.
- `431` glance audio overlay: `opacity .8s`.

`vertical-tabs-topbar.inc.css:18-19`: `height + opacity var(--zen-hidden-toolbar-transition) delay .2s` for `hide-window-controls`.

`zen-folders.css:23,57,36,105`: `indent-transition`, `var(--tab-dragover-transition)` when `[movingtab]`, collapsed icon `transform .1s`.

`zen-split-group.inc.css:12,15,47,148`: same indent + `scale .1s`.

JS open/close - `src/zen/common/modules/ZenUIManager.mjs:1070-1171` `animateItemOpen/Close`:

- open: `motion.animate(item,{opacity:[0,1],transform:[scale(.95),scale(1)],marginBottom:[-h,0]},{duration:.12,easing:easeOut})` + label `filter blur 1px>0 .1s`.
- close: inverse `.1s easeOut`.

Folders - `src/zen/folders/ZenFolders.mjs:1536-1595,1613-1619,1621-1719`:

- `#animateItem(item,target,{duration:.18,ease})` via `item.animate([from,to],{duration*1000,easing:ease-in-out/ease})`.
- `#folderAnimationDuration=.18s`, `#folderRevealDuration=.22s`, collapse `{opacity:[1,0],height:[auto,0]}`.
- Icon SVG `src/zen/folders/zen-folder-icon.inc.css:8-10`: `g/rect/path {transition: transform .3s, opacity .3s cubic-bezier(.42,0,0,1)}`.

Live folders promo `src/zen/live-folders/ZenLiveFoldersManager.sys.mjs:320`: `motion.animate(label,{backgroundPositionX:[0%,-50%]},{duration:1})`, pref `zen.live-folders.promotion.shown`.

---

## 4. Sidebar / Compact-mode / Toolbar

File: `src/zen/compact-mode/sidebar.inc.css`

- `70-73` `#navigator-toolbox:not([animate])`: `transition: left .15s, right .15s, visibility .15s ease` - off-canvas parked `left:calc(-1*width...) :101,121`.
- `139` `#titlebar`: `visibility .15s`.
- `263-265` hover/focus `[zen-has-hover],[zen-user-show]`: `transition: left .25s var(--zen-compact-mode-func)` bespoke bounce.
- `269` `transition:none` on titlebar when shown.

`toolbar.inc.css:32,41,48`: `#zen-appcontent-navbar-wrapper {transition: height var(--...)}`, `#urlbar,#navbar-container {transition: opacity var(--...)}`.

`ZenCompactMode.mjs:536-626` `animateCompactMode()`:

- hide: `motion.animate(sidebar,{marginRight:[0,-w],marginLeft:[0,-w]},{ease:easeIn,spring,bounce:0,duration:.1})` then `visibility:hidden`.
- show: `margin [-w,0] + transform [translateX(100%),0] {ease:easeOut,spring,bounce:0,duration:.1}`.
- `713-734` flash: `rAF + setTimeout(duration)` toggling `flash-popup/zen-has-hover`.
- Prefs `1-80,685-701`: `zen.view.compact.toolbar-flash-popup.duration=800`, `animate-sidebar=true`, `toolbar-hide-after-hover.duration`, `sidebar-keep-hover.duration`, `hide-tabbar/hide-toolbar`, `outside-window-edge-offset`.

`src/zen/browser/zen-browser-container.css:54,57`: `.browserContainer {transition: margin var(--zen-hidden-toolbar-transition); delay:.2s}` - site slides on toolbar hover.

`src/zen/browser/zen-browser-ui.css:63,76,87,105,277,296,322-329`: background `grain opacity .2s`, splitter `opacity .1s, background .2s delay .2s`.

---

## 5. URL bar

File: `src/zen/urlbar/zen-omnibox.css`

- `161-163` single-toolbar page-action: `opacity .15s, visibility .15s` on `toolbox[zen-has-implicit-hover]/[open]/empty-tab`.
- `337` `#notification-popup-box`: `transition: all .2s` slide `margin-inline-start`.
- `492` floating identity `translate:-50% 0%` centering.
- JS `ZenUIManager.mjs:437-459`: search-mode `motion.animate(input,{scale:[1,.98,1]},{duration:.25})` + `setTimeout 1000 + rAF`.

---

## 6. Split-view

File: `src/zen/split-view/zen-split-view.css:24,74-76,144,169`

- `#zen-splitview-dropzone {transition: inset .08s ease-out}`.
- `> [zen-split] {transition: inset .09s ease-out !important; browser opacity .2s}` disabled via `.zen-split-view-no-transition / [zen-split-resizing]`.
- header `opacity .1s delay .1s`.

JS `src/zen/split-view/ZenViewSplitter.mjs:506-515,615-624,2337-2353`:

- drag-over `motion.animate(tabbox,{padding...},{duration:.1,easing:ease-out})` + `fakeBrowser {width/height/margin}`.
- `animateBrowserDrop`: `motion.animate(container,{scale:[.97,1],opacity:[0,1]},{spring,bounce:.4,duration:.2,delay:.1})`.

---

## 7. Glance overlay arc

File: `src/zen/glance/ZenGlanceManager.mjs`

- `42-44` `#GLANCE_ANIMATION_DURATION=getIntPref(zen.glance.animation-duration)`, `36-40` `#ARC_CONFIG={STEPS:80,MAX_H:20,RATIO:.2}`, `741-742` `zen.glance.deactivate-docshell-during-animation`.
- `438-456` buttons: `motion.animate(container,{opacity:[0,1],x:[±20,0]},{duration:.2,spring,delay:DURATION-0.2,bounce:0})`.
- `150-159,188-200` open/close detached: `elementAnimate(wrapper,arcSequence,{duration,easing:ease-in-out/ease-out})`.
- `710-762` `#executeGlanceAnimation`: content `opacity[0,1] duration DURATION/4`, browser `arcSequence`.
- `774-913` `#createGlanceArcSequence`: `easeOutBack(c1=.4) / easeOutCubic(^6)`, `x/y/scaleX/scaleY` 80 steps.
- `627-644` parent bg: `{scale:[1,.97],opacity:[1,.3]} duration DURATION spring bounce:.2`; close `1206-1225` inverse `/1.5 bounce:0`.
- CSS `src/zen/glance/zen-glance.css:12,32,74,135,142,173`: buttons `background .05s, scale .05s hover 1.02/.98`, `will-change:transform,opacity`, `has-finished-animation {transition:0s!important;transform:none}`, fade `opacity .15s`.

---

## 8. Downloads arc + dock

File: `src/zen/downloads/ZenDownloadAnimation.mjs:10-17,56-65,253-260,272-346,403-414,466-488`

- `CONFIG={ARC_STEPS:60,MAX_H:1200,RATIO:.8,SCALE_END:.45}`.
- arc: `motion.animate(arcEl,sequence,{duration:getIntPref(zen.downloads.download-animation-duration)/1000,easing:cubic-bezier(.37,0,.63,1),fill:forwards})` per-step `opacity/transform:translate+rotate+scale` with `easeInOutQuad`.
- entry: `{[side]:34px,opacity:1,scale:1.1} .35s ease-out` → `{[side]:24px,scale:1} .2s ease-in-out`.
- exit: `scale .9 .15s ease-in` → `{[side]:-50px,opacity:0,scale:.8} .3s cubic-bezier(.5,0,.75,0)`.
- Gate: `zen.downloads.download-animation:40`, pos `zen.downloads.icon-popup-position + zen.tabs.vertical.right-side:136-148`.

---

## 9. Media / Toasts / Notifications / Library / Share / Welcome / Misc

- Media JS `src/zen/media/ZenMediaController.mjs:739-797`: hide `motion.animate(bar,{opacity:[1,0],y:[0,10]},{duration:.1})`, show inverse via `rAF`. CSS `zen-media-controls.css:48,70,117,158,181,240,291`: progress `height .15s`, thumb `scale .15s`, hover `max-height/opacity/transform/padding .3s`, card `transform .35s, opacity .3s, filter .3s`, `@starting-style blur(4px) translateY(.5rem)`.
- Toast `ZenUIManager.mjs:810-868`: `motion.animate(toast,{opacity:[1,0],scale:[1,.5]},{duration:.2,bounce:0})`, in `{scale:1} spring bounce:.2 duration:.5`, `setTimeout options.timeout||2000`, pref `ui.popup.disable_autohide`. CSS `zen-popup.css:323-350`.
- Sidebar notification `src/zen/common/modules/ZenSidebarNotification.mjs:70-73,146-169`: `bar.animate({transform:[scaleX1,scaleX0]},{duration:autoHideMs,linear,forwards})` pause on hover; in `{opacity:[0,1],y:[50,0]} delay:1`, out `{opacity:[1,0],y:[0,10]}`.
- Library `src/zen/library/zen-library-widget.css:12,107,112,198,223`: `@property --zen-library-progress`, `transition: --progress .3s linear`, entries `.22s + index*12ms stagger`, `translateY((1-p)*25px) opacity:p`. `zen-library.css:288-296,730-738`: sprite `translateX 35*size`, indeterminate `background-position -70%>170% 1.2s infinite`, headers `opacity .28s`. JS `ZenLibrary.mjs:288-380`: `motion.animate(openProgress,target,{type:spring,stiffness:720,damping:47,mass:1.2})`.
- Share `src/zen/share/zen-share.css:33,42,51-56,148`: `zen-share-overlay-enter {from opacity 0, translateY(14px) scale(.98)} .35s cubic-bezier(.2,.8,.2,1) both (+.06s delay)`, folder `grid-template-rows .25s`.
- Welcome `src/zen/welcome/ZenWelcome.mjs:73,211-213,256,301,324-333,345`: `kSpring{spring,bounce:.35,visualDuration:.35}`, `kExit{duration:.12,ease:easeIn}`, `kFade{duration:.25,ease:easeOut}`, pages `x[120*dir,0] spring bounce:.4 stagger:.03`, video `opacity .6s`.
- Gradient `src/zen/spaces/zen-gradient-generator.css:118,178,236,286,332,419,432`: dots `transform .1s hover1.05/active.95`, thumb `transform .5s hover1.1`, buttons `background .2s`.
- Buttons `src/zen/common/styles/zen-buttons.css:17,76,105`: `transition:.1s`, `scale .2s active .98`, big-accent `scale .15s hover1.03/active1`.
- Single components `zen-single-components.css:175,194-211,351-370,392-521,625,765`: toolbarbtn `bg .1s, transform .2s active scale(.95)`, addon tiles `hover1.05/active.95`, progress `opacity/bg/transform .3s`.
- Startup `src/zen/common/modules/ZenStartup.mjs:129-158`: watermark `motion.animate(#browser>*,#urlbar,{opacity:[0,1]},{duration:.1})`.
- Updates `src/zen/common/modules/ZenUpdates.mjs:71-110`: `motion.animate(#zen-update-animation,{top:[100%,-50%],opacity:[.5,1]},{duration:.35})` + border `{--background-top:[150%,-50%]} delay:.08` via `requestIdleCallback`.
- Share import shake `src/zen/share/ZenShareManager.mjs:440-450`: `motion.animate(group,{x:[-32,0]},{spring,bounce:.5,duration:1.5})` via `rAF`.
- Rename `ZenUIManager.mjs:1699-1707`: `motion.animate(tab,{scale:[1,.98,1]},{duration:.25})`.
- New popup `ZenUIManager.mjs:223-251`: `motion.animate(image,{transform:[rotate0,rotate45]},{duration:.2})` + reverse.

No `setInterval` animation loops; `setTimeout` is one-shot fallback/delay; `rAF` is layout-flush / hover-debounce, not tween engine.
