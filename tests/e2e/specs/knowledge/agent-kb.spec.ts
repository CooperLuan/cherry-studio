import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage } from '../../pages/chat-agent.page'
import { fixturePath } from '../../utils/e2e-env'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (kb-f2, full · live: llm + embedding): a KB-equipped agent actually calls a knowledge
 * tool (kb_search scopes all bases; golden's completed E2E_Test_KB is enough). Anchor =
 * `message-tool-history` envelope. Pick the agent from the bottom picker, type into the draft,
 * send — do NOT click a global "new session" (it would drift ownership to the wrong agent).
 */
test.describe('Knowledge · agent retrieves KB (agentic)', () => {
  test('agent calls a knowledge tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.gotoAgents()
    await chat.selectAgent('E2E_Knowledge_Test_Agent(no_vision)')

    await chat.ask(`在我的知识库里查一下 ${fixturePath('recall-query')} 相关内容并引用。`)

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
  })
})
