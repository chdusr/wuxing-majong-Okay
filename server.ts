import express from 'express';
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import path from 'path';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { roomManager } from './server/mahjongRoomManager';
import { AvailableClaim } from './src/types/mahjong';
import { RoomSettings } from './src/types/multiplayer';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  transports: ['polling', 'websocket'],
  pingTimeout: 30000,
  pingInterval: 10000,
});
const PORT = 3000;

app.use(express.json());

// Enable CORS for all cross-origin requests (e.g. EdgeOne, CDN, or custom domains)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Lazy Gemini client helper
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Multiplayer room list REST endpoint
app.get('/api/mahjong/rooms', (req, res) => {
  roomManager.cleanupEmptyRooms();
  res.json({ rooms: roomManager.getPublicRooms() });
});

// Advanced Server & IP/Port Diagnostic Endpoint
app.get('/api/mahjong/diagnose-server', async (req, res) => {
  const rawTarget = typeof req.query.target === 'string' ? req.query.target.trim() : '';
  if (!rawTarget) {
    return res.status(400).json({ success: false, error: '缺少 target 参数' });
  }

  let cleanTarget = rawTarget;
  let protocol = 'http';
  if (/^https:\/\//i.test(cleanTarget)) {
    protocol = 'https';
    cleanTarget = cleanTarget.replace(/^https:\/\//i, '');
  } else if (/^http:\/\//i.test(cleanTarget)) {
    protocol = 'http';
    cleanTarget = cleanTarget.replace(/^http:\/\//i, '');
  } else if (/^\/\//.test(cleanTarget)) {
    cleanTarget = cleanTarget.replace(/^\/\//, '');
  }

  const hostAndPort = cleanTarget.split('/')[0].split('?')[0].split('#')[0];
  let host = hostAndPort;
  let port = protocol === 'https' ? 443 : 3000;

  if (hostAndPort.includes(':')) {
    const lastColon = hostAndPort.lastIndexOf(':');
    host = hostAndPort.substring(0, lastColon);
    const parsedPort = parseInt(hostAndPort.substring(lastColon + 1), 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort;
    }
  }

  if (!host) {
    return res.status(400).json({ success: false, error: '无法从目标地址解析出有效 Host/IP' });
  }

  // 1. DNS Lookup (if domain)
  let resolvedIps: string[] = [];
  const isIpV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  if (!isIpV4 && host !== 'localhost') {
    try {
      const records = await dns.promises.lookup(host, { all: true });
      resolvedIps = records.map(r => r.address);
      if (resolvedIps.length === 0) {
        return res.json({
          success: false,
          target: rawTarget,
          host,
          port,
          errorType: 'DNS_EMPTY',
          error: `域名 ${host} 解析未返回任何 IP 地址，请检查 DNS A记录是否配置`,
        });
      }
    } catch (dnsErr: any) {
      return res.json({
        success: false,
        target: rawTarget,
        host,
        port,
        errorType: 'DNS_FAILED',
        error: `域名 DNS 查找失败 (${dnsErr.code || dnsErr.message})：域名不存在、未解析或尚未在全球生效`,
      });
    }
  }

  // 2. TCP Port Connectivity Test
  const tcpTargetHost = resolvedIps.length > 0 ? resolvedIps[0] : host;
  const tcpStartTime = Date.now();
  const tcpResult = await new Promise<{ ok: boolean; error?: string; latencyMs?: number }>((resolve) => {
    const client = new net.Socket();
    client.setTimeout(3500);

    client.connect(port, tcpTargetHost, () => {
      const latency = Date.now() - tcpStartTime;
      client.destroy();
      resolve({ ok: true, latencyMs: latency });
    });

    client.on('error', (err: any) => {
      client.destroy();
      if (err.code === 'ECONNREFUSED') {
        resolve({
          ok: false,
          error: `TCP 连接被拒绝 (ECONNREFUSED)：目标服务器网络可达，但端口 ${port} 上没有运行任何服务（请检查是否已在服务器使用 npm start 或 pm2 启动 Node.js）`,
        });
      } else {
        resolve({ ok: false, error: `TCP 连接失败 (${err.code || err.message})` });
      }
    });

    client.on('timeout', () => {
      client.destroy();
      resolve({
        ok: false,
        error: `TCP 连接超时（3.5秒未响应）：数据包无法到达端口 ${port}。最常见原因是腾讯云/阿里云控制台【安全组】或系统防火墙未放行 TCP ${port} 端口入站规则。`,
      });
    });
  });

  if (!tcpResult.ok) {
    return res.json({
      success: false,
      target: rawTarget,
      host,
      port,
      resolvedIps,
      errorType: 'TCP_UNREACHABLE',
      error: tcpResult.error,
    });
  }

  // 3. HTTP Health & ICP Inspection
  const testUrl = `${protocol}://${host}:${port}/api/health`;
  const httpStartTime = Date.now();
  try {
    const httpModule = protocol === 'https' ? https : http;
    const httpResult = await new Promise<{ status: number; body: string; latencyMs: number }>((resolve, reject) => {
      const reqHttp = httpModule.get(testUrl, { timeout: 3500 }, (resp) => {
        let data = '';
        resp.on('data', chunk => { data += chunk; });
        resp.on('end', () => {
          resolve({ status: resp.statusCode || 0, body: data, latencyMs: Date.now() - httpStartTime });
        });
      });
      reqHttp.on('error', reject);
      reqHttp.on('timeout', () => {
        reqHttp.destroy();
        reject(new Error('HTTP 响应超时'));
      });
    });

    // Check for ICP block page (common in Mainland Cloud Providers)
    if (httpResult.status === 403 || httpResult.body.includes('ICP') || httpResult.body.includes('备案') || httpResult.body.includes('Non-compliance')) {
      return res.json({
        success: false,
        target: rawTarget,
        host,
        port,
        resolvedIps,
        errorType: 'ICP_BLOCKED',
        error: `机房防火墙 ICP 备案拦截 (HTTP 403)：检测到域名或服务器未在机房完成工信部 ICP 备案被阻断。建议：改用 IP:端口 直连、使用海外云服务器、或使用本应用自带的【官方云端中继】免建服联机。`,
      });
    }

    try {
      const parsedJson = JSON.parse(httpResult.body);
      if (parsedJson.status === 'ok') {
        return res.json({
          success: true,
          target: rawTarget,
          host,
          port,
          resolvedIps,
          latencyMs: httpResult.latencyMs,
          message: `连通正常！服务响应正常 (延迟: ${httpResult.latencyMs}ms)`,
        });
      }
    } catch (e) {
      // not JSON
    }

    return res.json({
      success: true,
      target: rawTarget,
      host,
      port,
      resolvedIps,
      latencyMs: httpResult.latencyMs,
      message: `端口及服务可通，HTTP 状态码: ${httpResult.status}`,
    });
  } catch (httpErr: any) {
    return res.json({
      success: false,
      target: rawTarget,
      host,
      port,
      resolvedIps,
      errorType: 'HTTP_FAILED',
      error: `TCP 已连接，但 HTTP 请求失败: ${httpErr.message}`,
    });
  }
});

// AI Time Ju Analysis
app.post('/api/gemini/analyze-timeju', async (req, res) => {
  try {
    const { chartData, userQuestion } = req.body;
    if (!chartData) {
      return res.status(400).json({ error: 'Missing chartData' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      // Fallback deterministic interpretation if API key is not present in local test
      const { genderLabel, zodiac, lunarText, overviewPillars, stemHints, branchHints, dominantElement, favoredElement } = chartData;
      const fallbackText = `### 【五行时间局·气场断验】
- **局象定格**：${genderLabel} ${zodiac}，${lunarText}。
- **四柱排盘**：年柱【${overviewPillars.year.stem}${overviewPillars.year.branch}】、月柱【${overviewPillars.month.stem}${overviewPillars.month.branch}】、日柱【${overviewPillars.day.stem}${overviewPillars.day.branch}】、时柱【${overviewPillars.hour.stem}${overviewPillars.hour.branch}】。
- **干支生克**：${stemHints}；${branchHints}。
- **能量喜忌**：全局五行中【${dominantElement}】气最旺，喜用以【${favoredElement}】为调候化解之机。
- **当下时辰决断建议**：此时天干透出七杀与正官，官杀有气，适合稳健谋划、签署合约与定夺事务，忌急躁妄动。`;
      return res.json({ analysis: fallbackText, isFallback: true });
    }

    const prompt = `你是一位精通中国传统干支历法、子平命理、五行生克与时家奇门时间局的国学导师。请基于以下【五行时间局】排盘数据，给出一份详尽、典雅、实用且积极向上的时辰气象与运势指引：

【排盘数据】：
- 局名/性别：${chartData.genderLabel} (${chartData.xunShou}) ${chartData.zodiac}，笔画：${chartData.strokeCount}划
- 农历与时辰：${chartData.lunarText}
- 公历时间：${chartData.gregorianDateStr}
- 年柱：${chartData.overviewPillars.year.stem}${chartData.overviewPillars.year.branch} (主星：${chartData.overviewPillars.year.stemGod})
- 月柱：${chartData.overviewPillars.month.stem}${chartData.overviewPillars.month.branch} (主星：${chartData.overviewPillars.month.stemGod})
- 日柱：${chartData.overviewPillars.day.stem}${chartData.overviewPillars.day.branch} (主星：${chartData.overviewPillars.day.stemGod})
- 时柱：${chartData.overviewPillars.hour.stem}${chartData.overviewPillars.hour.branch} (主星：${chartData.overviewPillars.hour.stemGod})
- 天干提示：${chartData.stemHints}
- 地支提示：${chartData.branchHints}
- 五行能量：木${chartData.fiveElementsStats.wood}% 火${chartData.fiveElementsStats.fire}% 土${chartData.fiveElementsStats.earth}% 金${chartData.fiveElementsStats.metal}% 水${chartData.fiveElementsStats.water}% (最旺：${chartData.dominantElement}，喜用建议：${chartData.favoredElement})
${userQuestion ? `- 用户特定求问：${userQuestion}` : ''}

【输出要求】：
1. **时辰局象总论**：精辟提炼当前时局的气机特点、十神格局意象。
2. **干支刑冲合害解读**：专门解释提示中的关键作用（如暗合、自刑、相害等在现实生活中的对应象征）。
3. **五行调候与开运指南**：给出适宜的方位、颜色、穿戴或环境调节建议。
4. **即时行动与决策宜忌**：对于工作谈判、求财、沟通、出行、静养等具体场景的黄金指引。
排版请使用清晰的 Markdown 结构，语言兼具传统国学韵味与现代实用启发。`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: prompt,
    });

    res.json({ analysis: response.text });
  } catch (err: any) {
    console.error('Error in /api/gemini/analyze-timeju:', err);
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

// Socket.IO Real-Time Multiplayer Mahjong Handlers
io.on('connection', socket => {
  let currentRoomId: string | null = null;
  let currentUserId: string | null = null;

  // Create Room
  socket.on(
    'room:create',
    (
      data: {
        userId: string;
        name: string;
        avatar: string;
        roomName?: string;
        settings?: Partial<RoomSettings>;
      },
      callback
    ) => {
      try {
        const { userId, name, avatar, roomName, settings } = data;
        const room = roomManager.createRoom(userId, name, roomName, settings);
        currentRoomId = room.roomId;
        currentUserId = userId;

        socket.join(room.roomId);
        room.addPlayer(socket.id, userId, name, avatar);
        room.broadcastState(io);

        io.emit('lobby:rooms_update', roomManager.getPublicRooms());
        if (callback) {
          callback({
            success: true,
            roomId: room.roomId,
            state: room.getClientState(userId),
          });
        }
      } catch (e: any) {
        if (callback) callback({ success: false, error: e.message });
      }
    }
  );

  // Join Room
  socket.on(
    'room:join',
    (
      data: {
        roomId: string;
        userId: string;
        name: string;
        avatar: string;
        password?: string;
      },
      callback
    ) => {
      try {
        const { roomId, userId, name, avatar, password } = data;
        const room = roomManager.getRoom(roomId);
        if (!room) {
          if (callback) callback({ success: false, error: '房间不存在或已解散' });
          return;
        }

        if (room.settings.isPrivate && room.settings.password && room.settings.password !== password) {
          if (callback) callback({ success: false, error: '房间密码错误' });
          return;
        }

        currentRoomId = roomId;
        currentUserId = userId;
        socket.join(roomId);

        const joinResult = room.addPlayer(socket.id, userId, name, avatar);
        room.broadcastState(io);
        io.emit('lobby:rooms_update', roomManager.getPublicRooms());

        if (callback) {
          callback({
            success: true,
            roomId,
            state: room.getClientState(userId),
            message: joinResult.message,
          });
        }
      } catch (e: any) {
        if (callback) callback({ success: false, error: e.message });
      }
    }
  );

  // Quick Match
  socket.on(
    'room:quick_match',
    (data: { userId: string; name: string; avatar: string }, callback) => {
      try {
        let room = roomManager.findQuickMatch();
        if (!room) {
          room = roomManager.createRoom(data.userId, data.name, `${data.name}的五行速配房`, {
            autoFillBots: true,
            turnTimeLimit: 20,
          });
        }

        currentRoomId = room.roomId;
        currentUserId = data.userId;
        socket.join(room.roomId);

        room.addPlayer(socket.id, data.userId, data.name, data.avatar);
        room.broadcastState(io);
        io.emit('lobby:rooms_update', roomManager.getPublicRooms());

        if (callback) {
          callback({
            success: true,
            roomId: room.roomId,
            state: room.getClientState(data.userId),
          });
        }
      } catch (e: any) {
        if (callback) callback({ success: false, error: e.message });
      }
    }
  );

  // Sync / Get current state
  socket.on('room:sync', (data: { roomId: string; userId: string }, callback) => {
    try {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        currentRoomId = data.roomId;
        currentUserId = data.userId;
        socket.join(data.roomId);
        // Ensure socketId is up to date
        const seated = room.players.find(p => p?.userId === data.userId);
        if (seated) {
          seated.id = socket.id;
          seated.isConnected = true;
        }
        if (callback) {
          callback({
            success: true,
            state: room.getClientState(data.userId),
          });
        }
      } else {
        if (callback) callback({ success: false, error: '房间已不存在' });
      }
    } catch (e: any) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // Leave Room
  socket.on('room:leave', (data: { roomId: string; userId: string }, callback) => {
    try {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        room.removePlayer(data.userId);
        socket.leave(data.roomId);
        room.broadcastState(io);
        roomManager.cleanupEmptyRooms();
        io.emit('lobby:rooms_update', roomManager.getPublicRooms());
      }
      currentRoomId = null;
      if (callback) callback({ success: true });
    } catch (e: any) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // Toggle Ready
  socket.on('room:set_ready', (data: { roomId: string; userId: string; isReady: boolean }) => {
    const room = roomManager.getRoom(data.roomId);
    if (room) {
      room.setReady(data.userId, data.isReady);
      room.broadcastState(io);
    }
  });

  // Add Bot to a Seat
  socket.on('room:add_bot', (data: { roomId: string; seatIndex?: number }, callback) => {
    try {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        const added = room.addBot(data.seatIndex);
        room.broadcastState(io);
        if (callback) callback({ success: added, error: added ? undefined : '添加电脑人失败，席位已满或对局已开始' });
      } else {
        if (callback) callback({ success: false, error: '房间不存在' });
      }
    } catch (e: any) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // Fill All Remaining Seats with Bots
  socket.on('room:fill_bots', (data: { roomId: string }, callback) => {
    try {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        const count = room.fillBots();
        room.broadcastState(io);
        if (callback) callback({ success: count > 0, count, error: count > 0 ? undefined : '桌台已满，无需补齐' });
      } else {
        if (callback) callback({ success: false, error: '房间不存在' });
      }
    } catch (e: any) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // Host Kick Seat / Remove Bot
  socket.on('room:kick_seat', (data: { roomId: string; seatIndex: number }, callback) => {
    try {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        const kicked = room.kickSeat(data.seatIndex);
        room.broadcastState(io);
        if (callback) callback({ success: kicked });
      } else {
        if (callback) callback({ success: false, error: '房间不存在' });
      }
    } catch (e: any) {
      if (callback) callback({ success: false, error: e.message });
    }
  });

  // Host Start Game
  socket.on('room:start_game', (data: { roomId: string; userId: string }, callback) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) {
      if (callback) callback({ success: false, error: '房间不存在' });
      return;
    }
    if (room.hostUserId !== data.userId) {
      if (callback) callback({ success: false, error: '仅房主可开启对局' });
      return;
    }

    const started = room.startGame(io);
    io.emit('lobby:rooms_update', roomManager.getPublicRooms());
    if (callback) {
      callback({
        success: started,
        error: started ? undefined : '无法开启对局：请确保所有入座的真人玩家均已点击“准备”',
      });
    }
  });

  // Player Discard Tile
  socket.on('room:discard', (data: { roomId: string; userId: string; tileId: string }) => {
    const room = roomManager.getRoom(data.roomId);
    if (room) {
      room.playerDiscard(io, data.userId, data.tileId);
    }
  });

  // Player Claim Action (Eat/Pung/Clash/Kong/Hu/Pass)
  socket.on(
    'room:claim_action',
    (data: { roomId: string; userId: string; claim: AvailableClaim | null }) => {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        room.submitClaimAction(io, data.userId, data.claim);
      }
    }
  );

  // Player Self-Draw Hu
  socket.on('room:self_draw_hu', (data: { roomId: string; userId: string }, callback) => {
    const room = roomManager.getRoom(data.roomId);
    if (room) {
      const success = room.playerSelfDrawHu(io, data.userId);
      if (callback) callback({ success });
    }
  });

  // In-Game Chat / Quick Shouts
  socket.on(
    'room:send_chat',
    (data: {
      roomId: string;
      userId: string;
      name: string;
      avatar: string;
      text: string;
      type?: 'text' | 'emoji' | 'shout';
    }) => {
      const room = roomManager.getRoom(data.roomId);
      if (room) {
        room.addChatMessage(io, {
          senderId: data.userId,
          senderName: data.name,
          avatar: data.avatar,
          text: data.text,
          type: data.type || 'text',
        });
      }
    }
  );

  // Play Next Round (再来一局)
  socket.on('room:next_round', (data: { roomId: string; userId: string }, callback) => {
    const room = roomManager.getRoom(data.roomId);
    if (!room) {
      if (callback) callback({ success: false, error: '房间不存在' });
      return;
    }

    const player = room.players.find(p => p?.userId === data.userId);
    if (!player) {
      if (callback) callback({ success: false, error: '未在房间座位中' });
      return;
    }

    // If host triggered, start next round directly
    if (player.isHost) {
      const started = room.startNextRound(io);
      io.emit('lobby:rooms_update', roomManager.getPublicRooms());
      if (callback) callback({ success: started });
    } else {
      // Mark ready for next round and notify
      player.isReady = true;
      room.addChatMessage(io, {
        senderId: player.userId,
        senderName: player.name,
        avatar: player.avatar,
        text: `【${player.name}】已准备开启下一局！`,
        isSystem: true,
      });
      room.broadcastState(io);

      // If all human players are ready, auto-start next round
      const allHumansReady = room.players.every(p => p === null || p.isBot || p.isReady);
      if (allHumansReady) {
        room.startNextRound(io);
        io.emit('lobby:rooms_update', roomManager.getPublicRooms());
      }
      if (callback) callback({ success: true });
    }
  });

  // Reset to Waiting Table (重置新局)
  socket.on('room:restart_game', (data: { roomId: string; userId: string }, callback) => {
    const room = roomManager.getRoom(data.roomId);
    if (room) {
      room.resetToWaiting();
      room.broadcastState(io);
      io.emit('lobby:rooms_update', roomManager.getPublicRooms());
      if (callback) callback({ success: true });
    } else {
      if (callback) callback({ success: false, error: '房间不存在' });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoomId) {
      const room = roomManager.getRoom(currentRoomId);
      if (room) {
        room.handleDisconnect(socket.id);
        room.broadcastState(io);
        roomManager.cleanupEmptyRooms();
        io.emit('lobby:rooms_update', roomManager.getPublicRooms());
      }
    }
  });
});

// Vite middleware & Static serving
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`五行麻将 & 时间局 server running on http://localhost:${PORT}`);
  });
}

start();

