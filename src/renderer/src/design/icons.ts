import { css, html, svg, type TemplateResult } from 'lit'
import { unsafeSVG } from 'lit/directives/unsafe-svg.js'
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon'
import ArrowLeft01Icon from '@hugeicons/core-free-icons/ArrowLeft01Icon'
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon'
import BotIcon from '@hugeicons/core-free-icons/BotIcon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import FileScriptIcon from '@hugeicons/core-free-icons/FileScriptIcon'
import Folder01Icon from '@hugeicons/core-free-icons/Folder01Icon'
import FolderOpenIcon from '@hugeicons/core-free-icons/FolderOpenIcon'
import FolderAddIcon from '@hugeicons/core-free-icons/FolderAddIcon'
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
  'arrow-down': ArrowDown01Icon,
  bot: BotIcon,
  x: Cancel01Icon,
  file: FileScriptIcon,
  'file-text': FileScriptIcon,
  folder: Folder01Icon,
  'folder-open': FolderOpenIcon,
  'folder-plus': FolderAddIcon,
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
export const DEFAULT_ICON_SIZE = 18

let aiMaskId = 0

/** Motion from the supplied WriteMd AI artwork, resolved by the app's motion preference. */
export const aiActivityStyles = css`
  [data-icon='ai-thinking'] .writemd-ai-eyes {
    transform-origin: 627px 653px;
    animation: writemd-ai-think 3.2s ease-in-out infinite;
  }
  [data-icon='ai-thinking'] .writemd-ai-doc {
    animation: writemd-ai-float 3.2s ease-in-out infinite;
  }
  .writemd-ai-thinking-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 20px;
    font-family: var(--font-ui);
    font-weight: 500;
    font-size: 13px;
    line-height: 20px;
  }
  .writemd-ai-thinking-label svg {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
  }
  .writemd-ai-thinking-label .writemd-ai-dot {
    animation: writemd-ai-dot 1.4s ease-in-out infinite;
  }
  .writemd-ai-thinking-label .writemd-ai-dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .writemd-ai-thinking-label .writemd-ai-dot:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes writemd-ai-think {
    0%,
    100% {
      transform: translate(0, 0) scaleY(1);
    }
    12%,
    32% {
      transform: translate(-36px, -14px) scaleY(1);
    }
    46%,
    66% {
      transform: translate(36px, -14px) scaleY(1);
    }
    78%,
    92% {
      transform: translate(0, 0) scaleY(1);
    }
    86% {
      transform: translate(0, 0) scaleY(0.08);
    }
  }
  @keyframes writemd-ai-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
  @keyframes writemd-ai-dot {
    0%,
    60%,
    100% {
      opacity: 0.2;
    }
    30% {
      opacity: 1;
    }
  }
  :host-context([data-motion='reduced']) [data-icon='ai-thinking'] .writemd-ai-eyes,
  :host-context([data-motion='reduced']) [data-icon='ai-thinking'] .writemd-ai-doc,
  :host-context([data-motion='reduced']) .writemd-ai-thinking-label .writemd-ai-dot {
    animation: none;
  }
  :host-context([data-motion='reduced']) .writemd-ai-thinking-label .writemd-ai-dot {
    opacity: 1;
  }
`

/** Reuses the supplied silhouette. White and black are mask coverage, not interface colours. */
function aiMask(maskId: string): TemplateResult {
  return svg`<defs><mask id=${maskId} maskUnits="userSpaceOnUse" x="200" y="200" width="860" height="900">
      <rect x="200" y="200" width="860" height="900" fill="white" />
      <path fill="black" d="M730 282C755 305 770 350 780 400C790 440 800 462 840 468C880 472 915 478 928 492H795C760 492 731 465 731 430Z" />
      <g class="writemd-ai-eyes" fill="black">
        <rect x="493" y="565" width="76" height="176" rx="38" />
        <rect x="686" y="565" width="76" height="176" rx="38" />
      </g>
    </mask></defs>`
}

function aiDocument(maskId: string): TemplateResult {
  return svg`<g class="writemd-ai-doc"><path fill="currentColor" d="M432 246H690C725 246 748 258 770 278L925 455C945 478 956 495 956 520V900A130 130 0 0 1 826 1030H432A130 130 0 0 1 302 900V376A130 130 0 0 1 432 246Z" mask=${`url(#${maskId})`} /></g>`
}

function aiIcon(name: 'ai' | 'ai-thinking', size: number): TemplateResult {
  const maskId = `writemd-ai-mask-${++aiMaskId}`
  return svg`<svg data-icon=${name} width=${size} height=${size} viewBox="260 220 740 840" fill="none" aria-hidden="true">
    ${aiMask(maskId)}${aiDocument(maskId)}
  </svg>`
}

/** The supplied unified Thinking artwork, with theme colour and shared typography. */
export function aiThinkingLabel(): TemplateResult {
  return html`<span class="writemd-ai-thinking-label" data-artwork="label">
    ${aiIcon('ai-thinking', 18)}
    <span class="writemd-ai-thinking-text"
      >Thinking<span class="writemd-ai-dot">.</span><span class="writemd-ai-dot">.</span
      ><span class="writemd-ai-dot">.</span></span
    >
  </span>`
}

export function chromeIcon(name: string, size = DEFAULT_ICON_SIZE): TemplateResult | null {
  if (name === 'ai' || name === 'ai-thinking') return aiIcon(name, size)
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
