import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f2, full · live: llm + websearch): a web-search agent actually calls the web_search
 * tool. Anchor = `message-tool-history` envelope. Pick the agent from the bottom picker, type
 * into the draft, send (no global "new session").
 */
test.describe('WebSearch · agent searches the web (agentic)', () => {
  test('agent calls the web search tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.gotoAgents()
    await chat.selectAgent('E2E_WebSearch_Test_Agent')

    await chat.ask('用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
  })
})
