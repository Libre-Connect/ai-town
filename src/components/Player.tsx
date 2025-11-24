import { Character } from './Character.tsx';
import { orientationDegrees } from '../../convex/util/geometry.ts';
import { characters } from '../../data/characters.ts';
import { toast } from 'react-toastify';
import { Player as ServerPlayer } from '../../convex/aiTown/player.ts';
import { GameId } from '../../convex/aiTown/ids.ts';
import { Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Location, locationFields, playerLocation } from '../../convex/aiTown/location.ts';
import { useHistoricalValue } from '../hooks/useHistoricalValue.ts';
import { PlayerDescription } from '../../convex/aiTown/playerDescription.ts';
import { WorldMap } from '../../convex/aiTown/worldMap.ts';
import { ServerGame } from '../hooks/serverGame.ts';

export type SelectElement = (element?: { kind: 'player'; id: GameId<'players'> }) => void;

const logged = new Set<string>();

export const Player = ({
  game,
  isViewer,
  player,
  onClick,
  historicalTime,
  worldId,
}: {
  game: ServerGame;
  isViewer: boolean;
  player: ServerPlayer;

  onClick: SelectElement;
  historicalTime?: number;
  worldId: Id<'worlds'>;
}) => {
  const playerCharacter = game.playerDescriptions.get(player.id)?.character;
  const playerName = game.playerDescriptions.get(player.id)?.name;
  if (!playerCharacter) {
    throw new Error(`Player ${player.id} has no character`);
  }
  let character = characters.find((c) => c.name === playerCharacter);

  const locationBuffer = game.world.historicalLocations?.get(player.id);
  const historicalLocation = useHistoricalValue<Location>(
    locationFields,
    historicalTime,
    playerLocation(player),
    locationBuffer,
  );
  const isAssetUrl = typeof playerCharacter === 'string' && playerCharacter.startsWith('/ai-town/assets/');
  const textureUrl = character?.textureUrl ?? (isAssetUrl ? playerCharacter : undefined);
  const spritesheetData = character?.spritesheetData;
  const speed = character?.speed ?? 0.1;
  if (!textureUrl) {
    if (!logged.has(playerCharacter)) {
      logged.add(playerCharacter);
      toast.error(`未知角色 ${playerCharacter}`);
    }
    return null;
  }

  if (!historicalLocation) {
    return null;
  }

  const isSpeaking = !![...game.world.conversations.values()].find(
    (c) => c.isTyping?.playerId === player.id,
  );
  const isThinking =
    !isSpeaking &&
    !![...game.world.agents.values()].find(
      (a) => a.playerId === player.id && !!a.inProgressOperation,
    );
  const playerConversation = game.world.playerConversation(player);
  let speechText: string | undefined;
  let speechColor = 0x333333;
  {
    const palette = [0xe57373, 0x64b5f6, 0xffd54f, 0x81c784, 0xba68c8, 0xa1887f];
    let sum = 0;
    for (let i = 0; i < player.id.length; i++) sum += player.id.charCodeAt(i);
    speechColor = palette[sum % palette.length];
  }
  // Fetch latest messages for this player's conversation.
  const messages = useQuery(
    api.messages.listMessages,
    playerConversation ? { worldId, conversationId: playerConversation.id } : 'skip',
  );
  if (messages && messages.length > 0) {
    const ordered = messages.slice().sort((a: any, b: any) => a._creationTime - b._creationTime);
    const last = ordered[ordered.length - 1];
    if (last.author === player.id) {
      const now = Date.now();
      if (now - last._creationTime < 12000) {
        const t = last.text.trim();
        speechText = t;
      }
    }
  }
  const tileDim = game.worldMap.tileDim;
  const historicalFacing = { dx: historicalLocation.dx, dy: historicalLocation.dy };
  return (
    <>
      <Character
        x={historicalLocation.x * tileDim + tileDim / 2}
        y={historicalLocation.y * tileDim + tileDim / 2}
        orientation={orientationDegrees(historicalFacing)}
        isMoving={historicalLocation.speed > 0}
        isThinking={isThinking}
        isSpeaking={isSpeaking}
        emoji={
          player.activity && player.activity.until > (historicalTime ?? Date.now())
            ? player.activity?.emoji
            : undefined
        }
        isViewer={isViewer}
        textureUrl={textureUrl}
        spritesheetData={spritesheetData}
        speed={speed}
        onClick={() => {
          onClick({ kind: 'player', id: player.id });
        }}
        speechText={speechText}
        speechColor={speechColor}
        name={playerName}
      />
    </>
  );
};
