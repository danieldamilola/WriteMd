import { html, nothing, type TemplateResult } from 'lit'
import { icon } from './icons'
import { GROUP_ICON_PRESETS, GROUP_ICON_SIZE, isGroupIcon } from '../state/group-icons'

/**
 * The icon a group row draws.
 *
 * A group with no choice, or one restored from a profile written before
 * presets existed, gets the folder pair that opens and closes with the group,
 * which is what the row used to show before the chevron was folded into it.
 */
export function groupRowIcon(group: { icon?: string; collapsed: boolean }): TemplateResult {
  if (isGroupIcon(group.icon)) return icon(group.icon, GROUP_ICON_SIZE)
  return icon(group.collapsed ? 'folder' : 'folder-open', GROUP_ICON_SIZE)
}

/**
 * The picker both context menus render in place of the old colour swatches.
 *
 * `onPick` runs before the caller closes the menu, so the row updates in the
 * same frame and reopening the menu shows the choice already applied. The grid
 * wraps rather than scrolls, because a menu tall enough to scroll hides its
 * own divider from the rows below.
 */
export function renderGroupIconPicker(
  current: string | undefined,
  onPick: (id: string) => void
): TemplateResult {
  return html`
    <div class="group-icon-picker" role="group" aria-label="Group icon">
      ${GROUP_ICON_PRESETS.map(
        (preset) => html`
          <div
            class="group-icon-choice ${preset.id === current ? 'selected' : ''}"
            role="button"
            tabindex="0"
            title=${preset.label}
            aria-label=${preset.label}
            aria-pressed=${preset.id === current ? 'true' : 'false'}
            @click=${(e: MouseEvent) => {
              e.stopPropagation()
              onPick(preset.id)
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              e.stopPropagation()
              onPick(preset.id)
            }}
          >
            ${icon(preset.id, GROUP_ICON_SIZE)}
          </div>
        `
      )}
    </div>
  `
}

/**
 * The icon a "Move to <group>" entry carries, so a group looks the same in the
 * list it can be moved into as it does in the row it lives in. Unset groups
 * carry nothing rather than a folder, since the label already says which
 * group it is.
 */
export function renderGroupMenuIcon(group: { icon?: string }): TemplateResult | typeof nothing {
  if (!isGroupIcon(group.icon)) return nothing
  return html`<span class="group-menu-icon">${icon(group.icon, GROUP_ICON_SIZE)}</span>`
}
