/**
 * Lines `opencode run --standalone --format json` printed for real turns of
 * OpenCode 2.2.3 against a local fake model, kept verbatim, so the 2.x runtime
 * and normalizer tests replay what 2.x really prints:
 * - toolTurn: a `shell` call, then a text answer (two steps).
 * - subagentTurn: a `subagent` call whose child session answered, then a text answer.
 * - questionTurn: a `question` call `run` cancelled (nobody can answer it), then a text answer.
 * - modelError: the only line of a turn whose model OpenCode does not know (exit code 1).
 */
export const toolTurn: Array<Record<string, any>> = [
  {
    "type": "step_start",
    "timestamp": 1793723568109,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "id": "prt_1a2418fed001PgvJ3y0AJ2dC15",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2418fae001M5zBOVUPPBPrIG",
      "type": "step-start",
      "snapshot": "0d8a474fc67971fb3dd7616e26323d3066442555"
    }
  },
  {
    "type": "tool_use",
    "timestamp": 1793723568146,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "partID": "prt_1a2418ff2001eyxqbXHKcreXwh",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2418fae001M5zBOVUPPBPrIG",
      "type": "tool",
      "id": "call_fake_5",
      "tool": "shell",
      "state": {
        "status": "completed",
        "input": {
          "command": "echo hello-from-fake-tool",
          "description": "Echo a greeting"
        },
        "output": "hello-from-fake-tool\n",
        "title": "shell",
        "metadata": {
          "metadata": {
            "status": "completed",
            "truncated": false,
            "exit": 0
          },
          "content": [
            {
              "type": "text",
              "text": "hello-from-fake-tool\n"
            }
          ],
          "providerCall": {
            "executed": false
          },
          "providerResult": {
            "executed": false
          },
          "rawInput": "{\"command\":\"echo hello-from-fake-tool\",\"description\":\"Echo a greeting\"}"
        },
        "time": {
          "start": 1793723568114,
          "end": 1793723568146
        }
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793723568165,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "id": "prt_1a2419025001MaCRGpSdRhrEQd",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2418fae001M5zBOVUPPBPrIG",
      "type": "step-finish",
      "reason": "tool-calls",
      "snapshot": "0d8a474fc67971fb3dd7616e26323d3066442555",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  },
  {
    "type": "step_start",
    "timestamp": 1793723568204,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "id": "prt_1a241904c001Xm5DQBC8M0LXiw",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2419033001NYFk9vCTlGCbzI",
      "type": "step-start",
      "snapshot": "0d8a474fc67971fb3dd7616e26323d3066442555"
    }
  },
  {
    "type": "text",
    "timestamp": 1793723568254,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "id": "prt_1a2419050001KInMs9C1gDWuwe",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2419033001NYFk9vCTlGCbzI",
      "type": "text",
      "text": "Hello from the fake model.",
      "time": {
        "start": 1793723568208,
        "end": 1793723568254
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793723568271,
    "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
    "part": {
      "id": "prt_1a2419033001NYFk9vCTlGCbzI_step-finish",
      "sessionID": "ses_e5dbe753fffepZVQl7Vl2i8Bzb",
      "messageID": "msg_1a2419033001NYFk9vCTlGCbzI",
      "type": "step-finish",
      "reason": "stop",
      "snapshot": "0d8a474fc67971fb3dd7616e26323d3066442555",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  }
];

export const subagentTurn: Array<Record<string, any>> = [
  {
    "type": "step_start",
    "timestamp": 1793725438860,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "id": "prt_1a25e1b8c001UXq66fQr23ric4",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1afc001QHboDv5x3nrP9Y",
      "type": "step-start",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f"
    }
  },
  {
    "type": "tool_use",
    "timestamp": 1793725439066,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "partID": "prt_1a25e1b90001R3QDGaj6D584iv",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1afc001QHboDv5x3nrP9Y",
      "type": "tool",
      "id": "call_fake_2",
      "tool": "subagent",
      "state": {
        "status": "completed",
        "input": {
          "description": "Say hi in a subagent",
          "prompt": "Say hello",
          "agent": "general"
        },
        "output": "<subagent sessionID=\"ses_e5da1e45fffeZ2WCwgpM9byvoB\" state=\"completed\">\nHello from the fake model.\n</subagent>",
        "title": "subagent",
        "metadata": {
          "metadata": {
            "sessionID": "ses_e5da1e45fffeZ2WCwgpM9byvoB",
            "status": "completed",
            "truncated": false
          },
          "content": [
            {
              "type": "text",
              "text": "<subagent sessionID=\"ses_e5da1e45fffeZ2WCwgpM9byvoB\" state=\"completed\">\nHello from the fake model.\n</subagent>"
            }
          ],
          "providerCall": {
            "executed": false
          },
          "providerResult": {
            "executed": false
          },
          "rawInput": "{\"description\":\"Say hi in a subagent\",\"prompt\":\"Say hello\",\"agent\":\"general\"}"
        },
        "time": {
          "start": 1793725438864,
          "end": 1793725439066
        }
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793725439080,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "id": "prt_1a25e1c68001dKSQSu47oXBT87",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1afc001QHboDv5x3nrP9Y",
      "type": "step-finish",
      "reason": "tool-calls",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  },
  {
    "type": "step_start",
    "timestamp": 1793725439113,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "id": "prt_1a25e1c89001uyCo0xzQtR7raY",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1c730010G8dgSZHvd0XQN",
      "type": "step-start",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f"
    }
  },
  {
    "type": "text",
    "timestamp": 1793725439156,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "id": "prt_1a25e1c8c001v24xMx98Tb8ebw",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1c730010G8dgSZHvd0XQN",
      "type": "text",
      "text": "Hello from the fake model.",
      "time": {
        "start": 1793725439116,
        "end": 1793725439156
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793725439170,
    "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
    "part": {
      "id": "prt_1a25e1c730010G8dgSZHvd0XQN_step-finish",
      "sessionID": "ses_e5da1edb1ffer2MoyNzk2wtJfT",
      "messageID": "msg_1a25e1c730010G8dgSZHvd0XQN",
      "type": "step-finish",
      "reason": "stop",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  }
];

export const questionTurn: Array<Record<string, any>> = [
  {
    "type": "step_start",
    "timestamp": 1793725351171,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "id": "prt_1a25cc5030011WBN2f7dd4pxKn",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc43d001kJp7HisPrWFU57",
      "type": "step-start",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f"
    }
  },
  {
    "type": "tool_use",
    "timestamp": 1793725351255,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "partID": "prt_1a25cc508001XlDbOP9019wkeM",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc43d001kJp7HisPrWFU57",
      "type": "tool",
      "id": "call_fake_2",
      "tool": "question",
      "state": {
        "status": "error",
        "input": {
          "questions": [
            {
              "question": "Which color?",
              "header": "Color",
              "options": [
                {
                  "label": "Red",
                  "description": "warm"
                },
                {
                  "label": "Blue",
                  "description": "cool"
                }
              ]
            }
          ]
        },
        "error": "This non-interactive run cannot ask the user questions, so the question was cancelled. Continue without an answer; make reasonable assumptions and state them.",
        "metadata": {
          "providerCall": {
            "executed": false
          },
          "providerResult": {
            "executed": false
          },
          "rawInput": "{\"questions\":[{\"question\":\"Which color?\",\"header\":\"Color\",\"options\":[{\"label\":\"Red\",\"description\":\"warm\"},{\"label\":\"Blue\",\"description\":\"cool\"}]}]}"
        },
        "time": {
          "start": 1793725351176,
          "end": 1793725351255
        }
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793725351273,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "id": "prt_1a25cc569001F73wLEqoZe6Kx4",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc43d001kJp7HisPrWFU57",
      "type": "step-finish",
      "reason": "tool-calls",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  },
  {
    "type": "step_start",
    "timestamp": 1793725351366,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "id": "prt_1a25cc5c6001Wrb9t0pXZ3m0TX",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc5790014NMpeNVaOD9AQj",
      "type": "step-start",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f"
    }
  },
  {
    "type": "text",
    "timestamp": 1793725351373,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "id": "prt_1a25cc5c9001Q2fP7rA5785Rrb",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc5790014NMpeNVaOD9AQj",
      "type": "text",
      "text": "Hello from the fake model.",
      "time": {
        "start": 1793725351369,
        "end": 1793725351373
      }
    }
  },
  {
    "type": "step_finish",
    "timestamp": 1793725351387,
    "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
    "part": {
      "id": "prt_1a25cc5790014NMpeNVaOD9AQj_step-finish",
      "sessionID": "ses_e5da34145ffeTeO083899TCBJv",
      "messageID": "msg_1a25cc5790014NMpeNVaOD9AQj",
      "type": "step-finish",
      "reason": "stop",
      "snapshot": "853694aae8816094a0d875fee7ea26278dbf5d0f",
      "cost": 0,
      "tokens": {
        "input": 42,
        "output": 7,
        "reasoning": 0,
        "cache": {
          "read": 0,
          "write": 0
        }
      }
    }
  }
];

export const modelError: Array<Record<string, any>> = [
  {
    "type": "error",
    "timestamp": 1793725564485,
    "sessionID": "ses_e5d9fff9fffeZhO8ovl40XOL8B",
    "error": {
      "type": "provider.no-route",
      "message": "Model unavailable: fake/nope"
    }
  }
];
