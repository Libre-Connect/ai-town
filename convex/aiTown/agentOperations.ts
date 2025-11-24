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

const DISCOVERY_GENERATION_PROBABILITY = 0.05;
const POLLINATIONS_MODEL = 'flux';
const POLLINATIONS_TOKEN = 'r5bQfseAxxaO7YNc';

type Placement = { x: number; y: number };

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

    await ctx.runMutation(internal.aiTown.agent.agentSendMessage, {
      worldId: args.worldId,
      conversationId: args.conversationId,
      agentId: args.agentId,
      playerId: args.playerId,
      text,
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
    const generation = await ctx.runQuery(api.world.generationBudget, { worldId: args.worldId });
    const windowMs = 20 * 60 * 1000;
    const windowExpired = now - (generation.windowStart ?? 0) > windowMs;
    const windowStart = windowExpired ? now : generation.windowStart ?? now;
    const windowCount = windowExpired ? 0 : generation.windowCount ?? 0;
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
    const canUseBucket = generation.bucket > generation.lastGenerationBucket;
    const canUseWindow = windowCount < 2;
    const doGenerate = canUseBucket && canUseWindow && Math.random() < DISCOVERY_GENERATION_PROBABILITY;
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
      const free = findFreePlacement(map, { x: base.x, y: base.y }, { x: w, y: h });
      await sleep(Math.random() * 1000);
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'discoverItem',
        args: {
          playerId: player.id,
          item: { name: english, imageUrl },
          place: free,
          kind,
          size: { w, h },
        },
      });
      await ctx.runMutation(api.world.setGenerationBucket, {
        worldId: args.worldId,
        bucket: generation.bucket,
        windowStart,
        windowCount: windowCount + 1,
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
    } else {
      const dest = {
        x: Math.floor(myPos.x + (Math.random() < 0.5 ? 0 : Math.sign(Math.random() - 0.5))),
        y: Math.floor(myPos.y + (Math.random() < 0.5 ? 0 : Math.sign(Math.random() - 0.5))),
      };
      const x = Math.max(0, Math.min(args.map.width - 1, dest.x));
      const y = Math.max(0, Math.min(args.map.height - 1, dest.y));
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId: args.worldId,
        name: 'placeInventoryItem',
        args: { playerId: player.id, itemIndex: idx, position: { x, y } },
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

function buildOccupiedTiles(worldMap: WorldMap) {
  const occupied = new Set<string>();
  for (const sprite of worldMap.animatedSprites) {
    const tilesW = Math.max(1, Math.ceil(sprite.w / worldMap.tileDim));
    const tilesH = Math.max(1, Math.ceil(sprite.h / worldMap.tileDim));
    const baseX = Math.floor(sprite.x / worldMap.tileDim);
    const baseY = Math.floor(sprite.y / worldMap.tileDim);
    for (let dx = 0; dx < tilesW; dx++) {
      for (let dy = 0; dy < tilesH; dy++) {
        occupied.add(`${baseX + dx},${baseY + dy}`);
      }
    }
  }
  return occupied;
}

function findFreePlacement(worldMap: WorldMap, start: Placement, size: Placement): Placement {
  const occupied = buildOccupiedTiles(worldMap);
  const fits = (x: number, y: number) => {
    if (x < 0 || y < 0 || x + size.x > worldMap.width || y + size.y > worldMap.height) return false;
    for (let dx = 0; dx < size.x; dx++) {
      for (let dy = 0; dy < size.y; dy++) {
        if (occupied.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    return true;
  };
  const maxRadius = Math.max(worldMap.width, worldMap.height);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const dyCandidates = [r, -r];
      for (const dy of dyCandidates) {
        const x = start.x + dx;
        const y = start.y + dy;
        if (fits(x, y)) return { x, y };
      }
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      const dxCandidates = [r, -r];
      for (const dx of dxCandidates) {
        const x = start.x + dx;
        const y = start.y + dy;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  // Fallback: clamp to map bounds.
  return {
    x: Math.max(0, Math.min(worldMap.width - size.x, start.x)),
    y: Math.max(0, Math.min(worldMap.height - size.y, start.y)),
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
    const names = (Array.isArray(body.names) ? body.names : []).map((n) => String(n || '').trim()).filter(Boolean);
    const count = Math.max(0, Math.min(body.count ?? names.length, 200));

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
    const pickAsset = () => (unusedAssets.length ? unusedAssets.splice(Math.floor(Math.random() * unusedAssets.length), 1)[0] : fullAssets[Math.floor(Math.random() * fullAssets.length)]);

    const usedPersonality = new Set(
      (descs.playerDescriptions || [])
        .map((d: any) => String(d.description || ''))
        .filter((s) => PERSONALITIES.some((p) => p.identity === s)),
    );
    const unusedPersonality = PERSONALITIES.filter((p) => !usedPersonality.has(p.identity));
    const pickPersonality = () => (unusedPersonality.length ? unusedPersonality.splice(Math.floor(Math.random() * unusedPersonality.length), 1)[0] : PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)]);

    let created = 0;
    for (const name of names.slice(0, count || names.length)) {
      if (!name || existingNames.has(name)) continue;
      const personality = pickPersonality();
      const character = pickAsset();
      await ctx.runMutation(api.aiTown.main.sendInput, {
        worldId,
        name: 'createAgentDynamic',
        args: { name, character, identity: personality.identity, plan: personality.plan },
      });
      existingNames.add(name);
      created++;
    }
    return new Response(JSON.stringify({ ok: true, created }), {
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
    const body = (await request.json()) as {
      worldId?: Id<'worlds'>;
      playerId: string;
      area: { x1: number; y1: number; x2: number; y2: number };
      kind?: 'building' | 'item';
    };
    const worldStatus = await ctx.runQuery(api.world.defaultWorldStatus);
    const worldId = body.worldId ?? worldStatus?.worldId;
    if (!worldId) return new Response('No worldId', { status: 400 });
    const { playerId, area } = body;
    if (!playerId || !area) return new Response('Missing playerId/area', { status: 400 });
    const w = Math.abs(area.x2 - area.x1) + 1;
    const h = Math.abs(area.y2 - area.y1) + 1;
    if (w > 6 || h > 6) return new Response('Area too big', { status: 400 });

    const kind = body.kind ?? (Math.random() < 0.5 ? 'item' : 'building');
    const sys = 'You are a pixel art assistant. Output only an English prompt, no explanations.';
    const prompt =
      kind === 'building'
        ? 'Pixel art building sprite, top-down RPG style, clean outline, centered on a white grassy field with visible grass texture, never a solid white or blank background, game-ready.'
        : 'Pixel art item sprite, 1x1 tile, clear silhouette, centered on a white grassy field with visible grass texture, never a solid white or blank background, game-ready.';
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

    const minx = Math.min(area.x1, area.x2);
    const miny = Math.min(area.y1, area.y2);
    const cx = Math.floor((area.x1 + area.x2) / 2);
    const cy = Math.floor((area.y1 + area.y2) / 2);
    const size = kind === 'building' ? { w: Math.max(3, w), h: Math.max(3, h) } : { w: 1, h: 1 };
    const requested = kind === 'building' ? { x: minx, y: miny } : { x: cx, y: cy };
    const gameDesc = await ctx.runQuery(api.world.gameDescriptions, { worldId });
    const map = new WorldMap(gameDesc.worldMap);
    const free = findFreePlacement(map, requested, size as any);
    await ctx.runMutation(api.aiTown.main.sendInput, {
      worldId,
      name: 'discoverItem',
      args: {
        playerId,
        item: { name: english, imageUrl },
        place: free,
        kind,
        size,
      },
    });
    return new Response(JSON.stringify({ ok: true, prompt: english, imageUrl }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});
function presetPersonalities() {
  const types = [
    '毒舌美食博主', '杠精程序员', '街口大爷', '摇滚乐迷', '段子手', '直球工地师傅', '法学院学生', '大学生刺头',
    '摄影发烧友', '健身小教练', '追星女孩', '二次元宅', '猫咖店员', '咖啡师', '社区志愿者', '自由插画师',
    '短视频剪辑师', '电竞玩家', '数码发烧友', '理财达人'
  ];
  const tones = ['嘴碎', '较真', '直球', '爱杠', '毒舌', '冷面', '幽默', '冲动', '仗义', '嘴硬心软'];
  const hobbies = [
    '逛小吃街', '夜跑', '拍街景', '听现场', '剪视频', '撸猫', '打球', '露营', '骑行', '搜集老物件',
    '逛菜市场', '做手工', '玩桌游', '看展', '听脱口秀', '研究咖啡', '学烘焙', '种花', '照顾猫狗', '拍vlog',
    '收集车票', '画速写', '写日记', '看球', '打羽毛球', '打乒乓', '游泳', '打游戏', '读小说', '看纪录片'
  ];
  const goals = [
    '写一条爆笑日常', '点评一家店', '练习表达更有分寸', '组织一次小型活动', '把工具清单做完', '结识新朋友', '把流程梳理清楚', '出一条作品', '约一次局', '完成一个小目标',
    '发一条高赞作品', '找到志同道合的朋友', '把小账本记清楚', '参加一次线下活动', '完成一个迷你挑战', '每周打卡三次运动', '攒够旅行预算', '做一顿拿手菜请人吃', '学会一项新技能', '整理房间与工作台',
    '修好长期拖延的小事', '做一次城市漫步', '完成一个模型', '出一段练习视频', '写一篇认真长文', '做一个小型分享会', '帮朋友解决一个问题', '为社区做点事情', '刷新作品集', '给自己安排一日休息'
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
