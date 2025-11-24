import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import closeImg from '../../assets/close.svg';
import { SelectElement } from './Player';
import { Messages } from './Messages';
import { toastOnError } from '../toasts';
import { useSendInput } from '../hooks/sendInput';
import { Player } from '../../convex/aiTown/player';
import { GameId } from '../../convex/aiTown/ids';
import { ServerGame } from '../hooks/serverGame';

export default function PlayerDetails({
  worldId,
  engineId,
  game,
  playerId,
  setSelectedElement,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  game: ServerGame;
  playerId?: GameId<'players'>;
  setSelectedElement: SelectElement;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const humanTokenIdentifier = useQuery(api.world.userStatus, { worldId });

  const players = [...game.world.players.values()];
  const humanPlayer = players.find((p) => p.human === humanTokenIdentifier);
  const humanConversation = humanPlayer ? game.world.playerConversation(humanPlayer) : undefined;
  // Always select the other player if we're in a conversation with them.
  if (humanPlayer && humanConversation) {
    const otherPlayerIds = [...humanConversation.participants.keys()].filter(
      (p) => p !== humanPlayer.id,
    );
    playerId = otherPlayerIds[0];
  }

  const player = playerId && game.world.players.get(playerId);
  const playerConversation = player && game.world.playerConversation(player);

  const previousConversation = useQuery(
    api.world.previousConversation,
    playerId ? { worldId, playerId } : 'skip',
  );

  const playerDescription = playerId && game.playerDescriptions.get(playerId);
  const inventory = player && (player as any).inventory;

  const startConversation = useSendInput(engineId, 'startConversation');
  const acceptInvite = useSendInput(engineId, 'acceptInvite');
  const rejectInvite = useSendInput(engineId, 'rejectInvite');
  const leaveConversation = useSendInput(engineId, 'leaveConversation');

  if (!playerId) {
    return (
      <div className="h-full text-xl flex text-center items-center p-4">
        点击地图中的角色查看聊天记录。
      </div>
    );
  }
  if (!player) {
    return null;
  }
  const isMe = humanPlayer && player.id === humanPlayer.id;
  const canInvite = !isMe && !playerConversation && humanPlayer && !humanConversation;
  const sameConversation =
    !isMe &&
    humanPlayer &&
    humanConversation &&
    playerConversation &&
    humanConversation.id === playerConversation.id;

  const humanStatus =
    humanPlayer && humanConversation && humanConversation.participants.get(humanPlayer.id)?.status;
  const playerStatus = playerConversation && playerConversation.participants.get(playerId)?.status;

  const haveInvite = sameConversation && humanStatus?.kind === 'invited';
  const waitingForAccept =
    sameConversation && playerConversation.participants.get(playerId)?.status.kind === 'invited';
  const waitingForNearby =
    sameConversation && playerStatus?.kind === 'walkingOver' && humanStatus?.kind === 'walkingOver';

  const inConversationWithMe =
    sameConversation &&
    playerStatus?.kind === 'participating' &&
    humanStatus?.kind === 'participating';

  const onStartConversation = async () => {
    if (!humanPlayer || !playerId) {
      return;
    }
    console.log(`开始对话`);
    await toastOnError(startConversation({ playerId: humanPlayer.id, invitee: playerId }));
  };
  const onAcceptInvite = async () => {
    if (!humanPlayer || !humanConversation || !playerId) {
      return;
    }
    await toastOnError(
      acceptInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onRejectInvite = async () => {
    if (!humanPlayer || !humanConversation) {
      return;
    }
    await toastOnError(
      rejectInvite({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  const onLeaveConversation = async () => {
    if (!humanPlayer || !inConversationWithMe || !humanConversation) {
      return;
    }
    await toastOnError(
      leaveConversation({
        playerId: humanPlayer.id,
        conversationId: humanConversation.id,
      }),
    );
  };
  // const pendingSuffix = (inputName: string) =>
  //   [...inflightInputs.values()].find((i) => i.name === inputName) ? ' opacity-50' : '';

  const pendingSuffix = (s: string) => '';
  return (
    <>
      <div className="flex gap-4">
        <div className="box w-3/4 sm:w-full mr-auto">
          <h2 className="bg-brown-700 p-2 font-display text-2xl sm:text-4xl tracking-wider shadow-solid text-center">
            {playerDescription?.name}
          </h2>
        </div>
        <a
          className="button text-white shadow-solid text-2xl cursor-pointer pointer-events-auto"
          onClick={() => setSelectedElement(undefined)}
        >
          <h2 className="h-full bg-clay-700">
            <img className="w-4 h-4 sm:w-5 sm:h-5" src={closeImg} />
          </h2>
        </a>
      </div>
      {canInvite && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('startConversation')
          }
          onClick={onStartConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>开始对话</span>
          </div>
        </a>
      )}
      {waitingForAccept && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>等待对方接受...</span>
          </div>
        </a>
      )}
      {waitingForNearby && (
        <a className="mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto opacity-50">
          <div className="h-full bg-clay-700 text-center">
            <span>对方正在靠近...</span>
          </div>
        </a>
      )}
      {inConversationWithMe && (
        <a
          className={
            'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
            pendingSuffix('leaveConversation')
          }
          onClick={onLeaveConversation}
        >
          <div className="h-full bg-clay-700 text-center">
            <span>离开对话</span>
          </div>
        </a>
      )}
      {haveInvite && (
        <>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('acceptInvite')
            }
            onClick={onAcceptInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>接受</span>
            </div>
          </a>
          <a
            className={
              'mt-6 button text-white shadow-solid text-xl cursor-pointer pointer-events-auto' +
              pendingSuffix('rejectInvite')
            }
            onClick={onRejectInvite}
          >
            <div className="h-full bg-clay-700 text-center">
              <span>拒绝</span>
            </div>
          </a>
        </>
      )}
      {!playerConversation && player.activity && player.activity.until > Date.now() && (
        <div className="box flex-grow mt-6">
          <h2 className="bg-brown-700 text-base sm:text-lg text-center">
            {player.activity.description}
          </h2>
        </div>
      )}
      <div className="desc my-6">
        <p className="leading-tight -m-4 bg-brown-700 text-base sm:text-sm">
          {!isMe && playerDescription?.description}
          {isMe && <i>这是你！</i>}
          {!isMe && inConversationWithMe && (
            <>
              <br />
              <br />(<i>正在和你对话！</i>)
            </>
          )}
        </p>
      </div>
      {inventory && inventory.length > 0 && (
        <div className="box flex-grow">
          <h2 className="bg-brown-700 text-lg text-center">物品</h2>
          <div className="grid grid-cols-6 gap-2 p-2 bg-brown-200">
            {inventory.map((item: any, idx: number) => (
              <div key={`inv-${idx}`} className="flex flex-col items-center">
                <img src={item.imageUrl} className="w-8 h-8" />
                <span className="text-xs text-black mt-1 truncate max-w-[60px]">{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!isMe && playerConversation && playerStatus?.kind === 'participating' && (
        <Messages
          worldId={worldId}
          engineId={engineId}
          inConversationWithMe={inConversationWithMe ?? false}
          conversation={{ kind: 'active', doc: playerConversation }}
          humanPlayer={humanPlayer}
          scrollViewRef={scrollViewRef}
        />
      )}
      {!playerConversation && previousConversation && (
        <>
          <div className="box flex-grow">
            <h2 className="bg-brown-700 text-lg text-center">之前的对话</h2>
          </div>
          <Messages
            worldId={worldId}
            engineId={engineId}
            inConversationWithMe={false}
            conversation={{ kind: 'archived', doc: previousConversation }}
            humanPlayer={humanPlayer}
            scrollViewRef={scrollViewRef}
          />
        </>
      )}
    </>
  );
}
