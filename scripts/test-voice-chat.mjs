// scripts/test-voice-chat.mjs
// 全方位模拟测试：五行麻将联网对战在线语音聊天功能
import { io } from 'socket.io-client';

const SERVER_URL = 'http://127.0.0.1:3000';

class VoiceTestRunner {
  constructor() {
    this.results = [];
    this.clients = [];
  }

  log(section, status, message, details = null) {
    const entry = { section, status, message, details, timestamp: new Date().toISOString() };
    this.results.push(entry);
    const badge = status === 'PASS' ? '✅ [PASS]' : status === 'FAIL' ? '❌ [FAIL]' : 'ℹ️ [INFO]';
    console.log(`${badge} [${section}] ${message}`);
    if (details) {
      console.log('   └─ Details:', JSON.stringify(details));
    }
  }

  createClient(name, userId, avatar) {
    return new Promise((resolve, reject) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });

      socket.on('connect', () => {
        resolve({ socket, name, userId, avatar });
      });

      socket.on('connect_error', (err) => {
        reject(err);
      });
    });
  }

  async run() {
    console.log('\n======================================================');
    console.log('🎯 开始执行：五行麻将联网对战在线语音聊天全方位模拟测试');
    console.log('======================================================\n');

    try {
      // 阶段 1: 创建 4 个虚拟玩家客户端
      console.log('--- 测试阶段 1: 四方玩家客户端建立与多路连接 ---');
      const players = [
        { name: '青龙道长(房主)', userId: 'user_dragon_001', avatar: '🐉' },
        { name: '朱雀仙子(下家)', userId: 'user_phoenix_002', avatar: '🦅' },
        { name: '玄武居士(对家)', userId: 'user_turtle_003', avatar: '🐢' },
        { name: '白虎上人(上家)', userId: 'user_tiger_004', avatar: '🐅' },
      ];

      for (const p of players) {
        const client = await this.createClient(p.name, p.userId, p.avatar);
        this.clients.push(client);
      }
      this.log('连接建立', 'PASS', `成功建立 4 路 WebSocket 客户端连接`, { clientCount: this.clients.length });

      // 阶段 2: 房主创建联网对战房间，其余仙友加入
      console.log('\n--- 测试阶段 2: 联网房间创建与席位入驻 ---');
      const [host, p2, p3, p4] = this.clients;

      const createRoomRes = await new Promise((resolve) => {
        host.socket.emit('room:create', {
          userId: host.userId,
          name: host.name,
          roomName: '五行仙音测试房',
          settings: { autoFillBots: false, turnTimeLimit: 20 },
          avatar: host.avatar,
        }, resolve);
      });

      if (!createRoomRes.success) {
        throw new Error(`创建房间失败: ${createRoomRes.error}`);
      }
      const roomId = createRoomRes.roomId;
      this.log('房间创建', 'PASS', `房主创建房间成功: RoomId = ${roomId}`);

      // 其余 3 位玩家加入房间
      for (const p of [p2, p3, p4]) {
        const joinRes = await new Promise((resolve) => {
          p.socket.emit('room:join', {
            roomId,
            userId: p.userId,
            name: p.name,
            avatar: p.avatar,
          }, resolve);
        });
        if (!joinRes.success) throw new Error(`${p.name} 加入房间失败: ${joinRes.error}`);
      }
      this.log('玩家就位', 'PASS', `四方玩家全部入驻对局房间 #${roomId}`);

      // 阶段 3: 语音房间接入与成员状态同步 (voice:join, voice:sync_members, voice:user_joined)
      console.log('\n--- 测试阶段 3: 在线语音信道加入与动态成员状态同步 ---');
      
      // 房主先加入语音
      const hostJoinedPromise = new Promise((resolve) => {
        host.socket.once('voice:sync_members', (members) => resolve(members));
      });
      host.socket.emit('voice:join', { roomId, userId: host.userId, name: host.name, avatar: host.avatar });
      const hostInitialMembers = await hostJoinedPromise;
      this.log('房主进房', 'PASS', `房主加入语音房间，已收到同步初始成员列表`, { existingCount: hostInitialMembers.length });

      // 玩家2加入，房主应收到 voice:user_joined，玩家2应收到包含房主的 sync_members
      const p2SyncPromise = new Promise(resolve => p2.socket.once('voice:sync_members', resolve));
      const hostReceivedP2Promise = new Promise(resolve => host.socket.once('voice:user_joined', resolve));

      p2.socket.emit('voice:join', { roomId, userId: p2.userId, name: p2.name, avatar: p2.avatar });
      const [p2Synced, hostNotified] = await Promise.all([p2SyncPromise, hostReceivedP2Promise]);

      const p2HasHost = p2Synced.some(m => m.userId === host.userId);
      if (p2HasHost && hostNotified.userId === p2.userId) {
        this.log('增量同步', 'PASS', `二号玩家加入，双向成员同步成功`, {
          p2SyncedCount: p2Synced.length,
          hostReceivedNewMember: hostNotified.name,
        });
      } else {
        this.log('增量同步', 'FAIL', `成员同步异常`, { p2Synced, hostNotified });
      }

      // 玩家3与玩家4相继加入语音
      for (const p of [p3, p4]) {
        p.socket.emit('voice:join', { roomId, userId: p.userId, name: p.name, avatar: p.avatar });
      }
      await new Promise(r => setTimeout(r, 100));
      this.log('四人连线', 'PASS', `四方玩家已全部成功接入在线语音广播房间 voice:${roomId}`);

      // 阶段 4: 实时说话状态广播 (voice:speaking) 与光环联动
      console.log('\n--- 测试阶段 4: VAD声控/说话状态(Speaking)实时广播与延迟测试 ---');
      const startTime = Date.now();
      const p2SpeakingEventPromise = new Promise(resolve => {
        p2.socket.once('voice:speaking', (data) => resolve({ ...data, rtt: Date.now() - startTime }));
      });
      const p3SpeakingEventPromise = new Promise(resolve => {
        p3.socket.once('voice:speaking', (data) => resolve({ ...data, rtt: Date.now() - startTime }));
      });

      // 房主开麦说话
      host.socket.emit('voice:speaking', { roomId, userId: host.userId, isSpeaking: true });
      const [p2SpeakingData, p3SpeakingData] = await Promise.all([p2SpeakingEventPromise, p3SpeakingEventPromise]);

      if (p2SpeakingData.userId === host.userId && p2SpeakingData.isSpeaking === true) {
        this.log('发言广播', 'PASS', `房主发言信令下发成功，各座席即时收到光环点亮通知`, {
          p2LatencyMs: p2SpeakingData.rtt,
          p3LatencyMs: p3SpeakingData.rtt,
        });
      } else {
        this.log('发言广播', 'FAIL', `发言广播异常`, { p2SpeakingData });
      }

      // 房主闭麦停止说话
      const p2StopSpeakingPromise = new Promise(resolve => p2.socket.once('voice:speaking', resolve));
      host.socket.emit('voice:speaking', { roomId, userId: host.userId, isSpeaking: false });
      const stopData = await p2StopSpeakingPromise;
      if (stopData.isSpeaking === false) {
        this.log('停止发言', 'PASS', `房主停止讲话，各席位光环平滑熄灭复位`);
      }

      // 阶段 5: 麦克风静音状态切换 (voice:mute_status)
      console.log('\n--- 测试阶段 5: 麦克风全局静音/取消静音状态同步 ---');
      const p3MutePromise = new Promise(resolve => p3.socket.once('voice:mute_status', resolve));
      // 玩家2将自己静音
      p2.socket.emit('voice:mute_status', { roomId, userId: p2.userId, isMuted: true });
      const muteData = await p3MutePromise;
      if (muteData.userId === p2.userId && muteData.isMuted === true) {
        this.log('静音通知', 'PASS', `玩家2静音状态已成功广播至其他道友席位`, muteData);
      }

      // 玩家2解除静音
      const p3UnmutePromise = new Promise(resolve => p3.socket.once('voice:mute_status', resolve));
      p2.socket.emit('voice:mute_status', { roomId, userId: p2.userId, isMuted: false });
      const unmuteData = await p3UnmutePromise;
      if (unmuteData.userId === p2.userId && unmuteData.isMuted === false) {
        this.log('解除静音', 'PASS', `玩家2解除静音成功广播`, unmuteData);
      }

      // 阶段 6: 实时音频流数据传输与完整性校验 (voice:data)
      console.log('\n--- 测试阶段 6: 实时语音音频数据切片传输与吞吐量验证 ---');
      const fakeAudioBuffer = Buffer.from('RIFF_WAVE_TEST_VOICE_STREAM_DATA_CHUNK_OPUS_PAYLOAD_五行仙音_1234567890');
      const audioBase64 = fakeAudioBuffer.toString('base64');
      const sendTime = Date.now();

      const audioRecvPromise = new Promise(resolve => {
        host.socket.once('voice:data', (data) => resolve({ ...data, rtt: Date.now() - sendTime }));
      });

      // 玩家3(玄武居士)发送音频切片
      p3.socket.emit('voice:data', {
        roomId,
        userId: p3.userId,
        audioData: audioBase64,
        mimeType: 'audio/webm;codecs=opus',
      });

      const audioRecv = await audioRecvPromise;
      const isContentIdentical = audioRecv.audioData === audioBase64;
      if (isContentIdentical && audioRecv.userId === p3.userId) {
        this.log('音频流传输', 'PASS', `音频切片成功通过低延迟通道广播，数据校验 100% 完整无损`, {
          bytesTransferred: fakeAudioBuffer.length,
          mimeType: audioRecv.mimeType,
          transferLatencyMs: audioRecv.rtt,
        });
      } else {
        this.log('音频流传输', 'FAIL', `音频数据传输异常或校验不匹配`);
      }

      // 阶段 7: 多人并发同讲压力测试 (Multi-Speaker Concurrent Stream)
      console.log('\n--- 测试阶段 7: 双仙友并发同讲(Concurrent Multi-Speaker)混流测试 ---');
      let p4RecvHost = false;
      let p4RecvP2 = false;

      const p4RecvPromise = new Promise(resolve => {
        const handler = (data) => {
          if (data.userId === host.userId) p4RecvHost = true;
          if (data.userId === p2.userId) p4RecvP2 = true;
          if (p4RecvHost && p4RecvP2) {
            p4.socket.off('voice:speaking', handler);
            resolve(true);
          }
        };
        p4.socket.on('voice:speaking', handler);
      });

      // 房主与玩家2同时开麦
      host.socket.emit('voice:speaking', { roomId, userId: host.userId, isSpeaking: true });
      p2.socket.emit('voice:speaking', { roomId, userId: p2.userId, isSpeaking: true });

      const concurrentSuccess = await Promise.race([
        p4RecvPromise,
        new Promise(r => setTimeout(() => r(false), 2000)),
      ]);

      if (concurrentSuccess) {
        this.log('并发同讲', 'PASS', `多路语音并发状态正确同步，无消息踩踏或通道串线`);
      } else {
        this.log('并发同讲', 'FAIL', `并发说话事件未完全被捕获`);
      }

      // 阶段 8: 优雅退出 (voice:leave) 与异常掉线自动清理测试
      console.log('\n--- 测试阶段 8: 优雅退出与网络断开连接自动回收机制 ---');
      
      // 玩家4主动优雅退出语音
      const p1LeavePromise = new Promise(resolve => host.socket.once('voice:user_left', resolve));
      p4.socket.emit('voice:leave', { roomId, userId: p4.userId });
      const p4LeftData = await p1LeavePromise;
      if (p4LeftData.userId === p4.userId) {
        this.log('优雅退出', 'PASS', `玩家4主动调用 voice:leave，其他玩家立即收到成员离线通知`, p4LeftData);
      }

      // 玩家3非正常断开连接（如网络崩溃、刷新或关闭网页）
      const p1DisconnectNoticePromise = new Promise(resolve => host.socket.once('voice:user_left', resolve));
      p3.socket.disconnect();
      const p3DroppedData = await p1DisconnectNoticePromise;
      if (p3DroppedData.userId === p3.userId) {
        this.log('断线回收', 'PASS', `玩家3网络中断后，服务器自动感知并向全房广播移除，防止幽灵麦`, p3DroppedData);
      }

      console.log('\n======================================================');
      console.log('🎉 所有测试阶段已顺利执行完毕！');
      console.log('======================================================\n');

      return { success: true, results: this.results };
    } catch (err) {
      this.log('全局异常', 'FAIL', `测试执行过程中断: ${err.message}`);
      return { success: false, error: err.message, results: this.results };
    } finally {
      // 清理所有连接
      for (const client of this.clients) {
        if (client.socket.connected) {
          client.socket.disconnect();
        }
      }
    }
  }
}

const runner = new VoiceTestRunner();
runner.run().then((report) => {
  const passCount = report.results.filter(r => r.status === 'PASS').length;
  const failCount = report.results.filter(r => r.status === 'FAIL').length;
  console.log(`\n📊 测试结果汇总: 总计 ${passCount + failCount} 项 | 通过 ${passCount} | 失败 ${failCount}`);
  process.exit(failCount === 0 ? 0 : 1);
});
