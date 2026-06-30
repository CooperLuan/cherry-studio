import { expect, test } from '../../fixtures/seeded-electron.fixture'
import { ChatAgentPage } from '../../pages/chat-agent.page'
import { waitForAppReady } from '../../utils/wait-helpers'

/**
 * Spec (ws-f1, full · live: llm + websearch): a web-search-enabled assistant actually calls the
 * web_search tool. Anchor = `message-tool-history` envelope (≥1 tool called); never asserts
 * search content/ranking/quality. First tool call can take ~70s under live LLM.
 */
test.describe('WebSearch · assistant searches the web (agentic)', () => {
  test('assistant calls the web search tool', async ({ mainWindow }) => {
    test.setTimeout(300_000)
    await waitForAppReady(mainWindow)
    const chat = new ChatAgentPage(mainWindow)
    await chat.gotoAssistants()
    await chat.selectAssistant('E2E_WebSearch_Test_Assistant')

    await chat.ask('用网络搜索查一下 2026 年 6 月 OpenAI 有哪些新发布，并给出来源链接。')

    await expect(chat.toolHistory).toBeVisible({ timeout: 180_000 })
  })
})
