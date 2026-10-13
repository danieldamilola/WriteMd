export interface AiSkillView {
  name: string
  description: string
}

export interface AiSkillsView {
  folder: string
  skills: AiSkillView[]
  warnings: string[]
}
