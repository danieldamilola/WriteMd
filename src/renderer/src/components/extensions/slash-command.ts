import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

function slashCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/^\/\w*/)
  if (!word) return null
  if (word.from !== word.to && !context.explicit) return null

  return {
    from: word.from,
    options: [
      {
        label: '/table',
        type: 'keyword',
        info: 'Insert a new Markdown table',
        apply: (view, _completion, from, to) => {
          const tableStr = `| Column 1 | Column 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n`
          view.dispatch({
            changes: { from, to, insert: tableStr },
            selection: { anchor: from + 2, head: from + 10 }
          })
        }
      }
    ]
  }
}

export const slashCommandPlugin = autocompletion({
  override: [slashCompletions]
})
