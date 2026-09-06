/**
 * Public MadeAPI / MadeClaw model catalog for the marketing site.
 * Stable public IDs only — never list internal or unreleased model ids.
 */
export const MADECLAW_PUBLIC_MODELS = [
  {
    family: "OpenAI 系",
    models: [
      { id: "gpt-5.6-luna", ref: "madeapi/gpt-5.6-luna", note: "默认推荐" },
      { id: "gpt-5.6-terra", ref: "madeapi/gpt-5.6-terra", note: "" },
      { id: "gpt-5.6-sol", ref: "madeapi/gpt-5.6-sol", note: "" },
      { id: "gpt-5.5", ref: "madeapi/gpt-5.5", note: "" },
      { id: "gpt-5.4", ref: "madeapi/gpt-5.4", note: "" },
      { id: "gpt-5.4-mini", ref: "madeapi/gpt-5.4-mini", note: "轻量" },
    ],
  },
  {
    family: "Claude 系",
    models: [
      { id: "claude-sonnet-4-6", ref: "madeapi/claude-sonnet-4-6", note: "常用后备" },
      { id: "claude-sonnet-5", ref: "madeapi/claude-sonnet-5", note: "" },
      { id: "claude-opus-4-6", ref: "madeapi/claude-opus-4-6", note: "" },
      { id: "claude-opus-5", ref: "madeapi/claude-opus-5", note: "" },
      { id: "claude-haiku-4-5", ref: "madeapi/claude-haiku-4-5", note: "更快" },
      { id: "claude-fable-5-1", ref: "madeapi/claude-fable-5-1", note: "" },
    ],
  },
  {
    family: "其他",
    models: [
      { id: "deepseek-v4-flash", ref: "madeapi/deepseek-v4-flash", note: "" },
      { id: "deepseek-v4-pro", ref: "madeapi/deepseek-v4-pro", note: "" },
      { id: "gemini-3.5-flash", ref: "madeapi/gemini-3.5-flash", note: "" },
      { id: "gemini-3.8-flash", ref: "madeapi/gemini-3.8-flash", note: "" },
      { id: "gemini-3.1-pro-preview", ref: "madeapi/gemini-3.1-pro-preview", note: "" },
      { id: "glm-5.3-flash", ref: "madeapi/glm-5.3-flash", note: "" },
      { id: "glm-5.3", ref: "madeapi/glm-5.3", note: "" },
      { id: "kimi-k3", ref: "madeapi/kimi-k3", note: "" },
      { id: "grok-4.6", ref: "madeapi/grok-4.6", note: "" },
    ],
  },
];
