import { DWClient, EventAck, TOPIC_ROBOT } from 'dingtalk-stream';
import crypto from 'crypto';
import { dingtalkDb } from './database/db.js';
import { queryClaudeSDK } from './claude-sdk.js';
import { getProjects } from './projects.js';
import {
  createAICardInstance,
  deliverAICard,
  startAICardStreaming,
  streamAICardContent,
  finishAICard,
  sendMessage,
} from './dingtalk-cards.js';

// 钉钉首条消息前置提示词
const DINGTALK_SYSTEM_INSTRUCTIONS = `## 工作规范

你正在通过钉钉机器人与用户交互。请严格遵循以下规则：

1. **禁止在主分支操作**：所有代码修改必须先创建新分支，在新分支上进行，完成后提交该分支。绝对不允许直接在 main/master 分支上修改或提交。
2. **拉取最新代码**：每次开始工作前，先执行 git pull 拉取最新代码。
3. **确认方案**：在修改任何代码之前，必须先向用户说明你的修改方案，等用户确认后再执行。不要未经确认就开始改代码。
4. **提交规范**：改动完成后，在新分支上提交代码，并告知用户分支名称。`;

let streamClient = null;
let cachedAccessToken = null;
let tokenExpiresAt = 0;
let connectionInfo = {
  connected: false,
  connectedAt: null,
  messageCount: 0,
  lastMessageAt: null,
  clientId: null,
};

// Current config used by the stream client
let activeConfig = null;

// Event deduplication
const processedEvents = new Map();
const EVENT_CACHE_TTL = 5 * 60 * 1000;

function isEventProcessed(eventId) {
  return processedEvents.has(eventId);
}
function markEventProcessed(eventId) {
  processedEvents.set(eventId, Date.now());
}
function cleanupOldEvents() {
  const now = Date.now();
  for (const [id, ts] of processedEvents.entries()) {
    if (now - ts > EVENT_CACHE_TTL) processedEvents.delete(id);
  }
}

/**
 * Get DingTalk access token with caching (7200s validity, refresh 5 min early)
 */
export async function getAccessToken(clientId, clientSecret) {
  const cid = clientId || activeConfig?.client_id;
  const cs = clientSecret || activeConfig?.client_secret;

  if (!cid || !cs) {
    throw new Error('DingTalk client credentials not configured');
  }

  const now = Date.now();
  if (cachedAccessToken && now < tokenExpiresAt) {
    return cachedAccessToken;
  }

  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: cid, appSecret: cs }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to get DingTalk access token (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedAccessToken = data.accessToken;
  tokenExpiresAt = now + ((data.expireIn || 7200) - 300) * 1000;
  return cachedAccessToken;
}

// ==================== DingTalkCardWriter ====================

/**
 * DingTalkCardWriter — same interface as SSEStreamWriter / WebSocketWriter
 * Uses DingTalk's built-in AI Card template for streaming responses.
 */
class DingTalkCardWriter {
  constructor({ accessToken, outTrackId, conversationId }) {
    this.accessToken = accessToken;
    this.outTrackId = outTrackId;
    this.conversationId = conversationId;
    this.sessionId = null;
    this.isDingTalkCardWriter = true;

    this._steps = [];          // Completed step strings (tool calls, text blocks)
    this._streamingText = '';   // Current streaming text accumulator
    this._buffer = '';          // Full rendered markdown
    this._debounceTimer = null;
    this._debounceMs = 500;
    this._finalized = false;
    this._inputingStarted = false;
    this._pendingTools = new Map(); // toolId → step index for result matching
  }

  send(data) {
    if (this._finalized) return;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'session-created':
        if (data.sessionId) {
          this.sessionId = data.sessionId;
          if (this.conversationId) {
            dingtalkDb.updateConversationSession(this.conversationId, data.sessionId);
          }
        }
        break;

      case 'claude-response':
        this._handleResponse(data.data);
        break;

      case 'claude-complete':
        this._finalize();
        break;

      case 'claude-error':
        this._handleError(data.error);
        break;

      default:
        break;
    }
  }

  setSessionId(id) { this.sessionId = id; }
  getSessionId() { return this.sessionId; }

  _handleResponse(msgData) {
    if (!msgData) return;

    // Case 1: Streaming text delta — append to current streaming text
    if (msgData.type === 'content_block_delta' && msgData.delta?.text) {
      this._streamingText += msgData.delta.text;
      this._rebuildBuffer();
      this._scheduleUpdate();
      return;
    }

    // Case 2: Content block stop — commit streaming text as a step
    if (msgData.type === 'content_block_stop') {
      if (this._streamingText.trim()) {
        this._steps.push(this._streamingText.trim());
        this._streamingText = '';
        this._rebuildBuffer();
      }
      this._scheduleUpdate();
      return;
    }

    // Case 3: Full message with content array
    const content = msgData.message?.content || msgData.content;
    const role = msgData.message?.role || msgData.role;

    if (Array.isArray(content)) {
      // Tool results (role: user)
      if (role === 'user') {
        for (const part of content) {
          if (part.type === 'tool_result' && part.tool_use_id) {
            const stepIdx = this._pendingTools.get(part.tool_use_id);
            if (stepIdx !== undefined) {
              // Mark tool as complete, append brief result if error
              if (part.is_error) {
                this._steps[stepIdx] += ' ❌';
                const errText = this._extractResultText(part.content);
                if (errText) {
                  this._steps[stepIdx] += ` ${errText.slice(0, 100)}`;
                }
              } else {
                this._steps[stepIdx] += ' ✅';
              }
              this._pendingTools.delete(part.tool_use_id);
            }
          }
        }
        this._rebuildBuffer();
        this._scheduleUpdate();
        return;
      }

      // Assistant message with tool_use and/or text blocks
      // First, commit any pending streaming text
      if (this._streamingText.trim()) {
        this._steps.push(this._streamingText.trim());
        this._streamingText = '';
      }

      for (const part of content) {
        if (part.type === 'tool_use') {
          const summary = this._formatToolUse(part.name, part.input);
          const stepIdx = this._steps.length;
          this._steps.push(summary);
          if (part.id) {
            this._pendingTools.set(part.id, stepIdx);
          }
        } else if (part.type === 'text' && part.text?.trim()) {
          this._steps.push(part.text.trim());
        }
      }

      this._rebuildBuffer();
      this._scheduleUpdate();
      return;
    }

    // Case 4: Simple string or other format
    if (typeof msgData === 'string' && msgData.trim()) {
      this._steps.push(msgData.trim());
      this._rebuildBuffer();
      this._scheduleUpdate();
    }
  }

  _formatToolUse(name, input) {
    if (!input) return `> 🔧 **${name}**`;
    switch (name) {
      case 'Read':
        return `> 📖 **Read** \`${this._shortPath(input.file_path)}\``;
      case 'Edit':
        return `> ✏️ **Edit** \`${this._shortPath(input.file_path)}\``;
      case 'Write':
        return `> 📝 **Write** \`${this._shortPath(input.file_path)}\``;
      case 'Bash':
        return `> 💻 **Run** \`${(input.command || '').slice(0, 60)}${(input.command || '').length > 60 ? '...' : ''}\``;
      case 'Glob':
        return `> 🔍 **Search files** \`${input.pattern || ''}\``;
      case 'Grep':
        return `> 🔍 **Search** \`${input.pattern || ''}\`${input.path ? ` in \`${this._shortPath(input.path)}\`` : ''}`;
      case 'Task':
        return `> 🤖 **Task** ${input.description || ''}`;
      case 'WebSearch':
        return `> 🌐 **Search** ${input.query || ''}`;
      case 'WebFetch':
        return `> 🌐 **Fetch** ${input.url || ''}`;
      default:
        return `> 🔧 **${name}**`;
    }
  }

  _shortPath(filePath) {
    if (!filePath) return '';
    const parts = filePath.split('/');
    return parts.length > 3 ? '.../' + parts.slice(-3).join('/') : filePath;
  }

  _extractResultText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join(' ')
        .slice(0, 200);
    }
    return '';
  }

  _rebuildBuffer() {
    const parts = [...this._steps];
    if (this._streamingText.trim()) {
      parts.push(this._streamingText);
    }
    this._buffer = parts.join('\n\n');
  }

  _scheduleUpdate() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flushUpdate(), this._debounceMs);
  }

  async _flushUpdate() {
    if (this._finalized || !this._buffer) return;

    try {
      // Start INPUTING state on first write
      if (!this._inputingStarted) {
        await startAICardStreaming({ accessToken: this.accessToken, outTrackId: this.outTrackId });
        this._inputingStarted = true;
      }

      await streamAICardContent({
        accessToken: this.accessToken,
        outTrackId: this.outTrackId,
        content: this._buffer,
        isFull: true,
        isFinalize: false,
        isError: false,
      });
    } catch (err) {
      console.error('[DingTalk] Stream update error:', err.message);
    }
  }

  async _finalize() {
    if (this._finalized) return;
    this._finalized = true;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    try {
      // Ensure INPUTING state was started before finalizing
      if (!this._inputingStarted) {
        await startAICardStreaming({ accessToken: this.accessToken, outTrackId: this.outTrackId });
        this._inputingStarted = true;
      }

      // Final stream write
      await streamAICardContent({
        accessToken: this.accessToken,
        outTrackId: this.outTrackId,
        content: this._buffer || '(empty response)',
        isFull: true,
        isFinalize: true,
        isError: false,
      });

      // Set card to FINISHED state
      await finishAICard({
        accessToken: this.accessToken,
        outTrackId: this.outTrackId,
        finalContent: this._buffer || '(empty response)',
      });
    } catch (err) {
      console.error('[DingTalk] Finalize error:', err.message);
      // Try to force finish even if streaming failed
      try {
        await finishAICard({
          accessToken: this.accessToken,
          outTrackId: this.outTrackId,
          finalContent: this._buffer || '(error)',
        });
      } catch (e) {
        console.error('[DingTalk] Force finish also failed:', e.message);
      }
    }

    // Store assistant message
    if (this.conversationId && this._buffer) {
      dingtalkDb.addMessage(this.conversationId, 'assistant', this._buffer, this.outTrackId);
    }
  }

  async _handleError(error) {
    this._finalized = true;

    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    const errMsg = typeof error === 'string' ? error : (error?.message || 'Unknown error');

    try {
      if (!this._inputingStarted) {
        await startAICardStreaming({ accessToken: this.accessToken, outTrackId: this.outTrackId });
        this._inputingStarted = true;
      }

      await streamAICardContent({
        accessToken: this.accessToken,
        outTrackId: this.outTrackId,
        content: `Error: ${errMsg}`,
        isFull: true,
        isFinalize: true,
        isError: true,
      });
    } catch (err) {
      console.error('[DingTalk] Error card update failed:', err.message);
    }
  }
}

// ==================== OpenSpaceId ====================

function buildOpenSpaceId(conversationType, conversationId, senderStaffId) {
  if (conversationType === '2') {
    return `dtv1.card//IM_GROUP.${conversationId}`;
  }
  return `dtv1.card//IM_ROBOT.${senderStaffId}`;
}

// ==================== Process with Claude ====================

async function processWithClaude({ userMessage, conv, accessToken, config }) {
  const outTrackId = `claude_${conv.id}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const openSpaceId = buildOpenSpaceId(conv.conversation_type, conv.dingtalk_conversation_id, conv.sender_staff_id);

  // Step 1: Create AI Card instance
  await createAICardInstance({ accessToken, outTrackId });

  // Step 2: Deliver AI Card
  await deliverAICard({
    accessToken,
    outTrackId,
    openSpaceId,
    robotCode: config.client_id,
    conversationType: conv.conversation_type,
  });

  // Store user message
  dingtalkDb.addMessage(conv.id, 'user', userMessage);

  // Create writer
  const writer = new DingTalkCardWriter({
    accessToken,
    outTrackId,
    conversationId: conv.id,
  });

  if (conv.claude_session_id) {
    writer.setSessionId(conv.claude_session_id);
  }

  // 首条消息拼接前置提示词
  let finalMessage = userMessage;
  if (!conv.claude_session_id) {
    finalMessage = DINGTALK_SYSTEM_INSTRUCTIONS + '\n\n---\n\n' + userMessage;
  }

  try {
    await queryClaudeSDK(finalMessage, {
      projectPath: conv.project_path,
      cwd: conv.project_path,
      sessionId: conv.claude_session_id || null,
      permissionMode: conv.permission_mode || 'bypassPermissions',
    }, writer);

    const newSessionId = writer.getSessionId();
    if (newSessionId && newSessionId !== conv.claude_session_id) {
      dingtalkDb.updateConversationSession(conv.id, newSessionId);
    }
  } catch (err) {
    console.error('[DingTalk] Claude query error:', err.message);
  }
}

// ==================== Project Selection (Markdown + Number Reply) ====================

/**
 * Send project list as markdown, user replies with number to select.
 * Returns the items array so handleRobotMessage can cache it for number matching.
 */
async function sendProjectList({ accessToken, config, conv }) {
  // Check aliases first — if configured, use them as project list
  const aliases = dingtalkDb.getProjectAliases();
  const useAliases = aliases.length > 0;

  let projects = [];
  if (!useAliases) {
    try {
      projects = await getProjects();
    } catch (err) {
      console.error('[DingTalk] Failed to get projects:', err.message);
    }
  }

  const historyConvs = dingtalkDb.getUserConversations(conv.sender_staff_id, 5);

  const lines = ['### 选择项目'];

  const projectItems = useAliases ? aliases : projects;

  if (projectItems.length === 0 && historyConvs.length === 0) {
    lines.push('暂无可用项目，请先在 Claude Code UI 中添加项目。');
    await sendMessage({
      accessToken,
      robotCode: config.client_id,
      conversationType: conv.conversation_type,
      conversationId: conv.dingtalk_conversation_id,
      senderStaffId: conv.sender_staff_id,
      msgType: 'markdown',
      title: '选择项目',
      text: lines.join('\n\n'),
    });
    return;
  }

  // List projects (aliases or raw projects)
  if (projectItems.length > 0) {
    projectItems.slice(0, 20).forEach((item, i) => {
      const name = useAliases
        ? item.display_name
        : (item.displayName || item.name || item.path);
      lines.push(`${i + 1}. ${name}`);
    });
  }

  // List history conversations (continue numbering)
  if (historyConvs.length > 0) {
    lines.push('**继续历史对话：**');
    const offset = Math.min(projectItems.length, 20);
    historyConvs.slice(0, 5).forEach((h, i) => {
      const pathParts = (h.project_path || '').split('/');
      const shortName = pathParts[pathParts.length - 1] || h.project_path || '?';
      lines.push(`${offset + i + 1}. ↩ ${shortName} (${h.message_count || 0} 条消息)`);
    });
  }

  lines.push('---');
  lines.push('回复编号选择项目');

  await sendMessage({
    accessToken,
    robotCode: config.client_id,
    conversationType: conv.conversation_type,
    conversationId: conv.dingtalk_conversation_id,
    senderStaffId: conv.sender_staff_id,
    msgType: 'markdown',
    title: '选择项目',
    text: lines.join('\n\n'),
  });
}

/**
 * Handle numbered reply for project selection.
 * Returns true if a valid selection was made, false otherwise.
 */
async function handleNumberedSelection({ number, conv, accessToken, config }) {
  // Check aliases first — mirror sendProjectList logic
  const aliases = dingtalkDb.getProjectAliases();
  const useAliases = aliases.length > 0;

  let projects = [];
  if (!useAliases) {
    try { projects = await getProjects(); } catch (e) { /* ignore */ }
  }

  const projectItems = useAliases ? aliases : projects;

  const historyConvs = dingtalkDb.getUserConversations(conv.sender_staff_id, 5);
  const projectCount = Math.min(projectItems.length, 20);
  const historyCount = Math.min(historyConvs.length, 5);

  const idx = number - 1; // 0-based

  // Project selection
  if (idx >= 0 && idx < projectCount) {
    const selected = projectItems[idx];
    const projectPath = useAliases ? selected.project_path : (selected.path || selected.name);
    dingtalkDb.updateConversationProject(conv.id, projectPath, 'bypassPermissions');

    const pendingMessage = dingtalkDb.getPendingMessage(conv.id);
    dingtalkDb.clearPendingMessage(conv.id);

    // Send confirmation
    const name = useAliases
      ? selected.display_name
      : (selected.displayName || selected.name || selected.path);
    await sendMessage({
      accessToken,
      robotCode: config.client_id,
      conversationType: conv.conversation_type,
      conversationId: conv.dingtalk_conversation_id,
      senderStaffId: conv.sender_staff_id,
      msgType: 'markdown',
      title: '已选择',
      text: `✅ 已选择项目: **${name}**`,
    });

    if (pendingMessage) {
      const updatedConv = dingtalkDb.getConversationById(conv.id);
      await processWithClaude({ userMessage: pendingMessage, conv: updatedConv, accessToken, config });
    }
    return true;
  }

  // History conversation resume
  const historyIdx = idx - projectCount;
  if (historyIdx >= 0 && historyIdx < historyCount) {
    const historicalConv = historyConvs[historyIdx];

    dingtalkDb.updateConversationProject(conv.id, historicalConv.project_path, historicalConv.permission_mode);
    dingtalkDb.updateConversationSession(conv.id, historicalConv.claude_session_id);

    const pendingMessage = dingtalkDb.getPendingMessage(conv.id);
    dingtalkDb.clearPendingMessage(conv.id);

    const pathParts = (historicalConv.project_path || '').split('/');
    const shortName = pathParts[pathParts.length - 1] || '?';
    await sendMessage({
      accessToken,
      robotCode: config.client_id,
      conversationType: conv.conversation_type,
      conversationId: conv.dingtalk_conversation_id,
      senderStaffId: conv.sender_staff_id,
      msgType: 'markdown',
      title: '已恢复',
      text: `↩ 已恢复对话: **${shortName}** (${historicalConv.message_count || 0} 条消息)`,
    });

    if (pendingMessage) {
      const updatedConv = dingtalkDb.getConversationById(conv.id);
      await processWithClaude({ userMessage: pendingMessage, conv: updatedConv, accessToken, config });
    }
    return true;
  }

  return false;
}

// ==================== Handle Robot Message ====================

async function handleRobotMessage(data) {
  try {
    const textContent = data?.text?.content?.trim() || '';
    const senderStaffId = data?.senderStaffId;
    const senderNick = data?.senderNick;
    const conversationId = data?.conversationId;
    const conversationType = data?.conversationType || '1';

    if (!senderStaffId || !conversationId || !textContent) {
      console.log('[DingTalk] Ignoring empty or invalid message');
      return;
    }

    connectionInfo.messageCount++;
    connectionInfo.lastMessageAt = new Date().toISOString();

    // Strip @bot mention in group chats
    let userMessage = textContent;
    if (conversationType === '2') {
      userMessage = userMessage.replace(/^@\S+\s*/, '').trim();
    }
    if (!userMessage) return;

    const config = activeConfig || dingtalkDb.getActiveConfig();
    if (!config) {
      console.error('[DingTalk] No active config found');
      return;
    }

    const accessToken = await getAccessToken(config.client_id, config.client_secret);
    const conv = dingtalkDb.getOrCreateConversation(conversationId, senderStaffId, senderNick, conversationType);

    // Handle special commands
    const lowerMsg = userMessage.toLowerCase();

    if (lowerMsg === 'help' || lowerMsg === '/help') {
      const currentProject = conv.project_path
        ? conv.project_path.split('/').pop()
        : null;
      const statusLine = currentProject
        ? `**Current project:** ${currentProject}`
        : '**Current project:** none';

      await sendMessage({
        accessToken,
        robotCode: config.client_id,
        conversationType,
        conversationId,
        senderStaffId,
        msgType: 'markdown',
        title: 'Help',
        text: [
          '### 可用命令',
          '',
          statusLine,
          '',
          '- **help** — 显示此帮助信息',
          '- **new** — 开始新对话（清除历史，重新选择项目）',
          '- **switch** — 切换到其他项目',
          '- **reset** — 同 new',
          '- **status** — 显示当前会话信息',
          '',
          '其他消息将发送给 Claude。',
        ].join('\n'),
      });
      return;
    }

    if (lowerMsg === 'status' || lowerMsg === '/status') {
      const currentProject = conv.project_path
        ? conv.project_path.split('/').pop()
        : 'not selected';
      const msgCount = conv.message_count || 0;
      const sessionId = conv.claude_session_id ? conv.claude_session_id.slice(0, 8) + '...' : 'none';

      await sendMessage({
        accessToken,
        robotCode: config.client_id,
        conversationType,
        conversationId,
        senderStaffId,
        msgType: 'markdown',
        title: 'Status',
        text: [
          '### Session Status',
          '',
          `- **Project:** ${currentProject}`,
          `- **Mode:** ${conv.permission_mode || 'bypassPermissions'}`,
          `- **Messages:** ${msgCount}`,
          `- **Session:** ${sessionId}`,
        ].join('\n'),
      });
      return;
    }

    if (lowerMsg === 'new' || lowerMsg === 'reset' || lowerMsg === '/reset' || lowerMsg === '/new') {
      dingtalkDb.resetConversation(conv.id);
      await sendMessage({
        accessToken,
        robotCode: config.client_id,
        conversationType,
        conversationId,
        senderStaffId,
        msgType: 'markdown',
        title: 'Reset',
        text: 'Session cleared. Send a new message to start.',
      });
      return;
    }

    if (lowerMsg === 'switch' || lowerMsg === '/switch') {
      dingtalkDb.resetConversation(conv.id);
      const refreshedConv = dingtalkDb.getConversationById(conv.id);
      await sendProjectList({ accessToken, config, conv: refreshedConv });
      return;
    }

    // Try to parse numbered project selection (e.g., user replies "1", "2", etc.)
    if (!conv.project_path && /^\d+$/.test(userMessage)) {
      const number = parseInt(userMessage, 10);
      const handled = await handleNumberedSelection({ number, conv, accessToken, config });
      if (handled) return;
      // Invalid number — fall through to show project list again
    }

    // Case A: No active session — need project selection
    if (!conv.project_path) {
      dingtalkDb.setPendingMessage(conv.id, userMessage);
      await sendProjectList({ accessToken, config, conv });
      return;
    }

    // Case B: Active session — process directly
    await processWithClaude({ userMessage, conv, accessToken, config });
  } catch (err) {
    console.error('[DingTalk] handleRobotMessage error:', err);
  }
}

// ==================== Init / Disconnect ====================

/**
 * Initialize DingTalk Stream client
 */
export async function initDingTalkStream(config) {
  if (streamClient) {
    await disconnectDingTalkStream();
  }

  const clientId = config.clientId || config.client_id;
  const clientSecret = config.clientSecret || config.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error('DingTalk clientId and clientSecret are required');
  }

  activeConfig = {
    client_id: clientId,
    client_secret: clientSecret,
  };

  streamClient = new DWClient({ clientId, clientSecret });

  // Register robot message handler
  streamClient.registerCallbackListener(TOPIC_ROBOT, (msg) => {
    const messageId = msg.headers?.messageId;
    streamClient.socketCallBackResponse(messageId, EventAck.SUCCESS);

    if (messageId && isEventProcessed(messageId)) return;
    if (messageId) markEventProcessed(messageId);

    try {
      const data = JSON.parse(msg.data);
      handleRobotMessage(data).catch(err => {
        console.error('[DingTalk] Error handling robot message:', err);
      });
    } catch (err) {
      console.error('[DingTalk] Failed to parse robot message:', err);
    }
  });

  await streamClient.connect();

  connectionInfo = {
    connected: true,
    connectedAt: new Date().toISOString(),
    messageCount: 0,
    lastMessageAt: null,
    clientId,
  };

  // Start event cleanup interval
  setInterval(cleanupOldEvents, 60 * 1000);

  console.log('[DingTalk] Stream client connected successfully');
}

/**
 * Disconnect DingTalk Stream client
 */
export async function disconnectDingTalkStream() {
  if (streamClient) {
    try { streamClient.disconnect(); } catch (e) { /* ignore */ }
    streamClient = null;
  }

  activeConfig = null;
  cachedAccessToken = null;
  tokenExpiresAt = 0;
  connectionInfo.connected = false;
  console.log('[DingTalk] Stream client disconnected');
}

export function isDingTalkConnected() {
  return connectionInfo.connected && streamClient !== null;
}

export function getDingTalkStatus() {
  return { ...connectionInfo };
}
