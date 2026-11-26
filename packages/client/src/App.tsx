import { useEffect } from 'react';
import { useStore } from './store';
import Lobby from './views/Lobby';
import Room from './views/Room';
import Game from './views/Game';
import Nimmt from './views/Nimmt';
import Cheat from './views/Cheat';
import DrawGuess from './views/DrawGuess';
import Galli from './views/Galli';
import CardGallery from './views/CardGallery';

export default function App() {
  const { route, init, error, theme, view } = useStore();
  useEffect(() => { init(); }, []);
  useEffect(() => { document.body.dataset.theme = theme; }, [theme]);

  if (location.search.includes('cards')) {
    return <div className="h-full"><CardGallery /></div>;
  }

  const gameView = route === 'game'
    ? (view?.game === 'uno' || view?.game === undefined
      ? <Game key="uno" />
      : view?.game === 'nimmt'
        ? <Nimmt key="nimmt" />
      : view?.game === 'cheat'
        ? <Cheat key="cheat" />
      : view?.game === 'drawguess'
        ? <DrawGuess key="drawguess" />
      : view?.game === 'galli'
        ? <Galli key="galli" />
        : <div className="h-full flex items-center justify-center text-white/60">该游戏界面开发中</div>)
    : null;

  return (
    <div className="h-full">
      {route === 'lobby' && <Lobby key="lobby" />}
      {route === 'room' && <Room key="room" />}
      {gameView}
      {error && (
        <div className="fixed bottom-8 left-0 right-0 flex justify-center z-[100] pointer-events-none">
          <div className="bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg">{error}</div>
        </div>
      )}
    </div>
  );
}
