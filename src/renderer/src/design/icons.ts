import { svg, type TemplateResult } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon'
import ArrowLeft01Icon from '@hugeicons/core-free-icons/ArrowLeft01Icon'
import BotIcon from '@hugeicons/core-free-icons/BotIcon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import FileScriptIcon from '@hugeicons/core-free-icons/FileScriptIcon'
import FolderOpenIcon from '@hugeicons/core-free-icons/FolderOpenIcon'
import FolderTreeIcon from '@hugeicons/core-free-icons/FolderTreeIcon'
import InformationCircleIcon from '@hugeicons/core-free-icons/InformationCircleIcon'
import KeyboardIcon from '@hugeicons/core-free-icons/KeyboardIcon'
import LayoutAlignRightIcon from '@hugeicons/core-free-icons/LayoutAlignRightIcon'
import MoreHorizontalIcon from '@hugeicons/core-free-icons/MoreHorizontalIcon'
import PaintBoardIcon from '@hugeicons/core-free-icons/PaintBoardIcon'
import PencilEdit01Icon from '@hugeicons/core-free-icons/PencilEdit01Icon'
import PreferenceHorizontalIcon from '@hugeicons/core-free-icons/PreferenceHorizontalIcon'
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon'
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon'
import SidebarRight01Icon from '@hugeicons/core-free-icons/SidebarRight01Icon'
import SparklesIcon from '@hugeicons/core-free-icons/SparklesIcon'
import PinIcon from '@hugeicons/core-free-icons/PinIcon'
import Menu01Icon from '@hugeicons/core-free-icons/Menu01Icon'
import Download01Icon from '@hugeicons/core-free-icons/Download01Icon'
import ReloadIcon from '@hugeicons/core-free-icons/ReloadIcon'
import Home01Icon from '@hugeicons/core-free-icons/Home01Icon'

/** The same deep-imported Hugeicons chrome set used by MonoCode. */
const glyphs = {
  plus: Add01Icon,
  'arrow-left': ArrowLeft01Icon,
  bot: BotIcon,
  x: Cancel01Icon,
  file: FileScriptIcon,
  'file-text': FileScriptIcon,
  'folder-open': FolderOpenIcon,
  'folder-tree': FolderTreeIcon,
  info: InformationCircleIcon,
  keyboard: KeyboardIcon,
  sidebar: LayoutAlignRightIcon,
  split: SidebarRight01Icon,
  'more-horizontal': MoreHorizontalIcon,
  palette: PaintBoardIcon,
  pencil: PencilEdit01Icon,
  sliders: PreferenceHorizontalIcon,
  search: Search01Icon,
  settings: Settings01Icon,
  sparkle: SparklesIcon,
  pin: PinIcon,
  menu: Menu01Icon,
  download: Download01Icon,
  refresh: ReloadIcon,
  home: Home01Icon
}
const cache = new Map<string, string>()
const escape = (value: string | number): string =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
export function chromeIcon(name: string, size = 16): TemplateResult | null {
  if (!(name in glyphs)) return null
  let markup = cache.get(name)
  if (!markup) {
    // Only bundled, trusted catalog data reaches unsafeSVG; no user content.
    const rendered = glyphs[name as keyof typeof glyphs]
      .map(
        ([tag, attributes]) =>
          `<${tag} ${Object.entries(attributes)
            .filter(([key]) => key !== 'key')
            .map(([key, value]) => `${key}="${escape(String(value))}"`)
            .join(' ')} />`
      )
      .join('')
    cache.set(name, rendered)
    markup = rendered
  }
  return svg`<svg data-icon=${name} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${unsafeSVG(markup)}</svg>`
}
