import { diff, presentableDiff } from '@codemirror/merge'

const DIFF_LIMITS = { scanLimit: 500, timeout: 50 }

/** Keep unchanged text and its selections intact during an external update. */
export function documentChanges(
  original: string,
  content: string
): Array<{
  from: number
  to: number
  insert: string
}> {
  return diff(original, content, DIFF_LIMITS).map((change) => ({
    from: change.fromA,
    to: change.toA,
    insert: content.slice(change.fromB, change.toB)
  }))
}

/** Show only affected passages in the existing edit preview. */
export function previewChanges(
  original: string,
  content: string
): Array<{
  original: string
  content: string
}> {
  return presentableDiff(original, content, DIFF_LIMITS).map((change) => ({
    original: original.slice(change.fromA, change.toA),
    content: content.slice(change.fromB, change.toB)
  }))
}
