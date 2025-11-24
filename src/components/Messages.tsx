import clsx from 'clsx';
import { Doc, Id } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { MessageInput } from './MessageInput';
import { Player } from '../../convex/aiTown/player';
import { Conversation } from '../../convex/aiTown/conversation';
import { useEffect, useRef } from 'react';

export function Messages({
  worldId,
  engineId,
  conversation,
  inConversationWithMe,
  humanPlayer,
  scrollViewRef,
}: {
  worldId: Id<'worlds'>;
  engineId: Id<'engines'>;
  conversation:
    | { kind: 'active'; doc: Conversation }
    | { kind: 'archived'; doc: Doc<'archivedConversations'> };
  inConversationWithMe: boolean;
  humanPlayer?: Player;
  scrollViewRef: React.RefObject<HTMLDivElement>;
}) {
  const humanPlayerId = humanPlayer?.id;
  const descriptions = useQuery(api.world.gameDescriptions, { worldId });
  const messages = useQuery(api.messages.listMessages, {
    worldId,
    conversationId: conversation.doc.id,
  });
  const splitSegments = (text: string, fallbackName: string) => {
    const s = text || '';
    const matches = Array.from(s.matchAll(/(?:^|[\s\n\r])([\u4e00-\u9fa5A-Za-z0-9_]{1,20})[：:]/g));
    if (matches.length <= 1) return [{ name: fallbackName, content: s.trim() }];
    const segs: { name: string; content: string }[] = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const name = m[1];
      const start = m.index! + m[0].length - (m[0].startsWith(' ') || m[0].startsWith('\n') || m[0].startsWith('\r') ? 0 : 0);
      const end = i + 1 < matches.length ? matches[i + 1].index! : s.length;
      const content = s.substring(start, end).trim();
      if (content) segs.push({ name, content });
    }
    return segs.length ? segs : [{ name: fallbackName, content: s.trim() }];
  };
  const bubbleVariant = (id: string) => {
    const palette = ['bubble-rose', 'bubble-sky', 'bubble-lemon', 'bubble-mint', 'bubble-lilac', 'bubble-clay'];
    let sum = 0;
    for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
    return palette[sum % palette.length];
  };
  let currentlyTyping = conversation.kind === 'active' ? conversation.doc.isTyping : undefined;
  if (messages !== undefined && currentlyTyping) {
    if (messages.find((m) => m.messageUuid === currentlyTyping!.messageUuid)) {
      currentlyTyping = undefined;
    }
  }
  const currentlyTypingName =
    currentlyTyping &&
    descriptions?.playerDescriptions.find((p) => p.playerId === currentlyTyping?.playerId)?.name;

  const scrollView = scrollViewRef.current;
  const isScrolledToBottom = useRef(false);
  useEffect(() => {
    if (!scrollView) return undefined;

    const onScroll = () => {
      isScrolledToBottom.current = !!(
        scrollView && scrollView.scrollHeight - scrollView.scrollTop - 50 <= scrollView.clientHeight
      );
    };
    scrollView.addEventListener('scroll', onScroll);
    return () => scrollView.removeEventListener('scroll', onScroll);
  }, [scrollView]);
  useEffect(() => {
    if (isScrolledToBottom.current) {
      scrollViewRef.current?.scrollTo({
        top: scrollViewRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, currentlyTyping]);

  if (messages === undefined) {
    return null;
  }
  if (messages.length === 0 && !inConversationWithMe) {
    return null;
  }
  const messageNodes: { time: number; node: React.ReactNode }[] = messages.flatMap((m) => {
    const segs = splitSegments(m.text, m.authorName);
    return segs.map((seg, i) => {
      const node = (
        <div key={`text-${m._id}-${i}`} className="leading-tight mb-6">
          <div className="flex gap-4">
            <span className="uppercase flex-grow">{seg.name}</span>
            <time dateTime={m._creationTime.toString()}>
              {new Date(m._creationTime).toLocaleString('zh-CN')}
            </time>
          </div>
          <div className={clsx('bubble', m.author === humanPlayerId && 'bubble-mine', bubbleVariant(seg.name))}>
            <p className="bubble-content -mx-3 -my-1">{seg.content}</p>
          </div>
        </div>
      );
      return { node, time: m._creationTime };
    });
  });
  const lastMessageTs = messages.map((m) => m._creationTime).reduce((a, b) => Math.max(a, b), 0);

  const membershipNodes: typeof messageNodes = [];
  if (conversation.kind === 'active') {
    for (const [playerId, m] of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      let started;
      if (m.status.kind === 'participating') {
        started = m.status.started;
      }
      if (started) {
        membershipNodes.push({
          node: (
            <div key={`joined-${playerId}`} className="leading-tight mb-6">
              <p className="text-brown-700 text-center">{playerName} 加入了对话。</p>
            </div>
          ),
          time: started,
        });
      }
    }
  } else {
    for (const playerId of conversation.doc.participants) {
      const playerName = descriptions?.playerDescriptions.find((p) => p.playerId === playerId)
        ?.name;
      const started = conversation.doc.created;
      membershipNodes.push({
        node: (
          <div key={`joined-${playerId}`} className="leading-tight mb-6">
              <p className="text-brown-700 text-center">{playerName} 加入了对话。</p>
          </div>
        ),
        time: started,
      });
      const ended = conversation.doc.ended;
      membershipNodes.push({
        node: (
          <div key={`left-${playerId}`} className="leading-tight mb-6">
              <p className="text-brown-700 text-center">{playerName} 离开了对话。</p>
          </div>
        ),
        // Always sort all "left" messages after the last message.
        // TODO: We can remove this once we want to support more than two participants per conversation.
        time: Math.max(lastMessageTs + 1, ended),
      });
    }
  }
  const nodes = [...messageNodes, ...membershipNodes];
  nodes.sort((a, b) => a.time - b.time);
  return (
    <div className="chats text-base sm:text-sm">
      <div className="bg-brown-200 text-black p-2">
        {nodes.length > 0 && nodes.map((n) => n.node)}
        {currentlyTyping && currentlyTyping.playerId !== humanPlayerId && (
          <div key="typing" className="leading-tight mb-6">
            <div className="flex gap-4">
              <span className="uppercase flex-grow">{currentlyTypingName}</span>
              <time dateTime={currentlyTyping.since.toString()}>
                {new Date(currentlyTyping.since).toLocaleString('zh-CN')}
              </time>
            </div>
            <div className={clsx('bubble', bubbleVariant(currentlyTyping.playerId))}>
              <p className="bubble-content -mx-3 -my-1">
                <i>正在输入...</i>
              </p>
            </div>
          </div>
        )}
        {humanPlayer && inConversationWithMe && conversation.kind === 'active' && (
          <MessageInput
            worldId={worldId}
            engineId={engineId}
            conversation={conversation.doc}
            humanPlayer={humanPlayer}
          />
        )}
      </div>
    </div>
  );
}
