import { useEffect, useRef, useState } from 'react';
import PixiGame from './PixiGame.tsx';

import { useElementSize } from 'usehooks-ts';
import { Stage } from '@pixi/react';
import { ConvexProvider, useConvex, useQuery } from 'convex/react';
import PlayerDetails from './PlayerDetails.tsx';
import { api } from '../../convex/_generated/api';
import { useWorldHeartbeat } from '../hooks/useWorldHeartbeat.ts';
import { useHistoricalTime } from '../hooks/useHistoricalTime.ts';
import { DebugTimeManager } from './DebugTimeManager.tsx';
import { GameId } from '../../convex/aiTown/ids.ts';
import { useServerGame } from '../hooks/serverGame.ts';
import ChatFeed from './ChatFeed.tsx';

export const SHOW_DEBUG_UI = !!import.meta.env.VITE_SHOW_DEBUG_UI;

export default function Game() {
  const convex = useConvex();
  const [selectedElement, setSelectedElement] = useState<{
    kind: 'player';
    id: GameId<'players'>;
  }>();
  // 前端内存观众已禁用
  const [banner, setBanner] = useState<{ name: string; character?: string; kind: 'join' | 'leave' } | null>(null);
  const bannerQueueRef = useRef<Array<{ name: string; character?: string; kind: 'join' | 'leave' }>>([]);
  const lastAgentIdsRef = useRef<Set<string>>(new Set());
  const nameCacheRef = useRef<Map<string, { name: string; character?: string }>>(new Map());
  const lastWorldIdRef = useRef<string | undefined>(undefined);
  const [gameWrapperRef, { width, height }] = useElementSize();

  const worldStatus = useQuery(api.world.defaultWorldStatus);
  const worldId = worldStatus?.worldId;
  const engineId = worldStatus?.engineId;

  const game = useServerGame(worldId);

  // Send a periodic heartbeat to our world to keep it alive.
  useWorldHeartbeat();

  const worldState = useQuery(api.world.worldState, worldId ? { worldId } : 'skip');
  const { historicalTime, timeManager } = useHistoricalTime(worldState?.engine);

  const scrollViewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!game) return;
    const worldKey = String(worldId ?? 'none');
    if (lastWorldIdRef.current !== worldKey) {
      lastWorldIdRef.current = worldKey;
      lastAgentIdsRef.current = new Set();
      nameCacheRef.current.clear();
      bannerQueueRef.current = [];
    }
    const currentIds = new Set<string>([...game.agentDescriptions.keys()].map((id) => String(id)));
    const last = lastAgentIdsRef.current;
    for (const id of currentIds) {
      if (!last.has(id)) {
        const agent = game.world.agents.get(id as unknown as GameId<'agents'>);
        const playerId = agent?.playerId;
        const pd = playerId && game.playerDescriptions.get(playerId);
        const name = pd?.name || '新角色';
        const character = pd?.character;
        nameCacheRef.current.set(id, { name, character });
        bannerQueueRef.current.push({ name, character, kind: 'join' });
      } else {
        // Refresh cache for existing agents to keep latest names/avatars.
        const agent = game.world.agents.get(id as unknown as GameId<'agents'>);
        const playerId = agent?.playerId;
        const pd = playerId && game.playerDescriptions.get(playerId);
        if (pd) nameCacheRef.current.set(id, { name: pd.name, character: pd.character });
      }
    }
    for (const id of last) {
      if (!currentIds.has(id)) {
        const cached = nameCacheRef.current.get(id);
        bannerQueueRef.current.push({
          name: cached?.name || '角色',
          character: cached?.character,
          kind: 'leave',
        });
        nameCacheRef.current.delete(id);
      }
    }
    lastAgentIdsRef.current = currentIds;
    if (!banner && bannerQueueRef.current.length > 0) {
      const next = bannerQueueRef.current.shift()!;
      setBanner(next);
      setTimeout(() => {
        setBanner(null);
      }, 4000);
    }
  }, [game, banner, worldId, game?.world.agents.size, game?.agentDescriptions.size]);

  if (!worldId || !engineId || !game) {
    return null;
  }

  return (
    <>
      {banner && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="mx-auto max-w-[1400px]">
            <div className="flex items-center bg-rose-600 text-white px-4 py-2 shadow">
              <span className="font-bold">
                {banner.kind === 'join' ? '新角色加入：' : '角色离开：'}
                {banner.name}
              </span>
            </div>
          </div>
        </div>
      )}
      {SHOW_DEBUG_UI && <DebugTimeManager timeManager={timeManager} width={200} height={100} />}
      <div className="mx-auto w-full grid grid-rows-[240px_1fr] lg:grid-rows-[1fr] lg:grid-cols-[1fr_auto] lg:grow max-w-[1400px] min-h-[480px] bg-gradient-to-br from-[#0a1a0a] via-[#0f2d1a] to-[#123524]">
        {/* Game area */}
        <div className="relative overflow-hidden" ref={gameWrapperRef}>
          <div className="absolute inset-0">
            <div className="container">
              <Stage width={width} height={height} options={{ backgroundAlpha: 0 }}>
                {/* Re-propagate context because contexts are not shared between renderers.
https://github.com/michalochman/react-pixi-fiber/issues/145#issuecomment-531549215 */}
                <ConvexProvider client={convex}>
                  <PixiGame
                    game={game}
                    worldId={worldId}
                    engineId={engineId}
                    width={width}
                    height={height}
                    historicalTime={historicalTime}
                    setSelectedElement={setSelectedElement}
                  />
                </ConvexProvider>
              </Stage>
            </div>
          </div>
          {/* 前端内存/快速创建 UI 已禁用 */}
        </div>
        {/* Right column livestream chat */}
        <div
          className="chat-panel-bg flex flex-col overflow-y-auto shrink-0 px-4 py-4 sm:px-4 lg:w-96 xl:pr-4"
          ref={scrollViewRef}
        >
          {game && (
            <></>
          )}
          {worldId && <ChatFeed worldId={worldId} scrollViewRef={scrollViewRef} />}
        </div>
      </div>
    </>
  );
}
