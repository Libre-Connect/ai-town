# AI 服务集成指南

本文档总结了项目中 Pollinations.AI 和 GLM (ZhipuAI) 的调用方法，包括 API 端点、参数、Token 配置等，方便在其他项目中复用。

## 📋 目录

- [环境变量配置](#环境变量配置)
- [Pollinations.AI 调用方法](#pollinationsai-调用方法)
- [GLM (ZhipuAI) 调用方法](#glm-zhipuai-调用方法)
- [完整示例代码](#完整示例代码)
- [错误处理与降级策略](#错误处理与降级策略)

## 🔑 环境变量配置

### 必需的环境变量

```bash
# Pollinations.AI Token
export PAI_TOKEN="r5bQfseAxxaO7YNc"

# ZhipuAI API Key
export ZHIPUAI_API_KEY="c776b1833ad5e38df90756a57b1bcafc.Da0sFSNyQE2BMJEd"
```

### .env 文件示例

```env
# Pollinations.AI 配置
PAI_TOKEN=r5bQfseAxxaO7YNc

# ZhipuAI 配置
ZHIPUAI_API_KEY=c776b1833ad5e38df90756a57b1bcafc.Da0sFSNyQE2BMJEd
```

## 🌸 Pollinations.AI 调用方法

### 基础配置

```typescript
const PAI_TOKEN = process.env.PAI_TOKEN || 'r5bQfseAxxaO7YNc';
const POLLINATIONS_BASE_URL = 'https://text.pollinations.ai';
const POLLINATIONS_IMAGE_URL = 'https://image.pollinations.ai';
```

### 1. 文本生成 (GET 方式)

**端点**: `https://text.pollinations.ai/{prompt}`

```typescript
async function pollinationsTextGet(prompt: string, options: {
  model?: string;
  max_tokens?: number;
  system?: string;
} = {}) {
  const params = new URLSearchParams({
    token: PAI_TOKEN,
    model: options.model || 'openai',
    max_tokens: String(options.max_tokens || 8192),
    ...(options.system && { system: options.system })
  });
  
  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?${params}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${PAI_TOKEN}`,
      'User-Agent': 'YourApp/1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return await response.text();
}
```

### 2. 聊天对话 (POST 方式)

**端点**: `https://text.pollinations.ai/openai`

**重要**: Pollinations 不接受 `messages` 中的 system 消息，必须使用独立的 `system` 参数！

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function pollinationsChat(
  messages: ChatMessage[], 
  options: {
    model?: string;
    system?: string;
    max_tokens?: number;
    stream?: boolean;
  } = {}
) {
  const url = 'https://text.pollinations.ai/openai';
  
  const body = {
    model: options.model || 'openai', // 可选: openai, openai-fast, openai-large
    messages: messages, // 不包含 system 消息
    system: options.system, // ✅ system 必须单独传入
    max_tokens: options.max_tokens || 8192,
    stream: options.stream || false
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${PAI_TOKEN}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return await response.json(); // { choices: [{ message: { content } }] }
}
```

### 3. 图像生成 (GET 方式)

**端点**: `https://image.pollinations.ai/prompt/{prompt}`

```typescript
async function pollinationsImage(prompt: string, options: {
  model?: string;
  width?: number;
  height?: number;
  nologo?: boolean;
  enhance?: boolean;
  seed?: number;
} = {}) {
  const params = new URLSearchParams({
    token: PAI_TOKEN,
    model: options.model || 'flux',
    width: String(options.width || 1024),
    height: String(options.height || 1024),
    nologo: String(options.nologo !== false), // 默认去除logo
    ...(options.enhance && { enhance: 'true' }),
    ...(options.seed && { seed: String(options.seed) })
  });
  
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  
  const response = await fetch(url, { method: 'GET' });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.url; // 返回最终图片URL
}
```

### 4. 语音合成 (TTS)

**端点**: `https://text.pollinations.ai/{text}`

```typescript
async function pollinationsTTS(
  text: string, 
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' = 'alloy'
) {
  const params = new URLSearchParams({
    token: PAI_TOKEN,
    voice: voice
  });
  
  const url = `https://text.pollinations.ai/${encodeURIComponent(text)}?${params}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.url; // 返回音频文件URL
}
```

## 🧠 GLM (ZhipuAI) 调用方法

### 基础配置

```typescript
const ZHIPUAI_API_KEY = process.env.ZHIPUAI_API_KEY || 'c776b1833ad5e38df90756a57b1bcafc.Da0sFSNyQE2BMJEd';
const ZHIPUAI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
```

### 1. 文本聊天

**端点**: `https://open.bigmodel.cn/api/paas/v4/chat/completions`

```typescript
interface GLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function glmChat(
  messages: GLMMessage[], 
  options: {
    model?: string;
    max_tokens?: number;
    stream?: boolean;
    temperature?: number;
  } = {}
) {
  const url = `${ZHIPUAI_BASE_URL}/chat/completions`;
  
  const body = {
    model: options.model || 'glm-4-flash-250414', // 推荐模型
    messages: messages,
    max_tokens: options.max_tokens || 8192,
    stream: options.stream || false,
    ...(options.temperature && { temperature: options.temperature })
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ZHIPUAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return await response.json(); // { choices: [{ message: { content } }], usage: ... }
}
```

### 2. 视觉理解 (图片+文本)

**端点**: 同文本聊天，但 `messages` 中包含图片

```typescript
async function glmVisionChat(
  text: string, 
  imageUrl: string, 
  model: string = 'glm-4v-flash'
) {
  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'text', text: text },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ];
  
  return await glmChat(messages as any, { model });
}
```

### 3. 图像生成

**端点**: `https://open.bigmodel.cn/api/paas/v4/images/generations`

```typescript
async function glmImageGeneration(
  prompt: string, 
  options: {
    model?: string;
    size?: string;
    quality?: string;
  } = {}
) {
  const url = `${ZHIPUAI_BASE_URL}/images/generations`;
  
  const body = {
    model: options.model || 'cogview-3-flash',
    prompt: prompt,
    size: options.size || '1024x1024',
    ...(options.quality && { quality: options.quality })
  };
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ZHIPUAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  return await response.json(); // 返回图片生成结果
}
```

## 📝 完整示例代码

### 统一的 AI 服务客户端

```typescript
class AIServiceClient {
  private paiToken: string;
  private zhipuApiKey: string;
  
  constructor(paiToken: string, zhipuApiKey: string) {
    this.paiToken = paiToken;
    this.zhipuApiKey = zhipuApiKey;
  }
  
  // Pollinations 聊天 (推荐用法)
  async pollinationsChat(messages: ChatMessage[], system?: string) {
    // 分离 system 消息
    const userMessages = messages.filter(msg => msg.role !== 'system');
    const systemContent = system || messages.find(msg => msg.role === 'system')?.content;
    
    const response = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.paiToken}`
      },
      body: JSON.stringify({
        model: 'openai',
        messages: userMessages,
        system: systemContent, // ✅ 关键：system 单独传入
        max_tokens: 8192
      })
    });
    
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  }
  
  // GLM 聊天
  async glmChat(messages: GLMMessage[]) {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.zhipuApiKey}`
      },
      body: JSON.stringify({
        model: 'glm-4-flash-250414',
        messages: messages,
        max_tokens: 8192
      })
    });
    
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  }
  
  // 图片生成 (Pollinations 优先)
  async generateImage(prompt: string) {
    try {
      // 优先使用 Pollinations
      return await this.pollinationsImage(prompt);
    } catch (error) {
      console.warn('Pollinations 图片生成失败，尝试 GLM:', error);
      // 降级到 GLM
      return await this.glmImageGeneration(prompt);
    }
  }
  
  private async pollinationsImage(prompt: string) {
    const params = new URLSearchParams({
      token: this.paiToken,
      model: 'flux',
      width: '1024',
      height: '1024',
      nologo: 'true'
    });
    
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
    const response = await fetch(url);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.url;
  }
  
  private async glmImageGeneration(prompt: string) {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.zhipuApiKey}`
      },
      body: JSON.stringify({
        model: 'cogview-3-flash',
        prompt: prompt,
        size: '1024x1024'
      })
    });
    
    if (!response.ok) throw new Error(await response.text());
    return await response.json();
  }
}

// 使用示例
const aiClient = new AIServiceClient(
  process.env.PAI_TOKEN || 'r5bQfseAxxaO7YNc',
  process.env.ZHIPUAI_API_KEY || 'c776b1833ad5e38df90756a57b1bcafc.Da0sFSNyQE2BMJEd'
);

// 聊天示例
const chatResponse = await aiClient.pollinationsChat([
  { role: 'user', content: '你好，请介绍一下人工智能' }
], '你是一个专业的AI助手');

// 图片生成示例
const imageUrl = await aiClient.generateImage('一只可爱的小猫在花园里玩耍');
```

## ⚠️ 错误处理与降级策略

### 推荐的服务优先级

1. **文本生成**: Pollinations openai → Pollinations openai-fast → GLM glm-4-flash-250414
2. **图像生成**: Pollinations flux → GLM cogview-3-flash
3. **视觉理解**: Pollinations openai → GLM glm-4v-flash

### 错误处理示例

```typescript
async function robustTextGeneration(messages: ChatMessage[], system?: string) {
  const providers = [
    { name: 'Pollinations', model: 'openai' },
    { name: 'Pollinations', model: 'openai-fast' },
    { name: 'GLM', model: 'glm-4-flash-250414' }
  ];
  
  for (const provider of providers) {
    try {
      if (provider.name === 'Pollinations') {
        return await aiClient.pollinationsChat(messages, system);
      } else {
        return await aiClient.glmChat([
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          ...messages
        ]);
      }
    } catch (error) {
      console.warn(`${provider.name} ${provider.model} 失败:`, error);
      if (provider === providers[providers.length - 1]) {
        throw new Error('所有服务提供商都失败了');
      }
    }
  }
}
```

## 🔧 常见问题

### 1. Pollinations system 消息问题

**错误做法**:
```typescript
// ❌ 错误：将 system 放在 messages 中
const messages = [
  { role: 'system', content: '你是AI助手' },
  { role: 'user', content: '你好' }
];
await pollinationsChat(messages); // 会失败
```

**正确做法**:
```typescript
// ✅ 正确：system 单独传入
const messages = [
  { role: 'user', content: '你好' }
];
await pollinationsChat(messages, '你是AI助手');
```

### 2. Token 安全性

- 生产环境中务必使用环境变量
- 不要在前端代码中硬编码 Token
- 考虑使用代理服务器来隐藏真实 Token

### 3. 速率限制

- Pollinations: 建议控制并发数 ≤ 15
- GLM: 注意 QPM (每分钟查询数) 限制
- 实现指数退避重试机制

## 📚 相关文档

- [Pollinations.AI 官方文档](https://pollinations.ai/)
- [ZhipuAI 官方文档](https://open.bigmodel.cn/)

---

**最后更新**: 2024年1月
**版本**: 1.0.0