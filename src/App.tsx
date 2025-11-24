import Game from './components/Game.tsx';

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col font-body">
      <div className="w-full lg:h-screen min-h-screen overflow-hidden flex flex-col">
        <Game />
      </div>
    </main>
  );
}
