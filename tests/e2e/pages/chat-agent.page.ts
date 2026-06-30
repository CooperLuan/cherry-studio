import type { Locator, Page } from '@playwright/test'

import { t } from '../utils/i18n'
import { BasePage } from './base.page'

/**
 * Page Object for the agentic chat flow (assistants / agents pages): pick a session owner from
 * the bottom picker, type a prompt, send, and observe the tool-call envelope.
 *
 * These flows are full-tier (live LLM). The deterministic anchor is `message-tool-history`
 * (the process-history collapse group, rendered iff ≥1 tool was actually called) — we assert the
 * envelope, never the model's text/ranking/quality.
 */
export class ChatAgentPage extends BasePage {
  async gotoAssistants(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-assistants"]').click()
  }

  async gotoAgents(): Promise<void> {
    await this.page.locator('[data-testid="sidebar-nav-agents"]').click()
  }

  /** The bottom session-owner picker (Popover trigger showing the current 💬 assistant / 🤖 agent). */
  picker(marker: '💬' | '🤖'): Locator {
    return this.page.locator('button[data-slot="popover-trigger"]').filter({ hasText: marker })
  }

  async selectAssistant(name: string): Promise<void> {
    await this.picker('💬').first().click()
    await this.page.getByRole('option').filter({ hasText: name }).first().click()
  }

  async selectAgent(name: string): Promise<void> {
    await this.picker('🤖').first().click()
    await this.page.getByRole('option').filter({ hasText: name }).first().click()
  }

  get composer(): Locator {
    return this.page.locator('[contenteditable="true"]').first()
  }

  get sendButton(): Locator {
    return this.page.getByRole('button', { name: t('chat.input.send') })
  }

  /** Type a prompt into the composer and send it. */
  async ask(prompt: string): Promise<void> {
    await this.composer.click()
    await this.composer.pressSequentially(prompt)
    await this.sendButton.click()
  }

  /** Process-history collapse group — present iff ≥1 tool was called. */
  get toolHistory(): Locator {
    return this.page.locator('[data-testid="message-tool-history"]')
  }

  /** Web search result block — mounted only when a search finished with results. */
  get webSearchResult(): Locator {
    return this.page.locator('[data-testid="message-websearch-result"]')
  }
}
