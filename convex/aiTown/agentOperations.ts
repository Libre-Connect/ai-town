import { internalAction, httpAction } from '../_generated/server';
import { WorldMap, serializedWorldMap } from './worldMap';
import { rememberConversation } from '../agent/memory';
import { GameId, agentId, conversationId, playerId } from './ids';
import {
  continueConversationMessage,
  leaveConversationMessage,
  startConversationMessage,
} from '../agent/conversation';
import { assertNever } from '../util/assertNever';
import { serializedAgent } from './agent';
import { ACTIVITIES, ACTIVITY_COOLDOWN, CONVERSATION_COOLDOWN } from '../constants';
import { api, internal } from '../_generated/api';
import { sleep } from '../util/sleep';
import { serializedPlayer } from './player';
import { chatCompletion } from '../util/llm';
import { characters } from '../../data/characters';
import { Id } from '../_generated/dataModel';
import { v } from 'convex/values';
const CHARACTER_ASSET_DIR = '/ai-town/assets/characters';
const CHARACTER_ASSETS = [
  '1.png',
  '2.png',
  '3.png',
  '4.png',
  '5.png',
  '6.png',
  '7.png',
  '8.png',
  '9.png',
  '10.png',
  '11.png',
  '12.png',
  '22.png',
  '23.png',
  '24.png',
  '42.png',
  '44.png',
  '45.png',
  '82y.png',
  '123.png',
  '124.png',
  '222.png',
  '22222.png',
  '234.png',
];

const DISCOVERY_GENERATION_PROBABILITY = 0;
const POLLINATIONS_MODEL = 'flux';
const POLLINATIONS_TOKEN = 'r5bQfseAxxaO7YNc';
const IMAGE_MESSAGE_PROBABILITY = 0.12;

function pollinationsImageUrl(prompt: string, seed = Date.now()) {
  const params = new URLSearchParams({
    token: POLLINATIONS_TOKEN,
    model: POLLINATIONS_MODEL,
    width: '512',
    height: '512',
    nologo: 'true',
    seed: String(seed),
  });
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`;
}

export const agentRememberConversation = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    await rememberConversation(
      ctx,
      args.worldId,
      args.agentId as GameId<'agents'>,
      args.playerId as GameId<'players'>,
      args.conversationId as GameId<'conversations'>,
    );
    await sleep(Math.random() * 1000);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishRememberConversation',
      args: {
        agentId: args.agentId,
        operationId: args.operationId,
      },
    });
  },
});

export const agentGenerateMessage = internalAction({
  args: {
    worldId: v.id('worlds'),
    playerId,
    agentId,
    conversationId,
    otherPlayerId: playerId,
    operationId: v.string(),
    type: v.union(v.literal('start'), v.literal('continue'), v.literal('leave')),
    messageUuid: v.string(),
  },
  handler: async (ctx, args) => {
    let completionFn;
    switch (args.type) {
      case 'start':
        completionFn = startConversationMessage;
        break;
      case 'continue':
        completionFn = continueConversationMessage;
        break;
      case 'leave':
        completionFn = leaveConversationMessage;
        break;
      default:
        assertNever(args.type);
    }
    let text = await completionFn(
      ctx,
      args.worldId,
      args.conversationId as GameId<'conversations'>,
      args.playerId as GameId<'players'>,
      args.otherPlayerId as GameId<'players'>,
    );
    text = (text || '').trim();
    const bannedRel = /(神爱世人|上帝|耶稣|圣经|教会|基督教|祷告)/i;
    if (bannedRel.test(text)) {
      text = `我们聊点生活吧：${text.replace(bannedRel, '').trim()}`;
    }
    const bannedSevere = /(操你妈|滚你妈|去你妈的|婊子|狗屎|垃圾人|畜生|智障)/i;
    if (bannedSevere.test(text)) {
      text = text.replace(bannedSevere, '……');
    }

    let imagePrompt: string | undefined;
    let imageUrl: string | undefined;
    const shouldGenerateImage =
      args.type !== 'leave' && text.length > 8 && Math.random() < IMAGE_MESSAGE_PROBABILITY;
    if (shouldGenerateImage) {
      try {
        const { content } = await chatCompletion({
          messages: [
            {
              role: 'system',
              content:
                'You turn a chat message into a concise, vivid pixel art sticker prompt in English. Output only the prompt, under 80 characters.',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.6,
          max_tokens: 80,
        });
        const englishPrompt = String(content || '')
          .trim()
          .replace(/^["'\s]+|["'\s]+$/g, '')
          .slice(0, 160);
        if (englishPrompt) {
          imagePrompt = englishPrompt;
          imageUrl = pollinationsImageUrl(englishPrompt);
        }
      } catch (e) {
        console.warn('generate image prompt failed', e);
      }
    }

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
      imagePrompt,
      imageUrl,
      messageUuid: args.messageUuid,
      leaveConversation: args.type === 'leave',
      operationId: args.operationId,
    });
  },
});

export const agentDoSomething = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    map: v.object(serializedWorldMap),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { player, agent } = args;
    const map = new WorldMap(args.map);
    const now = Date.now();
    // Don't try to start a new conversation if we were just in one.
    const justLeftConversation =
      agent.lastConversation && now < agent.lastConversation + CONVERSATION_COOLDOWN;
    // Don't try again if we recently tried to find someone to invite.
    const recentlyAttemptedInvite =
      agent.lastInviteAttempt && now < agent.lastInviteAttempt + CONVERSATION_COOLDOWN;
    const recentActivity = player.activity && now < player.activity.until + ACTIVITY_COOLDOWN;
    // Decide whether to do an activity or wander somewhere.
    if (!player.pathfinding) {
      if (recentActivity || justLeftConversation) {
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            destination: wanderDestination(map),
          },
        });
        return;
      } else {
        // TODO: have LLM choose the activity & emoji
        const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
        await sleep(Math.random() * 1000);
        await ctx.runMutation(api.aiTown.main.sendInput, {
          worldId: args.worldId,
          name: 'finishDoSomething',
          args: {
            operationId: args.operationId,
            agentId: agent.id,
            activity: {
              description: activity.description,
              emoji: activity.emoji,
              until: Date.now() + activity.duration,
            },
          },
        });
        return;
      }
    }
    const invitee =
      justLeftConversation || recentlyAttemptedInvite
        ? undefined
        : await ctx.runQuery(internal.aiTown.agent.findConversationCandidate, {
            now,
            worldId: args.worldId,
            player: args.player,
            otherFreePlayers: args.otherFreePlayers,
          });

    // TODO: We hit a lot of OCC errors on sending inputs in this file. It's
    // easy for them to get scheduled at the same time and line up in time.
    const doGenerate = Math.random() < DISCOVERY_GENERATION_PROBABILITY;
    if (doGenerate) {
      const kind: 'building' | 'item' = Math.random() < 0.5 ? 'building' : 'item';
      const sys = 'You are a pixel art assistant. Output only an English prompt, no explanations.';
      const prompt =
        kind === 'building'
          ? 'Pixel art building sprite, top-down RPG style, clean outline, placed on a white grassy field with visible grass texture, never a solid white or blank background, game-ready.'
          : 'Pixel art item sprite, 1x1 tile, clear silhouette, placed on a white grassy field with visible grass texture, never a solid white or blank background, game-ready.';
      const { content } = await chatCompletion({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 100,
      });
      const english = String(content || '').trim() || (kind === 'building' ? 'cozy pixel building' : 'cozy pixel item');
      const imageUrl = pollinationsImageUrl(english);
      const base = wanderDestination(map);
      const w = kind === 'building' ? 3 + Math.floor(Math.random() * 4) : 1;
      const h = kind === 'building' ? 3 + Math.floor(Math.random() * 4) : 1;
      const x = Math.max(0, Math.min(map.width - w, base.x));
      const y = Math.max(0, Math.min(map.height - h, base.y));
      await sleep(Math.random() * 1000);
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'discoverItem',
        args: {
          playerId: player.id,
          item: { name: english, imageUrl },
          place: { x, y },
          kind,
          size: { w, h },
        },
      });
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'finishDoSomething',
        args: { operationId: args.operationId, agentId: args.agent.id },
      });
    } else {
      await sleep(Math.random() * 1000);
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'finishDoSomething',
        args: {
          operationId: args.operationId,
          agentId: args.agent.id,
          invitee,
        },
      });
    }
  },
});

export const agentHandleInventory = internalAction({
  args: {
    worldId: v.id('worlds'),
    player: v.object(serializedPlayer),
    agent: v.object(serializedAgent),
    otherFreePlayers: v.array(v.object(serializedPlayer)),
    map: v.object(serializedWorldMap),
    operationId: v.string(),
  },
  handler: async (ctx, args) => {
    const player = args.player;
    const items = player.inventory ?? [];
    if (!items.length) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'finishDoSomething',
        args: { operationId: args.operationId, agentId: args.agent.id },
      });
      return;
    }
    const idx = Math.floor(Math.random() * items.length);
    const myPos = player.position;
    const nearby = args.otherFreePlayers
      .map((p) => ({ p, d: Math.abs(p.position.x - myPos.x) + Math.abs(p.position.y - myPos.y) }))
      .sort((a, b) => a.d - b.d)[0];
    const doTrade = nearby && nearby.d <= 3 && Math.random() < 0.6;
    if (doTrade) {
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'tradeItem',
        args: { from: player.id, to: nearby.p.id, itemIndex: idx },
      });
    }
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId: args.worldId,
      name: 'finishDoSomething',
      args: { operationId: args.operationId, agentId: args.agent.id },
    });
  },
});

function wanderDestination(worldMap: WorldMap) {
  // Wander someonewhere at least one tile away from the edge.
  return {
    x: 1 + Math.floor(Math.random() * (worldMap.width - 2)),
    y: 1 + Math.floor(Math.random() * (worldMap.height - 2)),
  };
}
export const importBilibiliUsers = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as {
      worldId?: Id<'worlds'>;
      users?: Array<{ name: string; uid?: string }>;
    };
    const worldStatus = await ctx.runQuery(api.world.defaultWorldStatus);
    const worldId = body.worldId ?? worldStatus?.worldId;
    if (!worldId) return new Response('No worldId', { status: 400 });
    const users = Array.isArray(body.users) ? body.users : [];
    const descs = await ctx.runQuery(api.world.gameDescriptions, { worldId });
    const existingNames = new Set(
      (descs.playerDescriptions || []).map((d: any) => String(d.name || '').trim()).filter(Boolean),
    );
    const usedAssets = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.character || ''))
        .filter((p) => p.startsWith(`${CHARACTER_ASSET_DIR}/`)),
    );
    const fullAssets = CHARACTER_ASSETS.map((n) => `${CHARACTER_ASSET_DIR}/${n}`);
    const unusedAssets = fullAssets.filter((p) => !usedAssets.has(p));
    const pickAsset = () => {
      if (unusedAssets.length > 0) {
        return unusedAssets.splice(Math.floor(Math.random() * unusedAssets.length), 1)[0];
      }
      return fullAssets[Math.floor(Math.random() * fullAssets.length)];
    };
    const usedPersonality = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.description || ''))
        .filter((s) => PERSONALITIES.some((p) => p.identity === s)),
    );
    const unusedPersonality = PERSONALITIES.filter((p) => !usedPersonality.has(p.identity));
    const pickPersonality = () => {
      if (unusedPersonality.length > 0) {
        const idx = Math.floor(Math.random() * unusedPersonality.length);
        return unusedPersonality.splice(idx, 1)[0];
      }
      return PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
    };
    let created = 0;
    for (const u of users.slice(0, 100)) {
      const name = (u.name || '').trim();
      if (!name || existingNames.has(name)) continue;
      const personality = pickPersonality();
      let identity = personality.identity;
      let plan = personality.plan;
      let character = pickAsset();
      const banned = /(上帝|耶稣|圣经|教会|神爱世人|宗教|祷告)/i;
      identity = identity.replace(banned, '').trim();
      plan = plan.replace(banned, '').trim();
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId,
        name: 'createAgentDynamic',
        args: { name, character, identity, plan },
      });
      created++;
      existingNames.add(name);
    }
    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});

export const presenceImport = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as {
      worldId?: Id<'worlds'>;
      names?: string[];
      count?: number;
    };
    const worldStatus = await ctx.runQuery(api.world.defaultWorldStatus);
    const worldId = body.worldId ?? worldStatus?.worldId;
    if (!worldId) return new Response('No worldId', { status: 400 });
    const names = (Array.isArray(body.names) ? body.names : [])
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    const MAX_CREATE = 150;
    const count = Math.max(0, Math.min(body.count ?? names.length, MAX_CREATE));

    // 去重输入并拉取最新的名称集合，避免重复创建相同昵称的 agent
    const namesUnique = Array.from(new Set(names));
    const descs = await ctx.runQuery(api.world.gameDescriptions, { worldId });
    const existingNames = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.name || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const usedAssets = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.character || ''))
        .filter((p) => p.startsWith(`${CHARACTER_ASSET_DIR}/`)),
    );
    const fullAssets = CHARACTER_ASSETS.map((n) => `${CHARACTER_ASSET_DIR}/${n}`);
    const unusedAssets = fullAssets.filter((p) => !usedAssets.has(p));
    const pickAsset = () => (unusedAssets.length ? unusedAssets.splice(Math.floor(Math.random() * unusedAssets.length), 1)[0] : fullAssets[Math.floor(Math.random() * fullAssets.length)]);

    const usedPersonality = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.description || ''))
        .filter((s) => PERSONALITIES.some((p) => p.identity === s)),
    );
    const unusedPersonality = PERSONALITIES.filter((p) => !usedPersonality.has(p.identity));
    const pickPersonality = () => (unusedPersonality.length ? unusedPersonality.splice(Math.floor(Math.random() * unusedPersonality.length), 1)[0] : PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)]);

    let created = 0;
    for (const name of namesUnique.slice(0, count || namesUnique.length)) {
      const normalized = name.toLowerCase();
      if (!name || existingNames.has(normalized)) continue;
      const personality = pickPersonality();
      const character = pickAsset();
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId,
        name: 'createAgentDynamic',
        args: { name, character, identity: personality.identity, plan: personality.plan },
      });
      existingNames.add(normalized);
      created++;
    }
    return new Response(JSON.stringify({ ok: true, created }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});

export const danmakuMessage = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as {
      worldId?: Id<'worlds'>;
      name?: string;
      text?: string;
    };
    const worldStatus = await ctx.runQuery(api.world.defaultWorldStatus);
    const worldId = body.worldId ?? worldStatus?.worldId;
    if (!worldId) return new Response('No worldId', { status: 400 });

    const name = String(body.name || '').trim();
    const text = String(body.text || '').trim();
    if (!name || !text) return new Response('Missing name/text', { status: 400 });

    const worldState = await ctx.runQuery(api.world.worldState, { worldId });
    const conversations = worldState.world.conversations || [];
    if (conversations.length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_conversation' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const conversation = conversations.reduce((best: any, current: any) => {
      const bestTs = best?.lastMessage?.timestamp ?? best?.created ?? 0;
      const currTs = current?.lastMessage?.timestamp ?? current?.created ?? 0;
      return currTs > bestTs ? current : best;
    }, conversations[0]);

    const descs = await ctx.runQuery(api.world.gameDescriptions, { worldId });
    const normalized = name.toLowerCase();
    const playerDesc = (descs.playerDescriptions || []).find(
      (p: any) => String(p.name || '').trim().toLowerCase() === normalized,
    );
    if (!playerDesc) {
      return new Response(JSON.stringify({ ok: false, reason: 'player_not_found' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const playerId = playerDesc.playerId;
    const messageUuid = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await ctx.runMutation(api.messages.writeMessage, {
      worldId,
      conversationId: conversation.id,
      playerId,
      text,
      messageUuid,
    });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});

export const importCharacterAssets = httpAction(async (ctx, request) => {
  try {
    const body = (await request.json()) as {
      worldId?: Id<'worlds'>;
      assets?: string[];
      count?: number;
    };
    const worldStatus = await ctx.runQuery(api.world.defaultWorldStatus);
    const worldId = body.worldId ?? worldStatus?.worldId;
    if (!worldId) return new Response('No worldId', { status: 400 });
    const assets = (Array.isArray(body.assets) ? body.assets : []).filter((p) => typeof p === 'string');
    if (assets.length === 0) return new Response('No assets', { status: 400 });
    const count = Math.max(1, Math.min(body.count ?? assets.length, 50));

    const descs = await ctx.runQuery(api.world.gameDescriptions, { worldId });
    const existing = descs.playerDescriptions;
    const used = new Set(
      existing
        .map((d: any) => d.character)
        .filter((c: any) => typeof c === 'string' && c.startsWith('/ai-town/assets/characters')),
    );
    const unused = assets.filter((a) => !used.has(a));
    const pool = unused.length >= count ? unused : [...unused, ...assets].slice(0, assets.length);

    const chosen: string[] = [];
    const taken = new Set<string>();
    while (chosen.length < Math.min(count, pool.length)) {
      const candidate = pool[Math.floor(Math.random() * pool.length)];
      if (!taken.has(candidate)) {
        chosen.push(candidate);
        taken.add(candidate);
      }
      if (taken.size === pool.length) break;
    }
    while (chosen.length < count) {
      chosen.push(assets[Math.floor(Math.random() * assets.length)]);
    }
    if (chosen.length === 0) return new Response('No available assets', { status: 400 });

    for (const asset of chosen) {
      const sys = '你是角色设定生成器，输出JSON，不要任何解释。严格使用简体中文，避免宗教内容。';
      const prompt = `根据形象图片路径“${asset}”，为直播间生成一个角色：\n` +
        `name：一个中文网名，避免英文与敏感词；\n` +
        `identity：50-80字的人物自我描述，贴近中国本土生活；\n` +
        `plan：一句话的近期目标；\n` +
        `格式: {"name":"...","identity":"...","plan":"..."}`;
      const { content } = await chatCompletion({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 512,
      });
      let name = '直播观众';
      let identity = '喜欢互动，热爱生活，偶尔分享新鲜事。';
      let plan = '结识朋友，聊天打卡。';
      try {
        const parsed = JSON.parse(String(content));
        if (typeof parsed.name === 'string') name = parsed.name;
        if (typeof parsed.identity === 'string') identity = parsed.identity;
        if (typeof parsed.plan === 'string') plan = parsed.plan;
      } catch {}
      const banned = /(上帝|耶稣|圣经|教会|神爱世人|宗教|祷告)/i;
      name = name.replace(banned, '').trim();
      identity = identity.replace(banned, '').trim();
      plan = plan.replace(banned, '').trim();
      if (!name) name = `观众${Math.floor(Math.random() * 10000)}`;

      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId,
        name: 'createAgentDynamic',
        args: { name, character: asset, identity, plan },
      });
    }

    return new Response(JSON.stringify({ ok: true, created: chosen.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});

export const generateImageItem = httpAction(async (ctx, request) => {
  try {
    await request.json();
    return new Response(JSON.stringify({ ok: false, disabled: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 403,
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
function presetPersonalities() {
  const types = [
    '毒舌美食博主', '杠精程序员', '街口大爷', '摇滚乐迷', '段子手', '直球工地师傅', '法学院学生', '大学生刺头',
    '摄影发烧友', '健身小教练', '追星女孩', '二次元宅', '猫咖店员', '咖啡师', '社区志愿者', '自由插画师',
    '短视频剪辑师', '电竞玩家', '数码发烧友', '理财达人', '播客主播', '广播剧配音', '旅行团领队', '剧本杀主持',
    '独立音乐人', '旧物修理匠', '园艺达人', '调酒学徒', '街舞爱好者', '手工香水师', '桌游店店员', '密室解谜控',
    '科学科普人', '脱口秀练习生', '城市漫步者', '卡车司机', '房车旅行者', '摄影棚助理', '美剧追更党', 'AI 科研打工人',
    '方言段子手', '情感电台主播', '户外登山向导', '摩旅骑士', '骑行博主', '篮球陪练', '羽毛球陪练', '长跑教练',
    '街头魔术师', '花艺学徒', '茶饮研发员', '剧评人', '影迷社团发起人', '模型工作室老板', '桌球爱好者', '网球新手',
    '海钓玩家', '潜水爱好者', '飞盘教练', '露营装备党', '自驾游策划', '民宿店小二', '滑雪玩家', '冲浪新手',
    '老物件修复师', '木工 DIY 玩家', '家电维修能手', '城市考古爱好者', '城市乐队键盘手', '口琴街头艺人', '合唱团成员',
    '配音练习生', '配乐制作人', '漫画脚本作者', '同人写手', '桌游设计师', '密室剧本作者', '独立游戏测试员', '独立游戏策划',
    '公益组织志愿者', '宠物驯导师', '犬校助理', '猫舍志愿者', '救援队预备队员', '消防宣传志愿者', '社区调解员', '科幻迷',
    '历史播客作者', '财经解说员', '二手交易达人', '旧书摊主', '城市公共艺术观察者', '地铁拍客', '夜市美食探店人'
  ];
  const tones = [
    '嘴碎', '较真', '直球', '爱杠', '毒舌', '冷面', '幽默', '冲动', '仗义', '嘴硬心软',
    '佛系', '乐观', '细腻', '慢热', '社恐但健谈', '热心肠', '温柔吐槽', '稳重', '碎嘴暖男/女', '冷幽默',
    '高能吐槽', '理性分析', '八卦但有边界', '真诚憨直', '浪漫主义', '现实主义', '乐天派', '谨慎派', '抖包袱型',
    '讲冷笑话型'
  ];
  const hobbies = [
    '逛小吃街', '夜跑', '拍街景', '听现场', '剪视频', '撸猫', '打球', '露营', '骑行', '搜集老物件',
    '逛菜市场', '做手工', '玩桌游', '看展', '听脱口秀', '研究咖啡', '学烘焙', '种花', '照顾猫狗', '拍vlog',
    '收集车票', '画速写', '写日记', '看球', '打羽毛球', '打乒乓', '游泳', '打游戏', '读小说', '看纪录片',
    '听播客', '学调酒', '做模型', '淘黑胶', '练口琴', '拍人文街拍', '摆摊卖周边', '学塔罗', '做手账', '夜拍延时',
    '学编程做小工具', '做电子乐', '做木工', '玩飞盘', '打德扑', '看相声', '玩胶片相机', '刷美食探店',
    '学吉他', '学钢琴', '写歌词', '做播客剪辑', '拍短片', '写剧本', '练配音', '做香薰蜡烛', '做手作银饰', 'DIY 键盘',
    '修车', '修自行车', '玩无人机航拍', '玩模型涂装', '玩积木拼装', '蒸馏果酒', '做清酒试酿', '学习咖啡拉花', '练习街舞 popping',
    '练习 breaking', '城市夜跑', '晨跑', '练瑜伽', '练普拉提', '团课打卡', '做 CrossFit', '跟练跳操', '跳广场舞',
    '做飞盘狗训练', '做宠物摄影', '城市鸟类观察', '拍植物花草', '露营做饭', '野外生火', '夜观星空', '玩天文望远镜',
    '写段子', '收集冷笑话', '写吐槽稿子', '练习脱口秀', '做梗图', '看喜剧专场', '模仿配音搞笑', '练习讲故事', '写幽默博客', '录搞笑播客'
  ];
  const goals = [
    '写一条爆笑日常', '点评一家店', '练习表达更有分寸', '组织一次小型活动', '把工具清单做完', '结识新朋友', '把流程梳理清楚', '出一条作品', '约一次局', '完成一个小目标',
    '发一条高赞作品', '找到志同道合的朋友', '把小账本记清楚', '参加一次线下活动', '完成一个迷你挑战', '每周打卡三次运动', '攒够旅行预算', '做一顿拿手菜请人吃', '学会一项新技能', '整理房间与工作台',
    '修好长期拖延的小事', '做一次城市漫步', '完成一个模型', '出一段练习视频', '写一篇认真长文', '做一个小型分享会', '帮朋友解决一个问题', '为社区做点事情', '刷新作品集', '给自己安排一日休息',
    '尝试一天不刷手机', '补齐搁置的博客草稿', '整理硬盘和照片', '学习一句外语并用上', '做一次深度清洁', '完成三公里慢跑', '为朋友准备一个小惊喜', '完成一份作品投稿', '学会一道新菜式', '修好一件旧设备',
    '更新社交账号形象', '练习一小时乐器', '安排一次家庭小聚', '手绘一张城市小地图', '尝试一周早睡', '录一段播客小片段', '完成一幅水彩练习', '备份资料并整理云盘',
    '完成一次冷启动直播', '采访一位路人做播客', '做一期城市声音采样', '体验一次陌生人的职业', '做一张自制 zine', '策划一场主题观影', '完成一次公益志愿', '做一张 Lo-fi 混音', '把房车改装清单完成', '拍一组城市夜景',
    '找到三条小众新闻线索', '学会两道家乡菜', '完成一周无外卖挑战', '做一次手作市集摊主', '录一支配音 demo', '完成一次飞盘小队训练',
    '做一次播客连麦', '设计一张演出海报', '完成一次人声采样混音', '做一份咖啡测评', '写一篇旅行路线攻略', '做一次城市美食地图', '做一次深夜食堂 vlog', '整理一次闲置转卖', '体验一次陌生的球类运动', '去一次免费展览并写观后感',
    '录一段街头采访', '策划一场小游戏比赛', '完成一次 10 公里骑行', '帮朋友做一次搬家清单', '做一次宠物摄影作品', '约一次 K 歌合唱', '写一首短诗并分享', '做一份主题歌单', '写一段配音样本', '练习一段脱口秀稿子',
    '完成一次日出观景打卡', '完成一张插画小稿', '做一次主题读书会', '学会一套拉伸动作', '做一次少糖饮食周', '拍一组胶片照片', '录制一段英语口语日常', '做一次科普小视频', '采访家人做口述史', '完成一次旧衣改造',
    '做一次桌游主控', '完成一次剧本杀主持', '写一段游戏剧情', '做一个小游戏关卡', '修好一把坏吉他', '做一次茶会小聚', '完善一次理财表格', '完成一次卧推目标', '跑一次 5 公里配速挑战', '尝试无手机半天',
    '整理出一份家乡小吃榜', '做一次社区志愿服务', '探访一间独立书店', '在公园打一次羽毛球', '联系一个冷门社群', '学会一个新魔术', '学会一个新调酒配方', '写一段感想并打印出来', '做一次手账周记', '练习一首钢琴曲',
    '完成一张复古海报设计', '写一篇科普短文', '做一次夜市探店直播', '记录一次父母的故事', '整理一份城市植物清单', '制作一条手机壳手绳', '练习一段街舞组合', '做一次无人机航拍剪辑', '完成一份课程学习打卡',
    '写十个短段子并试讲', '准备一场开放麦小稿', '做一张梗图并发出去', '模仿一次配音恶搞', '写一段冷笑话合集', '录一段搞笑播客小片段', '做一次喜剧专场笔记', '编一个整活小剧本', '讲一个暖心笑话给朋友', '收集五个城市趣事'
  ];
  const out: Array<{ identity: string; plan: string }> = [];
  for (let i = 0; i < types.length; i++) {
    for (let j = 0; j < tones.length; j++) {
      const k = (i + j) % hobbies.length;
      const t = types[i];
      const tone = tones[j];
      const hobby = hobbies[k];
      const goal = goals[(i * 3 + j) % goals.length];
      const identity = `${t}，性格${tone}，平时喜欢${hobby}，说话直接但不低俗，遇到不讲理会怼两句，事后愿意讲道理，贴近本土生活。`;
      const plan = `${goal}。`;
      out.push({ identity, plan });
      if (out.length >= 200) break;
    }
    if (out.length >= 200) break;
  }
  while (out.length < 200) {
    out.push({ identity: '普通观众，口语化交流，偶尔吐槽，保持礼貌与分寸。', plan: '认识几位同好。' });
  }
  return out;
}
const PERSONALITIES = presetPersonalities();
