import fetch from 'node-fetch';

const DINGTALK_API_BASE = 'https://api.dingtalk.com';

// DingTalk built-in AI streaming card template
const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  FAILED: '5',
};

/**
 * Helper: make DingTalk API request
 */
async function apiRequest(method, path, accessToken, body) {
  const res = await fetch(`${DINGTALK_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DingTalk API ${method} ${path} failed (${res.status}): ${errText}`);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ==================== Generic Card Instance ====================

/**
 * Create a card instance (step 1)
 */
export async function createCardInstance({ accessToken, outTrackId, cardTemplateId, cardData, callbackType }) {
  return apiRequest('POST', '/v1.0/card/instances', accessToken, {
    cardTemplateId: cardTemplateId || AI_CARD_TEMPLATE_ID,
    outTrackId,
    cardData: { cardParamMap: cardData || {} },
    callbackType: callbackType || 'STREAM',
    imGroupOpenSpaceModel: { supportForward: true },
    imRobotOpenSpaceModel: { supportForward: true },
  });
}

/**
 * Create an AI Card instance (uses built-in AI template)
 */
export async function createAICardInstance({ accessToken, outTrackId }) {
  return createCardInstance({ accessToken, outTrackId, cardTemplateId: AI_CARD_TEMPLATE_ID });
}

/**
 * Deliver a card to a user/group (step 2)
 */
export async function deliverCard({ accessToken, outTrackId, openSpaceId, robotCode, conversationType }) {
  const body = {
    outTrackId,
    openSpaceId,
    userIdType: 1,
  };

  if (conversationType === '2') {
    body.imGroupOpenDeliverModel = { robotCode };
  } else {
    body.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
  }

  return apiRequest('POST', '/v1.0/card/instances/deliver', accessToken, body);
}

// Backward compat alias
export const deliverAICard = deliverCard;

/**
 * Update card instance data (for changing button states, etc.)
 */
export async function updateCardInstance({ accessToken, outTrackId, cardData }) {
  return apiRequest('PUT', '/v1.0/card/instances', accessToken, {
    outTrackId,
    cardData: { cardParamMap: cardData },
  });
}

/**
 * Start AI Card streaming (transition to INPUTING state)
 */
export async function startAICardStreaming({ accessToken, outTrackId }) {
  return apiRequest('PUT', '/v1.0/card/instances', accessToken, {
    outTrackId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.INPUTING,
        msgContent: '',
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
      },
    },
  });
}

/**
 * Stream update AI Card content
 */
export async function streamAICardContent({ accessToken, outTrackId, content, isFull, isFinalize, isError }) {
  return apiRequest('PUT', '/v1.0/card/streaming', accessToken, {
    outTrackId,
    key: 'msgContent',
    content: content || '',
    isFull: isFull !== undefined ? isFull : true,
    isFinalize: isFinalize || false,
    isError: isError || false,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
}

/**
 * Finish AI Card (set flow status to FINISHED)
 */
export async function finishAICard({ accessToken, outTrackId, finalContent }) {
  return apiRequest('PUT', '/v1.0/card/instances', accessToken, {
    outTrackId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: finalContent || '',
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({ order: ['msgContent'] }),
      },
    },
  });
}

// ==================== Robot Messages (no template needed) ====================

/**
 * Send markdown message to a user (1:1)
 */
export async function sendMarkdownToUser({ accessToken, robotCode, userId, title, text }) {
  return apiRequest('POST', '/v1.0/robot/oToMessages/batchSend', accessToken, {
    robotCode,
    userIds: [userId],
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({ title: title || 'Message', text }),
  });
}

/**
 * Send markdown message to a group
 */
export async function sendMarkdownToGroup({ accessToken, robotCode, openConversationId, title, text }) {
  return apiRequest('POST', '/v1.0/robot/groupMessages/send', accessToken, {
    robotCode,
    openConversationId,
    msgKey: 'sampleMarkdown',
    msgParam: JSON.stringify({ title: title || 'Message', text }),
  });
}

/**
 * Send ActionCard to a user (1:1) — supports buttons, no template needed
 */
export async function sendActionCardToUser({ accessToken, robotCode, userId, card }) {
  return apiRequest('POST', '/v1.0/robot/oToMessages/batchSend', accessToken, {
    robotCode,
    userIds: [userId],
    msgKey: 'sampleActionCard6',
    msgParam: JSON.stringify(card),
  });
}

/**
 * Send ActionCard to a group
 */
export async function sendActionCardToGroup({ accessToken, robotCode, openConversationId, card }) {
  return apiRequest('POST', '/v1.0/robot/groupMessages/send', accessToken, {
    robotCode,
    openConversationId,
    msgKey: 'sampleActionCard6',
    msgParam: JSON.stringify(card),
  });
}

/**
 * Send a markdown or ActionCard message, auto-detecting chat type
 */
export async function sendMessage({ accessToken, robotCode, conversationType, conversationId, senderStaffId, msgType, title, text, card }) {
  if (msgType === 'actionCard' && card) {
    if (conversationType === '2') {
      return sendActionCardToGroup({ accessToken, robotCode, openConversationId: conversationId, card });
    }
    return sendActionCardToUser({ accessToken, robotCode, userId: senderStaffId, card });
  }

  // Default: markdown
  if (conversationType === '2') {
    return sendMarkdownToGroup({ accessToken, robotCode, openConversationId: conversationId, title, text });
  }
  return sendMarkdownToUser({ accessToken, robotCode, userId: senderStaffId, title, text });
}

export { AI_CARD_TEMPLATE_ID, AICardStatus };
