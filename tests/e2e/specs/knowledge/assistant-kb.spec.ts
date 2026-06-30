import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage } from '../../pages/chat-agent.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-f1, full · live: llm + embedding): a KB-equipped assistant actually calls a knowledge
 * tool. Deterministic anchor = the `message-tool-history` envelope (≥1 tool called); we never
 * assert retrieval ranking/scores/content. Envelope-missing = model didn't call (capability) or
 * tool broke — full-tier is reported, not gating.
 */
test.describe('Knowledge · assistant retrieves KB (agentic)', () => {
  // fixme: the KB assistant's model does not reliably call the KB tool here (capability, not a
  // harness/tool bug — the agent variant kb-f2 calls the same tools and passes; full-tier is
  // reported, not gating). Re-enable once the assistant model reliably triggers the tool.
  test.fixme('assistant calls a knowledge tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.gotoAssistants()
    await chat.selectAssistant('E2E_Knowledge_Test_Assistant(no_vision)')

    await chat.ask(`在我的知识库里查一下 ${fixturePath('recall-query')} 相关内容并引用。`)

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
  })
})
