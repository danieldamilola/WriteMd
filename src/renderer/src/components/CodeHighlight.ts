import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

// VS Code Dark+ / Light+ token colors via CSS vars so themes stay in charge.
// Vars are defined in styles/themes.css per theme. Backgrounds stay transparent.
export const vscodeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--code-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--code-keyword)' },
  { tag: tags.moduleKeyword, color: 'var(--code-keyword)' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: tags.special(tags.string), color: 'var(--code-string)' },
  { tag: tags.regexp, color: 'var(--code-string)' },
  { tag: tags.character, color: 'var(--code-string)' },
  { tag: tags.comment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--code-number)' },
  { tag: tags.bool, color: 'var(--code-number)' },
  { tag: tags.null, color: 'var(--code-number)' },
  { tag: tags.function(tags.variableName), color: 'var(--code-function)' },
  { tag: tags.function(tags.propertyName), color: 'var(--code-function)' },
  { tag: tags.typeName, color: 'var(--code-type)' },
  { tag: tags.className, color: 'var(--code-type)' },
  { tag: tags.labelName, color: 'var(--code-type)' },
  { tag: tags.namespace, color: 'var(--code-type)' },
  { tag: tags.variableName, color: 'var(--code-variable)' },
  { tag: tags.standard(tags.variableName), color: 'var(--code-variable)' },
  { tag: tags.self, color: 'var(--code-variable)' },
  { tag: tags.propertyName, color: 'var(--code-variable)' },
  { tag: tags.attributeName, color: 'var(--code-variable)' },
  { tag: tags.definition(tags.propertyName), color: 'var(--code-variable)' },
  { tag: tags.tagName, color: 'var(--code-keyword)' },
  { tag: tags.angleBracket, color: 'var(--code-punctuation)' },
  { tag: tags.operator, color: 'var(--code-punctuation)' },
  { tag: tags.punctuation, color: 'var(--code-punctuation)' },
  { tag: [tags.bracket, tags.brace, tags.paren], color: 'var(--code-punctuation)' },
  { tag: tags.separator, color: 'var(--code-punctuation)' },
  { tag: tags.meta, color: 'var(--code-comment)' },
  { tag: tags.link, color: 'var(--code-string)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--code-string)', textDecoration: 'underline' },
  { tag: tags.invalid, color: 'var(--danger)' }
])

export const vscodeHighlight = syntaxHighlighting(vscodeHighlightStyle)
