import React, { useState, useEffect, useRef } from 'react';
import { Shield, Zap, Search, Skull, Trophy, RotateCcw, Copy, Users, Play, LogIn, ArrowRight } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, updateProfile } from "firebase/auth";
import {
  getFirestore, collection, doc, setDoc, getDoc, updateDoc,
  onSnapshot, arrayUnion, serverTimestamp, increment
} from "firebase/firestore";

// --- Firebase Configuration & Setup ---
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'default-app-id';

// --- Utility Functions ---
const generateBingoCard = () => {
  const card = [];
  const ranges = [
    { min: 1, max: 15 }, { min: 16, max: 30 }, { min: 31, max: 45 }, { min: 46, max: 60 }, { min: 61, max: 75 }
  ];
  for (let col = 0; col < 5; col++) {
    const columnNumbers = [];
    while (columnNumbers.length < 5) {
      const num = Math.floor(Math.random() * (ranges[col].max - ranges[col].min + 1)) + ranges[col].min;
      if (!columnNumbers.includes(num)) columnNumbers.push(num);
    }
    for (let row = 0; row < 5; row++) {
      const idx = row * 5 + col;
      card[idx] = {
        id: idx,
        value: (row === 2 && col === 2) ? 'FREE' : columnNumbers[row],
        marked: (row === 2 && col === 2)
      };
    }
  }
  return card.sort((a, b) => a.id - b.id);
};

const checkWin = (card) => {
  const lines = [
    [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
    [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
    [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]
  ];
  return lines.some(line => line.every(idx => card[idx].marked));
};

// --- Main Component ---
const GameApp = () => {
  // Global State
  const [user, setUser] = useState(null);
  const [view, setView] = useState('login'); // login, lobby, room, game

  // Game Data State
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [gameData, setGameData] = useState(null); // shared game state (status, currentNumber, etc.)
  const [players, setPlayers] = useState([]); // list of players in room
  const [myPlayerDoc, setMyPlayerDoc] = useState(null); // my specific player data

  // Local Gameplay State
  const [timeLeft, setTimeLeft] = useState(4);
  const [logs, setLogs] = useState([]);
  const [localCard, setLocalCard] = useState([]);

  // Refs
  const timerRef = useRef(null);
  const numberPoolRef = useRef([]);

  // --- Auth & Init ---
  useEffect(() => {
    const initAuth = async () => {
        try {
            await signInAnonymously(auth);
        } catch (error) {
            console.error("Auth failed", error);
        }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        if (u.displayName) setView('lobby'); // Skip login if already has name
      }
    });
    return () => unsubscribe();
  }, []);

  // --- Firestore Listeners ---
  useEffect(() => {
    if (!roomId || !user) return;

    // 1. Listen to Game Room Data
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId);
    const unsubGame = onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGameData(data);

        // Host Logic: Timer Sync
        if (data.status === 'playing' && data.lastCallTime) {
           // Sync time logic could go here, simplified for now
        }
      } else {
        // Room deleted
        alert('Room closed');
        setView('lobby');
      }
    }, (error) => console.error("Game listener error:", error));

    // 2. Listen to Players Subcollection
    const playersRef = collection(db, 'artifacts', appId, 'public', 'data', 'games', roomId, 'players');
    const unsubPlayers = onSnapshot(playersRef, (snapshot) => {
      const pList = snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
      setPlayers(pList);

      const me = pList.find(p => p.uid === user.uid);
      if (me) {
        setMyPlayerDoc(me);
        setLocalCard(me.card || []);

        // Check if I won
        if (me.hasWon && view !== 'gameover') {
           // Wait for game status update
        }

        // Handle Stun Effect
        if (me.status === 'stunned') {
            // Auto recover after 3s (Client side prediction/cleanup)
             setTimeout(() => {
               if (me.status === 'stunned') {
                 updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId, 'players', user.uid), {
                   status: 'normal'
                 });
               }
             }, 3000);
        }
      }
    }, (error) => console.error("Players listener error:", error));

    return () => {
      unsubGame();
      unsubPlayers();
    };
  }, [roomId, user]);

  // --- Host Game Loop ---
  useEffect(() => {
    if (!isHost || !gameData || gameData.status !== 'playing') return;

    const runGameLoop = async () => {
      if (timeLeft <= 0) {
        // Pick Number
        const pool = gameData.numberPool || [];
        if (pool.length === 0) return; // End game logic could go here

        const randomIndex = Math.floor(Math.random() * pool.length);
        const nextNum = pool[randomIndex];
        const newPool = pool.filter((_, i) => i !== randomIndex);

        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId), {
          currentNumber: nextNum,
          calledNumbers: arrayUnion(nextNum),
          numberPool: newPool,
          lastCallTime: serverTimestamp()
        });
        setTimeLeft(4);
      } else {
        const timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
        return () => clearTimeout(timer);
      }
    };

    const cleanup = runGameLoop();
    return () => cleanup && cleanup.then && cleanup.then(c => c && c());
  }, [timeLeft, isHost, gameData]);


  // --- Actions ---

  const handleLogin = async (name) => {
    if (!name.trim()) return;
    try {
      await updateProfile(user, { displayName: name });
      setView('lobby');
    } catch (e) {
      console.error(e);
    }
  };

  const createRoom = async () => {
    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', newRoomId);

    // Init Game Doc
    await setDoc(gameRef, {
      hostId: user.uid,
      status: 'waiting',
      currentNumber: null,
      calledNumbers: [],
      numberPool: Array.from({ length: 75 }, (_, i) => i + 1),
      winner: null
    });

    // Init My Player Doc
    await joinRoomLogic(newRoomId, true);
  };

  const joinRoom = async (idInput) => {
    const id = idInput.toUpperCase();
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', id);
    const snap = await getDoc(gameRef);
    if (snap.exists()) {
      if (snap.data().status !== 'waiting') {
        alert("Game already started!");
        return;
      }
      await joinRoomLogic(id, false);
    } else {
      alert("Room not found");
    }
  };

  const joinRoomLogic = async (id, hostStatus) => {
    setRoomId(id);
    setIsHost(hostStatus);

    const myCard = generateBingoCard();
    const playerRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', id, 'players', user.uid);

    await setDoc(playerRef, {
      name: user.displayName || 'Anonymous',
      card: myCard,
      items: { search: 1, bomb: 1, shield: 1 },
      status: 'normal',
      score: 0, // lines completed
      hasWon: false
    });

    setView('room');
  };

  const startGame = async () => {
    if (!isHost) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId), {
      status: 'playing',
      numberPool: Array.from({ length: 75 }, (_, i) => i + 1) // Reset pool
    });
  };

  const handleCardClick = async (idx) => {
    if (!myPlayerDoc || myPlayerDoc.status === 'stunned') return;
    if (!gameData || !gameData.currentNumber) return;

    const cell = localCard[idx];
    if (cell.marked) return;

    // Validate
    if (cell.value === gameData.currentNumber || cell.value === 'FREE') {
      const newCard = [...localCard];
      newCard[idx].marked = true;
      setLocalCard(newCard); // Optimistic update

      // Update DB
      const playerRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId, 'players', user.uid);
      await updateDoc(playerRef, { card: newCard });

      // Check Win
      if (checkWin(newCard)) {
        await updateDoc(playerRef, { hasWon: true });
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId), {
            status: 'ended',
            winner: user.displayName
        });
      }
    } else {
      // Wrong number feedback (local)
      setLogs(prev => ['ผิด! เลขยังไม่ออก', ...prev]);
    }
  };

  const useItem = async (type) => {
    if (myPlayerDoc.items[type] <= 0) return;
    if (myPlayerDoc.status === 'stunned') return;

    // Deduct Item
    const playerRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId, 'players', user.uid);
    await updateDoc(playerRef, { [`items.${type}`]: increment(-1) });

    if (type === 'search') {
      // Auto find
      const targetIdx = localCard.findIndex(c => c.value === gameData.currentNumber && !c.marked);
      if (targetIdx !== -1) handleCardClick(targetIdx);
      else setLogs(prev => ['หาไม่เจอจ้า', ...prev]);
    }
    else if (type === 'bomb') {
      // Attack random other player
      const targets = players.filter(p => p.uid !== user.uid && p.status !== 'stunned' && !p.shieldActive);
      if (targets.length > 0) {
        const victim = targets[Math.floor(Math.random() * targets.length)];
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId, 'players', victim.uid), {
          status: 'stunned'
        });
        setLogs(prev => [`ปาระเบิดใส่ ${victim.name}!`, ...prev]);
      } else {
        setLogs(prev => ['ไม่มีเป้าหมาย!', ...prev]);
      }
    }
    else if (type === 'shield') {
      await updateDoc(playerRef, { shieldActive: true });
      setTimeout(() => {
         updateDoc(playerRef, { shieldActive: false }).catch(() => {});
      }, 10000);
    }
  };

  // --- Views ---

  // 1. Login View
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center">
           <h1 className="text-4xl font-black text-indigo-600 mb-2">BINGO</h1>
           <p className="text-gray-500 mb-6">Battle Online</p>
           <form onSubmit={(e) => { e.preventDefault(); handleLogin(e.target.name.value); }}>
             <input name="name" placeholder="ใส่ชื่อเล่นของคุณ..." className="w-full bg-gray-100 border-2 border-gray-200 rounded-xl p-3 mb-4 text-center text-lg focus:border-indigo-500 outline-none" autoFocus maxLength={10} required />
             <button type="submit" className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2">
               เข้าสู่ระบบ <ArrowRight size={20} />
             </button>
           </form>
        </div>
      </div>
    );
  }

  // 2. Lobby View
  if (view === 'lobby') {
    return (
       <div className="min-h-screen bg-indigo-900 flex flex-col items-center justify-center p-4 font-sans text-white">
         <div className="w-full max-w-md space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 bg-indigo-700 rounded-full mx-auto flex items-center justify-center text-4xl mb-4 border-4 border-indigo-500">
                😎
              </div>
              <h2 className="text-2xl font-bold">สวัสดี, {user?.displayName}</h2>
              <p className="text-indigo-300">พร้อมจะลุยหรือยัง?</p>
            </div>

            <div className="bg-indigo-800 p-6 rounded-3xl shadow-lg border border-indigo-700">
               <button onClick={createRoom} className="w-full bg-gradient-to-r from-pink-500 to-rose-500 p-4 rounded-xl font-bold text-xl mb-4 shadow-lg active:scale-95 transition flex items-center justify-center gap-2">
                 <Play fill="white" /> สร้างห้องใหม่
               </button>

               <div className="relative">
                 <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-indigo-600"></div></div>
                 <div className="relative flex justify-center text-sm"><span className="px-2 bg-indigo-800 text-indigo-400">หรือ</span></div>
               </div>

               <form onSubmit={(e) => { e.preventDefault(); joinRoom(e.target.room.value); }} className="mt-4 flex gap-2">
                 <input name="room" placeholder="กรอกรหัสห้อง" className="flex-1 bg-indigo-900 border border-indigo-600 rounded-xl px-4 text-center outline-none focus:border-pink-500 uppercase" maxLength={6} required />
                 <button type="submit" className="bg-indigo-600 p-3 rounded-xl font-bold hover:bg-indigo-500">เข้าร่วม</button>
               </form>
            </div>
         </div>
       </div>
    );
  }

  // 3. Waiting Room View
  if (view === 'room' && gameData?.status === 'waiting') {
    return (
      <div className="min-h-screen bg-slate-900 p-6 flex flex-col items-center text-white font-sans">
        <h1 className="text-3xl font-black mb-2 text-yellow-400">WAITING ROOM</h1>
        <div className="bg-slate-800 px-6 py-3 rounded-full flex items-center gap-3 mb-8 border border-slate-700">
          <span className="text-gray-400">Room Code:</span>
          <span className="text-2xl font-mono font-bold tracking-widest">{roomId}</span>
          <button onClick={() => navigator.clipboard.writeText(roomId)} className="p-1 hover:bg-slate-700 rounded"><Copy size={16}/></button>
        </div>

        <div className="w-full max-w-md grid grid-cols-2 gap-4 mb-8">
           {players.map(p => (
             <div key={p.uid} className="bg-indigo-800 p-4 rounded-xl flex items-center gap-3 border border-indigo-600">
               <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center">{p.uid === gameData.hostId ? '👑' : '👤'}</div>
               <span className="font-bold truncate">{p.name}</span>
             </div>
           ))}
        </div>

        {isHost ? (
          <button onClick={startGame} className="w-full max-w-md bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-2xl shadow-lg text-xl animate-pulse">
             START GAME
          </button>
        ) : (
          <p className="text-indigo-400 animate-pulse">Waiting for host to start...</p>
        )}
      </div>
    );
  }

  // 4. Game Over View
  if (gameData?.status === 'ended') {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-center">
            <div className="bg-white rounded-3xl p-10 max-w-sm w-full animate-bounce-in">
                <Trophy className="w-24 h-24 text-yellow-500 mx-auto mb-4" />
                <h2 className="text-3xl font-black text-slate-800 mb-2">{gameData.winner} ชนะ!</h2>
                <p className="text-gray-500 mb-8">เกมจบแล้วจ้า</p>
                <button onClick={() => setView('lobby')} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold">กลับไปหน้าหลัก</button>
            </div>
        </div>
      );
  }

  // 5. Playing View
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center relative overflow-hidden font-sans select-none">
      {/* Stun Overlay */}
      {myPlayerDoc?.status === 'stunned' && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center backdrop-blur-sm animate-pulse pointer-events-none">
          <div className="text-center">
            <Skull className="w-24 h-24 text-red-500 mx-auto mb-2 animate-bounce" />
            <h2 className="text-white text-3xl font-bold">STUNNED!</h2>
            <p className="text-red-300">โดนระเบิด! รอแป๊บนะ...</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="w-full max-w-md bg-indigo-900 p-4 pb-12 rounded-b-3xl shadow-xl z-10 flex flex-col items-center relative">
        {/* Opponents Status Bar */}
        <div className="flex w-full justify-center gap-3 mb-4 overflow-x-auto pb-2">
           {players.filter(p => p.uid !== user.uid).map(p => (
             <div key={p.uid} className={`flex flex-col items-center transition-all ${p.status === 'stunned' ? 'opacity-50 scale-90' : ''}`}>
               <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm bg-indigo-800 ${p.status === 'stunned' ? 'border-red-500' : 'border-green-400'}`}>
                 {p.status === 'stunned' ? '😵' : '🙂'}
               </div>
               <span className="text-[10px] text-indigo-200 mt-1 max-w-[50px] truncate">{p.name}</span>
             </div>
           ))}
        </div>

        {/* Big Number */}
        <div className="relative">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-yellow-400 to-orange-600 flex items-center justify-center border-4 border-white shadow-lg z-20 relative">
              <span className="text-5xl font-black text-white drop-shadow-md">
                {gameData?.currentNumber || '--'}
              </span>
            </div>
        </div>

        {/* Host Status Text */}
        {isHost && <p className="absolute bottom-2 text-xs text-indigo-400">คุณเป็น Host (ห้ามปิดจอนะ)</p>}
      </div>

      {/* Board */}
      <div className="flex-1 w-full max-w-md p-4 flex flex-col items-center -mt-8 z-0">
        <div className="bg-white p-3 rounded-2xl shadow-2xl w-full">
           <div className="grid grid-cols-5 mb-2 text-center">
             {['B', 'I', 'N', 'G', 'O'].map(l => <div key={l} className="text-2xl font-black text-indigo-900">{l}</div>)}
           </div>
           <div className="grid grid-cols-5 gap-2 aspect-square">
             {localCard.map((cell) => {
               const isMarked = cell.marked;
               return (
                 <button
                   key={cell.id}
                   onClick={() => handleCardClick(cell.id)}
                   disabled={cell.value === 'FREE' || isMarked || myPlayerDoc?.status === 'stunned'}
                   className={`
                     relative rounded-lg flex items-center justify-center text-xl font-bold transition-all duration-150
                     ${cell.value === 'FREE' ? 'bg-yellow-400 text-yellow-800' : isMarked ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-900 hover:bg-indigo-100 shadow-sm border-b-4 border-indigo-200 active:translate-y-1 active:border-b-0'}
                   `}
                 >
                   {cell.value === 'FREE' ? '⭐' : cell.value}
                 </button>
               );
             })}
           </div>
        </div>

        {/* Items */}
        <div className="w-full mt-6 grid grid-cols-3 gap-4">
          <ItemButton icon={<Search size={20} />} count={myPlayerDoc?.items?.search || 0} color="bg-blue-500" label="ช่วยหา" onClick={() => useItem('search')} />
          <ItemButton icon={<Zap size={20} />} count={myPlayerDoc?.items?.bomb || 0} color="bg-red-500" label="ปาระเบิด" onClick={() => useItem('bomb')} />
          <ItemButton icon={<Shield size={20} />} count={myPlayerDoc?.items?.shield || 0} color="bg-green-500" label="เกราะ" active={myPlayerDoc?.shieldActive} onClick={() => useItem('shield')} />
        </div>

        {/* Logs */}
        <div className="w-full mt-4 h-12 flex flex-col justify-end space-y-1 overflow-hidden">
          {logs.map((log, i) => (
             <div key={i} className="text-xs text-white/90 bg-slate-800/80 px-2 py-1 rounded self-center animate-fade-in-up">{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ItemButton = ({ icon, count, color, label, onClick, active }) => (
  <button onClick={onClick} disabled={count === 0} className={`relative flex flex-col items-center justify-center py-2 px-1 rounded-xl shadow-md transition-all ${count === 0 ? 'bg-gray-400 grayscale cursor-not-allowed' : color} ${active ? 'ring-4 ring-white' : ''} text-white active:scale-95`}>
    <div className="mb-1">{icon}</div>
    <span className="text-xs font-bold">{label}</span>
    <div className="absolute -top-2 -right-2 w-6 h-6 bg-white text-gray-800 rounded-full flex items-center justify-center text-xs font-bold shadow-sm border-2 border-gray-100">{count}</div>
  </button>
);

export default GameApp;
