import { Infer, ObjectType, v } from 'convex/values';
import { Point, Vector, path, point, vector } from '../util/types';
import { GameId, parseGameId } from './ids';
import { playerId } from './ids';
import {
  PATHFINDING_TIMEOUT,
  PATHFINDING_BACKOFF,
  HUMAN_IDLE_TOO_LONG,
  MAX_HUMAN_PLAYERS,
  MAX_PATHFINDS_PER_STEP,
} from '../constants';
import { pointsEqual, pathPosition } from '../util/geometry';
import { Game } from './game';
import { stopPlayer, findRoute, blocked, movePlayer } from './movement';
import { inputHandler } from './inputHandler';
import { characters } from '../../data/characters';
import { PlayerDescription } from './playerDescription';

const pathfinding = v.object({
  destination: point,
  started: v.number(),
  state: v.union(
    v.object({
      kind: v.literal('needsPath'),
    }),
    v.object({
      kind: v.literal('waiting'),
      until: v.number(),
    }),
    v.object({
      kind: v.literal('moving'),
      path,
    }),
  ),
});
export type Pathfinding = Infer<typeof pathfinding>;

export const activity = v.object({
  description: v.string(),
  emoji: v.optional(v.string()),
  until: v.number(),
});
export type Activity = Infer<typeof activity>;

export const serializedPlayer = {
  id: playerId,
  human: v.optional(v.string()),
  pathfinding: v.optional(pathfinding),
  activity: v.optional(activity),

  // The last time they did something.
  lastInput: v.number(),

  position: point,
  facing: vector,
  speed: v.number(),
  coins: v.optional(v.number()),
  inventory: v.optional(
    v.array(
      v.object({
        name: v.string(),
        imageUrl: v.string(),
        created: v.number(),
      }),
    ),
  ),
};
export type SerializedPlayer = ObjectType<typeof serializedPlayer>;

export class Player {
  id: GameId<'players'>;
  human?: string;
  pathfinding?: Pathfinding;
  activity?: Activity;

  lastInput: number;

  position: Point;
  facing: Vector;
  speed: number;
  coins: number;
  inventory: { name: string; imageUrl: string; created: number }[];

  constructor(serialized: SerializedPlayer) {
    const {
      id,
      human,
      pathfinding,
      activity,
      lastInput,
      position,
      facing,
      speed,
      coins,
      inventory,
    } = serialized;
    this.id = parseGameId('players', id);
    this.human = human;
    this.pathfinding = pathfinding;
    this.activity = activity;
    this.lastInput = lastInput;
    this.position = position;
    this.facing = facing;
    this.speed = speed;
    this.coins = coins ?? 100;
    this.inventory = inventory ?? [];
  }

  tick(game: Game, now: number) {
    if (this.human && this.lastInput < now - HUMAN_IDLE_TOO_LONG) {
      this.leave(game, now);
    }
  }

  tickPathfinding(game: Game, now: number) {
    // There's nothing to do if we're not moving.
    const { pathfinding, position } = this;
    if (!pathfinding) {
      return;
    }

    // Stop pathfinding if we've reached our destination.
    if (pathfinding.state.kind === 'moving' && pointsEqual(pathfinding.destination, position)) {
      stopPlayer(this);
    }

    // Stop pathfinding if we've timed out.
    if (pathfinding.started + PATHFINDING_TIMEOUT < now) {
      console.warn(`Timing out pathfinding for ${this.id}`);
      stopPlayer(this);
    }

    // Transition from "waiting" to "needsPath" if we're past the deadline.
    if (pathfinding.state.kind === 'waiting' && pathfinding.state.until < now) {
      pathfinding.state = { kind: 'needsPath' };
    }

    // Perform pathfinding if needed.
    if (pathfinding.state.kind === 'needsPath' && game.numPathfinds < MAX_PATHFINDS_PER_STEP) {
      game.numPathfinds++;
      if (game.numPathfinds === MAX_PATHFINDS_PER_STEP) {
        console.warn(`Reached max pathfinds for this step`);
      }
      const route = findRoute(game, now, this, pathfinding.destination);
      if (route === null) {
        console.log(`Failed to route to ${JSON.stringify(pathfinding.destination)}`);
        stopPlayer(this);
      } else {
        if (route.newDestination) {
          console.warn(
            `Updating destination from ${JSON.stringify(
              pathfinding.destination,
            )} to ${JSON.stringify(route.newDestination)}`,
          );
          pathfinding.destination = route.newDestination;
        }
        pathfinding.state = { kind: 'moving', path: route.path };
      }
    }
  }

  tickPosition(game: Game, now: number) {
    // There's nothing to do if we're not moving.
    if (!this.pathfinding || this.pathfinding.state.kind !== 'moving') {
      this.speed = 0;
      return;
    }

    // Compute a candidate new position and check if it collides
    // with anything.
    const candidate = pathPosition(this.pathfinding.state.path as any, now);
    if (!candidate) {
      console.warn(`Path out of range of ${now} for ${this.id}`);
      return;
    }
    const { position, facing, velocity } = candidate;
    const collisionReason = blocked(game, now, position, this.id);
    if (collisionReason !== null) {
      const backoff = Math.random() * PATHFINDING_BACKOFF;
      console.warn(`Stopping path for ${this.id}, waiting for ${backoff}ms: ${collisionReason}`);
      this.pathfinding.state = {
        kind: 'waiting',
        until: now + backoff,
      };
      return;
    }
    // Update the player's location.
    this.position = position;
    this.facing = facing;
    this.speed = velocity;
  }

  static join(
    game: Game,
    now: number,
    name: string,
    character: string,
    description: string,
    tokenIdentifier?: string,
  ) {
    if (tokenIdentifier) {
      let numHumans = 0;
      for (const player of game.world.players.values()) {
        if (player.human) {
          numHumans++;
        }
        if (player.human === tokenIdentifier) {
          throw new Error(`You are already in this game!`);
        }
      }
      if (numHumans >= MAX_HUMAN_PLAYERS) {
        throw new Error(`Only ${MAX_HUMAN_PLAYERS} human players allowed at once.`);
      }
    }
    let position;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = {
        x: Math.floor(Math.random() * game.worldMap.width),
        y: Math.floor(Math.random() * game.worldMap.height),
      };
      if (blocked(game, now, candidate)) {
        continue;
      }
      position = candidate;
      break;
    }
    if (!position) {
      throw new Error(`Failed to find a free position!`);
    }
    const facingOptions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    const facing = facingOptions[Math.floor(Math.random() * facingOptions.length)];
    if (!characters.find((c) => c.name === character)) {
      const isAssetUrl = typeof character === 'string' && character.startsWith('/ai-town/assets/');
      if (!isAssetUrl) {
        throw new Error(`Invalid character: ${character}`);
      }
    }
    const playerId = game.allocId('players');
    game.world.players.set(
      playerId,
      new Player({
        id: playerId,
        human: tokenIdentifier,
        lastInput: now,
        position,
        facing,
        speed: 0,
        coins: 100,
        inventory: [],
      }),
    );
    game.playerDescriptions.set(
      playerId,
      new PlayerDescription({
        playerId,
        character,
        description,
        name,
      }),
    );
    game.descriptionsModified = true;
    return playerId;
  }

  leave(game: Game, now: number) {
    // Stop our conversation if we're leaving the game.
    const conversation = [...game.world.conversations.values()].find((c) =>
      c.participants.has(this.id),
    );
    if (conversation) {
      conversation.stop(game, now);
    }
    game.world.players.delete(this.id);
  }

  serialize(): SerializedPlayer {
    const { id, human, pathfinding, activity, lastInput, position, facing, speed, coins, inventory } = this;
    return {
      id,
      human,
      pathfinding,
      activity,
      lastInput,
      position,
      facing,
      speed,
      coins,
      inventory,
    };
  }
}

export const playerInputs = {
  join: inputHandler({
    args: {
      name: v.string(),
      character: v.string(),
      description: v.string(),
      tokenIdentifier: v.optional(v.string()),
    },
    handler: (game, now, args) => {
      Player.join(game, now, args.name, args.character, args.description, args.tokenIdentifier);
      return null;
    },
  }),
  leave: inputHandler({
    args: { playerId },
    handler: (game, now, args) => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      player.leave(game, now);
      return null;
    },
  }),
  moveTo: inputHandler({
    args: {
      playerId,
      destination: v.union(point, v.null()),
    },
    handler: (game, now, args) => {
      const playerId = parseGameId('players', args.playerId);
      const player = game.world.players.get(playerId);
      if (!player) {
        throw new Error(`Invalid player ID ${playerId}`);
      }
      if (args.destination) {
        movePlayer(game, now, player, args.destination);
      } else {
        stopPlayer(player);
      }
      return null;
    },
  }),
  placeObject: inputHandler({
    args: {
      playerId,
      position: point,
      tileIndex: v.number(),
      layer: v.optional(v.number()),
    },
    handler: (game, now, args) => {
      const pid = parseGameId('players', args.playerId);
      const player = game.world.players.get(pid);
      if (!player) throw new Error(`Invalid player ID ${pid}`);
      const x = Math.floor(args.position.x);
      const y = Math.floor(args.position.y);
      if (x < 0 || y < 0 || x >= game.worldMap.width || y >= game.worldMap.height) {
        throw new Error(`Position out of bounds`);
      }
      const dist = Math.abs(player.position.x - x) + Math.abs(player.position.y - y);
      if (dist > 3) {
        throw new Error('Too far to build');
      }
      const layerIdx = args.layer ?? 0;
      while (game.worldMap.objectTiles.length <= layerIdx) {
        const layer = Array.from({ length: game.worldMap.width }, () =>
          Array.from({ length: game.worldMap.height }, () => -1),
        );
        game.worldMap.objectTiles.push(layer as any);
      }
      game.worldMap.objectTiles[layerIdx][x][y] = args.tileIndex;
      game.descriptionsModified = true;
      player.activity = { description: 'build', until: now + 3000 };
      return null;
    },
  }),
  tradeCoins: inputHandler({
    args: {
      from: playerId,
      to: playerId,
      amount: v.number(),
    },
    handler: (game, now, args) => {
      const fromId = parseGameId('players', args.from);
      const toId = parseGameId('players', args.to);
      const from = game.world.players.get(fromId);
      const to = game.world.players.get(toId);
      if (!from || !to) throw new Error('Invalid players');
      const amount = Math.floor(Math.max(0, args.amount));
      if (amount <= 0) return null;
      if ((from.coins ?? 0) < amount) throw new Error('Insufficient coins');
      const near = Math.abs(from.position.x - to.position.x) + Math.abs(from.position.y - to.position.y) <= 2;
      const sameConv = !!game.world.playerConversation(from) && game.world.playerConversation(from)?.participants.has(toId);
      if (!near && !sameConv) throw new Error('Players not nearby or conversing');
      from.coins = (from.coins ?? 0) - amount;
      to.coins = (to.coins ?? 0) + amount;
      return null;
    },
  }),
  tradeItem: inputHandler({
    args: {
      from: playerId,
      to: playerId,
      itemIndex: v.number(),
    },
    handler: (game, now, args) => {
      const fromId = parseGameId('players', args.from);
      const toId = parseGameId('players', args.to);
      const from = game.world.players.get(fromId);
      const to = game.world.players.get(toId);
      if (!from || !to) throw new Error('Invalid players');
      const idx = Math.floor(args.itemIndex);
      if (!from.inventory || idx < 0 || idx >= from.inventory.length) throw new Error('Invalid item');
      const near = Math.abs(from.position.x - to.position.x) + Math.abs(from.position.y - to.position.y) <= 2;
      const sameConv = !!game.world.playerConversation(from) && game.world.playerConversation(from)?.participants.has(toId);
      if (!near && !sameConv) throw new Error('Players not nearby or conversing');
      const item = from.inventory.splice(idx, 1)[0];
      to.inventory ??= [];
      to.inventory.push(item);
      return null;
    },
  }),
  placeInventoryItem: inputHandler({
    args: {
      playerId,
      itemIndex: v.number(),
      position: point,
    },
    handler: (game, now, args) => {
      const pid = parseGameId('players', args.playerId);
      const player = game.world.players.get(pid);
      if (!player) throw new Error(`Invalid player ID ${pid}`);
      const idx = Math.floor(args.itemIndex);
      if (!player.inventory || idx < 0 || idx >= player.inventory.length) throw new Error('Invalid item');
      const x = Math.floor(args.position.x);
      const y = Math.floor(args.position.y);
      if (x < 0 || y < 0 || x >= game.worldMap.width || y >= game.worldMap.height) {
        throw new Error('Position out of bounds');
      }
      const item = player.inventory.splice(idx, 1)[0];
      game.worldMap.animatedSprites.push({
        x: x * game.worldMap.tileDim,
        y: y * game.worldMap.tileDim,
        w: game.worldMap.tileDim,
        h: game.worldMap.tileDim,
        layer: 0,
        sheet: item.imageUrl,
        animation: 'default',
      } as any);
      game.descriptionsModified = true;
      player.activity = { description: 'build', until: now + 3000 };
      return null;
    },
  }),
  emote: inputHandler({
    args: {
      playerId,
      emoji: v.string(),
      durationMs: v.number(),
    },
    handler: (game, now, args) => {
      const pid = parseGameId('players', args.playerId);
      const player = game.world.players.get(pid);
      if (!player) throw new Error(`Invalid player ID ${pid}`);
      player.activity = { description: 'emote', emoji: args.emoji, until: now + Math.max(500, args.durationMs) };
      return null;
    },
  }),
  discoverItem: inputHandler({
    args: {
      playerId,
      item: v.object({ name: v.string(), imageUrl: v.string() }),
      place: v.optional(point),
      kind: v.optional(v.union(v.literal('item'), v.literal('building'))),
      size: v.optional(v.object({ w: v.number(), h: v.number() })),
    },
    handler: (game, now, args) => {
      const pid = parseGameId('players', args.playerId);
      const player = game.world.players.get(pid);
      if (!player) throw new Error(`Invalid player ID ${pid}`);
      player.inventory.push({ name: args.item.name, imageUrl: args.item.imageUrl, created: now });
      if (args.place) {
        const x = Math.floor(args.place.x);
        const y = Math.floor(args.place.y);
        if (x < 0 || y < 0 || x >= game.worldMap.width || y >= game.worldMap.height) {
          throw new Error('place out of bounds');
        }
        const cellsW = args.size?.w ?? 1;
        const cellsH = args.size?.h ?? 1;
        game.worldMap.animatedSprites.push({
          x: x * game.worldMap.tileDim,
          y: y * game.worldMap.tileDim,
          w: cellsW * game.worldMap.tileDim,
          h: cellsH * game.worldMap.tileDim,
          layer: 0,
          sheet: args.item.imageUrl,
          animation: 'default',
        } as any);
        game.descriptionsModified = true;
      }
      const kind = args.kind ?? 'item';
      player.activity = { description: kind === 'building' ? 'build' : 'explore', until: now + 3000 };
      return null;
    },
  }),
};
