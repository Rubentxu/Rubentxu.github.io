// The tool toolbar: one button per tool, and the one function that says which
// one is active.
//
// Why this module exists at all. Five tools — rectangle, ellipse, diamond, line
// and arrow — were fully delivered and reachable only by a keyboard shortcut that
// nothing on screen named. A capability with no affordance is not a capability;
// the hint line was the workaround, and the workaround was a paragraph of prose
// that had to be kept in step with a table by hand. So the buttons are here, and
// the hint is the reference's own again (TASK-214): a sentence for the state that
// has one, and nothing for the states that do not, rather than a paragraph that
// named the tools forever.
//
// Why the buttons are built here rather than written in `index.html`. A hand-written
// row of six `<button data-tool>` elements is six chances to spell a tool the
// keyboard would refuse, and that failure is silent: a mismatched `data-tool`
// wires to nothing and lights nothing. Building them from `TOOL_BUTTONS` means the
// markup carries an empty container and the one table is the only place a tool is
// named. The guard in `wiring.test.mjs` then reads this file rather than the HTML,
// because there is nothing in the HTML left to disagree with it.
//
// Why the buttons wear upstream's clothes (TASK-166). The row is upstream's
// toolbar island (`packages/excalidraw/components/Toolbar.tsx`, tarball
// 701b901a): the container becomes the island the foundation's stylesheet
// draws, every button is the foundation's `iconButton` in its toggle shape —
// the iconary's own drawing of the tool, the key in the `ToolIcon__keybinding`
// corner, the active tool carrying `ToolIcon--checked` beside `aria-pressed` —
// and the divider before the extra tools is upstream's own boundary. Behind it
// is upstream's ExtraToolsDropdown: a labelled vertical menu, closed until
// asked, with the image row (the `insertImage` verb) and then frame, embed and
// laser in the reference's order. The pen-mode button upstream leads with is
// not drawn until a pen is detected — the page hides it and the button is built
// so the state that makes it true has somewhere to arrive. The lock is here,
// beside it, as upstream's row has it.
//
// Why every button answers the keyboard (TASK-214). Upstream's tooltip is the
// name and the shortcut (`Tools.tsx:290`: `Rectángulo — R o 2`), its
// `aria-keyshortcuts` says the same two keys and its badge prints the first
// one. All three are derived here from the one table that answers the keyboard,
// so a button cannot advertise a key the keyboard refuses: `shortcutLabelFor`
// composes the sentence, `keyBindingFor` draws the badge (and hides the hand's,
// upstream's `hideKeyBinding`), and `tools.mjs` answers the digit as a shortcut
// too.
//
// Why there is one `refresh` and not three. The pressed state was written three
// times — in the binder, in the text-insert path, and in the keydown path — and
// two of the three reached for `document.querySelector("button[data-tool=\"text\"]")`
// with the tool name baked into the selector. That works today for exactly one
// button and quietly keeps working as the count grows, which is how a stale
// highlight looks like a working one. `refresh` is now the only answer to "which
// button is lit", every caller goes through it, and the buttons are found once.

import { TOOL_BUTTONS, TOOLS, keyBindingFor, letterKeyFor, shortcutLabelFor } from "./tools.mjs";
import { buttonText, TOOL_HOWS, howOf } from "./commands.mjs";
import { CHROME_ICONS } from "./chrome-icons.mjs";
import { iconButton } from "./chrome.mjs";
import { bindPenModeButton } from "./pen-mode.mjs";
import { bindToolLockButton } from "./tool-lock.mjs";

export { buttonText, TOOL_HOWS, howOf };

/**
 * The icon each tool's button wears, in the iconary's names — upstream's own
 * drawings (`icons.tsx`, tarball 701b901a). A tool whose name is missing here
 * builds a button with no drawing; the button exists so the miss is visible
 * on the glass, but the map is the one place to fix it.
 */
const TOOL_ICONS = Object.freeze({
  [TOOLS.hand]: "handIcon",
  [TOOLS.selection]: "SelectionIcon",
  [TOOLS.rectangle]: "RectangleIcon",
  [TOOLS.diamond]: "DiamondIcon",
  [TOOLS.ellipse]: "EllipseIcon",
  [TOOLS.arrow]: "ArrowIcon",
  [TOOLS.line]: "LineIcon",
  [TOOLS.freedraw]: "FreedrawIcon",
  [TOOLS.text]: "TextIcon",
  [TOOLS.stickynote]: "stickyNoteToolIcon",
  [TOOLS.eraser]: "EraserIcon",
  [TOOLS.laser]: "laserPointerToolIcon",
  [TOOLS.frame]: "frameToolIcon",
  [TOOLS.embeddable]: "EmbedIcon",
});

/**
 * The tools upstream holds behind the toolbar's extra-tools boundary
 * (`Toolbar.tsx`: the `ExtraToolsDropdown` after the row's last divider).
 *
 * The order is upstream's own list: image, frame, embeddable, (autoshape),
 * laser, (bucketfill), (lasso). The tools in parentheses do not exist in this
 * build, so they are not named on the glass — a row that cannot arm its tool
 * is a lie in a menu. The ones that do exist keep upstream's relative order.
 * The divider the binder draws goes in front of the first one the row reaches.
 */
const EXTRA_TOOLS = Object.freeze(new Set([TOOLS.frame, TOOLS.embeddable, TOOLS.laser]));

/**
 * The order upstream's dropdown lists the tools this build holds: frame,
 * embeddable, laser (`Toolbar.tsx`: image, frame, embeddable, autoshape,
 * laser, bucketfill, lasso). `TOOL_BUTTONS` carries the keyboard's order,
 * which is a different fact — the menu follows the reference's list.
 */
const EXTRA_TOOL_ORDER = Object.freeze([TOOLS.frame, TOOLS.embeddable, TOOLS.laser]);

/** The icon the trigger wears while an extra tool is armed, upstream's own swap. */
const EXTRA_TRIGGER_ICONS = Object.freeze({
  [TOOLS.frame]: () => CHROME_ICONS.frameToolIcon,
  [TOOLS.embeddable]: () => CHROME_ICONS.EmbedIcon,
  [TOOLS.laser]: () => CHROME_ICONS.laserPointerToolIcon,
});

/**
 * The `title` a button carries, naming both what it does and the shortcut that
 * reaches it — upstream's own sentence (`Tools.tsx:290`: `${label} — ${shortcut}`).
 *
 * The shortcut is the table's answer, not a literal: a button cannot advertise
 * a key the keyboard refuses, because both read `shortcutLabelFor`.
 */
function buttonTitle(tool, or) {
  const shortcut = shortcutLabelFor(tool, or);
  return composeTitle(buttonText(tool), shortcut);
}

/**
 * The `title` as a sentence: the name, and the shortcut when the tool has one.
 *
 * Upstream writes `Rectángulo — R o 2` and leaves the web embed's title as its
 * bare name; a tool with no key advertises none rather than an empty promise.
 * The "or" is the locale's (`helpDialog.or`), so the sentence translates while
 * the keys stay derived from the table that answers the keyboard.
 */
export function composeTitle(name, shortcut) {
  return shortcut === null || shortcut === undefined || shortcut === ""
    ? name
    : `${name} — ${shortcut}`;
}

/**
 * One row of upstream's extra-tools menu: the icon, the words and the
 * shortcut, in `DropdownMenu.Item`'s own shape (`dropdown-menu-item`,
 * `__icon`, `__text`, `__shortcut`). The row is a menu item of the dropdown,
 * not a toolbar toggle: the image row runs a command, and the three tool rows
 * carry `data-tool` so the one `refresh` lights them like the inline buttons.
 */
function menuItem({ createElement, icon, label, shortcut, attributes = {} }) {
  const item = createElement("button");
  item.setAttribute("type", "button");
  item.setAttribute("role", "menuitem");
  item.setAttribute("aria-label", label);
  item.classList.add("dropdown-menu-item");
  const box = createElement("div");
  box.classList.add("dropdown-menu-item__icon");
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = icon;
  item.appendChild(box);
  const words = createElement("div");
  words.classList.add("dropdown-menu-item__text");
  const span = createElement("span");
  span.textContent = label;
  words.appendChild(span);
  item.appendChild(words);
  if (shortcut !== null && shortcut !== undefined) {
    const key = createElement("div");
    key.classList.add("dropdown-menu-item__shortcut");
    key.textContent = shortcut;
    item.appendChild(key);
  }
  for (const [name, value] of Object.entries(attributes)) {
    item.setAttribute(name, value);
  }
  return item;
}

/**
 * Render the tool buttons under `root` and wire them to `toolState`.
 *
 * `createElement` is required rather than reached through `root.ownerDocument`,
 * matching `text-edit.mjs`: the production caller passes `document.createElement`
 * and the test passes a three-method fake, so this module needs no DOM at all to
 * be exercised. A test that needs a browser to run a five-line function is a
 * test that will not be run. The primitives take the same shim: `iconButton`
 * only creates elements, so the seam is the object the tests already inject.
 *
 * The container becomes upstream's toolbar island (`Toolbar.tsx`): the
 * foundation's island classes and padding go on `root` itself, so the markup
 * keeps its `id` — the wiring guard reads it — and the stylesheet draws the
 * island over it. Returns `refresh`, which sets `aria-pressed` and the
 * `ToolIcon--checked` class on every button from `toolState.currentTool` —
 * the attribute the assistive technology reads and the class the stylesheet
 * draws, written together so neither can go stale beside the other. Callers
 * that change the tool from somewhere other than a click — the keyboard, the
 * text-insert path — call it afterwards.
 *
 * @param {{ root: Element, toolState: { currentTool: string }, createElement: (tag: string) => Element, onChange?: () => void, signal?: AbortSignal, text?: (key: string, source: string) => string, penMode?: object|null, toolLock?: object|null, onCommand?: ((id: string) => void)|null }} options `signal` removes the listeners when it aborts; `onCommand` runs the menu's command rows.
 * @returns {() => void} `refresh`
 */
export function bindToolToolbar({ root, toolState, createElement, onChange, signal, text = (_key, source) => source, penMode = null, toolLock = null, onCommand = null }) {
  // The container is the island. Upstream's toolbar island is `padding: 1`
  // with the `App-toolbar` class, and the foundation's stylesheet draws it
  // by those names (`client/chrome.mjs`).
  root.classList.add("Island", "App-toolbar");
  root.style.setProperty("--padding", "1");
  root.setAttribute("data-viewport-ui-name", "toolbar");

  // Build the row before binding, so `refresh` has every button to write and
  // a button added later is a visible gap rather than a silent mismatch. The
  // divider goes in front of the first extra tool, which is upstream's own
  // boundary between the row and the tools it holds behind a dropdown.
  //
  // Pen mode leads the row, as upstream's PenModeButton leads its toolbar
  // (`Toolbar.tsx`: the pen and the lock come before the hand and the tools).
  // It is not a tool — it changes what a pointer *is*, not what it draws — so
  // it is not a row of TOOL_BUTTONS.
  let penButton = null;
  if (penMode !== null) {
    penButton = iconButton({ createElement }, {
      icon: CHROME_ICONS.PenModeIcon,
      label: text("ui.pen-mode.label", "Pen mode"),
      type: "toggle",
      checked: penMode.isOn(),
      attributes: {
        "data-pen-mode": "",
        title: text("ui.pen-mode.title", "Pen mode"),
      },
    });
    bindPenModeButton({ button: penButton, penMode, onChange, signal });
    root.appendChild(penButton);
  }
  // The lock rides beside the pen (`Toolbar.tsx`: PenModeButton then
  // LockButton): it says what happens to the tool after the shape lands.
  let lockButton = null;
  if (toolLock !== null) {
    lockButton = iconButton({ createElement }, {
      icon: toolLock.isOn() ? CHROME_ICONS.LockedIcon : CHROME_ICONS.UnlockedIcon,
      label: text("ui.lock.label", "Keep the tool active"),
      type: "toggle",
      checked: toolLock.isOn(),
      attributes: {
        "data-tool-lock": "",
        title: text("ui.lock.title", "Keep the selected tool active after drawing"),
      },
    });
    bindToolLockButton({
      button: lockButton,
      toolLock,
      icons: { on: CHROME_ICONS.LockedIcon, off: CHROME_ICONS.UnlockedIcon },
      onChange,
      signal,
    });
    root.appendChild(lockButton);
    // The lock rides before the row's first divider, as upstream's does
    // (`Toolbar.tsx`: LockButton, then the `App-toolbar__divider` with the
    // quarter-rem margin, then the hand). Without the divider the island is
    // one button narrow of the reference's box.
    const lockDivider = createElement("div");
    lockDivider.classList.add("App-toolbar__divider");
    lockDivider.style.width = "1px";
    lockDivider.style.height = "1.5rem";
    lockDivider.style.backgroundColor = "var(--default-border-color)";
    lockDivider.style.margin = "0 auto";
    lockDivider.style.marginRight = "0.25rem";
    root.appendChild(lockDivider);
  }
  const buttons = [];
  const or = text("ui.tool.or", "or");
  // The extra tools live behind upstream's dropdown (`Toolbar.tsx`'s
  // ExtraToolsDropdown): a dots trigger and a labelled vertical menu. The
  // boundary is a 1.5rem rule, the toolbar's own divider, not the 1rem
  // separator the chrome's islands use.
  const wrapper = createElement("div");
  wrapper.classList.add("extra-tools");
  const moreTools = text("ui.extra-tools.label", "More tools");
  const trigger = iconButton({ createElement }, {
    icon: CHROME_ICONS.DotsIcon,
    label: moreTools,
    type: "icon",
    attributes: {
      "data-extra-tools": "trigger",
      "data-extra-tools-trigger": "",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-controls": "extra-tools-panel",
      title: moreTools,
    },
  });
  trigger.classList.add("App-toolbar__extra-tools-trigger");
  const triggerIcon = trigger.children[0];
  const panel = createElement("div");
  panel.id = "extra-tools-panel";
  panel.classList.add("extra-tools-panel");
  panel.setAttribute("role", "menu");
  panel.setAttribute("aria-orientation", "vertical");
  // The trigger names the menu (aria-controls); an aria-label here would make
  // the panel a second landmark for the same words, and a runtime landmark is
  // one the page's own landmark catalogue cannot declare.
  panel.hidden = true;
  const setOpen = (open) => {
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  };
  trigger.addEventListener("click", () => setOpen(panel.hidden), { signal });
  const owner = wrapper.ownerDocument ?? root.ownerDocument;
  if (owner !== undefined && typeof owner.addEventListener === "function") {
    owner.addEventListener("pointerdown", (event) => {
      if (panel.hidden || trigger.contains(event.target) || panel.contains(event.target)) {
        return;
      }
      setOpen(false);
    }, { signal });
    owner.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        setOpen(false);
      }
    }, { signal });
  }
  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);
  // Upstream's menu leads with the image row (`Toolbar.tsx`: the `image` item
  // first, shortcut 9). The image is not a *tool* in this build — there is no
  // image tool state, only the import door the menu already opens — so the row
  // is a command item, and its shortcut is the same `insertImage` key the
  // command registry already answers (`commands.mjs`).
  const imageItem = menuItem({
    createElement,
    icon: CHROME_ICONS.ImageIcon,
    label: text("ui.extra.image.text", "Insert image"),
    shortcut: "9",
    attributes: { "data-command": "insertImage", "data-testid": "toolbar-image" },
  });
  imageItem.addEventListener("click", () => {
    setOpen(false);
    onCommand?.("insertImage");
  }, { signal });
  panel.appendChild(imageItem);

  // The extras are built before they are appended, so the menu can hold
  // upstream's order (image, frame, embeddable, laser) while `TOOL_BUTTONS`
  // keeps the keyboard's table order — the two orders are different facts.
  const extraButtons = new Map();
  for (const { tool } of TOOL_BUTTONS) {
    const extra = EXTRA_TOOLS.has(tool);
    const iconName = TOOL_ICONS[tool];
    if (iconName === undefined) {
      throw new Error(`no icon in the iconary names the tool ${JSON.stringify(tool)}`);
    }
    const shortcut = shortcutLabelFor(tool, or);
    const attributes = {
      "data-tool": tool,
      title: buttonTitle(tool, or),
      ...(shortcut === null ? {} : { "aria-keyshortcuts": shortcut }),
    };
    const button = extra
      ? menuItem({
          createElement,
          icon: CHROME_ICONS[iconName],
          // The menu row's words are visible text, not only an `aria-label`:
          // `localizeTools` rewrites the attribute, so the label the row is
          // born with has to be the locale's already.
          label: text(`ui.tool.${tool}.text`, buttonText(tool)),
          shortcut: letterKeyFor(tool) ?? undefined,
          attributes,
        })
      : iconButton({ createElement }, {
          icon: CHROME_ICONS[iconName],
          label: buttonText(tool),
          type: "toggle",
          keyBinding: keyBindingFor(tool) ?? undefined,
          attributes,
        });
    if (extra) {
      extraButtons.set(tool, button);
    } else {
      root.appendChild(button);
    }
    buttons.push(button);
  }
  for (const tool of EXTRA_TOOL_ORDER) {
    const button = extraButtons.get(tool);
    if (button === undefined) {
      continue;
    }
    panel.appendChild(button);
  }
  // The divider and its wrapper go in front of the hand's right neighbour —
  // the row's last inline tool — which is where upstream draws the boundary
  // (`Toolbar.tsx`: the last tool, then the divider with the quarter-rem
  // margin, then the extra-tools trigger).
  root.appendChild(wrapper);
  const divider = createElement("div");
  divider.classList.add("App-toolbar__divider");
  divider.style.width = "1px";
  divider.style.height = "1.5rem";
  divider.style.backgroundColor = "var(--default-border-color)";
  divider.style.margin = "0 auto";
  divider.style.marginLeft = "0.25rem";
  root.insertBefore(divider, wrapper);

  const refresh = () => {
    if (penButton !== null) {
      const on = penMode.isOn();
      penButton.setAttribute("aria-pressed", on ? "true" : "false");
      penButton.classList.toggle("ToolIcon--checked", on);
    }
    if (lockButton !== null) {
      const on = toolLock.isOn();
      lockButton.setAttribute("aria-pressed", on ? "true" : "false");
      lockButton.classList.toggle("ToolIcon--checked", on);
    }
    // Upstream's trigger wears the armed extra tool's drawing and its selected
    // state (`Toolbar.tsx`: the ternary over `imageToolSelected` … then
    // `DotsIcon`), so the row says where the tool in hand came from.
    const extraActive = EXTRA_TOOLS.has(toolState.currentTool);
    const extraIcon = EXTRA_TRIGGER_ICONS[toolState.currentTool];
    triggerIcon.innerHTML = extraIcon === undefined ? CHROME_ICONS.DotsIcon : extraIcon();
    trigger.classList.toggle("App-toolbar__extra-tools-trigger--selected", extraActive);
    for (const button of buttons) {
      const lit = button.dataset.tool === toolState.currentTool;
      button.setAttribute("aria-pressed", lit ? "true" : "false");
      // The class the stylesheet draws, beside the attribute assistive
      // technology reads — one state, two writings, and both come from the
      // same reading so neither can go stale. A menu row draws its selected
      // state with upstream's own class, an inline toggle with the ToolIcon
      // one (`dropdownMenu/DropdownMenu.scss`: `--selected`).
      const selectedClass = button.classList.contains("dropdown-menu-item")
        ? "dropdown-menu-item--selected"
        : "ToolIcon--checked";
      button.classList.toggle(selectedClass, lit);
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      // The toggle, matching upstream: pressing the active tool returns to
      // selection rather than re-selecting it. Two presses and you are back
      // where you started, which is what a user expects from a mode control
      // and what `Escape` does for the keyboard.
      toolState.currentTool =
        toolState.currentTool === tool ? TOOLS.selection : tool;
      if (EXTRA_TOOLS.has(tool)) {
        setOpen(false);
      }
      refresh();
      onChange?.();
    }, { signal });
  }

  refresh();
  return refresh;
}