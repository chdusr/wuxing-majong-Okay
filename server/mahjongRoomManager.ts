import { Server as SocketIOServer, Socket } from 'socket.io';
import {
  MahjongTileData,
  Meld,
  MeldType,
  HuResult,
  AvailableClaim,
} from '../src/types/mahjong';
import {
  OnlinePlayer,
  RoomSettings,
  RoomStatus,
  MultiplayerGameState,
  ChatMessage,
  DiscardEventData,
  RoomListItem,
} from '../src/types/multiplayer';
import {
  createDeck,
  findEatOptions,
  findPungOptions,
  findKongOptions,
  checkThreeTilesKan,
  checkHu,
  sortHand,
  getBestAiDiscard,
} from '../src/utils/mahjongRules';

interface PendingClaimSubmission {
  seatIndex: number;
  claim: AvailableClaim | null; // null means passed
}

export class MahjongRoom {
  roomId: string;
  roomName: string;
  hostUserId: string;
  status: RoomStatus = 'waiting';
  settings: RoomSettings;
  createdAt: number = Date.now();
  lastActiveAt: number = Date.now();
  
  players: (OnlinePlayer | null)[] = [null, null, null, null];
  spectators: { socketId: string; userId: string; name: string }[] = [];

  deck: MahjongTileData[] = [];
  wallIndex: number = 0;
  currentTurn: number = 0; // 0, 1, 2, 3
  dealerIndex: number = 0;
  roundNumber: number = 1;
  diceRoll: [number, number] = [1, 1];

  lastDiscard: DiscardEventData | null = null;
  pendingClaimsMap: Map<number, AvailableClaim[]> = new Map(); // seatIndex -> available claims
  pendingSubmissions: Map<number, AvailableClaim | null> = new Map(); // seatIndex -> submitted action
  claimTimer: NodeJS.Timeout | null = null;
  turnTimer: NodeJS.Timeout | null = null;
  botTimer: NodeJS.Timeout | null = null;
  botClaimTimers: NodeJS.Timeout[] = [];

  turnDeadline: number = 0;
  claimDeadline: number = 0;

  winnerData: MultiplayerGameState['winnerData'] = null;
  chatMessages: ChatMessage[] = [];

  constructor(roomId: string, roomName: string, hostUserId: string, settings?: Partial<RoomSettings>) {
    this.roomId = roomId;
    this.roomName = roomName;
    this.hostUserId = hostUserId;
    this.settings = {
      turnTimeLimit: settings?.turnTimeLimit || 20,
      autoFillBots: settings?.autoFillBots ?? true,
      isPrivate: settings?.isPrivate ?? false,
      password: settings?.password || '',
      roundsCount: settings?.roundsCount || 1,
    };
  }

  get summary(): RoomListItem {
    const activeCount = this.players.filter(p => p !== null).length;
    const hostPlayer = this.players.find(p => p?.isHost);
    return {
      roomId: this.roomId,
      name: this.roomName,
      hostName: hostPlayer?.name || '房主',
      playerCount: activeCount,
      status: this.status,
      isPrivate: this.settings.isPrivate,
      settings: this.settings,
    };
  }

  // Get state customized for a specific player (hand hidden for opponents)
  getClientState(userId?: string): MultiplayerGameState {
    const maskedPlayers = this.players.map(p => {
      if (!p) return null;
      const isMe = Boolean(userId && p.userId === userId);
      return {
        ...p,
        hand: isMe || this.status === 'round_end' ? (p.hand ? [...p.hand] : []) : undefined,
        handCount: p.hand ? p.hand.length : 0,
        lastDrawnTile: isMe || this.status === 'round_end' ? p.lastDrawnTile : null,
      };
    });

    return {
      roomId: this.roomId,
      roomName: this.roomName,
      hostId: this.hostUserId,
      status: this.status,
      settings: this.settings,
      players: maskedPlayers,
      currentTurn: this.currentTurn,
      dealerIndex: this.dealerIndex,
      wallRemaining: Math.max(0, this.deck.length - this.wallIndex),
      lastDiscard: this.lastDiscard,
      turnDeadline: this.turnDeadline,
      claimWindowDeadline: this.claimDeadline,
      winnerData: this.winnerData,
      roundNumber: this.roundNumber,
      diceRoll: this.diceRoll,
    };
  }

  // Update socket ID for a player (handles reconnects and transport switches)
  updatePlayerSocket(userId: string, socketId: string): void {
    this.lastActiveAt = Date.now();
    const player = this.players.find(p => p && p.userId === userId);
    if (player) {
      player.id = socketId;
      player.isConnected = true;
    }
  }

  // Add a player into an open seat or reconnect
  addPlayer(socketId: string, userId: string, name: string, avatar: string): { success: boolean; seatIndex?: number; message?: string } {
    this.lastActiveAt = Date.now();
    // Check if user is already seated in this room
    const existingIndex = this.players.findIndex(p => p && p.userId === userId);
    if (existingIndex !== -1) {
      const p = this.players[existingIndex]!;
      p.id = socketId;
      p.isConnected = true;
      p.isBot = false; // Restore from bot custody if user returned
      p.name = name || p.name;
      p.avatar = avatar || p.avatar;
      return { success: true, seatIndex: existingIndex, message: '重新入座' };
    }

    // If game in progress, can only join as spectator
    if (this.status !== 'waiting') {
      this.spectators.push({ socketId, userId, name });
      return { success: true, message: '对局进行中，已进入观战席' };
    }

    // Find first empty seat or replace an AI bot in waiting mode
    let targetIndex = this.players.findIndex(p => p === null);
    if (targetIndex === -1 && this.status === 'waiting') {
      targetIndex = this.players.findIndex(p => p !== null && p.isBot);
    }

    if (targetIndex === -1) {
      this.spectators.push({ socketId, userId, name });
      return { success: false, message: '房间座位已满，已转为观战' };
    }

    const isFirst = this.players.every(p => p === null);
    const isHost = isFirst || this.hostUserId === userId;
    if (isFirst) {
      this.hostUserId = userId;
    }

    this.players[targetIndex] = {
      id: socketId,
      userId,
      name: name || `牌友_${userId.slice(0, 4)}`,
      avatar: avatar || '🀄',
      seatIndex: targetIndex,
      isHost,
      isReady: isHost, // Host is ready by default
      isBot: false,
      isConnected: true,
      score: 1000,
      handCount: 0,
      hand: [],
      melds: [],
      discards: [],
      lastDrawnTile: null,
    };

    return { success: true, seatIndex: targetIndex };
  }

  // Explicit player leave action
  removePlayer(userId: string, io?: SocketIOServer): boolean {
    this.lastActiveAt = Date.now();
    const playerIdx = this.players.findIndex(p => p?.userId === userId);
    if (playerIdx === -1) {
      this.spectators = this.spectators.filter(s => s.userId !== userId);
      return true;
    }

    const player = this.players[playerIdx]!;
    const wasHost = player.isHost;

    if (this.status === 'playing') {
      // In-game: convert to Bot so game flow continues smoothly
      player.isBot = true;
      player.isConnected = true;
      player.name = `${player.name.replace(/\(托管\)$/, '')}(托管)`;
      player.avatar = '🤖';

      if (io) {
        this.addSystemMessage(io, `牌友【${player.name}】离开牌桌，系统已启用 AI 智能替打托管。`);
        if (this.currentTurn === playerIdx) {
          this.scheduleBotTurn(io);
        }
        if (this.pendingClaimsMap.has(playerIdx)) {
          this.handleBotClaimDecision(io, playerIdx, this.pendingClaimsMap.get(playerIdx)!);
        }
      }

      // If all human players have left during play, safely end the round
      const hasAnyHuman = this.players.some(p => p !== null && !p.isBot);
      if (!hasAnyHuman && io) {
        this.addSystemMessage(io, `所有真人玩家已离开，牌局结束。`);
        this.triggerRoundEnd(io, null);
      }
    } else {
      this.players[playerIdx] = null;
    }

    if (wasHost) {
      const nextHuman = this.players.find(p => p !== null && !p.isBot);
      if (nextHuman) {
        nextHuman.isHost = true;
        this.hostUserId = nextHuman.userId;
        if (io) {
          this.addSystemMessage(io, `👑 【${nextHuman.name}】 已成为新房主！`);
        }
      } else {
        this.hostUserId = '';
      }
    }
    return true;
  }

  // Temporary socket disconnect
  handleDisconnect(socketId: string): void {
    this.lastActiveAt = Date.now();
    const player = this.players.find(p => p?.id === socketId);
    if (player) {
      player.isConnected = false;
    }
    this.spectators = this.spectators.filter(s => s.socketId !== socketId);
  }

  // Add an AI bot to a seat
  addBot(seatIndex?: number): boolean {
    if (this.status !== 'waiting') return false;

    // Determine target seat index
    let targetIndex = -1;
    if (typeof seatIndex === 'number' && seatIndex >= 0 && seatIndex <= 3 && this.players[seatIndex] === null) {
      targetIndex = seatIndex;
    } else {
      targetIndex = this.players.findIndex(p => p === null);
    }

    if (targetIndex === -1) return false;

    const BOT_POOL = [
      { name: '青龙·木仙', avatar: '🐉' },
      { name: '朱雀·火神', avatar: '🦅' },
      { name: '白虎·金尊', avatar: '🐅' },
      { name: '玄武·水圣', avatar: '🐢' },
      { name: '麒麟·土皇', avatar: '🦄' },
      { name: '太极·真君', avatar: '☯️' },
      { name: '天璇·道长', avatar: '🎋' },
      { name: '紫微·仙尊', avatar: '⚡' },
      { name: '离火·仙姑', avatar: '🔥' },
      { name: '坎水·真人', avatar: '🌊' },
    ];

    // Filter out names already taken in this room
    const existingNames = new Set(this.players.filter(p => p !== null).map(p => p!.name));
    const availableBots = BOT_POOL.filter(b => !existingNames.has(b.name));
    const chosenBot = availableBots.length > 0
      ? availableBots[Math.floor(Math.random() * availableBots.length)]
      : BOT_POOL[targetIndex % BOT_POOL.length];

    const uniqueId = `bot_${targetIndex}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    this.players[targetIndex] = {
      id: `sock_${uniqueId}`,
      userId: uniqueId,
      name: chosenBot.name,
      avatar: chosenBot.avatar,
      seatIndex: targetIndex,
      isHost: false,
      isReady: true,
      isBot: true,
      isConnected: true,
      score: 1000,
      handCount: 0,
      hand: [],
      melds: [],
      discards: [],
      lastDrawnTile: null,
    };
    return true;
  }

  // Fill all remaining empty seats with AI bots
  fillBots(): number {
    if (this.status !== 'waiting') return 0;
    let addedCount = 0;
    for (let i = 0; i < 4; i++) {
      if (this.players[i] === null) {
        if (this.addBot(i)) {
          addedCount++;
        }
      }
    }
    return addedCount;
  }

  // Remove a player / bot from seat (host action)
  kickSeat(seatIndex: number): boolean {
    if (this.status !== 'waiting') return false;
    if (seatIndex >= 0 && seatIndex <= 3) {
      this.players[seatIndex] = null;
      return true;
    }
    return false;
  }

  // Toggle ready status
  setReady(userId: string, isReady: boolean): boolean {
    const player = this.players.find(p => p?.userId === userId);
    if (!player) return false;
    player.isReady = isReady;
    return true;
  }

  // Start the game
  startGame(io: SocketIOServer): boolean {
    if (this.status === 'playing') return false;

    // Ensure all 4 seats are filled before starting so 4-wind Mahjong cycle is complete
    for (let i = 0; i < 4; i++) {
      if (this.players[i] === null) {
        this.addBot(i);
      }
    }

    const readyPlayers = this.players.filter(p => p !== null);
    if (readyPlayers.length < 4) return false;

    // Check that all human players are ready (or host)
    const humanUnready = this.players.some(p => p !== null && !p.isBot && !p.isHost && !p.isReady);
    if (humanUnready) return false;

    // Initialize Mahjong Deck & Deal
    this.deck = createDeck();
    this.wallIndex = 0;
    this.status = 'playing';
    this.winnerData = null;
    this.lastDiscard = null;
    this.pendingClaimsMap.clear();
    this.pendingSubmissions.clear();

    // Roll dice
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.diceRoll = [d1, d2];
    // Seat 0 (Host) starts as East / Dealer for Game 1
    this.dealerIndex = 0;
    this.currentTurn = this.dealerIndex;

    // Deal 13 tiles to everyone, 14 to dealer
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (p) {
        p.melds = [];
        p.discards = [];
        p.lastDrawnTile = null;

        const tileCount = i === this.dealerIndex ? 14 : 13;
        const dealt = this.deck.slice(this.wallIndex, this.wallIndex + tileCount);
        this.wallIndex += tileCount;
        p.hand = sortHand(dealt);
        p.handCount = p.hand.length;

        if (i === this.dealerIndex) {
          p.lastDrawnTile = dealt[dealt.length - 1];
        }
      }
    }

    this.broadcastState(io);
    this.addSystemMessage(io, `🎮 对局开始！东家庄位：【${this.players[this.dealerIndex]?.name}】，掷骰【${d1}+${d2}点】`);

    // Start turn for dealer
    this.scheduleTurnTimer(io);

    // If dealer is bot, schedule bot action
    const currentP = this.players[this.currentTurn];
    if (currentP && currentP.isBot) {
      this.scheduleBotTurn(io);
    }

    return true;
  }

  // Handle a player's discard
  playerDiscard(io: SocketIOServer, userId: string, tileId: string): boolean {
    if (this.status !== 'playing') return false;
    // Guard against discarding during active claim window
    if (this.pendingClaimsMap.size > 0) return false;

    const player = this.players[this.currentTurn];
    if (!player || player.userId !== userId) return false;
    if (!player.hand || player.hand.length === 0) return false;

    const tileIdx = player.hand.findIndex(t => t.id === tileId);
    if (tileIdx === -1) return false;

    const [discardedTile] = player.hand.splice(tileIdx, 1);
    player.discards.push(discardedTile);
    player.lastDrawnTile = null;
    player.handCount = player.hand.length;

    this.clearTurnTimer();
    this.clearBotClaimTimers();
    this.lastDiscard = {
      playerIndex: this.currentTurn,
      tile: discardedTile,
      timestamp: Date.now(),
    };

    this.addSystemMessage(io, `【${player.name}】 打出了 【${discardedTile.name}】(${discardedTile.elementName})`);

    // Check available claims for other active players
    this.checkClaimsForDiscard(io, discardedTile, this.currentTurn);
    return true;
  }

  // Check claims for all players on discarded tile
  private checkClaimsForDiscard(io: SocketIOServer, discardedTile: MahjongTileData, discarderIdx: number): void {
    this.clearBotClaimTimers();
    this.pendingClaimsMap.clear();
    this.pendingSubmissions.clear();

    const nextSeat = (discarderIdx + 1) % 4;

    for (let i = 0; i < 4; i++) {
      if (i === discarderIdx) continue;
      const player = this.players[i];
      if (!player || !player.hand || player.hand.length === 0) continue;

      const claims: AvailableClaim[] = [];

      // 1. Check Hu (捉炮胡)
      const testHand = [...player.hand, discardedTile];
      const huCheck = checkHu(testHand, player.melds, false, false);
      if (huCheck.isHu) {
        claims.push({
          type: 'hu',
          label: `捉炮胡牌 (${huCheck.fans}番 ${huCheck.explanation})`,
          tiles: [discardedTile],
          targetTile: discardedTile,
          priority: 100,
        });
      }

      // 2. Check Pung & Clash Pung
      const { normalPung, clashPung } = findPungOptions(player.hand, discardedTile);
      if (clashPung) {
        claims.push({
          type: 'clash_pung',
          label: `冲战碰 (${clashPung[0].name}${clashPung[1].name} 冲 ${discardedTile.name})`,
          tiles: clashPung,
          targetTile: discardedTile,
          priority: 80,
        });
      }
      if (normalPung) {
        claims.push({
          type: 'pung',
          label: `碰牌 (${normalPung[0].name}${normalPung[1].name}${discardedTile.name})`,
          tiles: normalPung,
          targetTile: discardedTile,
          priority: 50,
        });
      }

      // 3. Check Kong
      const kongOptions = findKongOptions(player.hand, discardedTile);
      if (kongOptions.length > 0) {
        claims.push({
          type: 'kong',
          label: `大明杠 (${discardedTile.name}*4)`,
          tiles: kongOptions[0],
          targetTile: discardedTile,
          priority: 60,
        });
      }

      // 4. Check Eat (Chow) - only for immediate next player (下家)
      if (i === nextSeat) {
        const eatOptions = findEatOptions(player.hand, discardedTile);
        eatOptions.forEach(opt => {
          claims.push({
            type: 'eat',
            label: `吃牌 · ${opt.kan.typeLabel} (${opt.kan.name})`,
            tiles: opt.tiles,
            targetTile: discardedTile,
            priority: 20,
          });
        });
      }

      if (claims.length > 0) {
        this.pendingClaimsMap.set(i, claims);
      }
    }

    if (this.pendingClaimsMap.size > 0) {
      // Open claim window (10 seconds)
      const claimDuration = 10000;
      this.claimDeadline = Date.now() + claimDuration;

      // Broadcast state with claim requests to relevant players
      this.broadcastState(io);

      // Trigger bot claim decisions automatically
      this.pendingClaimsMap.forEach((claims, seatIdx) => {
        const p = this.players[seatIdx];
        if (p && p.isBot) {
          this.handleBotClaimDecision(io, seatIdx, claims);
        }
      });

      // Start timer
      this.claimTimer = setTimeout(() => {
        this.resolvePendingClaims(io);
      }, claimDuration);
    } else {
      // No claims possible, advance turn to next player
      this.advanceToNextTurn(io, nextSeat);
    }
  }

  // Handle a player's claim action submission
  submitClaimAction(io: SocketIOServer, userId: string, claim: AvailableClaim | null): boolean {
    if (this.status !== 'playing') return false;
    const player = this.players.find(p => p?.userId === userId);
    if (!player) return false;

    const seatIdx = player.seatIndex;
    if (!this.pendingClaimsMap.has(seatIdx)) return false;

    this.pendingSubmissions.set(seatIdx, claim);

    // If all required players submitted their choices, resolve immediately
    if (this.pendingClaimsMap.size > 0 && this.pendingSubmissions.size >= this.pendingClaimsMap.size) {
      this.resolvePendingClaims(io);
    }
    return true;
  }

  // Bot claim decision logic
  private handleBotClaimDecision(io: SocketIOServer, seatIdx: number, claims: AvailableClaim[]): void {
    const timer = setTimeout(() => {
      // Guard against race conditions if round changed or claim resolved
      if (this.status !== 'playing' || !this.pendingClaimsMap.has(seatIdx)) return;

      // Bot prefers: Hu > Clash Pung > Kong > Pung > Eat (with 70% probability for eats)
      const hu = claims.find(c => c.type === 'hu');
      if (hu) {
        this.pendingSubmissions.set(seatIdx, hu);
      } else {
        const clash = claims.find(c => c.type === 'clash_pung');
        if (clash) {
          this.pendingSubmissions.set(seatIdx, clash);
        } else {
          const kong = claims.find(c => c.type === 'kong');
          if (kong) {
            this.pendingSubmissions.set(seatIdx, kong);
          } else {
            const pung = claims.find(c => c.type === 'pung');
            if (pung) {
              this.pendingSubmissions.set(seatIdx, pung);
            } else {
              const eat = claims.find(c => c.type === 'eat');
              if (eat && Math.random() > 0.3) {
                this.pendingSubmissions.set(seatIdx, eat);
              } else {
                this.pendingSubmissions.set(seatIdx, null); // Pass
              }
            }
          }
        }
      }

      if (this.pendingClaimsMap.size > 0 && this.pendingSubmissions.size >= this.pendingClaimsMap.size) {
        this.resolvePendingClaims(io);
      }
    }, 1200 + Math.random() * 800);

    this.botClaimTimers.push(timer);
  }

  // Resolve all collected claim choices by Mahjong priority
  private resolvePendingClaims(io: SocketIOServer): void {
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
    this.clearBotClaimTimers();
    this.claimDeadline = 0;

    let winningClaim: { seatIdx: number; claim: AvailableClaim } | null = null;

    // Filter valid positive claims
    const activeSubmissions: Array<{ seatIdx: number; claim: AvailableClaim }> = [];
    this.pendingSubmissions.forEach((claim, seatIdx) => {
      if (claim) {
        activeSubmissions.push({ seatIdx, claim });
      }
    });

    if (activeSubmissions.length > 0) {
      const discarderIdx = this.lastDiscard ? this.lastDiscard.playerIndex : 0;
      // Sort by priority descending; if priority ties (e.g. multiple Hu or Pung), sort by proximity to discarder (下家 > 对家 > 上家)
      activeSubmissions.sort((a, b) => {
        if (b.claim.priority !== a.claim.priority) {
          return b.claim.priority - a.claim.priority;
        }
        const distA = (a.seatIdx - discarderIdx + 4) % 4;
        const distB = (b.seatIdx - discarderIdx + 4) % 4;
        return distA - distB;
      });
      winningClaim = activeSubmissions[0];
    }

    this.pendingClaimsMap.clear();
    this.pendingSubmissions.clear();

    if (winningClaim) {
      this.executeClaim(io, winningClaim.seatIdx, winningClaim.claim);
    } else {
      // All passed, proceed to next player's draw
      const discarderIdx = this.lastDiscard ? this.lastDiscard.playerIndex : this.currentTurn;
      const nextSeat = (discarderIdx + 1) % 4;
      this.advanceToNextTurn(io, nextSeat);
    }
  }

  // Execute the winning claim (Eat/Pung/Clash/Kong/Hu)
  private executeClaim(io: SocketIOServer, claimantSeatIdx: number, claim: AvailableClaim): void {
    const claimant = this.players[claimantSeatIdx];
    if (!claimant || !this.lastDiscard) return;

    const discarderSeatIdx = this.lastDiscard.playerIndex;
    const discarder = this.players[discarderSeatIdx];
    const claimedTile = this.lastDiscard.tile;

    // Remove tile from discarder's discards
    if (discarder) {
      let discIdx = -1;
      for (let d = discarder.discards.length - 1; d >= 0; d--) {
        if (discarder.discards[d].id === claimedTile.id) {
          discIdx = d;
          break;
        }
      }
      if (discIdx !== -1) {
        discarder.discards.splice(discIdx, 1);
      }
    }

    if (claim.type === 'hu') {
      // Trigger Ron Hu
      const winningTiles = [...claimant.hand, claimedTile];
      const huResult = checkHu(winningTiles, claimant.melds, false, false);

      this.triggerRoundEnd(io, {
        winnerIndex: claimantSeatIdx,
        winnerName: claimant.name,
        isSelfDraw: false,
        discarderIndex: discarderSeatIdx,
        huResult,
        winningTiles,
      });
      return;
    }

    // Eat, Pung, Clash Pung, Kong
    // Remove matching tiles from claimant's hand with dual ID and Name fallback matching
    const usedTileIds = new Set(claim.tiles.map(t => t.id));
    let remainingHand = claimant.hand.filter(t => !usedTileIds.has(t.id));

    // Fallback matching by tile name if ID matching did not remove all claimed hand tiles
    const expectedHandLen = claimant.hand.length - claim.tiles.length;
    if (remainingHand.length !== expectedHandLen) {
      const namesToRemove = [...claim.tiles.map(t => t.name)];
      remainingHand = claimant.hand.filter(t => {
        const idx = namesToRemove.indexOf(t.name);
        if (idx !== -1) {
          namesToRemove.splice(idx, 1);
          return false;
        }
        return true;
      });
    }
    claimant.hand = remainingHand;

    const fullMeldTiles = [...claim.tiles, claimedTile];
    let meldType: MeldType = 'triplet';
    let typeLabel = '碰牌';
    if (claim.type === 'clash_pung') {
      meldType = 'clash_meld';
      typeLabel = '冲战碰';
    } else if (claim.type === 'kong') {
      meldType = 'kong';
      typeLabel = '大明杠';
    } else if (claim.type === 'eat') {
      const kanCheck = checkThreeTilesKan(fullMeldTiles.map(t => t.name));
      meldType = kanCheck?.type || 'stem_combine';
      typeLabel = kanCheck?.typeLabel || '吃牌';
    }

    const meld: Meld = {
      type: meldType,
      typeLabel: typeLabel || claim.label,
      tiles: fullMeldTiles,
      sourcePlayerIndex: discarderSeatIdx,
      claimedTile,
    };

    claimant.melds.push(meld);
    claimant.handCount = claimant.hand.length;

    this.addSystemMessage(io, `⚡【${claimant.name}】 执行了 【${claim.label}】！`);

    // Turn moves to claimant, they now need to discard (unless kong, then draw kong replacement)
    this.currentTurn = claimantSeatIdx;
    this.lastDiscard = null;

    if (claim.type === 'kong') {
      this.drawKongTile(io, claimantSeatIdx);
    } else {
      this.broadcastState(io);
      this.scheduleTurnTimer(io);
      if (claimant.isBot) {
        this.scheduleBotTurn(io);
      }
    }
  }

  // Draw tile for player whose turn it is
  private advanceToNextTurn(io: SocketIOServer, nextSeatIdx: number): void {
    // Check if wall is exhausted
    if (this.wallIndex >= this.deck.length) {
      this.triggerRoundEnd(io, null); // Huang Zhuang (荒庄/流局)
      return;
    }

    this.currentTurn = nextSeatIdx;
    const player = this.players[nextSeatIdx];
    if (!player) return;

    // Clear previous discard as the round proceeds with drawing
    this.lastDiscard = null;

    // Draw one tile from wall
    const drawnTile = this.deck[this.wallIndex++];
    player.hand.push(drawnTile);
    player.lastDrawnTile = drawnTile;
    player.handCount = player.hand.length;

    this.broadcastState(io);
    this.scheduleTurnTimer(io);

    if (player.isBot) {
      this.scheduleBotTurn(io);
    }
  }

  // Draw replacement tile for Kong
  private drawKongTile(io: SocketIOServer, seatIdx: number): void {
    if (this.wallIndex >= this.deck.length) {
      this.triggerRoundEnd(io, null);
      return;
    }

    const player = this.players[seatIdx];
    if (!player) return;

    this.lastDiscard = null;
    const drawnTile = this.deck[this.wallIndex++];
    player.hand.push(drawnTile);
    player.lastDrawnTile = drawnTile;
    player.handCount = player.hand.length;

    this.addSystemMessage(io, `🀄【${player.name}】 杠后补得一张牌！`);

    this.broadcastState(io);
    this.scheduleTurnTimer(io);

    if (player.isBot) {
      this.scheduleBotTurn(io);
    }
  }

  // Player Self Kong (Concealed Kong 暗杠 or Add-on Kong 加杠)
  playerSelfKong(io: SocketIOServer, userId: string, tileName: string): { success: boolean; error?: string } {
    if (this.status !== 'playing') return { success: false, error: '非对局中' };

    const player = this.players[this.currentTurn];
    if (!player || player.userId !== userId) return { success: false, error: '非当前出牌回合' };

    // 1. Check Concealed Kong (4 identical tiles in hand)
    const matchingInHand = player.hand.filter(t => t.name === tileName);
    if (matchingInHand.length === 4) {
      // Remove all 4 from hand
      const usedIds = new Set(matchingInHand.map(t => t.id));
      player.hand = player.hand.filter(t => !usedIds.has(t.id));
      player.handCount = player.hand.length;

      const meld: Meld = {
        type: 'kong',
        typeLabel: '暗杠',
        tiles: matchingInHand,
        sourcePlayerIndex: this.currentTurn,
      };
      player.melds.push(meld);

      this.addSystemMessage(io, `🀄【${player.name}】 宣告了 【暗杠 · ${tileName}】！`);
      this.drawKongTile(io, this.currentTurn);
      return { success: true };
    }

    // 2. Check Add-on Kong (1 tile in hand matching an existing exposed triplet meld)
    const matchingHandTile = player.hand.find(t => t.name === tileName);
    const existingTriplet = player.melds.find(
      m => (m.type === 'triplet' || m.typeLabel?.includes('碰')) && m.tiles.length === 3 && m.tiles[0].name === tileName
    );

    if (matchingHandTile && existingTriplet) {
      // Remove tile from hand
      const idx = player.hand.findIndex(t => t.id === matchingHandTile.id);
      if (idx !== -1) player.hand.splice(idx, 1);
      player.handCount = player.hand.length;

      // Upgrade triplet to kong
      existingTriplet.type = 'kong';
      existingTriplet.typeLabel = '加杠';
      existingTriplet.tiles.push(matchingHandTile);

      this.addSystemMessage(io, `🀄【${player.name}】 宣告了 【加杠 · ${tileName}】！`);
      this.drawKongTile(io, this.currentTurn);
      return { success: true };
    }

    return { success: false, error: '未满足暗杠或加杠牌型条件' };
  }

  // Player Self-Draw Hu (自摸胡牌)
  playerSelfDrawHu(io: SocketIOServer, userId: string): boolean {
    if (this.status !== 'playing') return false;

    const player = this.players[this.currentTurn];
    if (!player || player.userId !== userId) return false;

    const huResult = checkHu(player.hand, player.melds, false, false);
    if (!huResult.isHu) return false;

    this.triggerRoundEnd(io, {
      winnerIndex: this.currentTurn,
      winnerName: player.name,
      isSelfDraw: true,
      huResult,
      winningTiles: player.hand,
    });
    return true;
  }

  // End round with settlement
  private triggerRoundEnd(io: SocketIOServer, winnerData: MultiplayerGameState['winnerData']): void {
    this.clearTurnTimer();
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }

    this.status = 'round_end';
    this.winnerData = winnerData;

    if (winnerData) {
      const winner = this.players[winnerData.winnerIndex];
      const winPoints = winnerData.huResult.fans * 100;

      if (winnerData.isSelfDraw) {
        // All other 3 players pay winPoints
        this.players.forEach((p, idx) => {
          if (p && idx !== winnerData.winnerIndex) {
            p.score -= winPoints;
          }
        });
        if (winner) winner.score += winPoints * 3;
        this.addSystemMessage(io, `🏆 恭喜【${winnerData.winnerName}】自摸胡牌！${winnerData.huResult.fans}番，各家付 ${winPoints} 分！`);
      } else {
        // Discarder pays winPoints
        const discarder = this.players[winnerData.discarderIndex!];
        if (discarder) discarder.score -= winPoints;
        if (winner) winner.score += winPoints;
        this.addSystemMessage(io, `🏆 恭喜【${winnerData.winnerName}】捉炮胡牌！${winnerData.huResult.fans}番，【${discarder?.name}】放铳付 ${winPoints} 分！`);
      }
    } else {
      this.addSystemMessage(io, `💨 牌墙摸尽，本局荒庄（流局）！各家积分不变。`);
    }

    this.broadcastState(io);
  }

  // Bot Turn Automation (Simulate smart discard or self-draw Hu)
  private scheduleBotTurn(io: SocketIOServer): void {
    if (this.botTimer) clearTimeout(this.botTimer);

    this.botTimer = setTimeout(() => {
      if (this.status !== 'playing') return;
      const bot = this.players[this.currentTurn];
      if (!bot || !bot.isBot || bot.hand.length === 0) return;

      // 1. Check if bot can Self-Draw Hu
      const huCheck = checkHu(bot.hand, bot.melds, false, false);
      if (huCheck.isHu) {
        this.playerSelfDrawHu(io, bot.userId);
        return;
      }

      // 2. Select discard tile using intelligent AI discard strategy
      const tileToDiscard = getBestAiDiscard(bot.hand, bot.melds);
      this.playerDiscard(io, bot.userId, tileToDiscard.id);
    }, 1500 + Math.random() * 1000);
  }

  // Turn Countdown Timer
  private scheduleTurnTimer(io: SocketIOServer): void {
    this.clearTurnTimer();
    const limitMs = (this.settings.turnTimeLimit || 20) * 1000;
    this.turnDeadline = Date.now() + limitMs;

    this.turnTimer = setTimeout(() => {
      if (this.status !== 'playing') return;
      // Auto discard last drawn tile or first tile if turn times out
      const player = this.players[this.currentTurn];
      if (player && player.hand && player.hand.length > 0) {
        const autoTile = player.lastDrawnTile || player.hand[player.hand.length - 1];
        this.addSystemMessage(io, `⏱️ 【${player.name}】 出牌超时，系统自动打出 【${autoTile.name}】`);
        this.playerDiscard(io, player.userId, autoTile.id);
      }
    }, limitMs);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.botTimer) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    this.clearBotClaimTimers();
  }

  private clearBotClaimTimers(): void {
    this.botClaimTimers.forEach(t => clearTimeout(t));
    this.botClaimTimers = [];
  }

  // Chat message
  addChatMessage(io: SocketIOServer, msg: Omit<ChatMessage, 'id' | 'timestamp'>): void {
    const fullMsg: ChatMessage = {
      ...msg,
      id: `chat_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
    };
    this.chatMessages.push(fullMsg);
    if (this.chatMessages.length > 100) this.chatMessages.shift();
    io.to(this.roomId).emit('room:chat_message', fullMsg);
  }

  private addSystemMessage(io: SocketIOServer, text: string): void {
    this.addChatMessage(io, {
      senderId: 'system',
      senderName: '系统公告',
      avatar: '📢',
      text,
      isSystem: true,
    });
  }

  // Broadcast state to each socket in room
  broadcastState(io: SocketIOServer): void {
    this.lastActiveAt = Date.now();
    // 1. Send personalized view (including private hand) to each seated human player
    this.players.forEach(player => {
      if (player && !player.isBot && player.id) {
        const state = this.getClientState(player.userId);
        io.to(player.id).emit('room:game_state', state);
      }
    });

    // 2. Send spectator view to spectators only
    const publicState = this.getClientState();
    this.spectators.forEach(spec => {
      if (spec.socketId) {
        io.to(spec.socketId).emit('room:game_state', publicState);
      }
    });
  }

  // Start next round immediately preserving player scores and seats
  startNextRound(io: SocketIOServer): boolean {
    this.clearTurnTimer();
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }

    // Auto fill empty seats with bots if needed
    for (let i = 0; i < 4; i++) {
      if (this.players[i] === null) {
        this.addBot(i);
      }
    }

    // Advance or keep dealer
    if (this.winnerData) {
      if (this.winnerData.winnerIndex !== this.dealerIndex) {
        this.dealerIndex = (this.dealerIndex + 1) % 4;
      }
    } else {
      this.dealerIndex = (this.dealerIndex + 1) % 4;
    }

    this.roundNumber += 1;
    this.deck = createDeck();
    this.wallIndex = 0;
    this.status = 'playing';
    this.winnerData = null;
    this.lastDiscard = null;
    this.pendingClaimsMap.clear();
    this.pendingSubmissions.clear();

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    this.diceRoll = [d1, d2];
    this.currentTurn = this.dealerIndex;

    // Deal 13 tiles to everyone, 14 to dealer
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (p) {
        p.isReady = true;
        p.melds = [];
        p.discards = [];
        p.lastDrawnTile = null;

        const tileCount = i === this.dealerIndex ? 14 : 13;
        const dealt = this.deck.slice(this.wallIndex, this.wallIndex + tileCount);
        this.wallIndex += tileCount;
        p.hand = sortHand(dealt);
        p.handCount = p.hand.length;

        if (i === this.dealerIndex) {
          p.lastDrawnTile = dealt[dealt.length - 1];
        }
      }
    }

    this.broadcastState(io);
    this.addSystemMessage(
      io,
      `🔄 第 ${this.roundNumber} 局对战开启！本局庄位：【${this.players[this.dealerIndex]?.name}】，掷骰【${d1}+${d2}点】`
    );

    this.scheduleTurnTimer(io);

    const currentP = this.players[this.currentTurn];
    if (currentP && currentP.isBot) {
      this.scheduleBotTurn(io);
    }

    return true;
  }

  // Safely reset room to waiting status for a new round
  resetToWaiting(): void {
    this.clearTurnTimer();
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
    this.status = 'waiting';
    this.deck = [];
    this.wallIndex = 0;
    this.currentTurn = 0;
    this.turnDeadline = 0;
    this.claimDeadline = 0;
    this.lastDiscard = null;
    this.winnerData = null;
    this.pendingClaimsMap.clear();
    this.pendingSubmissions.clear();

    this.players.forEach(p => {
      if (p) {
        p.isReady = p.isHost || p.isBot;
        p.hand = [];
        p.melds = [];
        p.discards = [];
        p.lastDrawnTile = null;
        p.handCount = 0;
      }
    });
  }
}

// Global Rooms Repository
export class MahjongRoomManager {
  private rooms: Map<string, MahjongRoom> = new Map();

  createRoom(hostUserId: string, hostName: string, roomName?: string, settings?: Partial<RoomSettings>): MahjongRoom {
    const roomId = String(Math.floor(100000 + Math.random() * 900000));
    const name = roomName || `五行${roomId.slice(-4)}号台`;
    const room = new MahjongRoom(roomId, name, hostUserId, settings);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): MahjongRoom | undefined {
    return this.rooms.get(roomId);
  }

  getPublicRooms(): RoomListItem[] {
    return Array.from(this.rooms.values())
      .filter(r => !r.settings.isPrivate)
      .map(r => r.summary);
  }

  findQuickMatch(): MahjongRoom | undefined {
    return Array.from(this.rooms.values()).find(
      r =>
        r.status === 'waiting' &&
        !r.settings.isPrivate &&
        (r.players.some(p => p === null) || r.players.some(p => p !== null && p.isBot))
    );
  }

  cleanupEmptyRooms(): void {
    const now = Date.now();
    this.rooms.forEach((room, id) => {
      const humanPlayers = room.players.filter(p => p !== null && !p.isBot);
      const connectedHumans = humanPlayers.filter(p => p?.isConnected);
      
      // If room has no human players at all
      if (humanPlayers.length === 0) {
        this.rooms.delete(id);
        return;
      }

      // If room in waiting status with no connected humans for over 3 minutes
      if (connectedHumans.length === 0 && now - room.lastActiveAt > 180000) {
        this.rooms.delete(id);
      }
    });
  }
}

export const roomManager = new MahjongRoomManager();
