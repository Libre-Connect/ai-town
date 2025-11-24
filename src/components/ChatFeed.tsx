import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import clsx from 'clsx';

export default function ChatFeed({ worldId, scrollViewRef }: { worldId: Id<'worlds'>; scrollViewRef: React.RefObject<HTMLDivElement> }) {
  const messages = useQuery(api.messages.listRecentByWorld, { worldId, limit: 300 });
  if (!messages) return null;
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
  const isScrolledToBottom = { current: true } as React.MutableRefObject<boolean>;
  const container = scrollViewRef.current;
  if (container) {
    const onScroll = () => {
      isScrolledToBottom.current = !!(
        container && container.scrollHeight - container.scrollTop - 50 <= container.clientHeight
      );
    };
    container.addEventListener('scroll', onScroll, { once: true });
    if (isScrolledToBottom.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }
  const nodes = messages
    .slice()
    .sort((a, b) => a._creationTime - b._creationTime)
    .flatMap((m: any) => {
      const segs = splitSegments(m.text, m.authorName);
      return segs.map((seg: any, i: number) => (
        <div key={`feed-${m._id}-${i}`} className="leading-tight mb-3">
          <div className="flex gap-2">
            <span className="uppercase flex-grow text-white">{seg.name}</span>
            <time dateTime={m._creationTime.toString()} className="text-xs text-gray-500">
              {new Date(m._creationTime).toLocaleTimeString('zh-CN', { hour12: false })}
            </time>
          </div>
          <div className={clsx('bubble', bubbleVariant(seg.name))}>
            <p className="bubble-content -mx-3 -my-1">{seg.content}</p>
          </div>
        </div>
      ));
    });
  return (
    <div className="text-base sm:text-sm">
      {nodes}
    </div>
  );
}
