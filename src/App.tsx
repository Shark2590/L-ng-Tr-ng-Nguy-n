import React, { useEffect, useState, useRef } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { 
  doc, 
  collection, 
  addDoc,
  setDoc, 
  onSnapshot, 
  updateDoc,
  arrayUnion,
  arrayRemove,
  query,
  where,
  documentId,
  getDocs,
  getDoc,
  increment
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { LogOut, Play, Users, Trophy, Target, Timer, User as UserIcon, UserCircle, Bot, ArrowLeft, Coins, Gem, ScrollText, Flag, Landmark, Swords, X, Tv, Gift, Volume2, VolumeX, UserPlus, BookOpen, Store, Clock, Home, MessageCircle, Castle, Sparkles, Crown, History, Pause } from 'lucide-react';

interface GridItem {
  value: number;
  position: number;
}

type GameMode = 'single' | '1v1' | 'bot';

interface GameState {
  id?: string;
  mode: GameMode;
  status: 'waiting' | 'playing' | 'finished';
  player1: string;
  player1_name: string;
  player2: string | null;
  player2_name: string | null;
  // Independent Progress & Grids
  current_number1: number;
  current_number2: number;
  found_numbers1: number[];
  found_numbers2: number[];
  grid1: GridItem[];
  grid2: GridItem[];
  hints_used1: number;
  hints_used2: number;
  
  max_number: number;
  level: number;
  betAmount: number;
  last_shuffle_time: number;
  winner: string | null;
  createdAt: number;
  recentChats?: { uid: string; text: string; timestamp: number }[];
  is_paused?: boolean;
  paused_at?: number;
}

interface UserProfile {
  uid: string;
  username: string;
  phone: string;
  referralCode: string;
  balance: number;
  referredBy?: string | null;
  relationship?: string | null;
  matchesRemaining: number;
  lastResetDate: string;
  friends?: string[];
  lastActive?: number;
  fastest50?: number;
  fastest100?: number;
  botWins?: number; // Leaderboard for bot matches
  currentLevel?: number; // New field for progressive levels
}

function calculateSwapTime(level: number): number {
  let time = 20;
  if (level > 1 && level <= 6) {
    time = 20 - (level - 1) * 2;
  } else if (level > 6) {
    time = 10 - (level - 6) * 1;
  }
  return Math.max(5, time); // Minimum 5s
}

interface FriendRequest {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

interface Invitation {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  roomId: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
}

interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

const handleFirestoreError = (error: any, operation: FirestoreErrorInfo['operationType'], path: string | null = null) => {
  if (error.code === 'permission-denied') {
    const errorInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType: operation,
      path: path,
      authInfo: {
        userId: auth.currentUser?.uid || 'anonymous',
        email: auth.currentUser?.email || '',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || true,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    console.error("Firestore Permission Denied:", JSON.stringify(errorInfo, null, 2));
    throw Error(JSON.stringify(errorInfo));
  }
  throw error;
};

const Spinner = () => (
  <div className="flex flex-col items-center justify-center gap-4">
    <div className="relative w-16 h-16">
      <div className="absolute inset-0 border-4 border-[#784627]/20 rounded-full"></div>
      <div className="absolute inset-0 border-4 border-t-[#f59e0b] border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
      <div className="absolute inset-2 border-2 border-[#d97706]/40 rounded-full animate-[spin_2s_linear_infinite_reverse]"></div>
    </div>
  </div>
);

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function generateInitialGrid(maxNumber: number = 100): GridItem[] {
  const size = Math.max(5, Math.ceil(Math.sqrt(maxNumber)));
  const totalCells = size * size;
  const values: number[] = [];
  
  for (let i = 1; i <= maxNumber; i++) values.push(i);
  for (let i = 1; i <= totalCells - maxNumber; i++) values.push(-i); // Use negative numbers for empty slots
  
  const shuffled = shuffleArray(values);
  return shuffled.map((value, index) => ({ value, position: index }));
}

function shuffleRemainingNumbers(gridItems: GridItem[], foundNumbers: number[]): GridItem[] {
  const remainingNumbers = gridItems.filter(item => !foundNumbers.includes(item.value));
  const shuffledRemaining = shuffleArray(remainingNumbers);
  
  return gridItems.map(item => {
    if (foundNumbers.includes(item.value)) return item;
    const nextItem = shuffledRemaining.pop();
    if (!nextItem) return item;
    return { ...nextItem, position: item.position };
  });
}

function generateRoomId(): string {
  const chars = '0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const VideoAdModal = ({ isOpen, onClose, onReward }: { isOpen: boolean, onClose: () => void, onReward: () => void }) => {
  // -------------------------------------------------------------------------
  // HƯỚNG DẪN TÍCH HỢP QUẢNG CÁO KIẾM TIỀN THỰC TẾ:
  // -------------------------------------------------------------------------
  // Để bắt đầu kiếm tiền thực từ quảng cáo này, Ngài cần thực hiện các bước sau:
  //
  // 1. Đăng ký tài khoản:
  //    - Google AdMob (Cho Mobile App) hoặc Google AdSense (Cho Web App).
  //    - Hoặc Unity Ads, AppLovin nếu muốn chuyên về Game.
  //
  // 2. Thêm Script/SDK vào ứng dụng:
  //    - Ví dụ với AdSense, thêm đoạn mã này vào file 'index.html':
  //      <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
  //
  // 3. Thay thế giao diện dưới đây bằng Component quảng cáo của nhà cung cấp:
  //    - Thay vì dùng 'setInterval' giả lập, Ngài sẽ dùng callback 'onAdDismissed' của SDK để gọi hàm 'onReward()'.
  // -------------------------------------------------------------------------

  const [adTime, setAdTime] = useState(15);
  const [canClose, setCanClose] = useState(false);
  const [isRewarded, setIsRewarded] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      setAdTime(15);
      setCanClose(false);
      setIsRewarded(false);
      timer = setInterval(() => {
        setAdTime(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setCanClose(true);
            setIsRewarded(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl bg-[#452b1b] border-4 border-double border-[#d97706] rounded-lg overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.5)] flex flex-col animate-in zoom-in-95 duration-300">
        <div className="bg-[#291c14] p-4 border-b-2 border-[#784627] flex justify-between items-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-gradient-to-r from-[#f59e0b] to-transparent"></div>
          <h3 className="text-[#f59e0b] font-bold uppercase tracking-widest flex items-center gap-2 relative z-10">
            <Tv className="w-5 h-5 animate-pulse" /> Quảng Cáo Tài Trợ
          </h3>
          <div className="relative z-10">
            {canClose ? (
              <button 
                onClick={() => {
                  if (isRewarded) onReward();
                  onClose();
                }} 
                className="bg-[#15803d] hover:bg-[#16a34a] text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2">
                <span>NHẬN THƯỞNG & ĐÓNG</span>
                <X className="w-4 h-4" />
              </button>
            ) : (
              <div className="bg-[#5c3a21] text-[#fef3c7] text-[10px] md:text-xs font-bold px-3 py-1 rounded-full border border-[#784627] flex items-center gap-2">
                <Clock className="w-3 h-3 animate-spin" />
                Thưởng sẽ có sau {adTime} giây
              </div>
            )}
          </div>
        </div>
        
        <div className="aspect-video bg-black relative flex items-center justify-center group">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/60 pointer-events-none z-10"></div>
          
          {/* Simulated Video Content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center p-8 z-20">
             <div className="relative">
                <div className="w-20 h-20 bg-[#f59e0b]/20 rounded-full flex items-center justify-center animate-[ping_2s_ease-in-out_infinite] absolute inset-0"></div>
                <div className="w-20 h-20 bg-[#291c14] border-2 border-[#f59e0b] rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.4)] relative">
                  <Play className="w-10 h-10 text-[#f59e0b] fill-current pr-2" />
                </div>
             </div>
             
             <div className="space-y-2 animate-in slide-in-from-bottom-4 duration-700">
               <h4 className="text-3xl font-black text-white uppercase font-display tracking-tight drop-shadow-lg">Truy Tìm Mộc Bản</h4>
               <p className="text-[#d6b485] max-w-sm text-sm italic opacity-90 mx-auto">"Hào kiệt bốn phương hội tụ, so tài cao thấp cùng hàng ngàn sĩ tử!"</p>
             </div>

             <div className="mt-4 flex gap-4 animate-in fade-in duration-1000 delay-300">
                <button className="px-6 py-2.5 bg-[#f59e0b] text-[#291c14] font-black rounded shadow-[0_4px_0_#b45309] hover:translate-y-0.5 transition-all uppercase text-xs tracking-widest">
                  Tải Xuống Luôn
                </button>
                <button className="px-6 py-2.5 border-2 border-[#d6b485] text-[#d6b485] font-bold rounded hover:bg-white/5 transition-all uppercase text-xs tracking-widest">
                  Xem Thêm
                </button>
             </div>
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center z-30">
             <div className="flex gap-2">
                <div className="w-1.5 h-1.5 bg-[#f59e0b] rounded-full animate-pulse"></div>
                <div className="w-1.5 h-1.5 bg-white/30 rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-white/30 rounded-full"></div>
             </div>
             <div className="flex items-center gap-3">
                <div className="text-[10px] text-white/50 font-mono bg-black/40 px-2 py-0.5 rounded">0:15 / 0:30</div>
                <Volume2 className="w-5 h-5 text-white/80 cursor-pointer hover:text-white" />
             </div>
          </div>
        </div>

        <div className="bg-[#291c14] p-4 border-t-2 border-[#784627] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#d6b485] font-bold uppercase tracking-wider">Phần thưởng sau khi xem:</span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-[#f59e0b]">
                <Swords className="w-3.5 h-3.5" />
                <span className="text-xs font-black">+10 Lượt</span>
              </div>
              <div className="flex items-center gap-1.5 text-yellow-500">
                <Coins className="w-3.5 h-3.5" />
                <span className="text-xs font-black">+50.000đ</span>
              </div>
            </div>
          </div>
          <div className="w-full h-1 bg-[#452b1b] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[#f59e0b] transition-all duration-1000 ease-linear shadow-[0_0_5px_#f59e0b]" 
              style={{ width: `${((15 - adTime) / 15) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const InvitationOverlay = ({ invitations, onAccept, onDecline }: { invitations: Invitation[], onAccept: (inv: Invitation) => void, onDecline: (invId: string) => void }) => {
  if (invitations.length === 0) return null;

  const current = invitations[0];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
       <div className="w-full max-w-sm bg-[#452b1b] border-4 border-double border-[#d97706] rounded shadow-[0_0_50px_rgba(245,158,11,0.5)] overflow-hidden animate-in zoom-in duration-300">
          <div className="bg-[#291c14] p-4 text-center border-b-2 border-[#784627]">
             <ScrollText className="w-12 h-12 text-[#f59e0b] mx-auto mb-2" />
             <h3 className="text-[#f59e0b] font-display font-bold text-xl uppercase tracking-widest">Thiệp Mời Tỷ Võ</h3>
          </div>
          <div className="p-6 text-center space-y-4">
             <p className="text-[#d6b485] leading-relaxed">
               Bằng hữu <span className="text-[#fef3c7] font-bold">{current.fromName}</span> vừa gửi lời mời Lão gia tham gia thi đấu tại lôi đài mã số:
             </p>
             <div className="bg-[#291c14] py-3 text-3xl font-mono text-[#f59e0b] border-y border-[#784627] tracking-tighter">
               {current.roomId}
             </div>
             <p className="text-xs text-[#d6b485] italic">Lão gia có sẵn lòng bái kiến bằng hữu?</p>
          </div>
          <div className="flex border-t-2 border-[#784627]">
             <button 
               onClick={() => onDecline(current.id)}
               className="flex-1 py-4 bg-[#291c14] hover:bg-[#5c3a21] text-[#ef4444] font-bold uppercase transition-colors"
             >
               Cáo lỗi
             </button>
             <button 
               onClick={() => onAccept(current)}
               className="flex-1 py-4 bg-green-800 hover:bg-green-700 text-white font-bold uppercase border-l-2 border-[#784627] transition-colors"
             >
               Bái kiến
             </button>
          </div>
       </div>
    </div>
  );
};

export function getRankName(balance: number = 0): string {
  if (balance < 100_000_000) return 'Nông Dân';
  if (balance < 200_000_000) return 'Thương Nhân';
  if (balance < 500_000_000) return 'Địa Chủ';
  if (balance < 1_000_000_000) return 'Quý Tộc';
  if (balance < 10_000_000_000) return 'Vua Chúa';
  return 'Thái Thượng Hoàng'; // > 10 tỷ
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  
  // Auth Form State
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [refCode, setRefCode] = useState('');
  const [relation, setRelation] = useState('nguoi_dung');

  const [targetNumberInput, setTargetNumberInput] = useState<number>(100);
  const [showNumberSelectParams, setShowNumberSelectParams] = useState<{
    action: 'single' | 'bot' | 'create1v1' | 'invite';
    friend?: UserProfile;
  } | null>(null);
  const [mainTab, setMainTab] = useState<'welcome' | 'learning' | 'merchant'>('welcome');
  const [menuState, setMenuState] = useState<'home' | 'main' | 'lobby_1v1' | 'in_game' | 'account' | 'leaderboard' | 'friends'>('main');
  const [leaderboardTab, setLeaderboardTab] = useState<'balance' | 'fastest50' | 'fastest100' | 'bot_rank'>('balance');
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [gameId, setGameId] = useState<string>(() => localStorage.getItem('hoithilang_active_game_id') || '');
  const [gameInput, setGameInput] = useState<string>('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isInitializingGame, setIsInitializingGame] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [stopwatch, setStopwatch] = useState<number>(0);
  const [hintValue, setHintValue] = useState<number | null>(null);
  const [showQuickChat, setShowQuickChat] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [showSurrenderConfirm, setShowSurrenderConfirm] = useState(false);
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('hoithilang_muted') === 'true';
  });
  const [betAmountInput, setBetAmountInput] = useState<number>(10000);
  const [isOpponentLikelyGone, setIsOpponentLikelyGone] = useState(false);
  const [localFound1, setLocalFound1] = useState<number[]>([]);
  const [localFound2, setLocalFound2] = useState<number[]>([]);
  const [localCurrent1, setLocalCurrent1] = useState<number>(1);
  const [localCurrent2, setLocalCurrent2] = useState<number>(1);

  const handleConfirmNumber = (num: number) => {
    console.log("handleConfirmNumber called with num:", num, "params:", showNumberSelectParams);
    setTargetNumberInput(num);
    if (showNumberSelectParams) {
      if (showNumberSelectParams.action === 'single') {
        startSinglePlayer(num);
      } else if (showNumberSelectParams.action === 'bot') {
        startBotGame(num);
      } else if (showNumberSelectParams.action === 'create1v1') {
        create1v1Game(num);
      } else if (showNumberSelectParams.action === 'invite' && showNumberSelectParams.friend) {
        inviteToGame(showNumberSelectParams.friend, num);
      }
    }
    setShowNumberSelectParams(null);
  };

  const sounds = useRef<Record<string, HTMLAudioElement | null>>({
    click: null,
    found: null,
    win: null,
    lose: null,
    hint: null,
  });

  useEffect(() => {
    // We use document.createElement('audio') instead of new Audio() to avoid "Illegal constructor" error in some iframe environments
    const audioFiles = {
      click: 'https://www.soundjay.com/buttons/sounds/button-16.mp3',
      found: 'https://www.soundjay.com/misc/sounds/bell-ring-01.mp3',
      win: 'https://www.soundjay.com/misc/sounds/success-fanfare-trumpet-15.mp3',
      lose: 'https://www.soundjay.com/misc/sounds/fail-trombone-01.mp3',
      hint: 'https://www.soundjay.com/buttons/sounds/button-20.mp3',
    };

    Object.entries(audioFiles).forEach(([key, url]) => {
      try {
        const audio = document.createElement('audio');
        audio.src = url;
        audio.preload = 'auto';
        sounds.current[key] = audio;
      } catch (error) {
        console.error(`Failed to initialize audio for ${key}:`, error);
      }
    });
  }, []);

  const playSound = (type: 'click' | 'found' | 'win' | 'lose' | 'hint') => {
    if (isMuted) return;
    try {
      const sound = sounds.current[type];
      if (sound) {
        sound.currentTime = 0;
        sound.play().catch((e) => {
          // Autoplay policy might block the first sound if user hasn't interacted
          console.warn('Audio play failed (likely autoplay policy):', e);
        });
      }
    } catch (err) {
      console.error('Error playing sound:', err);
    }
  };

  useEffect(() => {
    localStorage.setItem('hoithilang_muted', isMuted.toString());
  }, [isMuted]);

  const prevGameStatus = useRef<string | null>(null);
  useEffect(() => {
    if (gameState?.status === 'finished' && prevGameStatus.current === 'playing') {
      if (gameState.winner === user?.uid) {
        playSound('win');
      } else {
        playSound('lose');
      }
    }
    prevGameStatus.current = gameState?.status || null;
  }, [gameState?.status, gameState?.winner, user?.uid]);

  // Prevent accidental exit and handle abrupt closure
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (gameState && gameState.status === 'playing') {
        const message = "Trận đấu đang diễn ra! Nếu thoát ra lúc này, hệ thống sẽ xử thua và trừ ngân lượng. Ngài có chắc chắn?";
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [gameState]);

  const [friendsProfiles, setFriendsProfiles] = useState<UserProfile[]>([]);
  const [searchUsername, setSearchUsername] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);

  // Friend Request Listener
  useEffect(() => {
    if (!user) {
      setFriendRequests([]);
      return;
    }
    const q = query(
      collection(db, 'friend_requests'),
      where('toId', '==', user.uid),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snap) => {
      const requests = snap.docs.map(d => ({ id: d.id, ...d.data() } as FriendRequest));
      setFriendRequests(requests);
    });
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!userProfile?.friends || userProfile.friends.length === 0) {
      setFriendsProfiles([]);
      return;
    }
    // Firestore 'in' query supports up to 30 elements
    const friendsList = userProfile.friends.slice(0, 30);
    const q = query(collection(db, 'users'), where(documentId(), 'in', friendsList));
    const unsub = onSnapshot(q, (snap) => {
      setFriendsProfiles(snap.docs.map(d => d.data() as UserProfile));
    }, (error) => {
      console.error("Lỗi khi tải danh sách bằng hữu:", error);
    });
    return () => unsub();
  }, [userProfile?.friends]);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const stopwatchRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (menuState === 'leaderboard') {
      const fetchLeaderboard = async () => {
        try {
          let q;
          if (leaderboardTab === 'balance') {
            q = query(collection(db, 'users'), where('balance', '>', 0)); 
          } else if (leaderboardTab === 'fastest50') {
            q = query(collection(db, 'users'), where('fastest50', '>', 0));
          } else if (leaderboardTab === 'fastest100') {
            q = query(collection(db, 'users'), where('fastest100', '>', 0));
          } else if (leaderboardTab === 'bot_rank') {
             q = query(collection(db, 'users'));
          }
          
          if (!q) return;
          const snap = await getDocs(q);
          let users = snap.docs.map(doc => doc.data() as UserProfile);
          
          if (leaderboardTab === 'balance') {
            users = users.sort((a,b) => (b.balance || 0) - (a.balance || 0));
          } else if (leaderboardTab === 'fastest50') {
            users = users.sort((a,b) => (a.fastest50 || Infinity) - (b.fastest50 || Infinity));
          } else if (leaderboardTab === 'fastest100') {
            users = users.sort((a,b) => (a.fastest100 || Infinity) - (b.fastest100 || Infinity));
          } else if (leaderboardTab === 'bot_rank') {
            users = users.filter(u => u.botWins && u.botWins > 0).sort((a,b) => (b.botWins || 0) - (a.botWins || 0));
          }
          
          setLeaderboard(users.slice(0, 100));
        } catch(e) {
          console.error(e);
        }
      };
      fetchLeaderboard();
    }
  }, [menuState, leaderboardTab]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      return;
    }

    const unsub = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as UserProfile;
        // Manual override for admin balance
        if (user.email === 'minh.nv2590@gmail.com' && data.balance !== 1_000_000_000) {
            updateDoc(doc(db, 'users', user.uid), { balance: 1_000_000_000 });
        }
        setUserProfile(data);
      } else {
          // Only setup default if doc doesn't exist and we just logged in
        const setupDefault = async () => {
          const newCode = generateRoomId();
          const isAdmin = user.email === 'minh.nv2590@gmail.com';
          const newProfile = {
            uid: user.uid,
            username: user.displayName || 'Khách Vô Danh',
            phone: '',
            referralCode: newCode,
            balance: isAdmin ? 1_000_000_000 : 500_000,
            botWins: 0,
            matchesRemaining: 10,
            lastResetDate: new Date().toISOString().split('T')[0],
            friends: [],
            lastActive: Date.now(),
            createdAt: Date.now()
          };
          try {
            await setDoc(doc(db, 'users', user.uid), newProfile);
          } catch (e) {
            handleFirestoreError(e, 'create', `users/${user.uid}`);
          }
        };
        setupDefault();
      }
    }, (error) => {
      handleFirestoreError(error, 'get', `users/${user.uid}`);
    });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user || userProfile === null) return;
    
    const today = new Date().toISOString().split('T')[0];
    if (userProfile.lastResetDate !== today) {
      updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: 10,
        lastResetDate: today
      }).catch(e => handleFirestoreError(e, 'update', `users/${user.uid}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Presence Heartbeat
  const userProfileRef = useRef(userProfile);
  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  useEffect(() => {
    if (!user || userProfileRef.current === null) return;
    
    // Initial heartbeat
    updateDoc(doc(db, 'users', user.uid), { lastActive: Date.now() })
      .catch(e => {
        if (e.code !== 'not-found') {
          handleFirestoreError(e, 'update', `users/${user.uid}`);
        }
      });
    
    const interval = setInterval(() => {
      updateDoc(doc(db, 'users', user.uid), { lastActive: Date.now() })
        .catch(e => handleFirestoreError(e, 'update', `users/${user.uid}`));
    }, 60000); // Every 1 minute
    
    return () => clearInterval(interval);
  }, [user]);

  // Check for abandoned games on mount
  useEffect(() => {
    if (!user || !userProfile) return;

    const checkAbandonedGames = async () => {
      try {
        console.log("Đang kiểm tra trận đấu bỏ dở cho:", user.uid);
        // Simplify queries to avoid composite index requirement
        const q1 = query(collection(db, 'games'), where('player1', '==', user.uid));
        const q2 = query(collection(db, 'games'), where('player2', '==', user.uid));
        
        let snap1, snap2;
        try {
          snap1 = await getDocs(q1);
        } catch (e: any) {
          console.error("Lỗi khi truy vấn q1 (player1):", e.message, e.code);
          throw e;
        }

        try {
          snap2 = await getDocs(q2);
        } catch (e: any) {
          console.error("Lỗi khi truy vấn q2 (player2):", e.message, e.code);
          throw e;
        }

        const abandonedGames = [...snap1.docs, ...snap2.docs]
          .map(docSnap => ({ id: docSnap.id, ...docSnap.data() as GameState }))
          .filter(data => {
            // Client-side filter for status 'playing'
            if (data.status !== 'playing') return false;
            // Abandonment threshold: 5 minutes
            return (Date.now() - (data.last_shuffle_time || data.createdAt)) > 300000;
          });

        console.log(`Tìm thấy ${abandonedGames.length} trận đấu bỏ dở.`);

        for (const gameData of abandonedGames) {
          const winnerId = gameData.player1 === user.uid ? gameData.player2 : gameData.player1;
          
          console.log(`Xử lý kết thúc trận ${gameData.id}, người thắng dự kiến: ${winnerId}`);
          
          try {
            await processGameEnd(winnerId, user.uid, gameData.mode);
          } catch (e) {
            console.error(`Lỗi khi xử lý ngân lượng cho trận ${gameData.id}:`, e);
          }

          try {
            await updateDoc(doc(db, 'games', gameData.id!), {
              status: 'finished',
              winner: winnerId,
              abandonedBy: user.uid
            });
          } catch (e) {
            console.error(`Lỗi khi cập nhật trạng thái trận ${gameData.id}:`, e);
          }
          
          alert(`Cảnh báo: Lôi đài [${gameData.id}] đã bị hủy vì Ngài rời đi đột ngột. Hệ thống đã xử thua và tịch thu ngân lượng!`);
        }
      } catch (e: any) {
        if (e.code === 'permission-denied') {
          console.error("Lỗi quyền truy cập Firestore chi tiết:", e.message);
        }
        console.error("Lỗi khi kiểm tra trận đấu bỏ dở:", e);
      }
    };

    checkAbandonedGames();
  }, [user, !!userProfile]);

  const [invitations, setInvitations] = useState<Invitation[]>([]);

  // Invitation listener
  useEffect(() => {
    if (!user) {
      setInvitations([]);
      return;
    }
    const q = query(
      collection(db, 'invitations'), 
      where('toId', '==', user.uid), 
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(q, (snap) => {
      const invs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Invitation));
      setInvitations(invs);
    }, (error) => {
      handleFirestoreError(error, 'list', 'invitations');
    });
    return () => unsub();
  }, [user]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      alert('Tín vật (Mật khẩu) không khớp!');
      return;
    }
    if (!username || !password || !phone) {
      alert('Vui lòng điền đủ danh tính!');
      return;
    }

    try {
      let referrerDoc = null;
      if (refCode) {
        const q = query(collection(db, 'users'), where('referralCode', '==', refCode));
        const snap = await getDocs(q);
        if (!snap.empty) {
          referrerDoc = snap.docs[0];
        } else {
          alert('Lệnh bài giới thiệu không tồn tại trong nhân gian!');
          return;
        }
      }

      const email = `${username.trim().toLowerCase().replace(/\s+/g, '')}@hoithilang.vn`;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const myRefCode = generateRoomId();
      
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        username,
        phone,
        referralCode: myRefCode,
        balance: 500000,
        matchesRemaining: 10,
        lastResetDate: new Date().toISOString().split('T')[0],
        friends: [],
        lastActive: Date.now(),
        referredBy: refCode || null,
        relationship: refCode ? relation : null,
        createdAt: Date.now()
      });

      if (referrerDoc) {
        const oldBal = referrerDoc.data().balance || 0;
        await updateDoc(doc(db, 'users', referrerDoc.id), {
          balance: oldBal + 50000
        });
      }

    } catch (err: any) {
      alert('Ghi danh thất bại: Danh tính đã được sử dụng hoặc có lỗi!');
      console.error(err);
    }
  };

  const handleCustomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = `${username.trim().toLowerCase().replace(/\s+/g, '')}@hoithilang.vn`;
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      alert('Sai tên đăng nhập hoặc mật khẩu!');
    }
  };

  const loginWithGoogle = async () => {
    try {
      const googleProvider = new GoogleAuthProvider();
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      if (e.code === 'auth/popup-closed-by-user') {
        console.log('User closed the login popup.');
      } else {
        console.error('Google login failed:', e);
        alert('Có lỗi xảy ra khi đăng nhập Google!');
      }
    }
  };

  const logout = () => {
    signOut(auth);
    setMenuState('home');
    setGameId('');
    setGameState(null);
  };

  useEffect(() => {
    if (gameId) {
      localStorage.setItem('hoithilang_active_game_id', gameId);
    } else {
      localStorage.removeItem('hoithilang_active_game_id');
    }
  }, [gameId]);

  useEffect(() => {
    if (!gameId) {
      setGameState(null);
      setIsInitializingGame(false);
      return;
    }
    
    console.log("Listening to gameId:", gameId);
    setIsInitializingGame(true);
    const docRef = doc(db, 'games', gameId);
    const unsubscribe = onSnapshot(docRef, 
      (docSnap) => {
        setIsInitializingGame(false);
        if (docSnap.exists()) {
          console.log("Game document found, transitioning to in_game");
          const data = docSnap.data() as GameState;
          data.id = docSnap.id;
          
          if (data.status === 'finished' && data.winner) {
             // Game over, maybe don't jump back in if it's too old
          }
          
          setGameState(data);
          setMenuState('in_game');
        } else {
          console.warn("Game document does not exist yet for ID:", gameId);
          // If it's a room ID from join input, maybe it's just wrong
          if (gameInput && gameId === gameInput.trim().toUpperCase()) {
             setGameId('');
             alert("Không tìm thấy hội thi này!");
          }
        }
      },
      (error) => {
        setIsInitializingGame(false);
        console.error("Snapshot listener error for gameId:", gameId, error);
        if (error.code === 'permission-denied') {
          alert('Không có quyền truy cập hội thi này!');
          leaveGame();
        }
      }
    );
    return () => unsubscribe();
  }, [gameId]);

  const processGameEnd = async (winnerId: string | null, loserId: string | null, mode: GameMode, overrideBet?: number) => {
    try {
      const finalBet = overrideBet || gameState?.betAmount || 10000;
      const winnerReward = Math.floor(finalBet * 0.9);

      if (loserId && loserId !== 'bot_uid') {
        await updateDoc(doc(db, 'users', loserId), {
          balance: increment(-finalBet)
        });
      }
      
      if (mode === '1v1' && winnerId && winnerId !== 'bot_uid') {
        await updateDoc(doc(db, 'users', winnerId), {
          balance: increment(winnerReward)
        });
      }

      if (mode === 'single' && winnerId === user?.uid) {
         const newLevel = (userProfile?.currentLevel || 1) + 1;
         await updateDoc(doc(db, 'users', user.uid), {
             currentLevel: newLevel
         });
         if (newLevel > 11) {
             alert('Chúc mừng! Ngài đã đỗ đạt Top 1!');
         }
      }
      
      if (mode === 'bot' && winnerId === user?.uid) {
         const newLevel = (userProfile?.currentLevel || 1) + 1;
         await updateDoc(doc(db, 'users', user.uid), {
             botWins: increment(1),
             currentLevel: newLevel
         });
      }
    } catch (e) {
      console.error("Lỗi khi xử lý ngân lượng:", e);
    }
  };

  const hasEnoughBalance = (amount: number = 10000) => {
    if ((userProfile?.balance || 0) < amount) {
      alert(`Ngài không đủ ${amount.toLocaleString('vi-VN')} VNĐ ngân lượng để đi tiếp. Hãy xin xỏ hảo hữu hoặc nhập kho bạc nạp thêm!`);
      return false;
    }
    return true;
  };

  // Handle Stopwatch for Single Player
  useEffect(() => {
    if (gameState?.mode === 'single' && gameState?.status === 'playing') {
      if (gameState.is_paused && gameState.paused_at) {
        if (stopwatchRef.current) clearInterval(stopwatchRef.current);
        setStopwatch((gameState.paused_at - gameState.createdAt) / 1000);
      } else {
        stopwatchRef.current = setInterval(() => {
          setStopwatch((Date.now() - gameState.createdAt) / 1000);
        }, 100);
      }
    } else {
      if (stopwatchRef.current) clearInterval(stopwatchRef.current);
    }
    return () => {
      if (stopwatchRef.current) clearInterval(stopwatchRef.current);
    }
  }, [gameState?.status, gameState?.mode, gameState?.createdAt, gameState?.is_paused, gameState?.paused_at]);

  // Handle Bot Actions
  useEffect(() => {
    if (gameState?.mode === 'bot' && gameState?.status === 'playing' && user?.uid === gameState.player1) {
      const waitTime = Math.random() * 10000 + 10000; // 10s to 20s
      
      const timeout = setTimeout(async () => {
        if (!gameState || gameState.status !== 'playing') return;
        const target = gameState.current_number2;
        const nextNumber = target + 1;
        const isWin = nextNumber > gameState.max_number;
        const newLevel = isWin ? gameState.level : Math.floor((nextNumber - 1) / 10) + 1;

        if (isWin) {
          await processGameEnd('bot_uid', gameState.player1, 'bot');
        }

        try {
          await updateDoc(doc(db, 'games', gameState.id!), {
            current_number2: isWin ? target : nextNumber,
            found_numbers2: arrayUnion(target),
            level: newLevel,
            status: isWin ? 'finished' : 'playing',
            winner: isWin ? 'bot_uid' : null,
          });
        } catch (e) {
          console.error(e);
        }
      }, waitTime);

      return () => clearTimeout(timeout);
    }
  }, [gameState?.current_number2, gameState?.status, gameState?.mode, user?.uid, gameState?.id]);

  // Manage timer and shuffling natively
  useEffect(() => {
    if (gameState?.status !== 'playing' || gameState?.status === 'finished') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const intervalProcess = () => {
      if (gameState.is_paused && gameState.paused_at) {
        const shuffleInterval = Math.max(5, 20 - (gameState.level - 1));
        const elapsed = (gameState.paused_at - gameState.last_shuffle_time) / 1000;
        const remaining = Math.max(0, Math.ceil(shuffleInterval - elapsed));
        setTimeLeft(remaining);
        return;
      }

      const shuffleInterval = Math.max(5, 20 - (gameState.level - 1));
      const elapsed = (Date.now() - gameState.last_shuffle_time) / 1000;
      const remaining = Math.max(0, Math.ceil(shuffleInterval - elapsed));
      
      setTimeLeft(remaining);

      if (remaining === 0 && gameState.status === 'playing') {
        // If I am player 1, I shuffle
        if (user?.uid === gameState.player1) {
          const updates: any = {
            last_shuffle_time: Date.now()
          };
          
          updates.grid1 = shuffleRemainingNumbers(gameState.grid1, gameState.found_numbers1);
          if (gameState.mode !== 'single') {
            updates.grid2 = shuffleRemainingNumbers(gameState.grid2, gameState.found_numbers2);
          }

          updateDoc(doc(db, 'games', gameState.id!), updates);
        } 
        // If I am NOT player 1 and it's been more than 10 seconds past due, I can claim win
        else if (user?.uid === gameState.player2 && elapsed > shuffleInterval + 30) {
           // Opponent is likely gone
           setIsOpponentLikelyGone(true);
        }
      } else {
        setIsOpponentLikelyGone(false);
      }
    };

    timerRef.current = setInterval(intervalProcess, 100);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameState, user]);

  const hasEnoughMatches = () => {
    if (userProfile && userProfile.matchesRemaining <= 0) {
      setShowAdModal(true);
      return false;
    }
    return true;
  };

  const startSinglePlayer = async (targetNum: number) => {
    console.log("Starting single player with target:", targetNum);
    if (!user || !hasEnoughBalance()) return;
    setIsInitializingGame(true);
    setMenuState('in_game'); // Show loading screen immediately
    
    const initialGrid = generateInitialGrid(targetNum);
    const newGame: Omit<GameState, 'id'> = {
      mode: 'single',
      status: 'playing',
      player1: user.uid,
      player1_name: userProfile?.username || user.displayName || 'Sĩ Tử',
      player2: null,
      player2_name: null,
      current_number1: 1,
      current_number2: 0,
      found_numbers1: [],
      found_numbers2: [],
      grid1: initialGrid,
      grid2: [],
      hints_used1: 0,
      hints_used2: 0,
      max_number: targetNum,
      level: 1,
      betAmount: 10000,
      last_shuffle_time: Date.now(),
      winner: null,
      createdAt: Date.now()
    };
    try {
      setLocalFound1([]);
      setLocalFound2([]);
      setLocalCurrent1(1);
      setLocalCurrent2(1);
      const docRef = await addDoc(collection(db, 'games'), newGame);
      setGameId(docRef.id);
    } catch (e) {
      console.error("Error creating single player game:", e);
      setIsInitializingGame(false);
      setMenuState('main');
      alert("Hệ thống đình làng đang bận, không thể mở hội thi!");
    }
  };

  const startBotGame = async (targetNum: number) => {
    console.log("Starting bot game with target:", targetNum);
    if (!user || !hasEnoughBalance() || !hasEnoughMatches()) return;
    setIsInitializingGame(true);
    setMenuState('in_game');
    
    const grid1 = generateInitialGrid(targetNum);
    const grid2 = generateInitialGrid(targetNum);
    const newGame: Omit<GameState, 'id'> = {
      mode: 'bot',
      status: 'playing',
      player1: user.uid,
      player1_name: userProfile?.username || user.displayName || 'Kẻ Thách Thức',
      player2: 'bot_uid',
      player2_name: 'Trưởng Làng',
      current_number1: 1,
      current_number2: 1,
      found_numbers1: [],
      found_numbers2: [],
      grid1: grid1,
      grid2: grid2,
      hints_used1: 0,
      hints_used2: 0,
      max_number: targetNum,
      level: 1,
      betAmount: 10000,
      last_shuffle_time: Date.now(),
      winner: null,
      createdAt: Date.now()
    };
    try {
      setLocalFound1([]);
      setLocalFound2([]);
      setLocalCurrent1(1);
      setLocalCurrent2(1);
      const docRef = await addDoc(collection(db, 'games'), newGame);
      setGameId(docRef.id);
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(-1)
      });
    } catch (e) {
      console.error("Bot game error:", e);
      setIsInitializingGame(false);
      setMenuState('main');
      alert("Hệ thống đình làng đang bận!");
    }
  };

  const create1v1Game = async (targetNum: number) => {
    console.log("Creating 1v1 game with target:", targetNum);
    if (!user || !hasEnoughBalance(betAmountInput) || !hasEnoughMatches()) return;
    setIsInitializingGame(true);
    setMenuState('in_game');
    
    const customId = generateRoomId();
    const grid1 = generateInitialGrid(targetNum);
    const newGame: Omit<GameState, 'id'> = {
      mode: '1v1',
      status: 'waiting',
      player1: user.uid,
      player1_name: userProfile?.username || user.displayName || 'Sĩ Tử 1',
      player2: null,
      player2_name: null,
      current_number1: 1,
      current_number2: 1,
      found_numbers1: [],
      found_numbers2: [],
      grid1: grid1,
      grid2: [],
      hints_used1: 0,
      hints_used2: 0,
      max_number: targetNum,
      level: 1,
      betAmount: betAmountInput,
      last_shuffle_time: Date.now(),
      winner: null,
      createdAt: Date.now()
    };
    try {
      setLocalFound1([]);
      setLocalFound2([]);
      setLocalCurrent1(1);
      setLocalCurrent2(1);
      await setDoc(doc(db, 'games', customId), newGame);
      setGameId(customId);
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(-1)
      });
    } catch (e) {
      console.error("1v1 create error:", e);
      setIsInitializingGame(false);
      setMenuState('main');
      alert("Không thể lập sảnh!");
    }
  };

  const handleAdReward = async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(10),
        balance: increment(50000)
      });
      setShowAdModal(false);
      alert("Đại hỉ! Ngài đã nhận được 10 lượt chơi và 50.000 VNĐ ngân lượng bổng lộc!");
    } catch (e) {
      console.error("Lỗi khi nhận thưởng quảng cáo:", e);
    }
  };

  const handleSearchFriend = async () => {
    if (!searchUsername.trim()) return;
    try {
      const q = query(collection(db, 'users'), where('username', '==', searchUsername.trim()));
      const snap = await getDocs(q);
      setSearchResults(snap.docs.map(d => d.data() as UserProfile).filter(p => p.uid !== user?.uid));
      if (snap.empty) alert("Không tìm thấy sĩ tử nào có danh tính này!");
    } catch (e) {
      console.error(e);
    }
  };

  const addFriend = async (targetUser: UserProfile) => {
    if (!user || !userProfile) return;
    try {
      // Check if already friends in my list
      if (userProfile.friends?.includes(targetUser.uid)) {
        alert("Đã là hảo hữu từ trước!");
        return;
      }

      // SELF-HEALING: If they already have ME in their friends list, just add them to mine
      if (targetUser.friends?.includes(user.uid)) {
        await updateDoc(doc(db, 'users', user.uid), { friends: arrayUnion(targetUser.uid) });
        alert(`Đã khôi phục kết nối hảo hữu với ${targetUser.username}!`);
        setSearchResults([]);
        setSearchUsername('');
        return;
      }

      // Send Friend Request
      await addDoc(collection(db, 'friend_requests'), {
        fromId: user.uid,
        fromName: userProfile.username,
        toId: targetUser.uid,
        toName: targetUser.username,
        status: 'pending',
        createdAt: Date.now()
      });
      alert("Đã gửi thư kết giao! Chờ đối phương hồi đáp.");
      setSearchResults([]);
      setSearchUsername('');
    } catch (e) {
      console.error(e);
      alert("Lỗi khi gửi lời mời!");
    }
  };

  const removeFriend = async (friend: UserProfile) => {
    if (!user || !userProfile) return;
    if (!window.confirm(`Ngài có chắc chắn muốn đoạn tuyệt quan hệ hảo hữu với ${friend.username}?`)) return;
    
    try {
      // Remove from both sides
      await updateDoc(doc(db, 'users', user.uid), { friends: arrayRemove(friend.uid) });
      await updateDoc(doc(db, 'users', friend.uid), { friends: arrayRemove(user.uid) });
      alert(`Đã hủy kết giao với ${friend.username}.`);
    } catch (e) {
      console.error("Lỗi khi hủy kết giao:", e);
      alert("Không thể thực hiện đoạn tuyệt lúc này!");
    }
  };

  const acceptFriendRequest = async (req: FriendRequest) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'friend_requests', req.id), { status: 'accepted' });
      await updateDoc(doc(db, 'users', user.uid), { friends: arrayUnion(req.fromId) });
      await updateDoc(doc(db, 'users', req.fromId), { friends: arrayUnion(user.uid) });
      alert(`Đã kết giao với ${req.fromName}!`);
    } catch (e) {
      console.error(e);
    }
  };

  const rejectFriendRequest = async (reqId: string) => {
    try {
      await updateDoc(doc(db, 'friend_requests', reqId), { status: 'declined' });
    } catch (e) {
      console.error(e);
    }
  };

  const inviteToGame = async (friend: UserProfile, targetNum: number) => {
    if (!user || !userProfile || !hasEnoughBalance(betAmountInput) || !hasEnoughMatches()) return;
    const customId = generateRoomId();
    const grid1 = generateInitialGrid(targetNum);
    const newGame: Omit<GameState, 'id'> = {
      mode: '1v1',
      status: 'waiting',
      player1: user.uid,
      player1_name: userProfile.username,
      player2: null,
      player2_name: null,
      current_number1: 1,
      current_number2: 1,
      found_numbers1: [],
      found_numbers2: [],
      grid1: grid1,
      grid2: [],
      hints_used1: 0,
      hints_used2: 0,
      max_number: targetNum,
      level: 1,
      betAmount: betAmountInput,
      last_shuffle_time: Date.now(),
      winner: null,
      createdAt: Date.now()
    };
    
    try {
      await setDoc(doc(db, 'games', customId), newGame);
      await addDoc(collection(db, 'invitations'), {
        fromId: user.uid,
        fromName: userProfile.username,
        toId: friend.uid,
        roomId: customId,
        status: 'pending',
        createdAt: Date.now()
      });
      setGameId(customId);
      // We don't decrement matches until someone joins, but for consistency with previous logic
      // let's follow the create1v1Game pattern
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(-1)
      });
      alert(`Đã gửi thiệp mời cho ${friend.username}! Hãy chờ đối phương vào sân.`);
    } catch (e) {
      console.error(e);
    }
  };

  const joinInvitedGame = async (roomId: string, invId: string) => {
    if (!user || !hasEnoughMatches()) return;
    try {
      const docRef = doc(db, 'games', roomId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        alert("Phòng thi đã bị hủy hoặc không tồn tại!");
        await updateDoc(doc(db, 'invitations', invId), { status: 'declined' });
        return;
      }
      
      const gameData = docSnap.data() as GameState;
      if (gameData.player2) {
        alert("Lôi đài đã kín chỗ!");
        await updateDoc(doc(db, 'invitations', invId), { status: 'declined' });
        return;
      }

      if (!hasEnoughBalance(gameData.betAmount)) return;

      const grid2 = generateInitialGrid(gameData.max_number);
      await updateDoc(docRef, {
        player2: user.uid,
        player2_name: userProfile?.username || user.displayName || 'Sĩ Tử 2',
        status: 'playing',
        grid2: grid2,
        last_shuffle_time: Date.now()
      });
      
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(-1)
      });
      
      await updateDoc(doc(db, 'invitations', invId), { status: 'accepted' });
      setLocalFound1([]);
      setLocalFound2([]);
      setLocalCurrent1(1);
      setLocalCurrent2(1);
      setGameId(roomId);
    } catch (e) {
      console.error("Failed to join invited game:", e);
    }
  };

  const declineInvitation = async (invId: string) => {
    try {
      await updateDoc(doc(db, 'invitations', invId), { status: 'declined' });
    } catch (e) {
      console.error(e);
    }
  };

  const join1v1Game = async () => {
    console.log("Joining 1v1 game with ID:", gameInput);
    if (!user || !gameInput.trim() || !hasEnoughMatches()) return;
    setIsInitializingGame(true);
    setMenuState('in_game');
    
    try {
      const docId = gameInput.trim().toUpperCase();
      const docRef = doc(db, 'games', docId);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        setIsInitializingGame(false);
        setMenuState('lobby_1v1');
        alert("Chiếu chỉ (Mã Phòng) không tồn tại!");
        return;
      }
      
      const gameData = docSnap.data() as GameState;
      if (gameData.player2) {
        setIsInitializingGame(false);
        setMenuState('lobby_1v1');
        alert("Lôi đài đã kín chỗ!");
        return;
      }

      if (!hasEnoughBalance(gameData.betAmount)) {
        setIsInitializingGame(false);
        setMenuState('lobby_1v1');
        return;
      }

      const grid2 = generateInitialGrid(gameData.max_number);
      await updateDoc(docRef, {
        player2: user.uid,
        player2_name: userProfile?.username || user.displayName || 'Sĩ Tử 2',
        status: 'playing',
        grid2: grid2,
        last_shuffle_time: Date.now()
      });
      setLocalFound1([]);
      setLocalFound2([]);
      setLocalCurrent1(1);
      setLocalCurrent2(1);
      await updateDoc(doc(db, 'users', user.uid), {
        matchesRemaining: increment(-1)
      });
      setGameId(docId);
    } catch (e) {
      console.error("Failed to join game:", e);
      setIsInitializingGame(false);
      setMenuState('lobby_1v1');
      alert("Không thể bước lên lôi đài!");
    }
  };

  const handleNumberClick = async (clickedValue: number) => {
    if (!gameState || !user || gameState.status !== 'playing') return;
    setHintValue(null);
    
    const isPlayer1 = user.uid === gameState.player1;
    const currentNumber = isPlayer1 
      ? Math.max(gameState.current_number1, localCurrent1) 
      : Math.max(gameState.current_number2, localCurrent2);
    const foundNumbers = isPlayer1 
      ? [...gameState.found_numbers1, ...localFound1].filter((v, i, a) => a.indexOf(v) === i)
      : [...gameState.found_numbers2, ...localFound2].filter((v, i, a) => a.indexOf(v) === i);

    if (currentNumber !== clickedValue) return;
    if (foundNumbers.includes(clickedValue)) return;

    // Optimistic Update
    if (isPlayer1) {
      setLocalFound1(prev => [...prev, clickedValue]);
      setLocalCurrent1(currentNumber + 1);
    } else {
      setLocalFound2(prev => [...prev, clickedValue]);
      setLocalCurrent2(currentNumber + 1);
    }

    const nextNumber = currentNumber + 1;
    const isWin = nextNumber > gameState.max_number;
    const newLevel = isWin ? gameState.level : Math.floor((nextNumber - 1) / 10) + 1;

    if (isWin) {
      const winnerId = user.uid;
      let loserId: string | null = null;
      if (gameState.mode === '1v1') {
        loserId = gameState.player1 === user.uid ? gameState.player2 : gameState.player1;
      } else if (gameState.mode === 'bot') {
        loserId = 'bot_uid';
      }
      await processGameEnd(winnerId, loserId, gameState.mode);

      // Record fastest time for single player 50/100
      if (gameState.mode === 'single' && (gameState.max_number === 50 || gameState.max_number === 100)) {
        try {
          // Record current stopwatch time if it's faster
          const key = gameState.max_number === 50 ? 'fastest50' : 'fastest100';
          const currentTime = userProfile?.[key];
          if (!currentTime || stopwatch < currentTime) {
            await updateDoc(doc(db, 'users', user.uid), {
              [key]: stopwatch
            });
          }
        } catch (err) {
          console.error("Lỗi khi lưu thời gian:", err);
        }
      }
    }

    try {
      const updateData: any = {
        level: newLevel,
        status: isWin ? 'finished' : 'playing',
        winner: isWin ? user.uid : null,
      };

      if (isPlayer1) {
        updateData.current_number1 = isWin ? currentNumber : nextNumber;
        updateData.found_numbers1 = arrayUnion(clickedValue);
      } else {
        updateData.current_number2 = isWin ? currentNumber : nextNumber;
        updateData.found_numbers2 = arrayUnion(clickedValue);
      }

      await updateDoc(doc(db, 'games', gameState.id!), updateData);
    } catch (e) {
      console.error("Failed to update hit:", e);
    }
  };

  const sendQuickChat = async (text: string) => {
    if (!user || !gameState || gameState.status !== 'playing' || gameState.mode === 'single') return;
    try {
      const newChat = {
        uid: user.uid,
        text,
        timestamp: Date.now()
      };
      
      const updatedChats = [...(gameState.recentChats || []), newChat].slice(-10); // Keep last 10
      
      await updateDoc(doc(db, 'games', gameState.id!), {
        recentChats: updatedChats
      });
    } catch (e) {
      console.error("Lỗi khi gửi thoại:", e);
    }
  };

  const togglePause = async () => {
    if (!gameState || !user || gameState.status !== 'playing') return;
    
    // Allow toggle only for the host (player1) or if single player
    if (user.uid !== gameState.player1 && gameState.mode !== 'single') {
      alert("Chỉ chủ lôi đài mới được quyền tạm dừng!");
      return;
    }

    try {
      const isCurrentlyPaused = !!gameState.is_paused;
      const updates: any = {};
      
      if (isCurrentlyPaused) {
        // Resume check calculating duration of pause
        const pauseDuration = gameState.paused_at ? Date.now() - gameState.paused_at : 0;
        updates.is_paused = false;
        updates.paused_at = null;
        updates.last_shuffle_time = gameState.last_shuffle_time + pauseDuration;
        updates.createdAt = gameState.createdAt + pauseDuration; // adjust so stopwatch displays correctly
      } else {
        // Pause
        updates.is_paused = true;
        updates.paused_at = Date.now();
      }

      await updateDoc(doc(db, 'games', gameState.id!), updates);
    } catch (e) {
      console.error("Failed to toggle pause:", e);
    }
  };

  const useHint = async () => {
    if (!user || !gameState || gameState.status !== 'playing') return;
    
    const isPlayer1 = gameState.player1 === user.uid;
    const hintsUsed = isPlayer1 ? gameState.hints_used1 : gameState.hints_used2;
    const currentTarget = isPlayer1 ? gameState.current_number1 : gameState.current_number2;

    if (hintsUsed >= 3) {
      alert("Ngài đã dùng hết {3} sự trợ giúp trong trận này!");
      return;
    }

    try {
      const updateData: any = {};
      if (isPlayer1) {
        updateData.hints_used1 = increment(1);
      } else {
        updateData.hints_used2 = increment(1);
      }

      await updateDoc(doc(db, 'games', gameState.id!), updateData);
      
      // Visual feedback
      playSound('hint');
      setHintValue(currentTarget);
      setTimeout(() => setHintValue(null), 3000); // 3 seconds hint
    } catch (e) {
      console.error("Lỗi khi dùng trợ giúp:", e);
    }
  };

  const leaveGame = () => {
    setGameState(null);
    setGameId('');
    setMenuState('main');
  };

  const confirmSurrender = async () => {
    setShowSurrenderConfirm(false);
    if (gameState && gameState.status === 'playing') {
      if (gameState.mode === '1v1' && gameState.player2) {
        try {
          // Giành phần thắng cho người còn lại
          const winnerId = gameState.player1 === user?.uid ? gameState.player2 : gameState.player1;
          await processGameEnd(winnerId, user?.uid, '1v1');
          await updateDoc(doc(db, 'games', gameState.id!), {
            status: 'finished',
            winner: winnerId
          });
        } catch (e) {
          console.error("Lỗi khi đầu hàng:", e);
        }
      } else if (gameState.mode === 'bot') {
          try {
          await processGameEnd('bot_uid', user?.uid, 'bot');
          await updateDoc(doc(db, 'games', gameState.id!), {
            status: 'finished',
            winner: 'bot_uid'
          });
        } catch (e) {
          console.error(e);
        }
      } else if (gameState.mode === 'single') {
        try {
          await processGameEnd(null, user?.uid, 'single');
          await updateDoc(doc(db, 'games', gameState.id!), {
            status: 'finished',
            winner: null
          });
        } catch (e) {
          console.error(e);
        }
      }
    }
    leaveGame();
  };

  // ----------------------------------------------------
  // VIEW RENDERERS
  // ----------------------------------------------------

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center font-serif p-4" 
           style={{ backgroundImage: 'radial-gradient(circle at center, #5c3a21, #291c14)' }}>
        <div className="w-full max-w-md bg-[#452b1b] border-2 border-[#784627] p-8 flex flex-col items-center gap-6"
             style={{ boxShadow: '0 10px 40px rgba(0,0,0,0.8), inset 0 0 20px rgba(0,0,0,0.5)', borderRadius: '8px 8px 30px 30px' }}>
          <div className="w-20 h-20 bg-[#784627] rounded-full flex items-center justify-center shadow-[0_0_24px_rgba(214,180,133,0.2)] border border-[#a16207]">
            <ScrollText className="w-10 h-10 text-[#fef3c7]" />
          </div>
          <div className="text-center">
             <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[#fef3c7] mb-2 uppercase font-display" style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.6)' }}>Làng Trạng Nguyên</h1>
             <p className="text-[#d6b485] text-sm">Ghi danh bảng vàng, nhận ngàn bổng lộc</p>
          </div>

          <form onSubmit={isRegistering ? handleRegister : handleCustomLogin} className="w-full flex flex-col gap-3">
            <input 
              type="text" 
              placeholder="Tôn danh (Tên đăng nhập)" 
              value={username} onChange={e => setUsername(e.target.value)}
              className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors"
            />
            <input 
              type="password" 
              placeholder="Tín vật (Mật khẩu)" 
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors"
            />
            
            {isRegistering && (
              <>
                <input 
                  type="password" 
                  placeholder="Xác nhận Tín vật" 
                  value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors"
                />
                <input 
                  type="tel" 
                  placeholder="Số liên lạc (Số điện thoại)" 
                  value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors"
                />
                <input 
                  type="text" 
                  placeholder="Lệnh bài giới thiệu (Nếu có)" 
                  value={refCode} onChange={e => setRefCode(e.target.value)}
                  className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors uppercase"
                />
                <select 
                  value={relation} onChange={e => setRelation(e.target.value)}
                  className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] px-4 py-3 rounded focus:outline-none focus:border-[#d97706] transition-colors appearance-none">
                  <option value="nguoi_dung">Người qua đường</option>
                  <option value="ban_be">Hảo hữu (Bạn bè)</option>
                  <option value="gia_dinh">Người nhà (Gia đình)</option>
                </select>
              </>
            )}

            <button 
              type="submit"
              className="w-full bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] font-bold py-3 mt-2 rounded transition-colors shadow-lg border border-[#f59e0b]">
              {isRegistering ? 'Ghi Danh Nhận 500.000 VNĐ' : 'Tiến Vào Đình Làng'}
            </button>
          </form>

          <div className="flex flex-col gap-2 w-full text-center">
            <button 
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-[#d6b485] hover:text-[#fef3c7] text-sm underline transition-colors">
              {isRegistering ? 'Đã có bài vị? Báo danh ngay' : 'Thư sinh mới? Ghi danh tại đây'}
            </button>
            <div className="flex items-center justify-center gap-2 mt-4 text-[#784627]">
              <span className="w-8 h-[1px] bg-[#784627]"></span>
              <span className="text-xs uppercase font-bold">Hoặc dùng Lệnh Bài Ngoại Bang</span>
              <span className="w-8 h-[1px] bg-[#784627]"></span>
            </div>
            <button 
              onClick={loginWithGoogle}
              className="w-full bg-[#291c14] border border-[#784627] text-[#d6b485] hover:text-[#fef3c7] hover:bg-[#5c3a21] py-2 mt-2 rounded font-bold transition-all flex justify-center items-center gap-2">
              Bái kiến bằng Thông Hành Cốc Cốc (Google)
            </button>
          </div>
        </div>
      </div>
    );
  }

  const getWealthRankInfo = (balance: number) => {
    if (balance >= 100000000) {
      return {
        label: 'Bậc Đế Vương',
        description: 'Chủ tể của một phương, nắm giữ quốc bảo và ngân khố vô tận.',
        nextRank: null,
        icon: <div className="relative"><Castle className="w-24 h-24 md:w-32 md:h-32 text-yellow-400 drop-shadow-[0_0_20px_rgba(250,204,21,0.9)] animate-pulse" /><Sparkles className="absolute -top-4 -right-4 w-10 h-10 text-yellow-200 animate-bounce" /><Sparkles className="absolute -bottom-4 -left-4 w-10 h-10 text-yellow-200 animate-pulse" /></div>,
        borderColor: 'border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.6)]',
        titleColor: 'text-yellow-400 drop-shadow-lg'
      };
    }
    if (balance >= 20000000) {
      return {
        label: 'Quan Lại',
        description: 'Bậc quyền quý trong triều, bổng lộc dồi dào, lời nói có trọng lượng nơi quan trường.',
        nextRank: { name: 'Bậc Đế Vương', target: 100000000 },
        icon: <div className="relative"><Landmark className="w-20 h-20 md:w-24 md:h-24 text-purple-400 drop-shadow-[0_0_12px_rgba(192,132,252,0.7)]" /><Sparkles className="absolute -top-2 -right-2 w-8 h-8 text-purple-200 opacity-60" /></div>,
        borderColor: 'border-purple-600 shadow-[0_0_30px_rgba(147,51,234,0.4)]',
        titleColor: 'text-purple-400'
      };
    }
    if (balance >= 5000000) {
      return {
        label: 'Hào Phú',
        description: 'Kẻ giàu có nhất vùng, sở hữu ruộng vườn bát ngát và kho thóc đầy ắp.',
        nextRank: { name: 'Quan Lại', target: 20000000 },
        icon: <Landmark className="w-16 h-16 md:w-20 md:h-20 text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.5)]" />,
        borderColor: 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]',
        titleColor: 'text-blue-400'
      };
    }
    if (balance >= 1000000) {
      return {
        label: 'Thương Nhân',
        description: 'Người buôn bán ngược xuôi, tích cóp từng đồng tiền lời từ những chuyến hàng xa.',
        nextRank: { name: 'Hào Phú', target: 5000000 },
        icon: <Store className="w-14 h-14 md:w-16 md:h-16 text-orange-400" />,
        borderColor: 'border-orange-500',
        titleColor: 'text-orange-400'
      };
    }
    return {
      label: 'Nông Dân',
      description: 'Người chân lấm tay bùn, tài sản phụ thuộc vào mùa vụ và thuế khóa nặng nề.',
      nextRank: { name: 'Thương Nhân', target: 1000000 },
      icon: <Home className="w-12 h-12 md:w-14 md:h-14 text-[#d6b485]" />,
      borderColor: 'border-[#784627]',
      titleColor: 'text-[#f59e0b]'
    };
  };

  const rankInfo = getWealthRankInfo(userProfile?.balance || 0);

  return (
    <div className="font-serif flex flex-col h-[100dvh] overflow-hidden" style={{ backgroundColor: '#291c14', color: '#fef3c7' }}>
      {/* Header */}
      <header className="h-[50px] sm:h-[60px] border-b-2 border-[#784627] p-2 sm:px-6 shrink-0 flex items-center justify-between z-30" style={{ backgroundColor: '#452b1b', backgroundImage: 'radial-gradient(circle at center, transparent, rgba(0,0,0,0.3))' }}>
        <div 
          className={`flex flex-col pl-1 ${gameState?.status === 'playing' ? 'cursor-default' : 'cursor-pointer hover:opacity-80'}`} 
          onClick={() => {
            if (gameState?.status === 'playing') return;
            setMenuState('main');
          }}
        >
          <h1 className="m-0 text-xs sm:text-sm font-bold flex items-center gap-1 sm:gap-1.5 text-[#f59e0b] uppercase font-display">
            <ScrollText className="w-3 h-3 sm:w-4 sm:h-4" /> Làng Trạng Nguyên
          </h1>
          <p className="m-0 text-[8px] sm:text-[9px] text-[#d6b485] truncate max-w-[80px] sm:max-w-[120px]">Truy Tìm Mộc Bản</p>
        </div>

        {gameState?.status === 'playing' ? (
          <div className="flex gap-1 sm:gap-1.5 items-center">
            {gameState.mode === 'single' && (
              <div className="bg-[#291c14] py-0.5 sm:py-1 px-1.5 sm:px-2 rounded flex flex-col items-center border border-[#d97706]">
                <span className="text-[7px] sm:text-[8px] uppercase text-[#d6b485] font-bold leading-tight">Canh Giờ</span>
                <span className="text-xs sm:text-sm font-bold text-[#f59e0b] leading-none">{stopwatch.toFixed(1)}s</span>
              </div>
            )}
            <div className="bg-[#291c14] py-0.5 sm:py-1 px-1.5 sm:px-2 rounded flex flex-col items-center border border-[#784627]">
              <span className="text-[7px] sm:text-[8px] uppercase text-[#d6b485] font-bold leading-tight">Lượt</span>
              <span className="text-xs sm:text-sm font-bold text-[#f59e0b] leading-none">{gameState.level.toString().padStart(2, '0')}</span>
            </div>
            <div className="bg-[#291c14] py-0.5 sm:py-1 px-2 sm:px-3 rounded flex flex-col items-center border-2 border-[#f59e0b] shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <span className="text-[7px] sm:text-[8px] uppercase text-[#f59e0b] font-black tracking-tighter leading-tight">Tìm Số</span>
              <span className="text-sm sm:text-lg font-black text-white leading-none">
                {(user?.uid === gameState.player1 ? gameState.current_number1 : gameState.current_number2) <= gameState.max_number 
                  ? (user?.uid === gameState.player1 ? gameState.current_number1 : gameState.current_number2) 
                  : 'X'}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1 sm:gap-3">
            <div className="flex items-center gap-2 bg-[#291c14] px-2 py-1 border border-[#784627] rounded text-[10px] md:text-xs">
              {userProfile?.balance !== undefined && (
                <span className="text-[#f59e0b] font-mono flex items-center gap-1"><Coins className="w-3 h-3 text-yellow-500" />{userProfile.balance.toLocaleString('vi-VN')}</span>
              )}
            </div>
            
            <button 
              onClick={() => setIsMuted(!isMuted)} 
              className="p-1.5 hover:bg-[#5c3a21] rounded transition-colors text-[#d6b485]">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col overflow-hidden w-full relative md:pl-[70px]" 
            style={{ 
              backgroundImage: 'radial-gradient(circle, transparent 20%, #291c14 80%), url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 86c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zm66-3c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zm-46-45c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1zm54 54c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1zM58 7c.552 0 1-.448 1-1s-.448-1-1-1-1 .448-1 1 .448 1 1 1z\' fill=\'%23f59e0b\' fill-opacity=\'0.03\' fill-rule=\'evenodd\'/%3E%3C/svg%3E")' 
            }}>
        
        {/* LOBBY / MAIN MENU / HOME */}
        {(menuState === 'main' || menuState === 'home') && (
          <div className="flex flex-col items-center justify-center flex-1 h-full p-0.5 md:p-2.5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[#452b1b]/30 mix-blend-overlay pointer-events-none"></div>
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-[0.05] pointer-events-none" 
                 style={{ 
                   backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23f59e0b' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2v-4h4v-2h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2v-4h4v-2H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` 
                 }}>
            </div>
            
            <div className={`w-full h-full md:max-w-lg md:h-[85vh] border-4 border-double ${rankInfo.borderColor} p-2 md:p-10 rounded bg-[#291c14] flex flex-col items-center shadow-[0_0_50px_rgba(0,0,0,0.9)] z-10 relative transition-all duration-500 overflow-y-auto no-scrollbar`}>
              <div className="absolute inset-0 bg-[#f59e0b] opacity-5 pointer-events-none"></div>
              
              {/* Decorative Corners */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-[#d97706]/30 rounded-tl-sm pointer-events-none"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-[#d97706]/30 rounded-tr-sm pointer-events-none"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-[#d97706]/30 rounded-bl-sm pointer-events-none"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-[#d97706]/30 rounded-br-sm pointer-events-none"></div>

              <div className="relative z-10 w-full mb-4 md:mb-8 flex flex-col items-center shrink-0">
                <div className="mt-4 md:mt-8 mb-4 md:mb-6 animate-in zoom-in duration-700">
                   {rankInfo.icon}
                </div>
                <div className={`font-display font-black ${rankInfo.titleColor} text-2xl md:text-5xl uppercase tracking-[0.2em] md:tracking-[0.3em] transition-all duration-300 drop-shadow-2xl text-center`}>
                   {rankInfo.label}
                </div>
                <p className="text-[#d6b485] text-[10px] md:text-sm px-4 md:px-10 text-center mt-2 md:mt-3 italic opacity-80 leading-relaxed max-w-sm">
                  "{rankInfo.description}"
                </p>
                <div className="w-24 h-1 bg-gradient-to-r from-transparent via-[#784627] to-transparent mt-3 md:mt-4 opacity-40"></div>
                
                {rankInfo.nextRank && (
                  <div className="mt-3 md:mt-4 px-3 md:px-4 py-1.5 md:py-2 bg-[#291c14] border border-[#784627]/40 rounded-full flex items-center gap-2 md:gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse"></div>
                    <span className="text-[8px] md:text-[10px] uppercase font-bold text-[#d6b485] tracking-tighter">
                      Tiến tới: <span className="text-[#fef3c7]">{rankInfo.nextRank.name}</span> (Cần {rankInfo.nextRank.target.toLocaleString('vi-VN')} VNĐ)
                    </span>
                  </div>
                )}
              </div>

              {mainTab === 'welcome' ? (
                <div className="w-full bg-[#452b1b]/50 p-4 md:p-10 border border-[#784627] rounded shadow-lg flex flex-col gap-3 md:gap-4 relative z-10 animate-in fade-in zoom-in-95 duration-500 shrink-0">
                  <p className="text-[#d6b485] text-[10px] md:text-sm italic mb-1 font-serif text-center opacity-80 uppercase tracking-widest leading-none">
                     Chọn lối vào Hội Thí:
                  </p>
                  
                  <button 
                    onClick={() => setMainTab('learning')}
                    className="group bg-[#291c14] hover:bg-[#3d291c] text-[#fef3c7] font-extrabold py-3 md:py-4 border border-[#784627] hover:border-[#f59e0b] rounded uppercase transition-all shadow-md flex items-center justify-center gap-3 md:gap-4 text-xs md:text-sm tracking-[0.2em] active:scale-95">
                    <BookOpen className="w-4 h-4 md:w-5 md:h-5 text-[#f59e0b]" />
                    <span>Học Tài</span>
                  </button>

                  <button 
                    onClick={() => setMainTab('merchant')}
                    className="group bg-[#291c14] hover:bg-[#3d291c] text-[#fef3c7] font-extrabold py-3 md:py-4 border border-[#784627] hover:border-[#f59e0b] rounded uppercase transition-all shadow-md flex items-center justify-center gap-3 md:gap-4 text-xs md:text-sm tracking-[0.2em] active:scale-95">
                    <Store className="w-4 h-4 md:w-5 md:h-5 text-[#f59e0b]" />
                    <span>Thương Nhân</span>
                  </button>

                  <button 
                    onClick={logout}
                    className="mt-2 md:mt-4 group bg-[#291c14] hover:bg-red-950/20 text-red-500 font-extrabold py-2 md:py-3 border border-red-900/30 hover:border-red-500 rounded uppercase transition-all shadow-md flex items-center justify-center gap-2 md:gap-3 text-[10px] md:text-xs tracking-widest">
                    <LogOut className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    <span>Rời Làng</span>
                  </button>
                </div>
              ) : mainTab === 'learning' ? (
                <div className="w-full bg-[#452b1b]/50 p-4 md:p-10 border border-[#784627] rounded shadow-lg flex flex-col gap-4 md:gap-8 relative z-10 animate-in slide-in-from-bottom-8 duration-500 shrink-0">
                  <div className="flex flex-col gap-4 md:gap-6">
                    <div className="bg-[#291c14] border border-[#d97706]/40 p-3 md:p-4 rounded flex flex-col items-center justify-center gap-2 shadow-inner">
                      <div className="flex items-center justify-center gap-3 md:gap-4 w-full">
                        <div className="text-[10px] md:text-sm text-[#d6b485] font-bold uppercase tracking-widest shrink-0">Sát hạch:</div>
                        <div className={`font-mono font-bold text-lg md:text-2xl ${(userProfile?.matchesRemaining || 0) === 0 ? "text-red-500 animate-pulse" : "text-[#f59e0b]"}`}>
                          {userProfile?.matchesRemaining || 0}/10
                        </div>
                      </div>
                      
                      {(userProfile?.matchesRemaining || 0) <= 0 && (
                        <button 
                          onClick={() => setShowAdModal(true)}
                          className="mt-2 text-[10px] md:text-xs text-[#f59e0b] hover:text-[#fef3c7] font-bold flex items-center gap-2 py-1 px-3 bg-[#452b1b] rounded-full border border-[#f59e0b]/30 transition-all hover:bg-[#5c3a21]">
                          <Tv className="w-3.5 h-3.5" /> 
                          XEM QUẢNG CÁO NHẬN LƯỢT + TIỀN
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 md:gap-4">
                      <button 
                        onClick={() => setShowNumberSelectParams({ action: 'single' })}
                        className="group flex items-center p-3 md:p-4 bg-[#291c14] hover:bg-[#3d291c] border border-[#784627] hover:border-[#f59e0b] rounded transition-all shadow-md relative overflow-hidden w-full text-left">
                        <div className="absolute top-0 right-0 p-1 bg-[#f59e0b] text-[#291c14] text-[7px] md:text-[8px] font-bold uppercase tracking-tighter rounded-bl px-1.5 md:px-2">Một mình</div>
                        <UserIcon className="w-6 h-6 md:w-8 md:h-8 text-[#f59e0b] mr-3 md:mr-4" />
                        <h3 className="font-bold text-xs md:text-base text-[#fef3c7] uppercase tracking-widest">Thi Độc Môn</h3>
                      </button>

                      <button 
                        onClick={() => setMenuState('lobby_1v1')}
                        className="group flex items-center p-3 md:p-4 bg-[#291c14] hover:bg-[#3d291c] border border-[#784627] hover:border-[#b45309] rounded transition-all shadow-md relative overflow-hidden w-full text-left">
                        <div className="absolute top-0 right-0 p-1 bg-[#b45309] text-[#fef3c7] text-[7px] md:text-[8px] font-bold uppercase tracking-tighter rounded-bl px-1.5 md:px-2">Song đấu</div>
                        <Users className="w-6 h-6 md:w-8 md:h-8 text-[#b45309] mr-3 md:mr-4" />
                        <h3 className="font-bold text-xs md:text-base text-[#fef3c7] uppercase tracking-widest">Lôi Đài Tỷ Võ</h3>
                      </button>

                      <button 
                        onClick={() => {
                          const currentLevel = userProfile?.currentLevel || 1;
                          const nextTargetNum = Math.min(100, 40 + (currentLevel * 10));
                          startBotGame(nextTargetNum);
                        }}
                        className="group flex items-center p-3 md:p-4 bg-[#291c14] hover:bg-[#3d291c] border border-[#784627] hover:border-[#84cc16] rounded transition-all shadow-md relative overflow-hidden w-full text-left">
                        <div className="absolute top-0 right-0 p-1 bg-[#84cc16] text-[#291c14] text-[7px] md:text-[8px] font-bold uppercase tracking-tighter rounded-bl px-1.5 md:px-2">Huyện Lệnh</div>
                        <Bot className="w-6 h-6 md:w-8 md:h-8 text-[#84cc16] mr-3 md:mr-4" />
                        <h3 className="font-bold text-xs md:text-base text-[#fef3c7] uppercase tracking-widest">Đấu Trưởng Làng</h3>
                      </button>
                      
                      <button 
                        onClick={() => setMainTab('welcome')}
                        className="mt-2 md:mt-4 text-[#d6b485] hover:text-[#fef3c7] text-[10px] md:text-xs uppercase font-bold tracking-[0.3em] flex items-center justify-center gap-2 md:gap-3 py-2 md:py-3 border-t border-[#784627]/30 transition-colors">
                        <ArrowLeft className="w-3 h-3 md:w-4 md:h-4" /> Quay Lại
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-8 text-center py-10 relative z-10 w-full animate-in zoom-in-95 duration-500">
                   <div className="w-24 h-24 md:w-32 md:h-32 bg-[#291c14] border-4 border-[#784627] rounded-full flex items-center justify-center text-[#d6b485] animate-pulse shadow-[0_0_40px_rgba(120,70,39,0.4)] relative">
                      <Clock className="w-12 h-12 md:w-16 md:h-16" />
                      <div className="absolute inset-0 border-2 border-dashed border-[#784627] rounded-full animate-[spin_10s_linear_infinite]"></div>
                   </div>
                   <div className="space-y-5">
                     <h2 className="text-3xl md:text-5xl font-bold text-[#f59e0b] font-display uppercase tracking-[0.3em]">Sắp Ra Mắt</h2>
                     <div className="w-32 h-1.5 bg-gradient-to-r from-transparent via-[#f59e0b] to-transparent mx-auto"></div>
                     <p className="text-[#d6b485] italic text-lg md:text-xl max-w-sm px-6 leading-relaxed font-serif">
                       "Tiệm tạp hóa làng đang trong kỳ nghỉ lễ để nhập thêm lụa là, gấm vóc. Xin Ngài rộng lòng chờ đợi!"
                     </p>
                     <button 
                       onClick={() => setMainTab('welcome')}
                       className="mt-6 bg-[#452b1b] border-2 border-[#784627] text-[#d6b485] hover:text-[#fef3c7] hover:border-[#f59e0b] px-8 py-2 rounded uppercase font-bold transition-all shadow-lg flex items-center gap-3 mx-auto group">
                       <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Trở về Sân Đình
                     </button>
                   </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LEADERBOARD */}
        {menuState === 'leaderboard' && (
          <div className="flex flex-col items-center justify-center flex-1 h-full p-0.5 md:p-2.5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[#452b1b]/30 mix-blend-overlay pointer-events-none"></div>
            
            <div className="w-full h-full md:max-w-4xl md:h-[88vh] border-4 border-double border-[#d97706] p-2 md:p-8 rounded bg-[#291c14] flex flex-col shadow-[0_0_30px_rgba(0,0,0,0.8)] z-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[#f59e0b] opacity-10 pointer-events-none"></div>
              
              <h2 className="text-xl md:text-3xl font-bold text-[#f59e0b] mb-2 md:mb-4 border-b border-[#784627] pb-2 md:pb-4 font-display uppercase tracking-wider flex items-center justify-center gap-2 md:gap-3 shrink-0">
                Bảng Vàng Danh Dự
              </h2>
              
              <div className="flex w-full mb-4 md:mb-6 border-b border-[#784627]">
                {[
                  { id: 'balance', label: 'Ngân Lượng' },
                  { id: 'fastest50', label: '50 Số' },
                  { id: 'fastest100', label: '100 Số' },
                  { id: 'bot_rank', label: 'Hạ Trưởng Làng' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setLeaderboardTab(tab.id as 'balance' | 'fastest50' | 'fastest100' | 'bot_rank')}
                    className={`flex-1 py-3 px-2 text-xs md:text-sm font-bold uppercase transition-all whitespace-nowrap ${leaderboardTab === tab.id ? 'text-[#f59e0b] border-b-2 border-[#f59e0b] bg-[#452b1b]/50' : 'text-[#d6b485] hover:text-[#fef3c7] hover:bg-[#452b1b]/20'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="flex flex-col gap-4 pb-4">
                  <div className="bg-[#452b1b]/50 p-4 md:p-6 border border-[#784627] rounded shadow-sm">
                    <h3 className="text-[#fef3c7] font-bold mb-4 uppercase text-xs md:text-sm border-b border-[#784627]/50 pb-2">
                       {leaderboardTab === 'balance' ? 'Hạng bậc trạng nguyên' : leaderboardTab === 'bot_rank' ? 'Huyền thoại lôi đài' : 'Kỷ lục gia tốc độ'}
                    </h3>
                    <div className="flex flex-col gap-3">
                      {leaderboard.length === 0 ? (
                        <div className="text-[#d6b485] text-center text-sm md:text-base italic py-8">Chưa có sĩ tử nào ghi danh kỷ lục này.</div>
                      ) : (
                        leaderboard.map((u, i) => (
                          <div key={u.uid} className={`flex items-center px-3 py-3 md:px-4 md:py-4 rounded border ${i === 0 ? 'bg-[#291c14] border-[#f59e0b] shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'bg-[#291c14] border-[#784627]'} transition-all`}>
                            <div className="font-display text-lg md:text-2xl font-black w-10 md:w-12 text-center text-[#d6b485] shrink-0">#{i + 1}</div>
                            <div className="flex-1 overflow-hidden px-2 flex flex-col justify-center text-left">
                              <div className="font-bold text-sm md:text-lg truncate text-[#fef3c7]">{u.username}</div>
                              <div className="text-[9px] md:text-xs text-[#d6b485] font-bold uppercase tracking-wider">{getRankName(u.balance)}</div>
                            </div>
                            <div className="font-mono text-[#f59e0b] font-bold text-sm md:text-xl flex flex-col items-end md:flex-row md:items-center gap-1 md:gap-2 shrink-0">
                              {leaderboardTab === 'balance' ? (
                                <div className="flex items-center gap-1"><Coins className="w-3.5 h-3.5 md:w-4 md:h-4 text-yellow-500" /> {u.balance.toLocaleString('vi-VN')}</div>
                              ) : leaderboardTab === 'bot_rank' ? (
                                <div className="flex flex-col items-end text-[#f59e0b]">
                                   <div className="flex items-center gap-1">
                                      <Crown className="w-3.5 h-3.5 md:w-4 md:h-4" /> 
                                      <span className="tabular-nums">{u.botWins || 0} Trận</span>
                                   </div>
                                   <div className="text-[10px] uppercase font-bold">Cấp {u.currentLevel || 1}</div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 text-green-500">
                                   <Timer className="w-3.5 h-3.5 md:w-4 md:h-4" /> 
                                   <span className="tabular-nums">{(leaderboardTab === 'fastest50' ? u.fastest50 : u.fastest100)?.toFixed(1)}s</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* FRIENDS */}
        {menuState === 'friends' && (
          <div className="flex flex-col items-center justify-center flex-1 h-full p-0.5 md:p-2.5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[#452b1b]/30 mix-blend-overlay pointer-events-none"></div>
            
            <div className="w-full h-full md:max-w-4xl md:h-[88vh] border-4 border-double border-[#d97706] p-2 md:p-8 rounded bg-[#291c14] flex flex-col shadow-[0_0_30px_rgba(0,0,0,0.8)] z-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[#f59e0b] opacity-10 pointer-events-none"></div>
              
              <h2 className="text-xl md:text-3xl font-bold text-[#f59e0b] mb-2 md:mb-4 border-b border-[#784627] pb-2 md:pb-4 font-display uppercase tracking-wider flex items-center gap-2 md:gap-3 shrink-0">
                Danh Sách Hảo Hữu
              </h2>
              
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="flex flex-col gap-4 pb-4">
                  {/* Search Section */}
                  <div className="bg-[#452b1b]/50 p-4 md:p-6 border border-[#784627] rounded shadow-sm">
                    <h3 className="text-[#fef3c7] font-bold mb-4 uppercase text-xs md:text-sm border-b border-[#784627]/50 pb-2">Tìm kiếm Sĩ tử</h3>
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <input 
                          type="text" 
                          placeholder="Nhập danh tính..."
                          value={searchUsername}
                          onChange={(e) => setSearchUsername(e.target.value)}
                          className="w-full bg-[#291c14] border border-[#784627] text-[#fef3c7] text-sm px-4 py-2.5 rounded focus:outline-none focus:border-[#f59e0b] placeholder:text-[#d6b485]/30"
                        />
                      </div>
                      <button 
                        onClick={handleSearchFriend}
                        className="bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] text-sm font-bold py-2.5 rounded transition-colors flex items-center justify-center gap-2 shadow-md active:scale-95"
                      >
                        <Target className="w-4 h-4" /> Truy Tìm
                      </button>
                    </div>

                    {searchResults.length > 0 && (
                      <div className="mt-6 space-y-3">
                        <p className="text-[10px] md:text-xs text-[#d6b485] uppercase font-black tracking-widest">Kết quả tầm nã:</p>
                        {searchResults.map(res => (
                          <div key={res.uid} className="bg-[#291c14] p-3 border border-[#784627] rounded flex items-center justify-between group hover:border-[#f59e0b] transition-colors">
                            <span className="font-bold text-sm text-[#fef3c7]">{res.username}</span>
                            <button 
                              onClick={() => addFriend(res)}
                              className="bg-[#15803d] hover:bg-[#16a34a] text-white p-2 rounded transition-colors shadow-md"
                              title="Kết Giao"
                            >
                              <UserPlus className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Requests Section - Only if any */}
                  {friendRequests.length > 0 && (
                    <div className="bg-[#452b1b]/50 p-4 md:p-6 border border-[#f59e0b]/30 rounded shadow-sm">
                      <h3 className="text-[#f59e0b] font-bold mb-4 uppercase text-xs md:text-sm border-b border-[#f59e0b]/20 pb-2 flex justify-between items-center">
                        Thư Kết Giao <span className="bg-[#f59e0b] text-[#291c14] px-1.5 py-0.5 rounded text-[10px]">{friendRequests.length}</span>
                      </h3>
                      <div className="flex flex-col gap-2">
                        {friendRequests.map(req => (
                          <div key={req.id} className="bg-[#291c14] p-3 border border-[#784627] rounded flex items-center justify-between">
                            <span className="font-bold text-sm text-[#fef3c7] truncate mr-2">{req.fromName}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <button 
                                onClick={() => acceptFriendRequest(req)}
                                className="bg-[#15803d] hover:bg-[#16a34a] text-white px-3 py-1.5 text-[10px] rounded font-black uppercase tracking-tighter"
                              >
                                Nhận
                              </button>
                              <button 
                                onClick={() => rejectFriendRequest(req.id)}
                                className="bg-[#991b1b] hover:bg-[#b91c1c] text-white px-3 py-1.5 text-[10px] rounded font-black uppercase tracking-tighter"
                              >
                                Bỏ
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Friends List Section */}
                  <div className="bg-[#452b1b]/50 p-4 md:p-6 border border-[#784627] rounded shadow-sm min-h-[300px]">
                    <h3 className="text-[#fef3c7] font-bold mb-4 uppercase text-xs md:text-sm border-b border-[#784627]/50 pb-2">
                      Bằng hữu đã kết giao
                    </h3>

                    {friendsProfiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-[#d6b485] opacity-40">
                         <ScrollText className="w-12 h-12 mb-3" />
                         <p className="text-xs md:text-sm italic">Chưa có bằng hữu nào. Hãy kết giao thêm!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {friendsProfiles.map(friend => {
                          const isOnline = friend.lastActive && (Date.now() - friend.lastActive < 120000); // 2 mins
                          return (
                            <div key={friend.uid} className="bg-[#291c14] p-3 border border-[#784627] rounded flex items-center gap-3 hover:border-[#d97706]/50 transition-colors">
                              <div className="w-10 h-10 bg-[#452b1b] border border-[#784627] rounded-full flex items-center justify-center relative shrink-0">
                                 <UserIcon className="w-5 h-5 text-[#d6b485]" />
                                 <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#291c14] ${isOnline ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : 'bg-gray-600'}`}></div>
                              </div>
                              <div className="flex-1 overflow-hidden">
                                 <div className="font-bold text-[#fef3c7] truncate text-sm">{friend.username}</div>
                                 <div className={`text-[8px] uppercase font-black ${isOnline ? 'text-green-500' : 'text-[#d6b485]'}`}>
                                   {isOnline ? 'Tại ngoại' : 'Ẩn danh'}
                                 </div>
                              </div>
                               <div className="flex items-center gap-2">
                                 <button 
                                   onClick={() => setShowNumberSelectParams({ action: 'invite', friend })} 
                                   className="flex items-center gap-1 px-2 py-1.5 bg-[#b45309] rounded hover:bg-[#d97706] text-[#fef3c7] text-[10px] font-bold uppercase tracking-tighter shadow-md transition-all active:scale-90"
                                   title="Thách Đấu"
                                 >
                                   <Swords className="w-3.5 h-3.5" />
                                   <span>Thách Đấu</span>
                                 </button>
                                 <button 
                                   onClick={() => removeFriend(friend)}
                                   className="p-1.5 bg-[#291c14] border border-red-900/30 text-red-500/50 hover:text-red-500 hover:border-red-500 rounded transition-all"
                                   title="Hủy Kết Giao"
                                 >
                                    <X className="w-3.5 h-3.5" />
                                 </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ACCOUNT PROFILE */}
        {menuState === 'account' && (
          <div className="flex flex-col items-center justify-center flex-1 h-full p-0.5 md:p-2.5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[#452b1b]/30 mix-blend-overlay pointer-events-none"></div>
            
            <div className="w-full max-w-md h-[96vh] md:h-[88vh] border-4 border-double border-[#d97706] p-2 md:p-8 rounded bg-[#291c14] flex flex-col items-center shadow-[0_0_30px_rgba(0,0,0,0.8)] z-10 relative transition-all duration-300">
                <div className="absolute inset-0 bg-[#f59e0b] opacity-10 pointer-events-none"></div>
                
                <h2 className="text-xl md:text-2xl font-bold text-[#f59e0b] mb-4 md:mb-6 border-b border-[#784627] pb-2 md:pb-3 uppercase tracking-wider font-display shrink-0 w-full text-center">Tài Khoản</h2>

                <div className="w-full bg-[#452b1b]/50 p-4 md:p-6 border border-[#784627] rounded shadow-sm flex flex-col items-center gap-4 relative z-10 animate-in fade-in zoom-in-95 duration-500">
                  <div className="w-20 h-20 bg-[#291c14] rounded-full flex items-center justify-center border-2 border-[#f59e0b] shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                    <UserIcon className="w-10 h-10 text-[#f59e0b]" />
                  </div>
                  
                  <div className="flex flex-col items-center">
                    <h3 className="text-xl font-bold font-display text-[#fef3c7]">{userProfile?.username || user.displayName}</h3>
                    <p className="text-[#d6b485] font-bold text-[10px] uppercase tracking-widest mt-1 bg-[#291c14] border border-[#784627] px-4 py-1 rounded-full shadow-inner">{getRankName(userProfile?.balance)}</p>
                  </div>
                  
                  <div className="flex flex-col gap-3 w-full mt-2">
                    <div className="flex justify-between items-center bg-[#291c14] p-3 border border-[#784627] rounded shadow-inner">
                      <span className="text-[#d6b485] flex items-center gap-1.5 text-xs"><Coins className="w-3.5 h-3.5 text-yellow-500" /> Ngân Lượng:</span>
                      <span className="font-bold text-[#f59e0b] text-sm text-right">
                        {userProfile?.balance ? userProfile.balance.toLocaleString('vi-VN') : 0} VNĐ
                      </span>
                    </div>
                    
                    <div className="flex flex-col gap-2 bg-[#291c14] p-3 border border-[#d97706] rounded shadow-inner relative overflow-hidden">
                      <div className="absolute top-0 right-0 bg-[#d97706] text-[#291c14] text-[7px] font-bold px-1.5 py-0.5 rounded-bl">ĐỘC QUYỀN</div>
                      <span className="text-[#d6b485] font-bold text-[10px] uppercase text-center border-b border-[#784627] pb-1">Mã Giới Thiệu:</span>
                      <div className="flex items-center gap-2 justify-center mt-1">
                        <code className="text-center bg-[#452b1b] border-2 border-dashed border-[#d97706] text-[#f59e0b] py-2 px-3 text-lg font-bold tracking-widest rounded flex-1">
                           {userProfile?.referralCode || 'CHỜ...'}
                        </code>
                        <button 
                           onClick={() => {
                             navigator.clipboard.writeText(userProfile?.referralCode || '');
                           }}
                           className="p-2.5 bg-[#f59e0b] text-[#291c14] rounded hover:bg-[#d97706] transition-all shrink-0">
                           <ScrollText className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-[9px] text-center text-[#d6b485] mt-1 italic opacity-60">
                        * Giới thiệu người mới nhận 50.000 VNĐ.
                      </p>
                    </div>

                    <button 
                      onClick={logout}
                      className="mt-4 group bg-[#291c14] hover:bg-red-950/20 text-red-500 font-extrabold py-3 border border-red-900/30 hover:border-red-500 rounded uppercase transition-all shadow-md flex items-center justify-center gap-3 text-[10px] tracking-wider active:scale-95">
                      <LogOut className="w-3.5 h-3.5" /> Rời Làng
                    </button>
                  </div>
                </div>
            </div>
          </div>
        )}

        {/* LOBBY / MAIN MENU / LOBBY_1V1 */}
        {menuState === 'lobby_1v1' && (
          <div className="flex flex-col items-center justify-center flex-1 h-full p-0.5 md:p-2.5 relative overflow-hidden">
            <div className="absolute inset-0 bg-[#452b1b]/30 mix-blend-overlay pointer-events-none"></div>
            
            <div className="w-full h-full md:max-w-5xl md:h-[88vh] border-4 border-double border-[#d97706] p-2 md:p-8 rounded bg-[#291c14] flex flex-col shadow-[0_0_30px_rgba(0,0,0,0.8)] z-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[#f59e0b] opacity-10 pointer-events-none"></div>
              
              <h2 className="text-xl md:text-3xl font-bold text-[#f59e0b] mb-1 md:mb-8 border-b-2 border-[#784627] pb-1 md:pb-4 font-display uppercase tracking-wider flex items-center justify-center gap-2 md:gap-3 shrink-0">
                Sân Đình Quyết Đấu
              </h2>

              <div className="flex-1 overflow-y-auto w-full no-scrollbar">
                <div className="flex flex-col lg:flex-row items-center justify-center gap-2 lg:gap-12 w-full pb-4">
                  
                  {/* Lập Lôi Đài */}
                  <div className="w-full max-w-[340px] md:max-w-sm min-h-[220px] md:min-h-[400px] flex flex-col justify-between bg-[#452b1b]/50 border border-[#784627] p-4 md:p-8 rounded relative shadow-md">
                    <div className="flex flex-col items-center text-center gap-1 md:gap-2">
                      <h2 className="text-lg md:text-2xl font-bold text-[#f59e0b] mt-1 md:mt-2 uppercase font-display tracking-tight leading-none">Khai Trống Lôi Đài</h2>
                      <p className="text-xs md:text-sm text-[#d6b485] leading-tight px-2">Tạo sảnh đọ sức và nhận Cáo Thị đưa cho bằng hữu.</p>
                      
                      <div className="w-full mt-2 flex flex-col items-center">
                        <label className="text-[#d6b485] text-[10px] md:text-xs uppercase font-bold mb-2">Chọn giá trị cược (VNĐ)</label>
                        <select 
                          value={betAmountInput}
                          onChange={(e) => setBetAmountInput(Number(e.target.value))}
                          className="w-full max-w-[200px] bg-[#291c14] border-2 border-[#784627] text-[#f59e0b] text-center py-2 rounded font-mono font-bold focus:outline-none focus:border-[#f59e0b] cursor-pointer appearance-none"
                          style={{ backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f59e0b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.7rem center', backgroundSize: '1em' }}
                        >
                          {[10000, 20000, 30000, 40000, 50000].map((val) => (
                            <option key={val} value={val} className="bg-[#291c14] text-[#f59e0b]">
                              {val.toLocaleString('vi-VN')} VNĐ
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 mt-4">
                      <button 
                        onClick={() => setShowNumberSelectParams({ action: 'create1v1' })}
                        className="w-full bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] font-extrabold py-3 md:py-4 rounded transition-all border-b-4 border-[#78350f] active:border-b-0 active:translate-y-0.5 uppercase tracking-wider text-xs md:text-base shrink-0 active:scale-95">
                        Đánh Trống Mở Sảnh
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-2 w-full max-w-[240px] lg:h-40 lg:flex-col lg:w-auto">
                    <div className="flex-1 h-px lg:w-px bg-[#784627]"></div>
                    <div className="text-[#d6b485] font-bold italic text-[9px] md:text-xs bg-[#291c14] px-3 py-1 rounded-full border border-[#784627] uppercase shrink-0">HAY</div>
                    <div className="flex-1 h-px lg:w-px bg-[#784627]"></div>
                  </div>

                  {/* Lên Lôi Đài */}
                  <div className="w-full max-w-[340px] md:max-w-sm min-h-[220px] md:min-h-[400px] flex flex-col justify-between bg-[#452b1b]/50 border border-[#784627] p-4 md:p-8 rounded relative shadow-md">
                    <div className="flex flex-col items-center text-center gap-1 md:gap-2">
                      <h2 className="text-lg md:text-2xl font-bold text-[#b45309] mt-1 md:mt-2 uppercase font-display tracking-tight leading-none">So Khế Tước</h2>
                      <p className="text-xs md:text-sm text-[#d6b485] leading-tight px-2">Nhập 6 con số Cáo Thị từ lôi đài của tri kỷ bạn.</p>
                      <div className="text-[#ef4444] font-bold text-[10px] md:text-xs mt-2 italic opacity-50">Tài khoản cần có đủ ngân lượng</div>
                    </div>
                    <div className="flex flex-col gap-2 mt-4">
                      <input 
                        type="text" 
                        placeholder="MÃ CÁO THỊ"
                        value={gameInput}
                        onChange={e => setGameInput(e.target.value.replace(/\D/g, ''))}
                        maxLength={6}
                        className="w-full bg-[#291c14] border border-[#784627] focus:border-[#b45309] text-[#fef3c7] font-mono text-center py-2.5 md:py-4 rounded uppercase text-sm md:text-2xl focus:outline-none placeholder:text-[#d6b485]/30 shadow-inner"
                      />
                      <button 
                        onClick={join1v1Game}
                        className="w-full bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] font-extrabold py-3 md:py-4 rounded transition-all border-b-4 border-[#78350f] active:border-b-0 active:translate-y-0.5 uppercase tracking-wider text-xs md:text-base shrink-0 active:scale-95">
                        Bước Lên Lôi Đài
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        )}

        {menuState === 'in_game' && (
          (!gameState || isInitializingGame) ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#291c14] gap-6 p-10 text-center">
              <div className="relative">
                <Spinner />
                <div className="absolute inset-0 animate-ping border-4 border-[#f59e0b] rounded-full opacity-20"></div>
              </div>
              <div className="space-y-4">
                <p className="text-[#f59e0b] font-bold animate-pulse uppercase tracking-[0.2em] text-sm md:text-lg font-display">Đang thỉnh bản đồ cuộc thi...</p>
                <p className="text-[#d6b485] text-xs max-w-xs italic opacity-60">"Cố sự cổ xưa kể rằng, người tìm thấy mộc bản đầu tiên sẽ nhận được phước lành từ các bậc tiên hiền."</p>
              </div>
              <button 
                onClick={leaveGame}
                className="mt-8 px-8 py-3 bg-[#452b1b] border-2 border-[#784627] text-[#d6b485] hover:text-[#fef3c7] hover:border-[#f59e0b] rounded uppercase text-xs font-black tracking-widest transition-all shadow-lg active:scale-95">
                Hủy bỏ (Về Sân Đình)
              </button>
            </div>
          ) : (
            <div className="flex flex-col h-full w-full max-w-7xl mx-auto overflow-hidden bg-[#291c14]/50">
            {/* 1. Header: Info & Timer */}
            <div className="shrink-0 bg-[#291c14] border-b-2 border-[#784627] p-2 md:p-3 flex items-center justify-between shadow-lg z-20">
              <div className="flex items-center gap-2 md:gap-4 font-display">
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-[#452b1b] border border-[#d97706]/30 rounded">
                  <ScrollText className="w-4 h-4 text-[#f59e0b]" />
                  <span className="text-[10px] md:text-xs text-[#d6b485] font-bold uppercase tracking-widest">{gameState.mode === 'single' ? 'Độc Đấu' : gameState.mode === 'bot' ? 'Thách Đấu' : 'Tỷ Võ'}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-[#452b1b] border border-[#d97706]/30 rounded">
                  <Timer className="w-4 h-4 text-[#f59e0b]" />
                  <span className="text-sm md:text-xl font-mono font-black text-[#f59e0b] tracking-tighter tabular-nums">
                    {gameState.status === 'playing' ? (gameState.mode === 'single' ? stopwatch.toFixed(1) : timeLeft) : '0.0'}s
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1 bg-[#291c14] border border-[#784627] rounded shadow-inner">
                  <Coins className="w-4 h-4 text-yellow-500" />
                  <span className="text-xs md:text-sm font-bold text-[#fef3c7]">{(gameState.betAmount || 0).toLocaleString('vi-VN')}</span>
                </div>
                {gameState.status === 'playing' && (
                  <button 
                    onClick={() => setShowSurrenderConfirm(true)}
                    className="p-1.5 md:px-3 md:py-1 bg-white hover:bg-gray-200 border border-white text-black rounded text-[10px] md:text-xs font-bold uppercase transition-all flex items-center gap-2 shadow-sm active:scale-95">
                    <Flag className="w-3 h-3 md:w-4 md:h-4 text-black" />
                    <span className="hidden md:inline">Xin Thua</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
              {/* 2. Left Sidebar (Desktop) / Top Section (Mobile): Players Stats */}
              {(gameState.status === 'playing' || gameState.status === 'waiting') && (
                <div className="w-full md:w-72 lg:w-80 shrink-0 bg-[#291c14]/80 md:border-r-2 border-[#784627] flex flex-row md:flex-col p-2 md:p-4 gap-2 md:gap-4 overflow-x-auto md:overflow-y-auto no-scrollbar z-10 shadow-2xl">
                  {/* Player 1 Card */}
                  <div className="flex-1 min-w-[150px] md:min-w-0 bg-[#452b1b] rounded-lg p-2 md:p-4 border-l-4 border-l-[#f59e0b] shadow-lg flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <UserIcon className="w-20 h-20 text-[#f59e0b]" />
                    </div>
                    
                    <div className="flex items-start gap-2 mb-2 relative z-10">
                      <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-[#291c14] border-2 border-[#f59e0b] flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
                         <UserIcon className="w-5 h-5 md:w-7 md:h-7 text-[#f59e0b]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col">
                          <span className="font-black text-[10px] md:text-sm text-[#fef3c7] uppercase truncate leading-tight">{gameState.player1_name}</span>
                          <span className="text-[7px] md:text-[9px] text-[#d6b485] font-bold uppercase tracking-tighter opacity-70">Sĩ tử đương triều</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1 relative z-10">
                      <div className="flex justify-between items-end mb-1">
                        <span className="text-[8px] md:text-[10px] text-[#d6b485] font-bold uppercase">Tiến độ mộc bản</span>
                        <span className="text-[#f59e0b] font-black text-xs md:text-xl italic">#{Math.max(gameState.current_number1, localCurrent1)}</span>
                      </div>
                      <div className="h-2 md:h-4 bg-[#291c14] rounded-full overflow-hidden border border-[#784627] p-0.5">
                        <div className="h-full transition-all duration-300 bg-gradient-to-r from-[#b45309] to-[#f59e0b] rounded-full shadow-[0_0_8px_rgba(245,158,11,0.5)]" 
                            style={{ width: `${Math.min(100, ((Math.max(gameState.current_number1, localCurrent1) - 1) / gameState.max_number) * 100)}%` }}>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Player 2 Card (if applicable) */}
                  {gameState.mode !== 'single' && (
                    <div className="flex-1 min-w-[150px] md:min-w-0 bg-[#452b1b] rounded-lg p-2 md:p-4 border-l-4 border-l-[#b45309] shadow-lg flex flex-col justify-between relative overflow-hidden group">
                      <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
                        {gameState.mode === 'bot' ? <Bot className="w-20 h-20 text-[#b45309]" /> : <Users className="w-20 h-20 text-[#b45309]" />}
                      </div>
                      
                      <div className="flex items-start gap-2 mb-2 relative z-10">
                        <div className="w-8 h-8 md:w-12 md:h-12 rounded-full bg-[#291c14] border-2 border-[#b45309] flex items-center justify-center shrink-0 shadow-inner overflow-hidden">
                           {gameState.mode === 'bot' ? <Bot className="w-5 h-5 md:w-7 md:h-7 text-[#b45309]" /> : <Users className="w-5 h-5 md:w-7 md:h-7 text-[#b45309]" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col">
                            <span className="font-extrabold text-[10px] md:text-sm text-[#fef3c7] uppercase truncate leading-tight">{gameState.player2_name || (gameState.mode === 'bot' ? 'Trưởng Làng' : 'Chờ đối thủ...')}</span>
                            <span className="text-[7px] md:text-[9px] text-[#d6b485] font-bold uppercase tracking-tighter opacity-70">Kẻ thách thức</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1 relative z-10">
                        <div className="flex justify-between items-end mb-1">
                          <span className="text-[8px] md:text-[10px] text-[#d6b485] font-bold uppercase">Tiến độ mộc bản</span>
                          <span className="text-[#b45309] font-black text-xs md:text-xl italic">#{Math.max(gameState.current_number2, localCurrent2)}</span>
                        </div>
                        <div className="h-2 md:h-4 bg-[#291c14] rounded-full overflow-hidden border border-[#784627] p-0.5">
                          <div className="h-full transition-all duration-300 bg-gradient-to-r from-[#7c2d12] to-[#b45309] rounded-full shadow-[0_0_8px_rgba(180,83,9,0.3)]" 
                              style={{ width: `${Math.min(100, ((Math.max(gameState.current_number2, localCurrent2) - 1) / gameState.max_number) * 100)}%` }}>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Desktop Quick Chat (Only on Sidebar) */}
                  <div className="hidden md:flex flex-col mt-auto gap-2">
                     <div className="text-[10px] text-[#d6b485] font-bold uppercase tracking-widest pl-1">Truyền ngôn bộc bạch:</div>
                     <div className="grid grid-cols-2 lg:grid-cols-3 gap-1">
                        {['🤣', '😭', '😡', 'Lẹ lên!', 'Chịu thua đi!', 'Quá đỉnh!', '🔥'].map(msg => (
                          <button
                            key={msg}
                            onClick={() => sendQuickChat(msg)}
                            className="bg-[#291c14] hover:bg-[#5c3a21] border border-[#784627] text-[#fef3c7] py-1.5 rounded transition-all active:scale-95 text-xs">
                            {msg}
                          </button>
                        ))}
                     </div>
                  </div>
                </div>
              )}

              {/* 3. Center: Main Game Board Stage */}
              <div className="flex-1 flex flex-col p-2 md:p-6 overflow-hidden relative">
                
                {/* Board Layout */}
                {gameState.status === 'waiting' && (
                  <div className="flex-1 flex flex-col items-center justify-center border-4 border-double border-[#d97706] bg-[#452b1b] text-center p-4 sm:p-8 gap-4 sm:gap-6 shadow-[inset_0_0_50px_rgba(0,0,0,0.8)] relative rounded-xl animate-in zoom-in-95 duration-500">
                    <button 
                      onClick={leaveGame}
                      className="absolute top-4 left-4 p-2 sm:p-3 text-[#d6b485] hover:text-[#fef3c7] hover:bg-[#5c3a21] border border-[#784627] flex gap-2 rounded transition-all">
                      <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5"/> <span>Thoái lui</span>
                    </button>
                    <Spinner />
                    <h3 className="text-xl sm:text-3xl font-extrabold text-[#f59e0b] uppercase font-display">Sân Làng Đang Bày Biện</h3>
                    <p className="text-[#d6b485] text-xs sm:text-lg">Hãy giao Cáo Thị truyền tin này cho bằng hữu tới đấu:</p>
                    <div className="bg-[#291c14] border-2 border-[#784627] px-6 sm:px-10 py-4 sm:py-6 text-3xl sm:text-5xl font-mono text-[#f59e0b] select-all cursor-pointer font-extrabold tracking-[0.2em] sm:tracking-[0.5em] shadow-inner rounded-lg relative overflow-hidden hover:scale-105 transition-transform">
                       <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/aged-paper.png')] opacity-10"></div>
                      {gameState.id}
                    </div>
                  </div>
                )}

                {gameState.status === 'finished' && (
                  <div className="flex-1 flex flex-col items-center justify-center border-4 border-double border-[#d97706] bg-[#452b1b] text-center p-4 sm:p-8 gap-4 sm:gap-6 shadow-2xl relative rounded-xl animate-in zoom-in-95 duration-700">
                     <div className="absolute inset-0 bg-[#000]/20 pointer-events-none"></div>
                     <Trophy className="w-16 h-16 sm:w-24 sm:h-24 text-[#f59e0b] mb-2 sm:mb-4 drop-shadow-[0_0_20px_rgba(245,158,11,0.9)] animate-bounce" />
                     <h2 className="text-3xl sm:text-5xl lg:text-7xl font-black text-[#f59e0b] uppercase font-display italic tracking-tight" style={{ textShadow: '4px 4px 0px #78350f' }}>
                       {gameState.mode !== 'single' ? "Bảng Vàng Khắc Tên!" : "Trùm Làng!"}
                     </h2>
                     
                     <div className="text-center mt-2 sm:mt-4 p-6 bg-[#291c14]/50 border-y-2 border-[#d97706]/40 w-full max-w-md">
                        {gameState.winner === user?.uid ? (
                          <div className="space-y-4">
                            <p className="text-lg sm:text-xl text-[#d6b485] font-bold">Lão gia đã xuất sắc hạ gục đối thủ!</p>
                            <p className="font-black text-[#fef3c7] text-2xl sm:text-4xl uppercase bg-[#291c14] border-2 border-[#f59e0b] px-6 py-4 rounded-lg shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                              {userProfile?.username || user?.displayName || 'Trạng Nguyên'}
                            </p>
                          </div>
                        ) : gameState.winner === null && gameState.mode === 'single' ? (
                          <div className="space-y-4">
                            <p className="text-lg sm:text-xl text-[#d6b485] font-bold">Thời gian phá án kỳ tích:</p>
                            <p className="font-black text-[#f59e0b] text-4xl sm:text-6xl font-mono underline decoration-[#784627]">
                              {stopwatch.toFixed(1)}s
                            </p>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-4">
                            <p className="text-xl sm:text-3xl text-[#ef4444] font-black uppercase italic tracking-tighter">
                              "Lời thách đấu thất bại!"
                            </p>
                            <div className="h-0.5 w-20 bg-[#784627]"></div>
                            <p className="text-[#d6b485] text-sm uppercase font-bold">
                              Tiền bối chiến thắng: <span className="text-[#fef3c7]">{gameState.winner === gameState.player1 ? gameState.player1_name : (gameState.mode === 'bot' ? 'Trưởng Làng' : gameState.player2_name)}</span>
                            </p>
                          </div>
                        )}
                     </div>

                     <button 
                      onClick={leaveGame}
                      className="mt-6 sm:mt-10 bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] font-black py-4 px-10 text-xl sm:text-2xl shadow-[0_6px_0_#78350f] border-2 border-[#f59e0b] rounded-lg uppercase transition-all hover:-translate-y-1 active:translate-y-1 active:shadow-none animate-pulse">
                      Xác Nhận & Quay Về
                     </button>
                  </div>
                )}

                {gameState.status === 'playing' && (
                   <div className="flex-1 flex flex-col gap-2 overflow-hidden items-center justify-center">
                     
                     {/* Mobile Only: Shuffle Warning */}
                     <div className="sm:hidden w-full bg-[#ef4444]/20 border border-[#ef4444]/40 py-1 rounded flex items-center justify-center gap-2">
                        <Clock className="w-3 h-3 text-[#ef4444]" />
                        <span className="text-[8px] font-bold text-[#ef4444] uppercase">Khắc đổi bàn: {Math.max(5, 20 - (gameState.level - 1))}s</span>
                     </div>

                     {/* The Game Grid */}
                     <div className="flex-1 w-full max-w-[min(100%,80vh)] aspect-square bg-[#291c14] border-4 border-[#784627] shadow-[inset_0_0_60px_rgba(0,0,0,0.8)] rounded-xl relative p-1 md:p-3 overflow-hidden group">
                        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-10 pointer-events-none"></div>
                        
                        <div 
                          className="grid w-full h-full gap-1 md:gap-2 p-1" 
                          style={{ gridTemplateColumns: `repeat(${Math.max(5, Math.ceil(Math.sqrt(gameState.max_number)))}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(5, Math.ceil(Math.sqrt(gameState.max_number)))}, minmax(0, 1fr))` }}>
                            {(user?.uid === gameState.player1 ? gameState.grid1 : gameState.grid2).map((item) => {
                              if (item.value < 0) return <div key={`empty-${item.value}`} />;

                              const currentFound = user?.uid === gameState.player1 
                                ? [...gameState.found_numbers1, ...localFound1].filter((v, i, a) => a.indexOf(v) === i)
                                : [...gameState.found_numbers2, ...localFound2].filter((v, i, a) => a.indexOf(v) === i);
                              const isFound = currentFound.includes(item.value);
                              return (
                                <button
                                  key={item.value}
                                  onClick={() => handleNumberClick(item.value)}
                                  disabled={isFound || gameState.is_paused}
                                  className={`
                                    relative overflow-hidden w-full h-full flex items-center justify-center transition-all duration-75 select-none font-black rounded-lg text-xs md:text-2xl lg:text-3xl border-2
                                    ${isFound 
                                      ? 'bg-green-700 border-green-800 text-[#fef3c7] shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)] cursor-not-allowed z-0 scale-[0.98] drop-shadow-sm' 
                                      : item.value === hintValue
                                        ? 'bg-yellow-400 text-black border-white animate-pulse z-20 shadow-[0_0_30px_#facc15] scale-105'
                                        : 'bg-[#452b1b] hover:bg-[#5c3a21] text-[#fef3c7] border-[#d97706]/30 shadow-[0_4px_0_#1a0f08] hover:translate-y-[1px] active:translate-y-[3px] active:shadow-none'}
                                    ${gameState.is_paused && !isFound ? 'opacity-20 pointer-events-none blur-[2px]' : ''}
                                  `}
                                >
                                  <span style={{ textShadow: isFound ? 'none' : '2px 2px 4px rgba(0,0,0,0.7)' }}>{item.value}</span>
                                </button>
                              );
                            })}
                        </div>
                     </div>

                     {/* Action Controls Section (Bottom) */}
                     <div className="w-full max-w-lg shrink-0 flex items-center justify-between gap-2 mt-2 md:mt-4">
                        
                        {/* Pause Button (Host or Single only) */}
                        {(user?.uid === gameState.player1 || gameState.mode === 'single') && (
                          <button 
                             onClick={togglePause}
                             className="flex-[1.5] flex flex-col items-center justify-center p-2 bg-[#291c14] border-2 border-slate-500 rounded-lg shadow-lg group active:scale-95 transition-all text-slate-300 hover:bg-[#452b1b]">
                             <div className="flex items-center gap-2">
                               {gameState.is_paused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                             </div>
                             <span className="text-[8px] font-black uppercase tracking-tighter mt-1">{gameState.is_paused ? 'Tiếp Tục' : 'Tạm Dừng'}</span>
                          </button>
                        )}

                        {/* Hint Button */}
                        <button 
                           onClick={useHint}
                           className="flex-1 flex flex-col items-center justify-center p-2 bg-[#291c14] border-2 border-[#f59e0b] rounded-lg shadow-lg group active:scale-95 transition-all text-[#f59e0b] hover:bg-[#452b1b]">
                           <div className="flex items-center gap-2">
                             <Gem className="w-5 h-5 animate-pulse" />
                             <span className="font-black text-xl">
                               {3 - (gameState.player1 === user?.uid ? gameState.hints_used1 : gameState.hints_used2)}
                             </span>
                           </div>
                           <span className="text-[8px] font-black uppercase tracking-tighter mt-1">Trợ Giúp</span>
                        </button>

                        {/* Mobile: Quick Chat Toggle */}
                        <div className="flex-1 md:hidden relative">
                           <button 
                              onClick={() => setShowQuickChat(!showQuickChat)}
                              className="w-full flex flex-col items-center justify-center p-2 bg-[#291c14] border-2 border-[#3b82f6] rounded-lg shadow-lg active:scale-95 transition-all text-[#3b82f6] hover:bg-[#452b1b]">
                              <MessageCircle className="w-5 h-5" />
                              <span className="text-[8px] font-black uppercase tracking-tighter mt-1">Tán Gẫu</span>
                           </button>
                           {showQuickChat && (
                            <div className="absolute bottom-full mb-2 left-0 right-0 z-50 bg-[#291c14] border-2 border-[#3b82f6] p-2 rounded-lg grid grid-cols-3 gap-1 shadow-2xl">
                               {['🤣', '😭', '😡', 'Lẹ lên!', 'Win!', 'Đợi tí!'].map(msg => (
                                 <button
                                   key={msg}
                                   onClick={() => { sendQuickChat(msg); setShowQuickChat(false); }}
                                   className="bg-[#452b1b] py-2 text-xs rounded active:bg-blue-600 transition-colors">
                                   {msg}
                                 </button>
                               ))}
                            </div>
                           )}
                        </div>

                        {/* Shuffle Warning (Desktop Sidebar integration or mini display) */}
                        <div className="hidden sm:flex flex-[2] bg-[#452b1b] border border-[#ef4444]/30 rounded-lg p-2 items-center gap-3 shadow-inner">
                           <div className="w-8 h-8 rounded-full bg-red-950/50 flex items-center justify-center">
                              <Sparkles className="w-4 h-4 text-[#ef4444] animate-spin-slow" />
                           </div>
                           <div className="flex-1">
                              <div className="text-[8px] font-black text-[#ef4444] uppercase tracking-widest leading-none">Cảnh báo hoán đổi</div>
                              <div className="text-[10px] text-[#d6b485] font-bold mt-0.5 italic leading-none whitespace-nowrap">Bàn cờ thay đổi sau {Math.max(5, 20 - (gameState.level - 1))} khắc</div>
                           </div>
                        </div>

                     </div>
                   </div>
                )}
              </div>

              {/* 4. Right Sidebar (Desktop only) - Leaderboard or Chat History snippet */}
              <div className="hidden lg:flex w-64 lg:w-72 shrink-0 bg-[#291c14]/50 border-l-2 border-[#784627] flex-col p-4 z-10 overflow-hidden">
                <div className="flex flex-col h-full">
                  <div className="text-xs text-[#f59e0b] font-black uppercase tracking-widest mb-4 flex items-center gap-2 border-b-2 border-[#784627] pb-2">
                    <History className="w-4 h-4" /> Bức Họa Đối Thoại
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-2 no-scrollbar">
                    {(gameState.recentChats || []).map((chat, idx) => (
                      <div key={`${chat.timestamp}-${idx}`} className="animate-in slide-in-from-right-4 duration-300">
                        <div className={`p-2 rounded-lg text-xs leading-none flex gap-2 items-center ${chat.uid === user.uid ? 'bg-blue-900/20 border border-blue-800/30 ml-4' : 'bg-[#452b1b] border border-[#784627]/50 mr-4'}`}>
                           <span className="font-bold text-[#f59e0b] whitespace-nowrap uppercase text-[8px]">{chat.uid === user.uid ? 'Ngài' : 'Đối Thủ'}:</span>
                           <span className="text-[#fef3c7] italic">{chat.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 bg-[#452b1b] border border-[#d97706]/20 rounded-lg text-center shadow-inner">
                    <p className="text-[9px] text-[#d6b485] font-bold italic">"Trí tuệ làng xã, công bằng chính trực"</p>
                  </div>
                </div>
              </div>

            </div>
          </div>
      )
    )}

        {/* Modals & Overlays */}
        <VideoAdModal 
          isOpen={showAdModal} 
          onClose={() => setShowAdModal(false)} 
          onReward={handleAdReward} 
        />

        <InvitationOverlay 
          invitations={invitations}
          onAccept={(inv) => joinInvitedGame(inv.roomId, inv.id)}
          onDecline={declineInvitation}
        />

        <NumberSelectionModal 
          isOpen={showNumberSelectParams !== null}
          onClose={() => setShowNumberSelectParams(null)}
          onConfirm={handleConfirmNumber}
          action={showNumberSelectParams?.action || null}
          userProfile={userProfile}
        />

        {/* Surrender Confirmation Modal */}
        {showSurrenderConfirm && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100] backdrop-blur-sm animate-in fade-in">
            <div className="bg-[#291c14] border-4 border-[#784627] p-6 max-w-sm w-full rounded shadow-[0_0_40px_rgba(0,0,0,0.9)] flex flex-col items-center text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/wood-pattern.png')] opacity-10 pointer-events-none"></div>
              <Flag className="w-12 h-12 text-white mb-4 animate-pulse relative z-10" />
              <h2 className="text-xl md:text-2xl font-black text-[#fef3c7] uppercase mb-2 relative z-10 font-display">Xác Nhận Xin Thua</h2>
              <p className="text-[#d6b485] mb-6 font-bold text-sm md:text-base relative z-10">
                Ngài có chắc chắn muốn giương cờ trắng đầu hàng?
                <br/>
                <span className="text-[#ef4444] block mt-1">
                  (Sẽ bị tịch thu {(gameState?.betAmount || 0).toLocaleString('vi-VN')} VNĐ ngân lượng)
                </span>
              </p>
              
              <div className="flex gap-4 w-full relative z-10">
                <button 
                  onClick={() => setShowSurrenderConfirm(false)}
                  className="flex-1 bg-[#452b1b] border-2 border-[#784627] text-[#d6b485] hover:text-[#fef3c7] py-2 rounded font-bold uppercase transition-all shadow-md active:scale-95"
                >
                  Rút Lại
                </button>
                <button 
                  onClick={confirmSurrender}
                  className="flex-1 bg-white hover:bg-gray-200 border-2 border-white text-black py-2 rounded font-black uppercase transition-all shadow-md active:scale-95"
                >
                  Xác Nhận
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation for Mobile */}
      {!(gameState?.status === 'playing') && (
        <nav className="md:hidden h-[60px] border-t-2 border-[#784627] bg-[#291c14] flex items-center justify-around z-30 shrink-0 shadow-[0_-5px_15px_rgba(0,0,0,0.5)]">
           <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
               style={{ 
                 backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h20L10 10zm10 10L20 20H0z' fill='%23f59e0b' fill-opacity='1' fill-rule='evenodd'/%3E%3C/svg%3E")` 
               }}>
          </div>
          {[
            { label: 'Nhà tôi', state: 'home', icon: Home },
            { label: 'Sân đình', state: 'main', icon: Swords },
            { label: 'Bảng vàng', state: 'leaderboard', icon: Trophy },
            { label: 'Hảo hữu', state: 'friends', icon: Users },
            { label: 'Hồ sơ', state: 'account', icon: UserCircle },
          ].map((item) => (
            <button 
              key={item.state}
              onClick={() => {
                setMenuState(item.state as any);
                if (item.state === 'home') setMainTab('welcome');
                if (item.state === 'main') setMainTab('learning');
              }}
              className={`flex flex-col items-center justify-center flex-1 h-full py-1 gap-1 transition-all relative z-10 ${menuState === item.state ? 'text-[#f59e0b]' : 'text-[#d6b485]'}`}>
              <item.icon className={`w-5 h-5 ${menuState === item.state ? 'animate-bounce-short' : ''}`} />
              <span className="text-[9px] uppercase font-bold tracking-tighter">{item.label}</span>
              {menuState === item.state && <div className="absolute bottom-0 w-8 h-0.5 bg-[#f59e0b] rounded-full shadow-[0_0_10px_#f59e0b]"></div>}
            </button>
          ))}
        </nav>
      )}

      {/* Desktop Sidebar / Navigation */}
      {!(gameState?.status === 'playing') && (
        <div className="hidden md:flex fixed top-[60px] left-0 bottom-0 w-[80px] bg-[#291c14] border-r-2 border-[#784627] flex-col items-center py-8 gap-8 z-20 shadow-2xl">
          <div className="absolute inset-0 bg-[#f59e0b] opacity-5 pointer-events-none"></div>
          {[
            { label: 'Nhà Tôi', state: 'home', icon: Home },
            { label: 'Sân Đình', state: 'main', icon: Swords },
            { label: 'Bảng Vàng', state: 'leaderboard', icon: Trophy },
            { label: 'Hảo Hữu', state: 'friends', icon: Users },
            { label: 'Hồ Sơ', state: 'account', icon: UserCircle },
          ].map((item) => (
            <button 
              key={item.state}
              onClick={() => {
                setMenuState(item.state as any);
                if (item.state === 'home') setMainTab('welcome');
                if (item.state === 'main') setMainTab('learning');
              }}
              className={`group flex flex-col items-center gap-2 transition-all relative ${menuState === item.state ? 'text-[#f59e0b]' : 'text-[#d6b485] hover:text-[#fef3c7]'}`}
              title={item.label}>
              <div className={`p-2.5 rounded-xl transition-all shadow-lg ${menuState === item.state ? 'bg-[#452b1b] ring-2 ring-[#f59e0b] scale-110' : 'bg-[#452b1b]/50 group-hover:bg-[#5c3a21] group-hover:scale-105'}`}>
                <item.icon className="w-6 h-6" />
              </div>
              <span className="text-[9px] uppercase font-black text-center tracking-tight">{item.label}</span>
              {menuState === item.state && <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-[#f59e0b] rounded-r-full shadow-[0_0_15px_#f59e0b]"></div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NumberSelectionModal({ 
  isOpen, 
  onClose, 
  onConfirm,
  action,
  userProfile
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: (num: number) => void,
  action: 'single' | 'bot' | 'create1v1' | 'invite' | null,
  userProfile: UserProfile | null
}) {
  const [customNum, setCustomNum] = useState<string>('');
  
  if (!isOpen) return null;

  const currentLevel = userProfile?.currentLevel || 1;
  const nextTargetNum = Math.min(100, 40 + (currentLevel * 10));

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
      <div className="bg-[#452b1b] border-2 border-[#d97706] p-6 rounded-lg w-full max-w-sm flex flex-col gap-4 relative animate-in zoom-in-95 duration-200 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
        <button onClick={onClose} className="absolute top-2 right-2 text-[#d6b485] hover:text-[#fef3c7] transition-colors p-1">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-[#f59e0b] font-display text-xl md:text-2xl font-bold uppercase text-center border-b border-[#784627] pb-3 tracking-wider">Mộc Bản Mục Tiêu</h2>
        <p className="text-[#d6b485] text-xs text-center -mt-2">Chọn số lượng mộc bản để tranh tài</p>
        <div className="flex flex-col gap-3 mt-2">
          {action === 'bot' ? (
            currentLevel >= 6 ? (
                <div className="text-center py-4 text-[#f59e0b] font-bold">Bạn đã là người đạt cấp độ tối đa</div>
            ) : (
                <button 
                    onClick={() => onConfirm(nextTargetNum)} 
                    className="w-full py-4 bg-[#291c14] hover:bg-[#5c3a21] border border-[#784627] hover:border-[#f59e0b] text-[#fef3c7] font-bold rounded flex items-center justify-center gap-2 transition-all"
                >
                    <span className="text-xl">{nextTargetNum}</span> Số (Cấp {currentLevel})
                </button>
            )
          ) : (
            <>
              <button onClick={() => onConfirm(50)} className="w-full py-3 bg-[#291c14] hover:bg-[#5c3a21] border border-[#784627] hover:border-[#f59e0b] text-[#fef3c7] font-bold rounded flex items-center justify-center gap-2 transition-all">
                <span className="text-xl">50</span> Số
              </button>
              <button onClick={() => onConfirm(100)} className="w-full py-3 bg-[#291c14] hover:bg-[#5c3a21] border border-[#784627] hover:border-[#f59e0b] text-[#fef3c7] font-bold rounded flex items-center justify-center gap-2 transition-all">
                <span className="text-xl text-[#f59e0b]">100</span> Số (Chẩn)
              </button>
              <div className="relative mt-2 border-t border-[#784627] pt-4">
                <div className="flex items-center gap-2">
                  <input 
                    type="number" 
                    placeholder="Nhập số tùy chọn..." 
                    value={customNum}
                    onChange={(e) => setCustomNum(e.target.value)}
                    min="10"
                    max="999"
                    className="flex-1 bg-[#291c14] border border-[#784627] text-[#fef3c7] px-3 py-2.5 rounded focus:outline-none focus:border-[#f59e0b] text-center font-bold font-mono"
                  />
                  <button 
                    onClick={() => {
                      const num = parseInt(customNum);
                      if (num >= 5 && num <= 500) {
                        onConfirm(num);
                      } else {
                        alert('Xin ngài nhập số hợp lệ (Từ 5 đến 500)!');
                      }
                    }}
                    className="px-5 py-2.5 bg-[#b45309] hover:bg-[#d97706] text-[#fef3c7] font-bold rounded border border-[#92400e] transition-colors">
                    Giao Ước
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
