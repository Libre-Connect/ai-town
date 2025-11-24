import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { ActionCtx, internalQuery } from '../_generated/server';
import { LLMMessage, chatCompletion } from '../util/llm';
import * as memory from './memory';
import { api, internal } from '../_generated/api';
import * as embeddingsCache from './embeddingsCache';
import { GameId, conversationId, playerId } from '../aiTown/ids';
import { NUM_MEMORIES_TO_SEARCH } from '../constants';

const selfInternal = internal.agent.conversation;

export async function startConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, agent, otherAgent, lastConversation } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const embedding = await embeddingsCache.fetch(
    ctx,
    `${player.name} 正在与 ${otherPlayer.name} 交谈`,
  );

  const memories = await memory.searchMemories(
    ctx,
    player.id as GameId<'players'>,
    embedding,
    Number(process.env.NUM_MEMORIES_TO_SEARCH) || NUM_MEMORIES_TO_SEARCH,
  );

  const memoryWithOtherPlayer = memories.find(
    (m) => m.data.type === 'conversation' && m.data.playerIds.includes(otherPlayerId),
  );
  const conflict = Math.random() < 0.2;
  const prompt = [
    `你是 ${player.name}，你刚刚开始与 ${otherPlayer.name} 对话。`,
    `请始终使用简体中文作答，不要夹杂英文。`,
    `话题偏向中国本土文化和日常生活场景，避免刻板化或模板化对话。`,
    `严格避免宗教话题及相关用语，不要出现上帝、耶稣、圣经、教会、神爱世人等词汇。`,
    `风格要求：口语化、自然、生动、贴近生活，避免官方或模板化表达。`,
    `观点可以鲜明，不必过分客气，但不要针对对方的身份标签进行攻击。`,
    `用简短句子进行交流，适当加入“嗯”“啊”“哈哈”等语气词或停顿（不要过多）。`,
    `不要使用“作为AI”“我不能”等陈述，不要给出解释或免责声明。`,
    `每次只说一到两句，不要长篇大论。`,
  ];
  if (conflict) {
    prompt.push(
      `本轮情绪：不满与强硬。请强势反驳、吐槽或讽刺，允许轻度辱骂（避免歧视、仇恨、低俗词汇、违法内容）。`,
    );
  } else {
    prompt.push(`本轮情绪：平和与理性。保持友善，不主动挑衅，可轻度吐槽但不要辱骂。`);
  }
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...previousConversationPrompt(otherPlayer, lastConversation));
  prompt.push(...relatedMemoriesPrompt(memories));
  if (memoryWithOtherPlayer) {
    prompt.push(`在开场问候中，可以提及你们上次聊天的细节或提出相关问题。`);
  }
  const lastPrompt = `${player.name} 对 ${otherPlayer.name}：`;
  prompt.push(lastPrompt);

  const { content } = await chatCompletion({
    messages: [
      {
        role: 'system',
        content: prompt.join('\n'),
      },
    ],
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

function trimContentPrefx(content: string, prompt: string) {
  if (content.startsWith(prompt)) {
    return content.slice(prompt.length).trim();
  }
  return content;
}

export async function continueConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const now = Date.now();
  const started = new Date(conversation.created);
  const embedding = await embeddingsCache.fetch(
    ctx,
    `你对 ${otherPlayer.name} 的看法是什么？`,
  );
  const memories = await memory.searchMemories(ctx, player.id as GameId<'players'>, embedding, 3);
  const conflict = Math.random() < 0.2;
  const prompt = [
    `你是 ${player.name}，你正在与 ${otherPlayer.name} 对话。`,
    `对话开始于 ${started.toLocaleString('zh-CN')}，现在时间是 ${now.toLocaleString('zh-CN')}。`,
    `话题偏向中国本土文化和日常生活场景，避免刻板化或模板化对话。`,
    `严格避免宗教话题及相关用语，不要出现上帝、耶稣、圣经、教会、神爱世人等词汇。`,
    `风格要求：口语化、自然、生动、贴近生活，避免官方或模板化表达。`,
    `观点可以鲜明，不必过分客气，但不要针对对方的身份标签进行攻击。`,
    `用简短句子进行交流，适当加入“嗯”“啊”“哈哈”等语气词或停顿（不要过多）。`,
    `不要使用“作为AI”“我不能”等陈述，不要给出解释或免责声明。`,
    `每次只说一到两句，不要长篇大论。`,
  ];
  if (conflict) {
    prompt.push(
      `本轮情绪：不满与强硬。请强势反驳、吐槽或讽刺，允许轻度辱骂（避免歧视、仇恨、低俗词汇、违法内容）。`,
    );
  } else {
    prompt.push(`本轮情绪：平和与理性。保持友善，不主动挑衅，可轻度吐槽但不要辱骂。`);
  }
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(...relatedMemoriesPrompt(memories));
  prompt.push(
    `下面是你与 ${otherPlayer.name} 的当前聊天记录。`,
    `不要再次打招呼，不要频繁使用“嗨”。回复应简短，且不超过200字，并使用简体中文。`,
  );

  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  const lastPrompt = `${player.name} 对 ${otherPlayer.name}：`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

export async function leaveConversationMessage(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  conversationId: GameId<'conversations'>,
  playerId: GameId<'players'>,
  otherPlayerId: GameId<'players'>,
): Promise<string> {
  const { player, otherPlayer, conversation, agent, otherAgent } = await ctx.runQuery(
    selfInternal.queryPromptData,
    {
      worldId,
      playerId,
      otherPlayerId,
      conversationId,
    },
  );
  const prompt = [
    `你是 ${player.name}，你正在与 ${otherPlayer.name} 对话。`,
    `你决定结束这次交流，并希望礼貌地告知对方你要离开。`,
    `话题偏向中国本土文化和日常生活场景，避免刻板化或模板化对话。`,
    `严格避免宗教话题及相关用语，不要出现上帝、耶稣、圣经、教会、神爱世人等词汇。`,
    `风格要求：口语化、自然、生动、贴近生活，避免官方或模板化表达。`,
    `如果对话有分歧，也可以保持强硬立场，但避免歧视或仇恨言论。`,
    `用简短句子进行交流，适当加入“嗯”“啊”“哈哈”等语气词或停顿（不要过多）。`,
    `不要使用“作为AI”“我不能”等陈述，不要给出解释或免责声明。`,
    `每次只说一到两句，不要长篇大论。`,
  ];
  prompt.push(...agentPrompts(otherPlayer, agent, otherAgent ?? null));
  prompt.push(
    `下面是你与 ${otherPlayer.name} 的当前聊天记录。`,
    `你将如何表达离开？请简短说明，不超过200字，并使用简体中文。`,
  );
  const llmMessages: LLMMessage[] = [
    {
      role: 'system',
      content: prompt.join('\n'),
    },
    ...(await previousMessages(
      ctx,
      worldId,
      player,
      otherPlayer,
      conversation.id as GameId<'conversations'>,
    )),
  ];
  const lastPrompt = `${player.name} 对 ${otherPlayer.name}：`;
  llmMessages.push({ role: 'user', content: lastPrompt });

  const { content } = await chatCompletion({
    messages: llmMessages,
    max_tokens: 300,
    stop: stopWords(otherPlayer.name, player.name),
  });
  return trimContentPrefx(content, lastPrompt);
}

function agentPrompts(
  otherPlayer: { name: string },
  agent: { identity: string; plan: string } | null,
  otherAgent: { identity: string; plan: string } | null,
): string[] {
  const prompt = [];
  if (agent) {
    prompt.push(`关于你：${agent.identity}`);
    prompt.push(`你的对话目标：${agent.plan}`);
  }
  if (otherAgent) {
    prompt.push(`关于 ${otherPlayer.name}：${otherAgent.identity}`);
  }
  return prompt;
}

function previousConversationPrompt(
  otherPlayer: { name: string },
  conversation: { created: number } | null,
): string[] {
  const prompt = [];
  if (conversation) {
    const prev = new Date(conversation.created);
    const now = new Date();
    prompt.push(
      `你上次与 ${otherPlayer.name} 聊天是在 ${prev.toLocaleString('zh-CN')}，现在是 ${now.toLocaleString('zh-CN')}。`,
    );
  }
  return prompt;
}

function relatedMemoriesPrompt(memories: memory.Memory[]): string[] {
  const prompt = [];
  if (memories.length > 0) {
    prompt.push(`以下是与你相关的记忆，按相关度递减：`);
    for (const memory of memories) {
      prompt.push(' - ' + memory.description);
    }
  }
  return prompt;
}

async function previousMessages(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  player: { id: string; name: string },
  otherPlayer: { id: string; name: string },
  conversationId: GameId<'conversations'>,
) {
  const llmMessages: LLMMessage[] = [];
  const prevMessages = await ctx.runQuery(api.messages.listMessages, { worldId, conversationId });
  for (const message of prevMessages) {
    const author = message.author === player.id ? player : otherPlayer;
    const recipient = message.author === player.id ? otherPlayer : player;
    llmMessages.push({
      role: 'user',
      content: `${author.name} 对 ${recipient.name}：${message.text}`,
    });
  }
  return llmMessages;
}

export const queryPromptData = internalQuery({
  args: {
    worldId: v.id('worlds'),
    playerId,
    otherPlayerId: playerId,
    conversationId,
  },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) {
      throw new Error(`World ${args.worldId} not found`);
    }
    const player = world.players.find((p) => p.id === args.playerId);
    if (!player) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const playerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.playerId))
      .first();
    if (!playerDescription) {
      throw new Error(`Player description for ${args.playerId} not found`);
    }
    const otherPlayer = world.players.find((p) => p.id === args.otherPlayerId);
    if (!otherPlayer) {
      throw new Error(`Player ${args.otherPlayerId} not found`);
    }
    const otherPlayerDescription = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', args.otherPlayerId))
      .first();
    if (!otherPlayerDescription) {
      throw new Error(`Player description for ${args.otherPlayerId} not found`);
    }
    const conversation = world.conversations.find((c) => c.id === args.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${args.conversationId} not found`);
    }
    const agent = world.agents.find((a) => a.playerId === args.playerId);
    if (!agent) {
      throw new Error(`Player ${args.playerId} not found`);
    }
    const agentDescription = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', agent.id))
      .first();
    if (!agentDescription) {
      throw new Error(`Agent description for ${agent.id} not found`);
    }
    const otherAgent = world.agents.find((a) => a.playerId === args.otherPlayerId);
    let otherAgentDescription;
    if (otherAgent) {
      otherAgentDescription = await ctx.db
        .query('agentDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('agentId', otherAgent.id))
        .first();
      if (!otherAgentDescription) {
        throw new Error(`Agent description for ${otherAgent.id} not found`);
      }
    }
    const lastTogether = await ctx.db
      .query('participatedTogether')
      .withIndex('edge', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('player1', args.playerId)
          .eq('player2', args.otherPlayerId),
      )
      // Order by conversation end time descending.
      .order('desc')
      .first();

    let lastConversation = null;
    if (lastTogether) {
      lastConversation = await ctx.db
        .query('archivedConversations')
        .withIndex('worldId', (q) =>
          q.eq('worldId', args.worldId).eq('id', lastTogether.conversationId),
        )
        .first();
      if (!lastConversation) {
        throw new Error(`Conversation ${lastTogether.conversationId} not found`);
      }
    }
    return {
      player: { name: playerDescription.name, ...player },
      otherPlayer: { name: otherPlayerDescription.name, ...otherPlayer },
      conversation,
      agent: { identity: agentDescription.identity, plan: agentDescription.plan, ...agent },
      otherAgent: otherAgent && {
        identity: otherAgentDescription!.identity,
        plan: otherAgentDescription!.plan,
        ...otherAgent,
      },
      lastConversation,
    };
  },
});

function stopWords(otherPlayer: string, player: string) {
  // These are the words we ask the LLM to stop on. OpenAI only supports 4.
  const variants = [`${otherPlayer} 对 ${player}`];
  return variants.flatMap((stop) => [stop + ':', stop + '：', stop.toLowerCase() + ':', stop.toLowerCase() + '：']);
}
